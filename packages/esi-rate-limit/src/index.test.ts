import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EsiRateLimitStore } from './index'

type DeferredPut = {
	key: string
	value: string
	options?: { expirationTtl?: number }
	resolve: () => void
	reject: (error: Error) => void
}

class DeferredKv {
	private readonly store = new Map<string, string>()
	private readonly pendingPuts: DeferredPut[] = []

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

	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.pendingPuts.push({
				key,
				value,
				options,
				resolve: () => {
					this.store.set(key, value)
					resolve()
				},
				reject,
			})
		})
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key)
	}

	peekPutCount(): number {
		return this.pendingPuts.length
	}

	resolveNextPut(): void {
		const next = this.pendingPuts.shift()
		if (!next) {
			throw new Error('No pending KV put to resolve')
		}
		next.resolve()
	}

	rejectNextPut(error: Error): void {
		const next = this.pendingPuts.shift()
		if (!next) {
			throw new Error('No pending KV put to reject')
		}
		next.reject(error)
	}

	readRaw(key: string): string | undefined {
		return this.store.get(key)
	}
}

describe('EsiRateLimitStore', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-03T00:00:00.000Z'))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('coalesces repeated bucket writes for the same key and persists the latest snapshot', async () => {
		const kv = new DeferredKv()
		const store = new EsiRateLimitStore(kv as never)
		const now = Date.now()

		void store.putBucketSnapshot({
			group: 'char-wallet',
			userKey: '190134d517b34492afaca2e6ec8c8d4b:93665130',
			routeKey: '/corporations/:id/wallets/:id/transactions',
			status: 200,
			limit: 3,
			remaining: 2,
			used: 1,
			windowSeconds: 60,
			retryAfterSeconds: undefined,
			observedAtMs: now,
			expiresAtMs: now + 60_000,
		})

		void store.putBucketSnapshot({
			group: 'char-wallet',
			userKey: '190134d517b34492afaca2e6ec8c8d4b:93665130',
			routeKey: '/corporations/:id/wallets/:id/transactions',
			status: 200,
			limit: 3,
			remaining: 1,
			used: 2,
			windowSeconds: 60,
			retryAfterSeconds: undefined,
			observedAtMs: now + 100,
			expiresAtMs: now + 60_000,
		})

		await Promise.resolve()
		await Promise.resolve()
		expect(kv.peekPutCount()).toBe(1)

		const pending = await store.getBucketSnapshot(
			'char-wallet',
			'190134d517b34492afaca2e6ec8c8d4b:93665130'
		)
		expect(pending?.remaining).toBe(1)
		expect(pending?.used).toBe(2)
	})

	it('does not reject if limiter KV persistence is rate-limited', async () => {
		const kv = new DeferredKv()
		const store = new EsiRateLimitStore(kv as never)
		const now = Date.now()

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		const write = store.putBucketSnapshot({
			group: 'char-wallet',
			userKey: '190134d517b34492afaca2e6ec8c8d4b:93665130',
			routeKey: '/corporations/:id/wallets/:id/transactions',
			status: 200,
			limit: 3,
			remaining: 2,
			used: 1,
			windowSeconds: 60,
			retryAfterSeconds: undefined,
			observedAtMs: now,
			expiresAtMs: now + 60_000,
		})

		await Promise.resolve()
		await Promise.resolve()
		kv.rejectNextPut(new Error('KV PUT failed: 429 Too Many Requests'))
		await expect(write).resolves.toBeUndefined()
		expect(warnSpy).toHaveBeenCalled()
	})

	it('coalesces repeated route-group writes for the same route key', async () => {
		const kv = new DeferredKv()
		const store = new EsiRateLimitStore(kv as never)

		const firstWrite = store.rememberRouteGroup(
			'/corporations/:id/wallets/:id/journal',
			'corp-wallet'
		)
		void store.rememberRouteGroup('/corporations/:id/wallets/:id/journal', 'corp-wallet')

		await Promise.resolve()
		expect(kv.peekPutCount()).toBe(1)
		kv.resolveNextPut()
		await firstWrite

		await store.rememberRouteGroup('/corporations/:id/wallets/:id/journal', 'corp-wallet')
		expect(kv.peekPutCount()).toBe(0)
	})

	it('backs off repeated route-group writes after KV throttling', async () => {
		const kv = new DeferredKv()
		const store = new EsiRateLimitStore(kv as never)

		const firstWrite = store.rememberRouteGroup('/characters/:id/wallet', 'char-wallet')
		await Promise.resolve()
		kv.rejectNextPut(new Error('KV PUT failed: 429 Too Many Requests'))
		await firstWrite

		await store.rememberRouteGroup('/characters/:id/wallet', 'char-wallet')
		expect(kv.peekPutCount()).toBe(0)

		vi.advanceTimersByTime(60_000)
		const retry = store.rememberRouteGroup('/characters/:id/wallet', 'char-wallet')
		await Promise.resolve()
		expect(kv.peekPutCount()).toBe(1)
		kv.rejectNextPut(new Error('KV PUT failed: 429 Too Many Requests'))
		await retry
	})
})
