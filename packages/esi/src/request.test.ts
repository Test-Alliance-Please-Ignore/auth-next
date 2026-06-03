import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EsiRateLimitStore } from '@repo/esi-rate-limit'

import { EsiRequestClient, extractPageFromPath, removePageFromPath } from './request'

class MemoryKv {
	private readonly store = new Map<string, string>()

	async get<T>(key: string, type?: 'json'): Promise<T | string | null> {
		const value = this.store.get(key)
		if (value === undefined) {
			return null
		}
		if (type === 'json') {
			return JSON.parse(value) as T
		}
		return value
	}

	async put(key: string, value: string): Promise<void> {
		this.store.set(key, value)
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key)
	}
}

describe('ESI request helpers', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-02T00:00:00.000Z'))
		vi.restoreAllMocks()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('normalizes page parameters in cache keys', () => {
		expect(extractPageFromPath('/characters/123/orders?page=2')).toBe(2)
		expect(removePageFromPath('/characters/123/orders?page=2')).toBe('/characters/123/orders')
		expect(removePageFromPath('/characters/123/orders?status=open&page=2')).toBe(
			'/characters/123/orders?status=open'
		)
	})

	it('returns cached responses without fetching when the cache is fresh', async () => {
		const cache = {
			getCachedResponse: vi.fn().mockResolvedValue({
				data: [{ character_id: 1 }],
				expiresAt: new Date(Date.now() + 60_000),
				etag: 'etag-1',
				pages: null,
				page: null,
				lastModified: new Date(),
			}),
			setCachedResponse: vi.fn(),
		}

		const fetchSpy = vi.fn()
		const client = new EsiRequestClient({
			rateLimits: new EsiRateLimitStore(new MemoryKv() as never),
			cache,
			fetchImpl: fetchSpy,
		})

		const response = await client.request<Array<{ character_id: number }>>({
			path: '/characters/affiliation',
			userKey: 'public',
			cacheScope: { scope: 'public', scopeId: 'public' },
			cacheMode: 'default',
			parse: async () => [{ character_id: 1 }],
			buildError: () => new Error('unexpected'),
		})

		expect(response.data).toEqual([{ character_id: 1 }])
		expect(response.cached).toBe(true)
		expect(cache.getCachedResponse).toHaveBeenCalledTimes(1)
		expect(cache.setCachedResponse).not.toHaveBeenCalled()
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('does not resolve an access token when a provided cached response is still fresh', async () => {
		const fetchSpy = vi.fn()
		const accessTokenFactory = vi.fn().mockResolvedValue('token-1')
		const client = new EsiRequestClient({
			rateLimits: new EsiRateLimitStore(new MemoryKv() as never),
			fetchImpl: fetchSpy,
		})

		const response = await client.request<Array<{ character_id: number }>>({
			path: '/characters/affiliation',
			userKey: 'public',
			cacheScope: { scope: 'public', scopeId: 'public' },
			cacheMode: 'default',
			cachedResponse: {
				data: [{ character_id: 1 }],
				expiresAt: new Date(Date.now() + 60_000),
				etag: 'etag-1',
				pages: null,
				page: null,
				lastModified: new Date(),
				cached: true,
			},
			accessTokenFactory,
			parse: async () => [{ character_id: 1 }],
			buildError: () => new Error('unexpected'),
		})

		expect(response.data).toEqual([{ character_id: 1 }])
		expect(response.cached).toBe(true)
		expect(accessTokenFactory).not.toHaveBeenCalled()
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('revalidates stale cached responses with etag and updates the cache on 304', async () => {
		const cache = {
			getCachedResponse: vi.fn().mockImplementation(async (_scope, _path, _page, includeExpired) => {
				if (includeExpired) {
					return {
						data: [{ character_id: 1 }],
						expiresAt: new Date(Date.now() - 1_000),
						etag: 'etag-1',
						pages: null,
						page: null,
						lastModified: new Date(Date.now() - 60_000),
					}
				}

				return {
					data: [{ character_id: 1 }],
					expiresAt: new Date(Date.now() - 1_000),
					etag: 'etag-1',
					pages: null,
					page: null,
					lastModified: new Date(Date.now() - 60_000),
				}
			}),
			setCachedResponse: vi.fn(),
		}

		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 304,
				headers: {
					Expires: new Date(Date.now() + 60_000).toUTCString(),
				},
			})
		)
		const onResponse = vi.fn().mockResolvedValue(undefined)

		const client = new EsiRequestClient({
			rateLimits: new EsiRateLimitStore(new MemoryKv() as never),
			cache,
			fetchImpl: fetchSpy,
		})

		const response = await client.request<Array<{ character_id: number }>>({
			path: '/characters/affiliation',
			userKey: 'public',
			cacheScope: { scope: 'public', scopeId: 'public' },
			cacheMode: 'default',
			maxLocalCacheTtl: 0,
			onResponse,
			parse: async () => [{ character_id: 1 }],
			buildError: () => new Error('unexpected'),
		})

		expect(response.data).toEqual([{ character_id: 1 }])
		expect(response.cached).toBe(true)
		expect(cache.getCachedResponse).toHaveBeenCalledTimes(2)
		expect(cache.setCachedResponse).toHaveBeenCalledTimes(1)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(onResponse).toHaveBeenCalledTimes(1)
	})

	it('invokes the underlying fetch function without binding the client as this', async () => {
		const fetchImpl = vi.fn(function (this: unknown) {
			expect(this).toBeUndefined()
			return Promise.resolve(
				new Response(JSON.stringify([{ character_id: 1 }]), {
					status: 200,
					headers: {
						Expires: new Date(Date.now() + 60_000).toUTCString(),
					},
				})
			)
		})

		const client = new EsiRequestClient({
			rateLimits: new EsiRateLimitStore(new MemoryKv() as never),
			fetchImpl: fetchImpl as typeof fetch,
		})

		const response = await client.request<Array<{ character_id: number }>>({
			path: '/characters/affiliation',
			userKey: 'public',
			cacheScope: { scope: 'public', scopeId: 'public' },
			cacheMode: 'no-store',
			parse: async (res) => (await res.json()) as Array<{ character_id: number }>,
			buildError: () => new Error('unexpected'),
		})

		expect(response.data).toEqual([{ character_id: 1 }])
		expect(fetchImpl).toHaveBeenCalledTimes(1)
	})

	it('treats bucket limits as a sliding window and only blocks when remaining is exhausted', async () => {
		const fetchSpy = vi
			.fn()
			.mockImplementationOnce(() =>
				Promise.resolve(
					new Response(JSON.stringify([{ character_id: 1 }]), {
						status: 200,
						headers: {
							'Content-Type': 'application/json',
							'X-Ratelimit-Group': 'char-asset',
							'X-Ratelimit-Limit': '3/1m',
							'X-Ratelimit-Remaining': '1',
							'X-Ratelimit-Used': '2',
						},
					})
				)
			)
				.mockImplementationOnce(() =>
					Promise.resolve(
						new Response(JSON.stringify([{ character_id: 1 }]), {
							status: 200,
							headers: {
								'Content-Type': 'application/json',
								'X-Ratelimit-Group': 'char-asset',
								'X-Ratelimit-Limit': '3/1m',
								'X-Ratelimit-Remaining': '0',
								'X-Ratelimit-Used': '3',
							},
						})
					)
				)
				.mockImplementationOnce(() =>
					Promise.resolve(
						new Response(JSON.stringify([{ character_id: 1 }]), {
							status: 200,
							headers: {
								'Content-Type': 'application/json',
								'X-Ratelimit-Group': 'char-asset',
								'X-Ratelimit-Limit': '3/1m',
								'X-Ratelimit-Remaining': '1',
								'X-Ratelimit-Used': '2',
							},
						})
					)
				)

		const client = new EsiRequestClient({
			rateLimits: new EsiRateLimitStore(new MemoryKv() as never),
			fetchImpl: fetchSpy as typeof fetch,
		})

		const first = await client.request<Array<{ character_id: number }>>({
			path: '/characters/1402766339/assets?page=2',
			userKey: 'character:1402766339',
			cacheMode: 'no-store',
			parse: async (res) => (await res.json()) as Array<{ character_id: number }>,
			buildError: () => new Error('unexpected'),
		})
		const second = await client.request<Array<{ character_id: number }>>({
			path: '/characters/1402766339/assets?page=2',
			userKey: 'character:1402766339',
			cacheMode: 'no-store',
			parse: async (res) => (await res.json()) as Array<{ character_id: number }>,
			buildError: () => new Error('unexpected'),
		})

		await expect(
			client.request<Array<{ character_id: number }>>({
				path: '/characters/1402766339/assets?page=2',
				userKey: 'character:1402766339',
				cacheMode: 'no-store',
				parse: async (res) => (await res.json()) as Array<{ character_id: number }>,
				buildError: () => new Error('unexpected'),
			})
		).rejects.toThrow(/ESI rate limit active/)

		vi.advanceTimersByTime(61_000)

		const fourth = await client.request<Array<{ character_id: number }>>({
			path: '/characters/1402766339/assets?page=2',
			userKey: 'character:1402766339',
			cacheMode: 'no-store',
			parse: async (res) => (await res.json()) as Array<{ character_id: number }>,
			buildError: () => new Error('unexpected'),
		})

		expect(first.data).toEqual([{ character_id: 1 }])
		expect(second.data).toEqual([{ character_id: 1 }])
		expect(fourth.data).toEqual([{ character_id: 1 }])
		expect(fetchSpy).toHaveBeenCalledTimes(3)
	})

	it('does not preflight-block legacy error-limit telemetry until it is exhausted', async () => {
		const fetchSpy = vi.fn().mockImplementation(() =>
			Promise.resolve(
				new Response(JSON.stringify([{ character_id: 1 }]), {
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'X-ESI-Error-Limit-Remain': '9',
						'X-ESI-Error-Limit-Reset': '30',
					},
				})
			)
		)

		const client = new EsiRequestClient({
			rateLimits: new EsiRateLimitStore(new MemoryKv() as never),
			fetchImpl: fetchSpy as typeof fetch,
		})

		await client.request<Array<{ character_id: number }>>({
			path: '/universe/structures/1053654548169',
			userKey: 'character:1402766339',
			cacheMode: 'no-store',
			parse: async (res) => (await res.json()) as Array<{ character_id: number }>,
			buildError: () => new Error('unexpected'),
		})

		await client.request<Array<{ character_id: number }>>({
			path: '/universe/structures/1053654548169',
			userKey: 'character:1402766339',
			cacheMode: 'no-store',
			parse: async (res) => (await res.json()) as Array<{ character_id: number }>,
			buildError: () => new Error('unexpected'),
		})

		expect(fetchSpy).toHaveBeenCalledTimes(2)
	})
})
