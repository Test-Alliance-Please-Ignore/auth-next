import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import worker from '../../index'

import type { Discord } from '@repo/discord'
import type { Env } from '../../context'

// Cast env to have correct types
const testEnv = env as unknown as Env

describe('Discord Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toBe('Discord Durable Object Worker')
	})

	it('returns 404 for non-existent profile', async () => {
		const request = new Request('http://example.com/discord/profile/550e8400-e29b-41d4-a716-446655440000')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(404)
		const data = (await response.json()) as { error: string }
		expect(data).toHaveProperty('error')
	})
})

describe('Discord Durable Object', () => {
	it('returns null for non-existent profile', async () => {
		const stub = getStub<Discord>(testEnv.DISCORD, 'default')

		const profile = await stub.getProfileByCoreUserId('550e8400-e29b-41d4-a716-446655440000')

		expect(profile).toBeNull()
	})

	it('can call refreshTokenByCoreUserId', async () => {
		const stub = getStub<Discord>(testEnv.DISCORD, 'default')

		const result = await stub.refreshTokenByCoreUserId('550e8400-e29b-41d4-a716-446655440000')

		// Should return false since no profile exists
		expect(typeof result).toBe('boolean')
		expect(result).toBe(false)
	})
})
