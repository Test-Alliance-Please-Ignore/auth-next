import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { QueueConsumer } from '../../src/consumer'
import type { MessageBatch, Message, MessageMetadata } from '../../src/types'
import { FatalError } from '../../src/errors'
import { exponentialBackoff } from '../../src/retry'

const testSchema = z.object({
	characterId: z.string(),
	action: z.enum(['update', 'delete', 'refresh']),
	timestamp: z.number().optional(),
})

type TestMessage = z.infer<typeof testSchema>

describe('QueueConsumer Integration', () => {
	it('should handle end-to-end message processing', async () => {
		const processedMessages: TestMessage[] = []

		class CharacterUpdateConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({
					schema: testSchema,
					retryStrategy: exponentialBackoff(3, 1, 60),
				})
			}

			async handleMessage(message: TestMessage, _metadata: MessageMetadata): Promise<void> {
				processedMessages.push(message)
			}
		}

		const consumer = new CharacterUpdateConsumer()

		// Create test messages
		const messages: Message[] = [
			{
				id: 'msg-1',
				timestamp: new Date(),
				body: { characterId: 12345, action: 'update' },
				ack: () => {},
				retry: () => {},
			},
			{
				id: 'msg-2',
				timestamp: new Date(),
				body: { characterId: 67890, action: 'delete' },
				ack: () => {},
				retry: () => {},
			},
		]

		const batch: MessageBatch = {
			queue: 'character-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(processedMessages).toHaveLength(2)
		expect(processedMessages[0].characterId).toBe(12345)
		expect(processedMessages[1].characterId).toBe(67890)
	})

	it('should handle validation errors gracefully', async () => {
		const processedMessages: TestMessage[] = []
		const failedMessages: string[] = []

		class CharacterUpdateConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({
					schema: testSchema,
					hooks: {
						onMessageSuccess: (message: unknown) => {
							processedMessages.push(message as TestMessage)
						},
						onMessageError: (_error, _message, metadata) => {
							failedMessages.push(metadata.originalMessage.id)
						},
					},
				})
			}

			async handleMessage(_message: TestMessage): Promise<void> {
				// Successfully processed
			}
		}

		const consumer = new CharacterUpdateConsumer()

		const messages: Message[] = [
			{
				id: 'msg-1',
				timestamp: new Date(),
				body: { characterId: 12345, action: 'update' },
				ack: () => {},
				retry: () => {},
			},
			{
				id: 'msg-2',
				timestamp: new Date(),
				body: { characterId: 'invalid' }, // Invalid - missing action
				ack: () => {},
				retry: () => {},
			},
			{
				id: 'msg-3',
				timestamp: new Date(),
				body: { characterId: 67890, action: 'delete' },
				ack: () => {},
				retry: () => {},
			},
		]

		const batch: MessageBatch = {
			queue: 'character-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(processedMessages).toHaveLength(2)
		expect(failedMessages).toHaveLength(1)
		expect(failedMessages).toContain('msg-2')
	})

	it('should implement custom retry logic', async () => {
		const retryAttempts = new Map<string, number>()

		class CharacterUpdateConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({
					schema: testSchema,
					retryStrategy: exponentialBackoff(3, 2, 60),
					errorHandler: (error, _message, metadata) => {
						const attempts = retryAttempts.get(metadata.originalMessage.id) || 0
						retryAttempts.set(metadata.originalMessage.id, attempts + 1)

						// Retry transient errors only
						if (error.message.includes('transient')) {
							return 'retry'
						}
						return 'fatal'
					},
				})
			}

			async handleMessage(message: TestMessage): Promise<void> {
				if (message.characterId === '12345') {
					throw new Error('transient error')
				}
				if (message.characterId === '67890') {
					throw new Error('permanent error')
				}
			}
		}

		const consumer = new CharacterUpdateConsumer()

		const messages: Message[] = [
			{
				id: 'msg-1',
				timestamp: new Date(),
				body: { characterId: 12345, action: 'update' },
				ack: () => {},
				retry: () => {},
			},
			{
				id: 'msg-2',
				timestamp: new Date(),
				body: { characterId: 67890, action: 'update' },
				ack: () => {},
				retry: () => {},
			},
		]

		const batch: MessageBatch = {
			queue: 'character-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(retryAttempts.get('msg-1')).toBe(1) // Retried
		expect(retryAttempts.get('msg-2')).toBe(1) // Not retried (fatal)
	})

	it('should process messages concurrently', async () => {
		const processOrder: string[] = []
		const startTimes: number[] = []

		class CharacterUpdateConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({
					schema: testSchema,
					batchOptions: { concurrency: 3 },
				})
			}

			async handleMessage(message: TestMessage): Promise<void> {
				startTimes.push(Date.now())
				await new Promise((resolve) => setTimeout(resolve, 50))
				processOrder.push(message.characterId)
			}
		}

		const consumer = new CharacterUpdateConsumer()

		const messages: Message[] = Array.from({ length: 6 }, (_, i) => ({
			id: `msg-${i}`,
			timestamp: new Date(),
			body: { characterId: i + 1, action: 'update' as const },
			ack: () => {},
			retry: () => {},
		}))

		const batch: MessageBatch = {
			queue: 'character-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		const start = Date.now()
		await consumer.queue(batch, {}, {} as ExecutionContext)
		const duration = Date.now() - start

		expect(processOrder).toHaveLength(6)
		// With concurrency of 3 and 50ms per task, should take ~100ms total
		// Without concurrency would take ~300ms
		expect(duration).toBeLessThan(200)
	})

	it('should provide access to env and ctx in message handler', async () => {
		const testEnv = { API_KEY: 'test-key' }
		const testCtx = {} as ExecutionContext

		let receivedEnv: unknown
		let receivedCtx: unknown

		class CharacterUpdateConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({ schema: testSchema })
			}

			async handleMessage(_message: TestMessage, metadata: MessageMetadata): Promise<void> {
				receivedEnv = metadata.env
				receivedCtx = metadata.ctx
			}
		}

		const consumer = new CharacterUpdateConsumer()

		const messages: Message[] = [
			{
				id: 'msg-1',
				timestamp: new Date(),
				body: { characterId: 12345, action: 'update' },
				ack: () => {},
				retry: () => {},
			},
		]

		const batch: MessageBatch = {
			queue: 'character-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await consumer.queue(batch, testEnv, testCtx)

		expect(receivedEnv).toBe(testEnv)
		expect(receivedCtx).toBe(testCtx)
	})

	it('should track batch processing results', async () => {
		let batchResult: any

		class CharacterUpdateConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({
					schema: testSchema,
					hooks: {
						onBatchComplete: (_batch, result) => {
							batchResult = result
						},
					},
				})
			}

			async handleMessage(message: TestMessage): Promise<void> {
				if (message.characterId === '2' || message.characterId === '4') {
					throw new FatalError('Processing failed')
				}
			}
		}

		const consumer = new CharacterUpdateConsumer()

		const messages: Message[] = Array.from({ length: 5 }, (_, i) => ({
			id: `msg-${i}`,
			timestamp: new Date(),
			body: { characterId: i + 1, action: 'update' as const },
			ack: () => {},
			retry: () => {},
		}))

		const batch: MessageBatch = {
			queue: 'character-updates',
			messages,
			ackAll: () => {},
			retryAll: () => {},
		}

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(batchResult.total).toBe(5)
		expect(batchResult.successful).toBe(3)
		expect(batchResult.failed).toBe(2)
		expect(batchResult.errors).toHaveLength(2)
	})
})
