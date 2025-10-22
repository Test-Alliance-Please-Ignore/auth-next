import type { z } from 'zod'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import { createQueueConsumer, exponentialBackoff } from '@repo/queue-utils'
import { getStub } from '@repo/do-utils'
import type { Env } from '../context'

/**
 * Factory function to create corporation queue consumers with consistent configuration
 *
 * @param queueName - Name of the queue (for logging)
 * @param schema - Zod schema for message validation
 * @param handler - Handler function that processes the message
 * @returns Configured queue consumer
 */
export function createCorporationQueueConsumer<T extends z.ZodType>(
	queueName: string,
	schema: T,
	handler: (stub: EveCorporationData, message: z.infer<T>) => Promise<void>
) {
	return createQueueConsumer(
		schema,
		async (message, metadata) => {
			const env = metadata.env as Env

			// Get the Durable Object stub for this corporation
			const stub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, message.corporationId)

			// Execute the handler
			await handler(stub, message)
		},
		{
			// Retry strategy: exponential backoff with 3 attempts (2s, 4s, 8s)
			retryStrategy: exponentialBackoff(3, 2, 60),

			// Batch processing: 10 messages in parallel
			batchOptions: {
				concurrency: 10,
			},

			// Enable debug logging
			debug: true,

			// Lifecycle hooks for logging
			hooks: {
				onMessageSuccess: (message: unknown) => {
					const msg = message as z.infer<T>
					console.log(
						`[${queueName}] Successfully refreshed corp ${msg.corporationId}`,
						msg.requesterId ? `(requested by ${msg.requesterId})` : ''
					)
				},
				onMessageError: (error, message: unknown, metadata) => {
					const msg = message as z.infer<T> | undefined
					console.error(
						`[${queueName}] Failed for corp ${msg?.corporationId || 'unknown'} (attempt ${metadata.attempt}):`,
						error.message
					)
				},
				onBatchStart: (batch) => {
					console.log(`[${queueName}] Processing batch of ${batch.messages.length} messages`)
				},
				onBatchComplete: (_batch, result) => {
					console.log(
						`[${queueName}] Batch complete: ${result.successful} successful, ${result.failed} failed, ${result.retried} retried`
					)
				},
			},
		}
	)
}
