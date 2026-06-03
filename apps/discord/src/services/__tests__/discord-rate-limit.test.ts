import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	DiscordRateLimitGuard,
	type DiscordRateLimitStore,
	normalizeDiscordRouteKey,
} from '@repo/discord'

class InMemoryDiscordRateLimitStore implements DiscordRateLimitStore {
	private readonly values = new Map<string, { raw: string; expiresAt: number }>()

	async get(key: string) {
		const entry = this.values.get(key)
		if (!entry) {
			return null
		}
		if (entry.expiresAt <= Date.now()) {
			this.values.delete(key)
			return null
		}
		return JSON.parse(entry.raw)
	}

	async put(key: string, value: unknown, ttlSeconds: number) {
		this.values.set(key, {
			raw: JSON.stringify(value),
			expiresAt: Date.now() + ttlSeconds * 1000,
		})
	}

	async delete(key: string) {
		this.values.delete(key)
	}
}

describe('DiscordRateLimitGuard', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('normalizes Discord route keys by stripping resource IDs', () => {
		expect(
			normalizeDiscordRouteKey('https://discord.com/api/v10/guilds/1234567890/members/9876543210', 'get')
		).toBe('GET /guilds/:id/members/:id')
	})

	it('opens a cooldown using retry_after from a 429 response body', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-02T12:00:00.000Z'))

		const guard = new DiscordRateLimitGuard()
		const routeKey = 'GET /guilds/:id/members/:id'
		const response = new Response(
			JSON.stringify({
				message: 'You are being rate limited.',
				retry_after: 1.5,
				global: false,
			}),
			{
				status: 429,
				headers: {
					'Content-Type': 'application/json',
					'Retry-After': '1.5',
					'X-RateLimit-Bucket': 'abc123',
					'X-RateLimit-Scope': 'user',
				},
			}
		)

		const observation = await guard.observe(routeKey, response)

		expect(observation).toMatchObject({
			bucket: 'abc123',
			global: false,
			retryAfterMs: 1500,
			scope: 'user',
		})
		expect(guard.getDelayMs(routeKey)).toBe(1500)

		vi.setSystemTime(new Date('2026-06-02T12:00:01.000Z'))
		expect(guard.getDelayMs(routeKey)).toBe(500)
	})

	it('honors exhausted-bucket headers before Discord returns a 429', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-02T12:00:00.000Z'))

		const guard = new DiscordRateLimitGuard()
		const routeKey = 'GET /guilds/:id/roles'
		const response = new Response(null, {
			status: 200,
			headers: {
				'X-RateLimit-Bucket': 'bucket-1',
				'X-RateLimit-Remaining': '0',
				'X-RateLimit-Reset-After': '2.25',
				'X-RateLimit-Scope': 'shared',
			},
		})

		const observation = await guard.observe(routeKey, response)

		expect(observation).toMatchObject({
			bucket: 'bucket-1',
			remaining: 0,
			retryAfterMs: 2250,
			scope: 'shared',
		})
		expect(guard.getDelayMs(routeKey)).toBe(2250)
	})

	it('restores persisted cooldowns from KV storage after a fresh guard instance', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-02T12:00:00.000Z'))

		const store = new InMemoryDiscordRateLimitStore()
		const routeKey = 'GET /guilds/:id/members/:id'
		const seedGuard = new DiscordRateLimitGuard(store)
		seedGuard.record(routeKey, {
			bucket: 'persisted-bucket',
			global: false,
			remaining: 0,
			resetAfterMs: 2000,
			retryAfterMs: 2000,
			scope: 'shared',
		})

		const hydratedGuard = new DiscordRateLimitGuard(store)
		const waitPromise = hydratedGuard.wait(routeKey)
		await vi.advanceTimersByTimeAsync(2000)
		await expect(waitPromise).resolves.toBeUndefined()

		vi.setSystemTime(new Date('2026-06-02T12:00:02.100Z'))
		const expiredGuard = new DiscordRateLimitGuard(store)
		await expect(expiredGuard.wait(routeKey)).resolves.toBeUndefined()
		expect(expiredGuard.getDelayMs(routeKey)).toBe(0)
	})

	it('applies global 429 cooldowns across different routes', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-02T12:00:00.000Z'))

		const guard = new DiscordRateLimitGuard()
		const routeOne = 'GET /guilds/:id/members/:id'
		const routeTwo = 'GET /guilds/:id/roles'
		const response = new Response(
			JSON.stringify({
				message: 'You are being rate limited.',
				retry_after: 1,
				global: true,
			}),
			{
				status: 429,
				headers: {
					'Content-Type': 'application/json',
					'Retry-After': '1',
					'X-RateLimit-Scope': 'global',
					'X-RateLimit-Global': 'true',
				},
			}
		)

		await guard.observe(routeOne, response)

		expect(guard.getDelayMs(routeOne)).toBe(1000)
		expect(guard.getDelayMs(routeTwo)).toBe(1000)
	})
})
