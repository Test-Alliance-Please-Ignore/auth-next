import { describe, expect, it, vi } from 'vitest'

import { DedupedFetch, bodyAndAuthAwareKeyGenerator, defaultAuthAwareKeyGenerator } from '../src'

describe('DedupedFetch', () => {
	describe('Basic Deduplication', () => {
		it('should deduplicate concurrent GET requests to same URL', async () => {
			const deduper = new DedupedFetch()

			// Mock fetch to track calls
			const mockFetch = vi.fn(async () => new Response('test data'))
			globalThis.fetch = mockFetch

			// Make 3 concurrent requests to same URL
			const promises = [
				deduper.fetch('https://api.example.com/data'),
				deduper.fetch('https://api.example.com/data'),
				deduper.fetch('https://api.example.com/data'),
			]

			const results = await Promise.all(promises)

			// Only one fetch should have been made
			expect(mockFetch).toHaveBeenCalledTimes(1)

			// All callers should receive data
			expect(results).toHaveLength(3)
			for (const result of results) {
				expect(await result.text()).toBe('test data')
			}

			// Check stats
			const stats = deduper.getStats()
			expect(stats.hits).toBe(2) // 2 deduped requests
			expect(stats.misses).toBe(1) // 1 actual fetch
			expect(stats.inFlight).toBe(0) // All completed
		})

		it('should not deduplicate sequential requests', async () => {
			const deduper = new DedupedFetch()

			const mockFetch = vi.fn(async () => new Response('test data'))
			globalThis.fetch = mockFetch

			// Make requests sequentially
			await deduper.fetch('https://api.example.com/data')
			await deduper.fetch('https://api.example.com/data')

			// Both requests should result in fetches
			expect(mockFetch).toHaveBeenCalledTimes(2)

			const stats = deduper.getStats()
			expect(stats.hits).toBe(0)
			expect(stats.misses).toBe(2)
		})

		it('should not deduplicate requests to different URLs', async () => {
			const deduper = new DedupedFetch()

			const mockFetch = vi.fn(async () => new Response('test'))
			globalThis.fetch = mockFetch

			await Promise.all([
				deduper.fetch('https://api.example.com/data1'),
				deduper.fetch('https://api.example.com/data2'),
			])

			expect(mockFetch).toHaveBeenCalledTimes(2)
		})
	})

	describe('Authorization Header Security', () => {
		it('should NOT deduplicate requests with different Authorization headers', async () => {
			const deduper = new DedupedFetch()

			const mockFetch = vi.fn(async () => new Response('user data'))
			globalThis.fetch = mockFetch

			// Two concurrent requests to same URL but different auth tokens
			await Promise.all([
				deduper.fetch('https://api.example.com/profile', {
					headers: { Authorization: 'Bearer token1' },
				}),
				deduper.fetch('https://api.example.com/profile', {
					headers: { Authorization: 'Bearer token2' },
				}),
			])

			// Should make 2 separate fetches (different auth = different users)
			expect(mockFetch).toHaveBeenCalledTimes(2)

			const stats = deduper.getStats()
			expect(stats.hits).toBe(0)
			expect(stats.misses).toBe(2)
		})

		it('should deduplicate requests with identical Authorization headers', async () => {
			const deduper = new DedupedFetch()

			let resolveFetch: () => void
			const fetchPromise = new Promise<Response>((resolve) => {
				resolveFetch = () => resolve(new Response('user data'))
			})

			const mockFetch = vi.fn(async () => fetchPromise)
			globalThis.fetch = mockFetch as typeof fetch

			const authHeaders = { Authorization: 'Bearer token123' }

			// Two concurrent requests with same auth token
			// Both can start immediately - no race condition with sync key generation!
			const promises = Promise.all([
				deduper.fetch('https://api.example.com/profile', { headers: authHeaders }),
				deduper.fetch('https://api.example.com/profile', { headers: authHeaders }),
			])

			// Resolve the fetch
			resolveFetch!()

			await promises

			// Should only make 1 fetch (same auth = same user)
			expect(mockFetch).toHaveBeenCalledTimes(1)

			const stats = deduper.getStats()
			expect(stats.hits).toBe(1)
			expect(stats.misses).toBe(1)
		})

		it('should handle requests with no Authorization header', async () => {
			const deduper = new DedupedFetch()

			const mockFetch = vi.fn(async () => new Response('public data'))
			globalThis.fetch = mockFetch

			await Promise.all([
				deduper.fetch('https://api.example.com/public'),
				deduper.fetch('https://api.example.com/public'),
			])

			// Should deduplicate public requests
			expect(mockFetch).toHaveBeenCalledTimes(1)

			const stats = deduper.getStats()
			expect(stats.hits).toBe(1)
			expect(stats.misses).toBe(1)
		})
	})

	describe('Non-Deduped Requests', () => {
		it('should not deduplicate POST requests by default', async () => {
			const deduper = new DedupedFetch()

			const mockFetch = vi.fn(async () => new Response('created'))
			globalThis.fetch = mockFetch

			await Promise.all([
				deduper.fetch('https://api.example.com/items', { method: 'POST' }),
				deduper.fetch('https://api.example.com/items', { method: 'POST' }),
			])

			// POST requests should not be deduped by default
			expect(mockFetch).toHaveBeenCalledTimes(2)
		})

		it('should respect custom shouldDedupe predicate', async () => {
			const deduper = new DedupedFetch({
				shouldDedupe: (input, init) => {
					const method = init?.method?.toUpperCase() || 'GET'
					return ['GET', 'POST'].includes(method)
				},
				keyGenerator: bodyAndAuthAwareKeyGenerator,
			})

			const mockFetch = vi.fn(async () => new Response('ok'))
			globalThis.fetch = mockFetch

			const body = JSON.stringify({ data: 'test' })

			// POST requests with same body should be deduped with custom config
			await Promise.all([
				deduper.fetch('https://api.example.com/search', {
					method: 'POST',
					body,
				}),
				deduper.fetch('https://api.example.com/search', {
					method: 'POST',
					body,
				}),
			])

			expect(mockFetch).toHaveBeenCalledTimes(1)
		})
	})

	describe('Error Handling', () => {
		it('should propagate errors to all concurrent callers', async () => {
			const deduper = new DedupedFetch()

			const mockFetch = vi.fn(async () => {
				throw new Error('Network error')
			})
			globalThis.fetch = mockFetch

			const promises = [
				deduper.fetch('https://api.example.com/data'),
				deduper.fetch('https://api.example.com/data'),
			]

			// Both should reject with the same error
			await expect(Promise.all(promises)).rejects.toThrow('Network error')

			// Only one fetch should have been attempted
			expect(mockFetch).toHaveBeenCalledTimes(1)
		})

		it('should allow retry after error', async () => {
			const deduper = new DedupedFetch()

			let callCount = 0
			const mockFetch = vi.fn(async () => {
				callCount++
				if (callCount === 1) {
					throw new Error('First attempt failed')
				}
				return new Response('success')
			})
			globalThis.fetch = mockFetch

			// First request fails
			await expect(deduper.fetch('https://api.example.com/data')).rejects.toThrow(
				'First attempt failed'
			)

			// Second request should be allowed (not deduped with failed request)
			const result = await deduper.fetch('https://api.example.com/data')
			expect(await result.text()).toBe('success')

			expect(mockFetch).toHaveBeenCalledTimes(2)
		})
	})

	describe('Statistics', () => {
		it('should track hits and misses correctly', async () => {
			const deduper = new DedupedFetch()

			const mockFetch = vi.fn(async () => new Response('data'))
			globalThis.fetch = mockFetch

			// First request - miss
			await deduper.fetch('https://api.example.com/data1')

			let stats = deduper.getStats()
			expect(stats.hits).toBe(0)
			expect(stats.misses).toBe(1)

			// Concurrent requests to same URL - 1 miss, 2 hits
			await Promise.all([
				deduper.fetch('https://api.example.com/data2'),
				deduper.fetch('https://api.example.com/data2'),
				deduper.fetch('https://api.example.com/data2'),
			])

			stats = deduper.getStats()
			expect(stats.hits).toBe(2)
			expect(stats.misses).toBe(2)
		})

		it('should track in-flight requests', async () => {
			const deduper = new DedupedFetch()

			let resolveFirst: () => void
			const firstPromise = new Promise<Response>((resolve) => {
				resolveFirst = () => resolve(new Response('data'))
			})

			const mockFetch = vi.fn(async () => firstPromise)
			globalThis.fetch = mockFetch as typeof fetch

			// Start request but don't wait
			const promise = deduper.fetch('https://api.example.com/data')

			// Wait a tick for async key generation to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Should be in-flight
			expect(deduper.getStats().inFlight).toBe(1)

			// Resolve and wait
			resolveFirst!()
			await promise

			// Should no longer be in-flight
			expect(deduper.getStats().inFlight).toBe(0)
		})
	})

	describe('Memory Management', () => {
		it('should clean up completed requests', async () => {
			const deduper = new DedupedFetch()

			const mockFetch = vi.fn(async () => new Response('data'))
			globalThis.fetch = mockFetch

			await deduper.fetch('https://api.example.com/data')

			expect(deduper.size()).toBe(0)
		})

		it('should respect maxSize limit', async () => {
			const deduper = new DedupedFetch({ maxSize: 2 })

			const resolvers: Array<() => void> = []
			const mockFetch = vi.fn(async () => {
				return new Promise<Response>((resolve) => {
					resolvers.push(() => resolve(new Response('data')))
				})
			})
			globalThis.fetch = mockFetch as typeof fetch

			// Start 3 concurrent requests (limit is 2)
			const promise1 = deduper.fetch('https://api.example.com/data1')
			await new Promise((resolve) => setTimeout(resolve, 10))
			const promise2 = deduper.fetch('https://api.example.com/data2')
			await new Promise((resolve) => setTimeout(resolve, 10))
			const promise3 = deduper.fetch('https://api.example.com/data3')

			// Wait for all to register
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Should only have 2 in-flight (maxSize limit)
			expect(deduper.size()).toBeLessThanOrEqual(2)

			// Resolve all
			resolvers.forEach((r) => r())
			await Promise.all([promise1, promise2, promise3])
		}, 10000)

		it('should support manual clear', async () => {
			const deduper = new DedupedFetch()

			const mockFetch = vi.fn(async () => new Promise<Response>(() => {})) // Never resolves
			globalThis.fetch = mockFetch as typeof fetch

			// Start request (intentionally not awaited)
			void deduper.fetch('https://api.example.com/data')

			// Wait for async key generation to complete
			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(deduper.size()).toBe(1)

			deduper.clear()

			expect(deduper.size()).toBe(0)
			expect(deduper.getStats().inFlight).toBe(0)
		})
	})

	describe('Key Generators', () => {
		it('should use custom key generator', async () => {
			const customKeyGen = vi.fn(() => 'custom-key')

			const deduper = new DedupedFetch({
				keyGenerator: customKeyGen,
			})

			const mockFetch = vi.fn(async () => new Response('data'))
			globalThis.fetch = mockFetch

			await Promise.all([
				deduper.fetch('https://api.example.com/data1'),
				deduper.fetch('https://api.example.com/data2'),
			])

			// Should have been called for both requests
			expect(customKeyGen).toHaveBeenCalledTimes(2)

			// Both requests should use same key, so only 1 fetch
			expect(mockFetch).toHaveBeenCalledTimes(1)
		})

		it('should handle async key generators', async () => {
			const deduper = new DedupedFetch({
				keyGenerator: defaultAuthAwareKeyGenerator,
			})

			const mockFetch = vi.fn(async () => new Response('data'))
			globalThis.fetch = mockFetch

			await deduper.fetch('https://api.example.com/data', {
				headers: { Authorization: 'Bearer token' },
			})

			expect(mockFetch).toHaveBeenCalledTimes(1)
		})
	})

	describe('has() method', () => {
		it('should return true for in-flight requests', async () => {
			const deduper = new DedupedFetch()

			let resolveFirst: () => void
			const firstPromise = new Promise<Response>((resolve) => {
				resolveFirst = () => resolve(new Response('data'))
			})

			const mockFetch = vi.fn(async () => firstPromise)
			globalThis.fetch = mockFetch as typeof fetch

			const promise = deduper.fetch('https://api.example.com/data')

			// Wait for fetch to be registered
			await new Promise((resolve) => setTimeout(resolve, 1))

			expect(deduper.has('https://api.example.com/data')).toBe(true)

			resolveFirst!()
			await promise

			expect(deduper.has('https://api.example.com/data')).toBe(false)
		})
	})
})
