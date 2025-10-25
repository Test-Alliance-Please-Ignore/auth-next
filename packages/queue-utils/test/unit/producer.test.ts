import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { MessageValidationError } from '../../src/errors'
import { createQueueProducer, QueueProducer } from '../../src/producer'

import type { Queue } from '../../src/producer'

const testSchema = z.object({
	id: z.number(),
	name: z.string(),
})

type TestMessage = z.infer<typeof testSchema>

describe('QueueProducer', () => {
	it('should create producer instance', () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = new QueueProducer(mockQueue, { schema: testSchema })
		expect(producer).toBeInstanceOf(QueueProducer)
	})

	it('should validate and send message', async () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = new QueueProducer(mockQueue, { schema: testSchema })

		await producer.send({ id: 1, name: 'test' })

		expect(mockQueue.send).toHaveBeenCalledWith({ id: 1, name: 'test' }, undefined)
	})

	it('should validate and send message with options', async () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = new QueueProducer(mockQueue, { schema: testSchema })

		await producer.send({ id: 1, name: 'test' }, { delaySeconds: 30 })

		expect(mockQueue.send).toHaveBeenCalledWith({ id: 1, name: 'test' }, { delaySeconds: 30 })
	})

	it('should throw MessageValidationError on invalid message', async () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = new QueueProducer(mockQueue, { schema: testSchema })

		await expect(producer.send({ id: 'invalid' } as any)).rejects.toThrow(MessageValidationError)
		expect(mockQueue.send).not.toHaveBeenCalled()
	})

	it('should validate and send batch', async () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = new QueueProducer(mockQueue, { schema: testSchema })

		const messages = [
			{ id: 1, name: 'first' },
			{ id: 2, name: 'second' },
		]

		await producer.sendBatch(messages)

		expect(mockQueue.sendBatch).toHaveBeenCalledWith([
			{ body: { id: 1, name: 'first' }, delaySeconds: undefined },
			{ body: { id: 2, name: 'second' }, delaySeconds: undefined },
		])
	})

	it('should validate and send batch with options', async () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = new QueueProducer(mockQueue, { schema: testSchema })

		const messages = [
			{ id: 1, name: 'first' },
			{ id: 2, name: 'second' },
		]

		await producer.sendBatch(messages, { delaySeconds: 30 })

		expect(mockQueue.sendBatch).toHaveBeenCalledWith([
			{ body: { id: 1, name: 'first' }, delaySeconds: 30 },
			{ body: { id: 2, name: 'second' }, delaySeconds: 30 },
		])
	})

	it('should throw MessageValidationError on invalid batch message', async () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = new QueueProducer(mockQueue, { schema: testSchema })

		const messages = [{ id: 1, name: 'first' }, { id: 'invalid' } as any]

		await expect(producer.sendBatch(messages)).rejects.toThrow(MessageValidationError)
		await expect(producer.sendBatch(messages)).rejects.toThrow('index 1')
		expect(mockQueue.sendBatch).not.toHaveBeenCalled()
	})

	it('should send batch with individual options', async () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = new QueueProducer(mockQueue, { schema: testSchema })

		const messages = [
			{ body: { id: 1, name: 'first' }, delaySeconds: 10 },
			{ body: { id: 2, name: 'second' }, delaySeconds: 20 },
		]

		await producer.sendBatchWithOptions(messages)

		expect(mockQueue.sendBatch).toHaveBeenCalledWith([
			{ body: { id: 1, name: 'first' }, delaySeconds: 10 },
			{ body: { id: 2, name: 'second' }, delaySeconds: 20 },
		])
	})

	it('should validate batch with individual options', async () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = new QueueProducer(mockQueue, { schema: testSchema })

		const messages = [
			{ body: { id: 1, name: 'first' }, delaySeconds: 10 },
			{ body: { id: 'invalid' } as any, delaySeconds: 20 },
		]

		await expect(producer.sendBatchWithOptions(messages)).rejects.toThrow(MessageValidationError)
		expect(mockQueue.sendBatch).not.toHaveBeenCalled()
	})
})

describe('createQueueProducer', () => {
	it('should create a QueueProducer instance', () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = createQueueProducer(mockQueue, testSchema)
		expect(producer).toBeInstanceOf(QueueProducer)
	})

	it('should create producer with debug enabled', () => {
		const mockQueue: Queue<TestMessage> = {
			send: vi.fn(),
			sendBatch: vi.fn(),
		}

		const producer = createQueueProducer(mockQueue, testSchema, true)
		expect(producer).toBeInstanceOf(QueueProducer)
	})
})
