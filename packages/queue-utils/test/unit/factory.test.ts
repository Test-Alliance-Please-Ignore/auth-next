import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { FatalError, RetryableError } from '../../src/errors'
import { createQueueConsumer } from '../../src/factory'

import type { Message, MessageBatch } from '../../src/types'

const testSchema = z.object({
	id: z.number(),
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

describe('createQueueConsumer', () => {
	it('should create a queue handler function', () => {
		const handler = createQueueConsumer(testSchema, async () => {})
		expect(typeof handler).toBe('function')
	})

	it('should process valid messages', async () => {
		const handleMessage = vi.fn()
		const handler = createQueueConsumer(testSchema, handleMessage)

		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await handler(batch, {}, {} as ExecutionContext)

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
		const handler = createQueueConsumer(testSchema, handleMessage)

		const message = createMockMessage({ id: 'invalid', type: 'update' })
		const batch = createMockBatch([message])

		await handler(batch, {}, {} as ExecutionContext)

		expect(handleMessage).not.toHaveBeenCalled()
		expect(message.ack).toHaveBeenCalled()
	})

	it('should retry on retryable error', async () => {
		const handler = createQueueConsumer(testSchema, async () => {
			throw new RetryableError('Retry me', 30)
		})

		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await handler(batch, {}, {} as ExecutionContext)

		expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 })
		expect(message.ack).not.toHaveBeenCalled()
	})

	it('should not retry on fatal error', async () => {
		const handler = createQueueConsumer(testSchema, async () => {
			throw new FatalError('Fatal error')
		})

		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await handler(batch, {}, {} as ExecutionContext)

		expect(message.ack).toHaveBeenCalled()
		expect(message.retry).not.toHaveBeenCalled()
	})

	it('should call lifecycle hooks', async () => {
		const onBatchStart = vi.fn()
		const onBatchComplete = vi.fn()
		const onMessageSuccess = vi.fn()

		const handler = createQueueConsumer(testSchema, async () => {}, {
			hooks: {
				onBatchStart,
				onBatchComplete,
				onMessageSuccess,
			},
		})

		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await handler(batch, {}, {} as ExecutionContext)

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

		const handler = createQueueConsumer(
			testSchema,
			async () => {
				throw new Error('Test error')
			},
			{ hooks: { onMessageError } }
		)

		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await handler(batch, {}, {} as ExecutionContext)

		expect(onMessageError).toHaveBeenCalledWith(
			expect.any(Error),
			{ id: 1, type: 'update' },
			expect.objectContaining({ attempt: 1 })
		)
	})

	it('should use custom error handler', async () => {
		const errorHandler = vi.fn(() => 'retry' as const)

		const handler = createQueueConsumer(
			testSchema,
			async () => {
				throw new Error('Test error')
			},
			{ errorHandler }
		)

		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await handler(batch, {}, {} as ExecutionContext)

		expect(errorHandler).toHaveBeenCalled()
		expect(message.retry).toHaveBeenCalled()
	})

	it('should use custom retry strategy', async () => {
		const handler = createQueueConsumer(
			testSchema,
			async () => {
				throw new RetryableError('Retry me')
			},
			{
				retryStrategy: {
					maxAttempts: 5,
					getDelay: () => 10,
				},
			}
		)

		const message = createMockMessage({ id: 1, type: 'update' })
		const batch = createMockBatch([message])

		await handler(batch, {}, {} as ExecutionContext)

		expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 10 })
	})

	it('should use custom batch options', async () => {
		let concurrent = 0
		let maxConcurrent = 0

		const handler = createQueueConsumer(
			testSchema,
			async () => {
				concurrent++
				maxConcurrent = Math.max(maxConcurrent, concurrent)
				await new Promise((resolve) => setTimeout(resolve, 10))
				concurrent--
			},
			{ batchOptions: { concurrency: 2 } }
		)

		const messages = Array.from({ length: 5 }, (_, i) =>
			createMockMessage({ id: i, type: 'update' }, `msg-${i}`)
		)
		const batch = createMockBatch(messages)

		await handler(batch, {}, {} as ExecutionContext)

		expect(maxConcurrent).toBeLessThanOrEqual(2)
	})

	it('should process multiple messages', async () => {
		const processedIds: number[] = []

		const handler = createQueueConsumer(testSchema, async (message: TestMessage) => {
			processedIds.push(message.id)
		})

		const messages = [
			createMockMessage({ id: 1, type: 'update' }, 'msg-1'),
			createMockMessage({ id: 2, type: 'update' }, 'msg-2'),
			createMockMessage({ id: 3, type: 'update' }, 'msg-3'),
		]
		const batch = createMockBatch(messages)

		await handler(batch, {}, {} as ExecutionContext)

		expect(processedIds).toHaveLength(3)
		expect(processedIds).toContain(1)
		expect(processedIds).toContain(2)
		expect(processedIds).toContain(3)
	})

	it('should handle mixed success and failure', async () => {
		const handler = createQueueConsumer(testSchema, async (message: TestMessage) => {
			if (message.id === 2) {
				throw new Error('Failed for id 2')
			}
		})

		const messages = [
			createMockMessage({ id: 1, type: 'update' }, 'msg-1'),
			createMockMessage({ id: 2, type: 'update' }, 'msg-2'),
			createMockMessage({ id: 3, type: 'update' }, 'msg-3'),
		]
		const batch = createMockBatch(messages)

		await handler(batch, {}, {} as ExecutionContext)

		expect(messages[0].ack).toHaveBeenCalled()
		expect(messages[1].ack).toHaveBeenCalled() // Failed, but non-retryable
		expect(messages[2].ack).toHaveBeenCalled()
	})
})
