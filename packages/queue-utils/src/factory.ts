import type { z } from 'zod'
import type {
	MessageBatch,
	MessageHandler,
	MessageMetadata,
	QueueConsumerConfig,
	QueueHandler,
	BatchProcessingResult,
} from './types'
import {
	MessageValidationError,
	wrapError,
	getRetryDelay as getErrorRetryDelay,
	classifyError,
} from './errors'
import { defaultRetryStrategy, getRetryDelay } from './retry'
import { processConcurrently, defaultBatchOptions } from './batch'

/**
 * Create a type-safe queue consumer using a functional approach
 *
 * @param schema - Zod schema for message validation
 * @param handler - Function to handle validated messages
 * @param config - Optional consumer configuration
 *
 * @example
 * ```typescript
 * import { createQueueConsumer } from '@repo/queue-utils'
 * import { characterUpdateSchema } from './schemas'
 *
 * const queueHandler = createQueueConsumer(
 *   characterUpdateSchema,
 *   async (message, metadata) => {
 *     console.log(`Processing character ${message.characterId}`)
 *     // ... processing logic
 *   }
 * )
 *
 * export default {
 *   queue: queueHandler
 * }
 * ```
 */
export function createQueueConsumer<T extends z.ZodType>(
	schema: T,
	handler: MessageHandler<z.infer<T>>,
	config: Omit<QueueConsumerConfig<T>, 'schema'> = {}
): QueueHandler {
	const retryStrategy = config.retryStrategy || defaultRetryStrategy
	const batchOptions = { ...defaultBatchOptions, ...config.batchOptions }
	const errorHandler = config.errorHandler
	const hooks = config.hooks
	const debug = config.debug || false

	return async (batch: MessageBatch<unknown>, env: unknown, ctx: ExecutionContext) => {
		if (debug) {
			console.log(`[createQueueConsumer] Processing batch of ${batch.messages.length} messages`)
		}

		// Call onBatchStart hook
		if (hooks?.onBatchStart) {
			await hooks.onBatchStart(batch)
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
						parsed = schema.parse(message.body)
					} catch (error) {
						throw new MessageValidationError(
							'Message validation failed',
							error,
							error instanceof Error ? error : undefined
						)
					}

					// Process message
					await handler(parsed, metadata)

					// Success - acknowledge message
					message.ack()
					successful++

					// Call onMessageSuccess hook
					if (hooks?.onMessageSuccess) {
						await hooks.onMessageSuccess(parsed, metadata)
					}

					if (debug) {
						console.log(`[createQueueConsumer] Successfully processed message ${message.id}`)
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
						parsedMessage = schema.parse(message.body)
					} catch {
						// Message couldn't be parsed
					}

					// Determine how to handle the error
					let decision: 'retry' | 'ack' | 'fatal'
					const hasCustomErrorHandler = !!errorHandler

					// Use custom error handler if provided
					if (hasCustomErrorHandler) {
						decision = await errorHandler!(wrappedError, parsedMessage, metadata)
					} else {
						// Use default error classification
						decision = classifyError(wrappedError)
					}

					// Check if we should retry
					let shouldRetry = false
					if (decision === 'retry') {
						// Check if we've exceeded max attempts
						if (metadata.attempt > retryStrategy.maxAttempts) {
							shouldRetry = false
						} else if (hasCustomErrorHandler) {
							// Custom error handler explicitly said retry, respect that
							shouldRetry = true
						} else if (retryStrategy.shouldRetry) {
							// Use retry strategy's predicate
							shouldRetry = retryStrategy.shouldRetry(wrappedError)
						} else {
							// No predicate, default to retry
							shouldRetry = true
						}
					}

					if (shouldRetry) {
						// Calculate retry delay
						const errorDelay = getErrorRetryDelay(wrappedError)
						const strategyDelay = getRetryDelay(metadata.attempt, retryStrategy)
						const delaySeconds = errorDelay !== undefined ? errorDelay : strategyDelay

						message.retry({ delaySeconds })
						retried++

						if (debug) {
							console.log(
								`[createQueueConsumer] Retrying message ${message.id} (attempt ${metadata.attempt}) after ${delaySeconds}s`
							)
						}
					} else {
						// Either fatal error or max retries exceeded - acknowledge to prevent infinite loop
						message.ack()
						failed++

						if (debug) {
							console.error(
								`[createQueueConsumer] Failed to process message ${message.id} (attempt ${metadata.attempt}):`,
								wrappedError
							)
						}
					}

					// Call onMessageError hook
					if (hooks?.onMessageError) {
						await hooks.onMessageError(wrappedError, parsedMessage, metadata)
					}

					// Track error
					errors.push({
						error: wrappedError,
						messageId: message.id,
					})
				}
			},
			batchOptions.concurrency
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
		if (hooks?.onBatchComplete) {
			await hooks.onBatchComplete(batch, result)
		}

		if (debug) {
			console.log(
				`[createQueueConsumer] Batch complete: ${successful} successful, ${failed} failed, ${retried} retried`
			)
		}
	}
}
