import { defaultBatchOptions, processConcurrently } from './batch'
import {
	classifyError,
	getRetryDelay as getErrorRetryDelay,
	MessageValidationError,
	wrapError,
} from './errors'
import { defaultRetryStrategy, getRetryDelay } from './retry'

import type { z } from 'zod'
import type {
	BatchProcessingResult,
	MessageBatch,
	MessageMetadata,
	QueueConsumerConfig,
	QueueHandler,
} from './types'

/**
 * Abstract base class for type-safe queue consumers
 *
 * Extend this class and implement the handleMessage method to create a queue consumer.
 *
 * @example
 * ```typescript
 * import { QueueConsumer } from '@repo/queue-utils'
 * import { characterUpdateSchema } from './schemas'
 *
 * class CharacterUpdateConsumer extends QueueConsumer {
 *   constructor(env: Env) {
 *     super({ schema: characterUpdateSchema })
 *     this.env = env
 *   }
 *
 *   async handleMessage(message, metadata) {
 *     console.log(`Processing character ${message.characterId}`)
 *     // ... processing logic
 *   }
 * }
 *
 * export default {
 *   async queue(batch, env, ctx) {
 *     const consumer = new CharacterUpdateConsumer(env)
 *     await consumer.queue(batch, env, ctx)
 *   }
 * }
 * ```
 */
export abstract class QueueConsumer<T extends z.ZodType> {
	protected readonly schema: T
	protected readonly retryStrategy: typeof defaultRetryStrategy
	protected readonly batchOptions: typeof defaultBatchOptions
	protected readonly errorHandler?: QueueConsumerConfig<T>['errorHandler']
	protected readonly hooks?: QueueConsumerConfig<T>['hooks']
	protected readonly debug: boolean

	constructor(config: QueueConsumerConfig<T>) {
		this.schema = config.schema
		this.retryStrategy = config.retryStrategy || defaultRetryStrategy
		this.batchOptions = { ...defaultBatchOptions, ...config.batchOptions }
		this.errorHandler = config.errorHandler
		this.hooks = config.hooks
		this.debug = config.debug || false
	}

	/**
	 * Handle a single validated message
	 * Override this method to implement message processing logic
	 */
	abstract handleMessage(message: z.infer<T>, metadata: MessageMetadata): Promise<void>

	/**
	 * Queue handler function
	 * This is the entry point called by Cloudflare Workers Queue
	 */
	async queue(batch: MessageBatch<unknown>, env: unknown, ctx: ExecutionContext): Promise<void> {
		if (this.debug) {
			console.log(`[QueueConsumer] Processing batch of ${batch.messages.length} messages`)
		}

		// Call onBatchStart hook
		if (this.hooks?.onBatchStart) {
			await this.hooks.onBatchStart(batch)
		}

		// Track attempts for each message
		const messageAttempts = new Map<string, number>()

		// Process messages with concurrency control
		const errors: Array<{ error: Error; messageId: string }> = []
		let successful = 0
		let failed = 0
		let retried = 0

		await processConcurrently(
			batch.messages,
			async (message) => {
				try {
					// Track attempt count
					const attempt = (messageAttempts.get(message.id) || 0) + 1
					messageAttempts.set(message.id, attempt)

					// Create metadata
					const metadata: MessageMetadata = {
						originalMessage: message,
						batch,
						attempt,
						env,
						ctx,
					}

					// Validate message
					let parsed: z.infer<T>
					try {
						parsed = this.schema.parse(message.body)
					} catch (error) {
						throw new MessageValidationError(
							'Message validation failed',
							error,
							error instanceof Error ? error : undefined
						)
					}

					// Process message
					await this.handleMessage(parsed, metadata)

					// Success - acknowledge message
					message.ack()
					successful++

					// Call onMessageSuccess hook
					if (this.hooks?.onMessageSuccess) {
						await this.hooks.onMessageSuccess(parsed, metadata)
					}

					if (this.debug) {
						console.log(`[QueueConsumer] Successfully processed message ${message.id}`)
					}
				} catch (error) {
					const wrappedError = wrapError(error)

					// Create metadata for error handling
					const metadata: MessageMetadata = {
						originalMessage: message,
						batch,
						attempt: messageAttempts.get(message.id) || 1,
						env,
						ctx,
					}

					// Try to get parsed message for error handlers
					let parsedMessage: z.infer<T> | undefined
					try {
						parsedMessage = this.schema.parse(message.body)
					} catch {
						// Message couldn't be parsed
					}

					// Determine how to handle the error
					let decision: 'retry' | 'ack' | 'fatal'
					const hasCustomErrorHandler = !!this.errorHandler

					// Use custom error handler if provided
					if (hasCustomErrorHandler) {
						decision = await this.errorHandler!(wrappedError, parsedMessage, metadata)
					} else {
						// Use default error classification
						decision = classifyError(wrappedError)
					}

					// Check if we should retry
					let shouldRetry = false
					if (decision === 'retry') {
						// Check if we've exceeded max attempts
						if (metadata.attempt > this.retryStrategy.maxAttempts) {
							shouldRetry = false
						} else if (hasCustomErrorHandler) {
							// Custom error handler explicitly said retry, respect that
							shouldRetry = true
						} else if (this.retryStrategy.shouldRetry) {
							// Use retry strategy's predicate
							shouldRetry = this.retryStrategy.shouldRetry(wrappedError)
						} else {
							// No predicate, default to retry
							shouldRetry = true
						}
					}

					if (shouldRetry) {
						// Calculate retry delay
						const errorDelay = getErrorRetryDelay(wrappedError)
						const strategyDelay = getRetryDelay(metadata.attempt, this.retryStrategy)
						const delaySeconds = errorDelay !== undefined ? errorDelay : strategyDelay

						message.retry({ delaySeconds })
						retried++

						if (this.debug) {
							console.log(
								`[QueueConsumer] Retrying message ${message.id} (attempt ${metadata.attempt}) after ${delaySeconds}s`
							)
						}
					} else {
						// Either fatal error or max retries exceeded - acknowledge to prevent infinite loop
						message.ack()
						failed++

						if (this.debug) {
							console.error(
								`[QueueConsumer] Failed to process message ${message.id} (attempt ${metadata.attempt}):`,
								wrappedError
							)
						}
					}

					// Call onMessageError hook
					if (this.hooks?.onMessageError) {
						await this.hooks.onMessageError(wrappedError, parsedMessage, metadata)
					}

					// Track error
					errors.push({
						error: wrappedError,
						messageId: message.id,
					})
				}
			},
			this.batchOptions.concurrency
		)

		// Create result summary
		const result: BatchProcessingResult = {
			total: batch.messages.length,
			successful,
			failed,
			retried,
			errors,
		}

		// Call onBatchComplete hook
		if (this.hooks?.onBatchComplete) {
			await this.hooks.onBatchComplete(batch, result)
		}

		if (this.debug) {
			console.log(
				`[QueueConsumer] Batch complete: ${successful} successful, ${failed} failed, ${retried} retried`
			)
		}
	}

	/**
	 * Create a queue handler function from this consumer
	 * Useful for directly exporting as the queue handler
	 */
	toHandler(): QueueHandler {
		return (batch, env, ctx) => this.queue(batch, env, ctx)
	}
}
