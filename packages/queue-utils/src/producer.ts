import { MessageValidationError } from './errors'

import type { z } from 'zod'
import type { QueueProducerConfig, SendBatchOptions, SendMessageOptions } from './types'

/**
 * Cloudflare Queue binding interface
 * Represents the Queue object available in worker environment bindings
 */
export interface Queue<Body = unknown> {
	send(body: Body, options?: SendMessageOptions): Promise<void>
	sendBatch(messages: Array<{ body: Body } & SendMessageOptions>): Promise<void>
}

/**
 * Type-safe queue producer for sending validated messages
 *
 * @example
 * ```typescript
 * import { QueueProducer } from '@repo/queue-utils'
 * import { characterUpdateSchema } from './schemas'
 *
 * const producer = new QueueProducer({
 *   schema: characterUpdateSchema,
 *   queue: env.CHARACTER_UPDATE_QUEUE
 * })
 *
 * await producer.send({
 *   characterId: 12345,
 *   type: 'update'
 * })
 * ```
 */
export class QueueProducer<T extends z.ZodType> {
	private readonly schema: T
	private readonly queue: Queue<z.infer<T>>
	private readonly debug: boolean

	constructor(queue: Queue<z.infer<T>>, config: QueueProducerConfig<T>) {
		this.queue = queue
		this.schema = config.schema
		this.debug = config.debug || false
	}

	/**
	 * Send a single message to the queue
	 *
	 * @param message - Message body (will be validated against schema)
	 * @param options - Optional send options
	 */
	async send(message: z.infer<T>, options?: SendMessageOptions): Promise<void> {
		// Validate message
		let validated: z.infer<T>
		try {
			validated = this.schema.parse(message)
		} catch (error) {
			throw new MessageValidationError(
				'Message validation failed',
				error,
				error instanceof Error ? error : undefined
			)
		}

		if (this.debug) {
			console.log('[QueueProducer] Sending message:', validated)
		}

		// Send to queue
		await this.queue.send(validated, options)
	}

	/**
	 * Send multiple messages to the queue in a batch
	 *
	 * @param messages - Array of message bodies (will be validated against schema)
	 * @param options - Optional batch options
	 */
	async sendBatch(messages: Array<z.infer<T>>, options?: SendBatchOptions): Promise<void> {
		// Validate all messages
		const validated: Array<z.infer<T>> = []
		for (let i = 0; i < messages.length; i++) {
			try {
				validated.push(this.schema.parse(messages[i]))
			} catch (error) {
				throw new MessageValidationError(
					`Message validation failed for message at index ${i}`,
					error,
					error instanceof Error ? error : undefined
				)
			}
		}

		if (this.debug) {
			console.log(`[QueueProducer] Sending batch of ${validated.length} messages`)
		}

		// Send to queue
		await this.queue.sendBatch(
			validated.map((body) => ({
				body,
				delaySeconds: options?.delaySeconds,
			}))
		)
	}

	/**
	 * Send multiple messages with individual options
	 *
	 * @param messages - Array of messages with individual options
	 */
	async sendBatchWithOptions(
		messages: Array<{ body: z.infer<T> } & SendMessageOptions>
	): Promise<void> {
		// Validate all messages
		const validated: Array<{ body: z.infer<T> } & SendMessageOptions> = []
		for (let i = 0; i < messages.length; i++) {
			try {
				const { body, ...options } = messages[i]
				validated.push({
					body: this.schema.parse(body),
					...options,
				})
			} catch (error) {
				throw new MessageValidationError(
					`Message validation failed for message at index ${i}`,
					error,
					error instanceof Error ? error : undefined
				)
			}
		}

		if (this.debug) {
			console.log(`[QueueProducer] Sending batch of ${validated.length} messages with options`)
		}

		// Send to queue
		await this.queue.sendBatch(validated)
	}
}

/**
 * Create a type-safe queue producer
 *
 * @param queue - Cloudflare Queue binding
 * @param schema - Zod schema for message validation
 * @param debug - Enable debug logging
 *
 * @example
 * ```typescript
 * import { createQueueProducer } from '@repo/queue-utils'
 * import { characterUpdateSchema } from './schemas'
 *
 * const producer = createQueueProducer(
 *   env.CHARACTER_UPDATE_QUEUE,
 *   characterUpdateSchema
 * )
 *
 * await producer.send({
 *   characterId: 12345,
 *   type: 'update'
 * })
 * ```
 */
export function createQueueProducer<T extends z.ZodType>(
	queue: Queue<z.infer<T>>,
	schema: T,
	debug = false
): QueueProducer<T> {
	return new QueueProducer(queue, { schema, debug })
}
