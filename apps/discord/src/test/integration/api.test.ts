import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import worker from '../../index'

import type { Discord } from '@repo/discord'

describe('Discord Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toBe('Discord Durable Object Worker')
	})

	it('handles OAuth start flow', async () => {
		const request = new Request('http://example.com/discord/auth/start', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ state: 'test-state' }),
		})
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const data = (await response.json()) as { url: string; state: string }
		expect(data).toHaveProperty('url')
		expect(data).toHaveProperty('state')
		expect(data.url).toContain('discord.com')
		expect(data.url).toContain('authorize')
	})

	it('validates OAuth callback parameters', async () => {
		const request = new Request('http://example.com/discord/auth/callback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: 'test-code',
				coreUserId: '550e8400-e29b-41d4-a716-446655440000', // Valid UUID
			}),
		})
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		// Should return 200 even on error (error is in response body)
		expect(response.status).toBe(200)
		const data = (await response.json()) as { success: boolean; error?: string }
		expect(data).toHaveProperty('success')
	})

	it('returns 404 for non-existent profile', async () => {
		const request = new Request('http://example.com/discord/profile/550e8400-e29b-41d4-a716-446655440000')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(404)
		const data = (await response.json()) as { error: string }
		expect(data).toHaveProperty('error')
	})
})

describe('Discord Durable Object', () => {
	it('can start OAuth flow via RPC', async () => {
		const stub = getStub<Discord>(env.DISCORD, 'default')

		const result = await stub.startLoginFlow('test-state')

		expect(result).toHaveProperty('url')
		expect(result).toHaveProperty('state')
		expect(result.url).toContain('discord.com')
		expect(result.url).toContain('authorize')
	})

	it('handles OAuth callback with valid structure', async () => {
		const stub = getStub<Discord>(env.DISCORD, 'default')

		const result = await stub.handleCallback(
			'test-code',
			'test-state',
			'550e8400-e29b-41d4-a716-446655440000'
		)

		expect(result).toHaveProperty('success')
		// Note: This will fail in actual execution due to invalid code,
		// but the structure should be correct
		if (!result.success) {
			expect(result).toHaveProperty('error')
		}
	})

	it('returns null for non-existent profile', async () => {
		const stub = getStub<Discord>(env.DISCORD, 'default')

		const profile = await stub.getProfileByCoreUserId('550e8400-e29b-41d4-a716-446655440000')

		expect(profile).toBeNull()
	})

	it('can call refreshTokenByCoreUserId', async () => {
		const stub = getStub<Discord>(env.DISCORD, 'default')

		const result = await stub.refreshTokenByCoreUserId('550e8400-e29b-41d4-a716-446655440000')

		// Should return false since no profile exists
		expect(typeof result).toBe('boolean')
		expect(result).toBe(false)
	})
})
