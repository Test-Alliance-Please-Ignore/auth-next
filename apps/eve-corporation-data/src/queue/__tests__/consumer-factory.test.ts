import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createCorporationQueueConsumer } from '../consumer-factory'
import type { Env } from '../../context'

// Mock the dependencies
vi.mock('@repo/queue-utils', () => ({
	createQueueConsumer: vi.fn((schema, messageHandler, options) => {
		// Return a function that captures the configuration for testing
		return {
			schema,
			messageHandler,
			options,
		}
	}),
	exponentialBackoff: vi.fn((maxAttempts, baseDelay, maxDelay) => ({
		maxAttempts,
		baseDelay,
		maxDelay,
	})),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn((namespace, id) => ({
		_namespace: namespace,
		_id: id,
	})),
}))

describe('Consumer Factory', () => {
	describe('createCorporationQueueConsumer', () => {
		it('should create consumer with correct schema', () => {
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			expect(consumer.schema).toBe(schema)
		})

		it('should configure exponential backoff retry strategy', async () => {
			const { exponentialBackoff } = await import('@repo/queue-utils')
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			createCorporationQueueConsumer('test-queue', schema, handler)

			expect(exponentialBackoff).toHaveBeenCalledWith(3, 2, 60)
		})

		it('should configure batch options with concurrency 10', () => {
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			expect(consumer.options.batchOptions).toEqual({ concurrency: 10 })
		})

		it('should enable debug logging', () => {
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			expect(consumer.options.debug).toBe(true)
		})

		it('should extract corporationId and create stub with correct ID', async () => {
			const { getStub } = await import('@repo/do-utils')
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			const mockEnv = {
				EVE_CORPORATION_DATA: {} as DurableObjectNamespace,
			} as Env

			const metadata = {
				env: mockEnv,
				attempt: 1,
			}

			// Call the message handler
			await consumer.messageHandler(message, metadata)

			expect(getStub).toHaveBeenCalledWith(mockEnv.EVE_CORPORATION_DATA, '98000001')
		})

		it('should call handler with stub and message', async () => {
			const { getStub } = await import('@repo/do-utils')
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			const mockEnv = {
				EVE_CORPORATION_DATA: {} as DurableObjectNamespace,
			} as Env

			const metadata = {
				env: mockEnv,
				attempt: 1,
			}

			const mockStub = { _namespace: {}, _id: '98000001' }
			vi.mocked(getStub).mockReturnValue(mockStub as any)

			// Call the message handler
			await consumer.messageHandler(message, metadata)

			expect(handler).toHaveBeenCalledWith(mockStub, message)
		})

		it('should configure lifecycle hooks', () => {
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			expect(consumer.options.hooks).toBeDefined()
			expect(consumer.options.hooks.onMessageSuccess).toBeDefined()
			expect(consumer.options.hooks.onMessageError).toBeDefined()
			expect(consumer.options.hooks.onBatchStart).toBeDefined()
			expect(consumer.options.hooks.onBatchComplete).toBeDefined()
		})

		it('should log success with requesterId when provided', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
				requesterId: z.string().optional(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				requesterId: 'test-user',
			}

			consumer.options.hooks.onMessageSuccess(message)

			expect(consoleSpy).toHaveBeenCalledWith(
				'[test-queue] Successfully refreshed corp 98000001',
				'(requested by test-user)'
			)

			consoleSpy.mockRestore()
		})

		it('should log success without requesterId when not provided', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			consumer.options.hooks.onMessageSuccess(message)

			expect(consoleSpy).toHaveBeenCalledWith(
				'[test-queue] Successfully refreshed corp 98000001',
				''
			)

			consoleSpy.mockRestore()
		})

		it('should log errors with attempt count', () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			const error = new Error('Test error')
			const metadata = { attempt: 2 }

			consumer.options.hooks.onMessageError(error, message, metadata)

			expect(consoleSpy).toHaveBeenCalledWith(
				'[test-queue] Failed for corp 98000001 (attempt 2):',
				'Test error'
			)

			consoleSpy.mockRestore()
		})

		it('should log batch start with message count', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			const batch = {
				messages: [
					{ corporationId: '1', timestamp: 1 },
					{ corporationId: '2', timestamp: 2 },
				],
			}

			consumer.options.hooks.onBatchStart(batch as any)

			expect(consoleSpy).toHaveBeenCalledWith('[test-queue] Processing batch of 2 messages')

			consoleSpy.mockRestore()
		})

		it('should log batch completion with statistics', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
			const schema = z.object({
				corporationId: z.string(),
				timestamp: z.number(),
			})
			const handler = vi.fn()

			const consumer = createCorporationQueueConsumer('test-queue', schema, handler)

			const batch = { messages: [] }
			const result = {
				successful: 8,
				failed: 1,
				retried: 1,
			}

			consumer.options.hooks.onBatchComplete(batch as any, result as any)

			expect(consoleSpy).toHaveBeenCalledWith(
				'[test-queue] Batch complete: 8 successful, 1 failed, 1 retried'
			)

			consoleSpy.mockRestore()
		})
	})
})
