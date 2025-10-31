import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../../index'
import type { Env } from '../../context'

// Type augmentation for test environment
declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {}
}

describe('Fleets Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env as Env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('EVE Online Fleet Manager')
	})

	it('redirects unauthenticated user on join page', async () => {
		const request = new Request('http://example.com/join/test-token')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env as Env, ctx)
		await waitOnExecutionContext(ctx)

		// Should redirect to login since no auth cookie
		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toContain('/login')
	})
})

describe('Fleets Durable Object', () => {
	it('can create a Durable Object instance', async () => {
		// Skip this test if FLEETS is not available in test environment
		// This is primarily for TypeScript checking
		if (!env.FLEETS) {
			console.log('FLEETS binding not available in test environment')
			return
		}

		const id = env.FLEETS.idFromName(`test-${Date.now()}`)
		expect(id).toBeDefined()
	})
})
