import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { QueueConsumer } from '../../src/consumer'
import { FatalError, RetryableError } from '../../src/errors'

import type { Message, MessageBatch, MessageMetadata } from '../../src/types'

const testSchema = z.object({
	id: z.string(),
	type: z.enum(['update', 'delete']),
})

type TestMessage = z.infer<typeof testSchema>

function createMockMessage(body: unknown, id = 'msg-1'): Message {
	return {
		id,
		timestamp: new Date(),
		body,
		ack: vi.fn(),
		retry: vi.fn(),
	}
}

function createMockBatch(messages: Message[]): MessageBatch {
	return {
		queue: 'test-queue',
		messages,
		ackAll: vi.fn(),
		retryAll: vi.fn(),
	}
}

describe('QueueConsumer', () => {
	it('should process valid messages', async () => {
		const handleMessage = vi.fn()

		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({ schema: testSchema })
			}

			async handleMessage(message: TestMessage, metadata: MessageMetadata): Promise<void> {
				handleMessage(message, metadata)
			}
		}

		const consumer = new TestConsumer()
		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(handleMessage).toHaveBeenCalledWith(
			{ id: 1, type: 'update' },
			expect.objectContaining({
				attempt: 1,
			})
		)
		expect(message.ack).toHaveBeenCalled()
	})

	it('should reject invalid messages', async () => {
		const handleMessage = vi.fn()

		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({ schema: testSchema })
			}

			async handleMessage(message: TestMessage): Promise<void> {
				handleMessage(message)
			}
		}

		const consumer = new TestConsumer()
		const message = createMockMessage({ id: 'invalid', type: 'update' })
		const batch = createMockBatch([message])

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(handleMessage).not.toHaveBeenCalled()
		expect(message.ack).toHaveBeenCalled() // Invalid messages are acked to prevent infinite loop
	})

	it('should retry on retryable error', async () => {
		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({ schema: testSchema })
			}

			async handleMessage(): Promise<void> {
				throw new RetryableError('Retry me', 30)
			}
		}

		const consumer = new TestConsumer()
		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 })
		expect(message.ack).not.toHaveBeenCalled()
	})

	it('should not retry on fatal error', async () => {
		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({ schema: testSchema })
			}

			async handleMessage(): Promise<void> {
				throw new FatalError('Fatal error')
			}
		}

		const consumer = new TestConsumer()
		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(message.ack).toHaveBeenCalled()
		expect(message.retry).not.toHaveBeenCalled()
	})

	it('should call lifecycle hooks', async () => {
		const onBatchStart = vi.fn()
		const onBatchComplete = vi.fn()
		const onMessageSuccess = vi.fn()

		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({
					schema: testSchema,
					hooks: {
						onBatchStart,
						onBatchComplete,
						onMessageSuccess,
					},
				})
			}

			async handleMessage(): Promise<void> {}
		}

		const consumer = new TestConsumer()
		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(onBatchStart).toHaveBeenCalledWith(batch)
		expect(onBatchComplete).toHaveBeenCalledWith(
			batch,
			expect.objectContaining({
				total: 1,
				successful: 1,
				failed: 0,
			})
		)
		expect(onMessageSuccess).toHaveBeenCalledWith(
			{ id: 1, type: 'update' },
			expect.objectContaining({ attempt: 1 })
		)
	})

	it('should call onMessageError hook on error', async () => {
		const onMessageError = vi.fn()

		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({
					schema: testSchema,
					hooks: { onMessageError },
				})
			}

			async handleMessage(): Promise<void> {
				throw new Error('Test error')
			}
		}

		const consumer = new TestConsumer()
		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(onMessageError).toHaveBeenCalledWith(
			expect.any(Error),
			{ id: 1, type: 'update' },
			expect.objectContaining({ attempt: 1 })
		)
	})

	it('should use custom error handler', async () => {
		const errorHandler = vi.fn(() => 'retry' as const)

		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({
					schema: testSchema,
					errorHandler,
				})
			}

			async handleMessage(): Promise<void> {
				throw new Error('Test error')
			}
		}

		const consumer = new TestConsumer()
		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(errorHandler).toHaveBeenCalled()
		expect(message.retry).toHaveBeenCalled()
	})

	it('should respect retry strategy configuration', async () => {
		const errorHandler = vi.fn(() => 'retry' as const)

		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({
					schema: testSchema,
					retryStrategy: {
						maxAttempts: 3,
						getDelay: (attempt) => attempt * 10,
					},
					errorHandler,
				})
			}

			async handleMessage(): Promise<void> {
				throw new Error('Test error')
			}
		}

		const consumer = new TestConsumer()
		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await consumer.queue(batch, {}, {} as ExecutionContext)

		// Should retry since custom error handler said so
		expect(errorHandler).toHaveBeenCalled()
		expect(message.retry).toHaveBeenCalled()

		// Check retry delay matches strategy
		const retryCall = vi.mocked(message.retry).mock.calls[0]
		expect(retryCall[0]?.delaySeconds).toBe(10) // First attempt uses delay(1) = 10
	})

	it('should create handler function', () => {
		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({ schema: testSchema })
			}

			async handleMessage(): Promise<void> {}
		}

		const consumer = new TestConsumer()
		const handler = consumer.toHandler()

		expect(typeof handler).toBe('function')
	})

	it('should process multiple messages concurrently', async () => {
		const processedIds: string[] = []

		class TestConsumer extends QueueConsumer<typeof testSchema> {
			constructor() {
				super({ schema: testSchema, batchOptions: { concurrency: 2 } })
			}

			async handleMessage(message: TestMessage): Promise<void> {
				processedIds.push(message.id)
				await new Promise((resolve) => setTimeout(resolve, 10))
			}
		}

		const consumer = new TestConsumer()
		const messages = [
			createMockMessage({ id: 1, type: 'update' }, 'msg-1'),
			createMockMessage({ id: 2, type: 'update' }, 'msg-2'),
			createMockMessage({ id: 3, type: 'update' }, 'msg-3'),
		]
		const batch = createMockBatch(messages)

		await consumer.queue(batch, {}, {} as ExecutionContext)

		expect(processedIds).toHaveLength(3)
		expect(messages[0].ack).toHaveBeenCalled()
		expect(messages[1].ack).toHaveBeenCalled()
		expect(messages[2].ack).toHaveBeenCalled()
	})
})
