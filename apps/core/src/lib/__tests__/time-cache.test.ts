import { describe, expect, it, vi } from 'vitest'

import { TimeCache } from '@repo/hono-helpers'

describe('TimeCache', () => {
	it('shares an in-flight computation for concurrent misses', async () => {
		const cache = new TimeCache<string>(60_000)
		const compute = vi.fn(async () => 'value')

		const values = await Promise.all([
			cache.getOrSet('key', compute),
			cache.getOrSet('key', compute),
			cache.getOrSet('key', compute),
		])

		expect(values).toEqual(['value', 'value', 'value'])
		expect(compute).toHaveBeenCalledOnce()
	})

	it('does not cache rejected computations', async () => {
		const cache = new TimeCache<string>(60_000)
		const compute = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('failed'))
			.mockResolvedValueOnce('recovered')

		await expect(cache.getOrSet('key', compute)).rejects.toThrow('failed')
		await expect(cache.getOrSet('key', compute)).resolves.toBe('recovered')
		expect(compute).toHaveBeenCalledTimes(2)
	})
})
