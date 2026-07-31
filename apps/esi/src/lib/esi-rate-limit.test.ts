import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	buildEsiUserKey,
	buildPublicEsiUserKey,
	EsiRateLimitStore,
	parseEsiRateLimitHeaders,
	parseEsiRateLimitWindow,
} from '@repo/esi-rate-limit'

class MemoryKV {
	private readonly values = new Map<string, string>()

	async get(key: string, type?: string): Promise<unknown> {
		const value = this.values.get(key)
		if (value === undefined) {
			return null
		}
		if (type === 'json') {
			return JSON.parse(value) as unknown
		}
		return value
	}

	async put(key: string, value: string): Promise<void> {
		this.values.set(key, value)
	}

	async delete(key: string): Promise<void> {
		this.values.delete(key)
	}
}

describe('esi-rate-limit helpers', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-02T00:00:00.000Z'))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('parses bucket limit headers', () => {
		expect(parseEsiRateLimitWindow('150/15m')).toEqual({ limit: 150, windowSeconds: 900 })
		expect(parseEsiRateLimitWindow('120/1h')).toEqual({ limit: 120, windowSeconds: 3600 })
		expect(parseEsiRateLimitWindow('bad')).toBeNull()
	})

	it('parses ESI bucket and error-limit header snapshots', () => {
		const snapshot = parseEsiRateLimitHeaders(
			new Headers({
				'X-Ratelimit-Group': 'char-location',
				'X-Ratelimit-Limit': '150/15m',
				'X-Ratelimit-Remaining': '42',
				'X-Ratelimit-Used': '2',
				'Retry-After': '17',
				'X-ESI-Error-Limit-Remain': '9',
				'X-ESI-Error-Limit-Reset': '30',
			})
		)

		expect(snapshot).toMatchObject({
			group: 'char-location',
			limit: 150,
			remaining: 42,
			used: 2,
			windowSeconds: 900,
			retryAfterSeconds: 17,
			errorLimitRemain: 9,
			errorLimitResetSeconds: 30,
		})
	})

	it('persists bucket usage within the sliding window and expires it after the window elapses', async () => {
		const store = new EsiRateLimitStore(new MemoryKV() as unknown as KVNamespace)
		const nowMs = Date.now()
		const userKey = buildEsiUserKey('app', 'char')
		const routeKey = '/characters/:id/location'
		const group = 'char-location'

		await store.rememberRouteGroup(routeKey, group)
		expect(await store.getRouteGroup(routeKey)).toBe(group)

		await store.putBucketSnapshot({
			group,
			userKey,
			routeKey,
			status: 200,
			limit: 2,
			remaining: 1,
			used: 2,
			windowSeconds: 1,
			observedAtMs: nowMs,
			expiresAtMs: nowMs + 1_000,
		})

		expect(await store.getBucketSnapshot(group, userKey)).toMatchObject({
			group,
			userKey,
			routeKey,
			limit: 2,
			remaining: 1,
			used: 2,
			charges: [{ atMs: Math.floor(nowMs / 1000) * 1000, cost: 1 }],
		})

		vi.setSystemTime(new Date(nowMs + 2_000))
		expect(await store.getBucketSnapshot(group, userKey)).toBeNull()

		await store.putRouteCooldown({
			userKey: buildPublicEsiUserKey(),
			routeKey,
			retryAfterSeconds: 5,
			observedAtMs: Date.now(),
			expiresAtMs: Date.now() + 1_000,
		})

		expect(await store.getRouteCooldown(routeKey, buildPublicEsiUserKey())).toMatchObject({
			routeKey,
			userKey: buildPublicEsiUserKey(),
			retryAfterSeconds: 5,
		})
	})

	it('persists route error limit snapshots per route and user key', async () => {
		const store = new EsiRateLimitStore(new MemoryKV() as unknown as KVNamespace)
		const nowMs = Date.now()
		const userKey = buildEsiUserKey('app', 'char')
		const routeKey = '/search/'

		await store.putRouteErrorLimit({
			userKey,
			routeKey,
			remaining: 0,
			limit: 100,
			used: 100,
			windowSeconds: 60,
			retryAfterSeconds: 60,
			observedAtMs: nowMs,
			expiresAtMs: nowMs + 60_000,
		})

		expect(await store.getRouteErrorLimit(routeKey, userKey)).toMatchObject({
			routeKey,
			userKey,
			remaining: 0,
			limit: 100,
			retryAfterSeconds: 60,
		})
	})
})
