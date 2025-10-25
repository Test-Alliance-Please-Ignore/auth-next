import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { FatalError } from '../../src/errors'
import { createQueueConsumer } from '../../src/factory'
import { exponentialBackoff } from '../../src/retry'

import type { Message, MessageBatch } from '../../src/types'

const testSchema = z.object({
	corporationId: z.number(),
	operation: z.enum(['sync', 'update', 'archive']),
	priority: z.number().default(0),
})

type TestMessage = z.infer<typeof testSchema>

describe('createQueueConsumer Integration', () => {
	it('should handle end-to-end message processing', async () => {
		const processedMessages: TestMessage[] = []

		const handler = createQueueConsumer(testSchema, async (message) => {
			processedMessages.push(message)
		})

		const messages: Message[] = [
			{
				id: 'msg-1',
				timestamp: new Date(),
				body: { corporationId: 98765, operation: 'sync' },
				ack: () => {},
				retry: () => {},
			},
			{
				id: 'msg-2',
				timestamp: new Date(),
				body: { corporationId: 54321, operation: 'update' },
				ack: () => {},
				retry: () => {},
			},
		]

		const batch: MessageBatch = {
			queue: 'corporation-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await handler(batch, {}, {} as ExecutionContext)

		expect(processedMessages).toHaveLength(2)
		expect(processedMessages[0].corporationId).toBe(98765)
		expect(processedMessages[1].corporationId).toBe(54321)
	})

	it('should apply default values from schema', async () => {
		const processedMessages: TestMessage[] = []

		const handler = createQueueConsumer(testSchema, async (message) => {
			processedMessages.push(message)
		})

		const messages: Message[] = [
			{
				id: 'msg-1',
				timestamp: new Date(),
				body: { corporationId: 98765, operation: 'sync' },
				ack: () => {},
				retry: () => {},
			},
		]

		const batch: MessageBatch = {
			queue: 'corporation-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await handler(batch, {}, {} as ExecutionContext)

		expect(processedMessages[0].priority).toBe(0) // Default value applied
	})

	it('should handle complex processing workflows', async () => {
		const processingLog: string[] = []

		const handler = createQueueConsumer(
			testSchema,
			async (message, _metadata) => {
				processingLog.push(`start-${message.corporationId}`)

				// Simulate API call
				await new Promise((resolve) => setTimeout(resolve, 10))

				processingLog.push(`complete-${message.corporationId}`)
			},
			{
				batchOptions: { concurrency: 2 },
				hooks: {
					onBatchStart: (batch) => {
						processingLog.push(`batch-start-${batch.messages.length}`)
					},
					onBatchComplete: (batch, result) => {
						processingLog.push(`batch-complete-${result.successful}/${result.total}`)
					},
				},
			}
		)

		const messages: Message[] = Array.from({ length: 4 }, (_, i) => ({
			id: `msg-${i}`,
			timestamp: new Date(),
			body: { corporationId: i + 1, operation: 'sync' as const },
			ack: () => {},
			retry: () => {},
		}))

		const batch: MessageBatch = {
			queue: 'corporation-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await handler(batch, {}, {} as ExecutionContext)

		expect(processingLog[0]).toBe('batch-start-4')
		expect(processingLog[processingLog.length - 1]).toBe('batch-complete-4/4')
		expect(processingLog.filter((log) => log.startsWith('start-'))).toHaveLength(4)
		expect(processingLog.filter((log) => log.startsWith('complete-'))).toHaveLength(4)
	})

	it('should handle custom error handling logic', async () => {
		const errorLog: Array<{ id: number; error: string }> = []

		const handler = createQueueConsumer(
			testSchema,
			async (message) => {
				if (message.corporationId % 2 === 0) {
					throw new Error(`Failed for corp ${message.corporationId}`)
				}
			},
			{
				errorHandler: (error, message, _metadata) => {
					if (message) {
						errorLog.push({
							id: message.corporationId,
							error: error.message,
						})
					}
					// Don't retry even numbers
					return 'fatal'
				},
			}
		)

		const messages: Message[] = Array.from({ length: 5 }, (_, i) => ({
			id: `msg-${i}`,
			timestamp: new Date(),
			body: { corporationId: i + 1, operation: 'sync' as const },
			ack: () => {},
			retry: () => {},
		}))

		const batch: MessageBatch = {
			queue: 'corporation-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await handler(batch, {}, {} as ExecutionContext)

		expect(errorLog).toHaveLength(2)
		expect(errorLog.map((e) => e.id)).toEqual([2, 4])
	})

	it('should support retry strategies', async () => {
		let attemptCount = 0

		const handler = createQueueConsumer(
			testSchema,
			async (_message) => {
				attemptCount++
				if (attemptCount <= 2) {
					throw new Error('Temporary failure')
				}
			},
			{
				retryStrategy: exponentialBackoff(3, 1, 10),
			}
		)

		const messages: Message[] = [
			{
				id: 'msg-1',
				timestamp: new Date(),
				body: { corporationId: 12345, operation: 'sync' },
				ack: () => {},
				retry: () => {},
			},
		]

		const batch: MessageBatch = {
			queue: 'corporation-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		// First attempt - will fail and retry
		await handler(batch, {}, {} as ExecutionContext)

		expect(attemptCount).toBe(1)
	})

	it('should provide metadata to handler', async () => {
		let receivedMetadata: any

		const handler = createQueueConsumer(testSchema, async (message, metadata) => {
			receivedMetadata = metadata
		})

		const messages: Message[] = [
			{
				id: 'msg-123',
				timestamp: new Date(),
				body: { corporationId: 12345, operation: 'sync' },
				ack: () => {},
				retry: () => {},
			},
		]

		const batch: MessageBatch = {
			queue: 'corporation-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		const testEnv = { API_KEY: 'test' }
		const testCtx = {} as ExecutionContext

		await handler(batch, testEnv, testCtx)

		expect(receivedMetadata.originalMessage.id).toBe('msg-123')
		expect(receivedMetadata.batch).toBe(batch)
		expect(receivedMetadata.attempt).toBe(1)
		expect(receivedMetadata.env).toBe(testEnv)
		expect(receivedMetadata.ctx).toBe(testCtx)
	})

	it('should handle batch processing with mixed results', async () => {
		let batchResult: any

		const handler = createQueueConsumer(
			testSchema,
			async (_message) => {
				// Fail on specific IDs
				if ([2, 4, 6].includes(_message.corporationId)) {
					throw new FatalError('Processing failed')
				}
			},
			{
				hooks: {
					onBatchComplete: (_batch, result) => {
						batchResult = result
					},
				},
			}
		)

		const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
			id: `msg-${i}`,
			timestamp: new Date(),
			body: { corporationId: i + 1, operation: 'sync' as const },
			ack: () => {},
			retry: () => {},
		}))

		const batch: MessageBatch = {
			queue: 'corporation-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await handler(batch, {}, {} as ExecutionContext)

		expect(batchResult.total).toBe(10)
		expect(batchResult.successful).toBe(7)
		expect(batchResult.failed).toBe(3)
	})

	it('should work with complex nested schemas', async () => {
		const complexSchema = z.object({
			corporation: z.object({
				id: z.number(),
				name: z.string(),
			}),
			members: z.array(
				z.object({
					characterId: z.number(),
					roles: z.array(z.string()),
				})
			),
			metadata: z.record(z.string(), z.any()).optional(),
		})

		const processedMessages: any[] = []

		const handler = createQueueConsumer(complexSchema, async (message) => {
			processedMessages.push(message)
		})

		const messages: Message[] = [
			{
				id: 'msg-1',
				timestamp: new Date(),
				body: {
					corporation: {
						id: 12345,
						name: 'Test Corp',
					},
					members: [
						{ characterId: 1, roles: ['director', 'ceo'] },
						{ characterId: 2, roles: ['member'] },
					],
					metadata: {
						source: 'api',
						version: '1.0',
					},
				},
				ack: () => {},
				retry: () => {},
			},
		]

		const batch: MessageBatch = {
			queue: 'complex-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await handler(batch, {}, {} as ExecutionContext)

		expect(processedMessages).toHaveLength(1)
		expect(processedMessages[0].corporation.name).toBe('Test Corp')
		expect(processedMessages[0].members).toHaveLength(2)
	})
})
