import { describe, expect, it, vi } from 'vitest'
import {
	defaultBatchOptions,
	processConcurrently,
	processSequentially,
	processBatch,
	chunk,
} from '../../src/batch'

describe('defaultBatchOptions', () => {
	it('should have default concurrency of 10', () => {
		expect(defaultBatchOptions.concurrency).toBe(10)
	})

	it('should not stop on error by default', () => {
		expect(defaultBatchOptions.stopOnError).toBe(false)
	})
})

describe('processConcurrently', () => {
	it('should process items concurrently', async () => {
		const items = [1, 2, 3, 4, 5]
		const handler = vi.fn(async (item: number) => item * 2)

		const results = await processConcurrently(items, handler, 2)

		expect(results).toEqual([2, 4, 6, 8, 10])
		expect(handler).toHaveBeenCalledTimes(5)
	})

	it('should respect concurrency limit', async () => {
		let concurrent = 0
		let maxConcurrent = 0

		const items = Array.from({ length: 10 }, (_, i) => i)
		const handler = async (item: number) => {
			concurrent++
			maxConcurrent = Math.max(maxConcurrent, concurrent)
			await new Promise((resolve) => setTimeout(resolve, 10))
			concurrent--
			return item
		}

		await processConcurrently(items, handler, 3)

		expect(maxConcurrent).toBeLessThanOrEqual(3)
	})

	it('should handle empty array', async () => {
		const results = await processConcurrently([], async (item: number) => item)
		expect(results).toEqual([])
	})

	it('should propagate errors', async () => {
		const items = [1, 2, 3]
		const handler = async (item: number) => {
			if (item === 2) {
				throw new Error('Test error')
			}
			return item
		}

		await expect(processConcurrently(items, handler, 2)).rejects.toThrow('Test error')
	})
})

describe('processSequentially', () => {
	it('should process items sequentially', async () => {
		const items = [1, 2, 3, 4, 5]
		const order: number[] = []
		const handler = async (item: number) => {
			order.push(item)
			return item * 2
		}

		const results = await processSequentially(items, handler)

		expect(results).toEqual([2, 4, 6, 8, 10])
		expect(order).toEqual([1, 2, 3, 4, 5])
	})

	it('should handle empty array', async () => {
		const results = await processSequentially([], async (item: number) => item)
		expect(results).toEqual([])
	})

	it('should propagate errors', async () => {
		const items = [1, 2, 3]
		const handler = async (item: number) => {
			if (item === 2) {
				throw new Error('Test error')
			}
			return item
		}

		await expect(processSequentially(items, handler)).rejects.toThrow('Test error')
	})
})

describe('processBatch', () => {
	it('should process batch successfully', async () => {
		const items = [1, 2, 3, 4, 5]
		const handler = vi.fn(async () => {})

		const result = await processBatch(items, handler)

		expect(result.total).toBe(5)
		expect(result.successful).toBe(5)
		expect(result.failed).toBe(0)
		expect(result.errors).toHaveLength(0)
	})

	it('should collect errors without stopping', async () => {
		const items = [1, 2, 3, 4, 5]
		const handler = async (item: number) => {
			if (item === 2 || item === 4) {
				throw new Error(`Error for ${item}`)
			}
		}

		const result = await processBatch(items, handler)

		expect(result.total).toBe(5)
		expect(result.successful).toBe(3)
		expect(result.failed).toBe(2)
		expect(result.errors).toHaveLength(2)
	})

	it('should stop on first error when stopOnError is true', async () => {
		const items = [1, 2, 3, 4, 5]
		const handler = vi.fn(async (item: number) => {
			if (item === 2) {
				throw new Error('Error at 2')
			}
		})

		const result = await processBatch(items, handler, { stopOnError: true })

		expect(result.total).toBe(5)
		expect(result.successful).toBe(1)
		expect(result.failed).toBe(1)
		expect(handler).toHaveBeenCalledTimes(2) // Only 1 and 2 processed
	})

	it('should respect concurrency option', async () => {
		let concurrent = 0
		let maxConcurrent = 0

		const items = Array.from({ length: 10 }, (_, i) => i)
		const handler = async () => {
			concurrent++
			maxConcurrent = Math.max(maxConcurrent, concurrent)
			await new Promise((resolve) => setTimeout(resolve, 10))
			concurrent--
		}

		await processBatch(items, handler, { concurrency: 3 })

		expect(maxConcurrent).toBeLessThanOrEqual(3)
	})

	it('should handle empty batch', async () => {
		const result = await processBatch([], async () => {})

		expect(result.total).toBe(0)
		expect(result.successful).toBe(0)
		expect(result.failed).toBe(0)
	})
})

describe('chunk', () => {
	it('should chunk array into smaller arrays', () => {
		const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
		const chunks = chunk(items, 3)

		expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]])
	})

	it('should handle exact division', () => {
		const items = [1, 2, 3, 4, 5, 6]
		const chunks = chunk(items, 2)

		expect(chunks).toEqual([[1, 2], [3, 4], [5, 6]])
	})

	it('should handle empty array', () => {
		const chunks = chunk([], 3)
		expect(chunks).toEqual([])
	})

	it('should handle chunk size larger than array', () => {
		const items = [1, 2, 3]
		const chunks = chunk(items, 10)

		expect(chunks).toEqual([[1, 2, 3]])
	})

	it('should handle chunk size of 1', () => {
		const items = [1, 2, 3]
		const chunks = chunk(items, 1)

		expect(chunks).toEqual([[1], [2], [3]])
	})
})
