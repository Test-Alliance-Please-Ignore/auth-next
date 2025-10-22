import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { QueueProducer, createQueueProducer, type Queue } from '../../src/producer'
import { MessageValidationError } from '../../src/errors'

const notificationSchema = z.object({
	userId: z.number(),
	type: z.enum(['email', 'push', 'sms']),
	message: z.string(),
	metadata: z
		.object({
			priority: z.number().default(1),
			category: z.string().optional(),
		})
		.optional(),
})

type NotificationMessage = z.infer<typeof notificationSchema>

class MockQueue implements Queue<NotificationMessage> {
	public sentMessages: Array<{ body: NotificationMessage; options?: any }> = []
	public sentBatches: Array<Array<{ body: NotificationMessage } & any>> = []

	async send(body: NotificationMessage, options?: any): Promise<void> {
		this.sentMessages.push({ body, options })
	}

	async sendBatch(messages: Array<{ body: NotificationMessage } & any>): Promise<void> {
		this.sentBatches.push(messages)
	}

	reset() {
		this.sentMessages = []
		this.sentBatches = []
	}
}

describe('QueueProducer Integration', () => {
	it('should send validated messages', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		await producer.send({
			userId: 12345,
			type: 'email',
			message: 'Hello, World!',
		})

		expect(mockQueue.sentMessages).toHaveLength(1)
		expect(mockQueue.sentMessages[0].body.userId).toBe(12345)
		expect(mockQueue.sentMessages[0].body.type).toBe('email')
	})

	it('should send messages with options', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		await producer.send(
			{
				userId: 12345,
				type: 'email',
				message: 'Delayed message',
			},
			{ delaySeconds: 300 }
		)

		expect(mockQueue.sentMessages).toHaveLength(1)
		expect(mockQueue.sentMessages[0].options.delaySeconds).toBe(300)
	})

	it('should validate messages before sending', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		await expect(
			producer.send({
				userId: 'invalid' as any,
				type: 'email',
				message: 'Test',
			})
		).rejects.toThrow(MessageValidationError)

		expect(mockQueue.sentMessages).toHaveLength(0)
	})

	it('should send batch of messages', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		await producer.sendBatch([
			{ userId: 1, type: 'email', message: 'Message 1' },
			{ userId: 2, type: 'push', message: 'Message 2' },
			{ userId: 3, type: 'sms', message: 'Message 3' },
		])

		expect(mockQueue.sentBatches).toHaveLength(1)
		expect(mockQueue.sentBatches[0]).toHaveLength(3)
		expect(mockQueue.sentBatches[0][0].body.userId).toBe(1)
		expect(mockQueue.sentBatches[0][1].body.userId).toBe(2)
		expect(mockQueue.sentBatches[0][2].body.userId).toBe(3)
	})

	it('should send batch with delay options', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		await producer.sendBatch(
			[
				{ userId: 1, type: 'email', message: 'Message 1' },
				{ userId: 2, type: 'push', message: 'Message 2' },
			],
			{ delaySeconds: 60 }
		)

		expect(mockQueue.sentBatches).toHaveLength(1)
		expect(mockQueue.sentBatches[0][0].delaySeconds).toBe(60)
		expect(mockQueue.sentBatches[0][1].delaySeconds).toBe(60)
	})

	it('should validate all messages in batch', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		await expect(
			producer.sendBatch([
				{ userId: 1, type: 'email', message: 'Valid' },
				{ userId: 'invalid' as any, type: 'email', message: 'Invalid' },
				{ userId: 3, type: 'email', message: 'Valid' },
			])
		).rejects.toThrow(MessageValidationError)

		expect(mockQueue.sentBatches).toHaveLength(0)
	})

	it('should send batch with individual options', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		await producer.sendBatchWithOptions([
			{ body: { userId: 1, type: 'email', message: 'Urgent' }, delaySeconds: 0 },
			{ body: { userId: 2, type: 'push', message: 'Normal' }, delaySeconds: 60 },
			{ body: { userId: 3, type: 'sms', message: 'Low Priority' }, delaySeconds: 300 },
		])

		expect(mockQueue.sentBatches).toHaveLength(1)
		expect(mockQueue.sentBatches[0][0].delaySeconds).toBe(0)
		expect(mockQueue.sentBatches[0][1].delaySeconds).toBe(60)
		expect(mockQueue.sentBatches[0][2].delaySeconds).toBe(300)
	})

	it('should handle complex nested objects', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		await producer.send({
			userId: 12345,
			type: 'email',
			message: 'Important notification',
			metadata: {
				priority: 5,
				category: 'security',
			},
		})

		expect(mockQueue.sentMessages).toHaveLength(1)
		expect(mockQueue.sentMessages[0].body.metadata?.priority).toBe(5)
		expect(mockQueue.sentMessages[0].body.metadata?.category).toBe('security')
	})

	it('should apply schema defaults', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		await producer.send({
			userId: 12345,
			type: 'email',
			message: 'Test',
			metadata: {
				priority: 1,
				category: 'general',
			},
		})

		expect(mockQueue.sentMessages[0].body.metadata?.priority).toBe(1)
	})

	it('should handle large batches', async () => {
		const mockQueue = new MockQueue()
		const producer = new QueueProducer(mockQueue, { schema: notificationSchema })

		const largeBatch = Array.from({ length: 100 }, (_, i) => ({
			userId: i + 1,
			type: 'email' as const,
			message: `Message ${i + 1}`,
		}))

		await producer.sendBatch(largeBatch)

		expect(mockQueue.sentBatches).toHaveLength(1)
		expect(mockQueue.sentBatches[0]).toHaveLength(100)
	})
})

describe('createQueueProducer Integration', () => {
	it('should create a functional producer', async () => {
		const mockQueue = new MockQueue()
		const producer = createQueueProducer(mockQueue, notificationSchema)

		await producer.send({
			userId: 12345,
			type: 'email',
			message: 'Test message',
		})

		expect(mockQueue.sentMessages).toHaveLength(1)
	})

	it('should create producer with debug enabled', async () => {
		const mockQueue = new MockQueue()
		const producer = createQueueProducer(mockQueue, notificationSchema, true)

		await producer.send({
			userId: 12345,
			type: 'email',
			message: 'Debug test',
		})

		expect(mockQueue.sentMessages).toHaveLength(1)
	})

	it('should handle end-to-end workflow', async () => {
		// Simulate a realistic workflow
		const mockQueue = new MockQueue()
		const producer = createQueueProducer(mockQueue, notificationSchema)

		// Send individual high-priority message
		await producer.send(
			{
				userId: 1,
				type: 'push',
				message: 'Critical alert!',
				metadata: { priority: 10, category: 'security' },
			},
			{ delaySeconds: 0 }
		)

		// Send batch of normal messages
		await producer.sendBatch(
			Array.from({ length: 5 }, (_, i) => ({
				userId: i + 2,
				type: 'email' as const,
				message: `Daily digest ${i + 1}`,
			})),
			{ delaySeconds: 3600 }
		)

		// Send batch with varied delays
		await producer.sendBatchWithOptions([
			{
				body: { userId: 10, type: 'sms', message: 'Immediate SMS' },
				delaySeconds: 0,
			},
			{
				body: { userId: 11, type: 'email', message: 'Delayed email' },
				delaySeconds: 1800,
			},
		])

		expect(mockQueue.sentMessages).toHaveLength(1)
		expect(mockQueue.sentBatches).toHaveLength(2)
		expect(mockQueue.sentBatches[0]).toHaveLength(5)
		expect(mockQueue.sentBatches[1]).toHaveLength(2)
	})

	it('should validate input data', async () => {
		const mockQueue = new MockQueue()
		const producer = createQueueProducer(mockQueue, notificationSchema)

		// Valid message should succeed
		await producer.send({
			userId: 12345,
			type: 'email',
			message: 'Test message',
		})

		expect(mockQueue.sentMessages).toHaveLength(1)
		expect(mockQueue.sentMessages[0].body.type).toBe('email')

		// Invalid message should throw
		await expect(
			producer.send({ userId: 'invalid' as any, type: 'email', message: 'Test' })
		).rejects.toThrow(MessageValidationError)
	})
})
