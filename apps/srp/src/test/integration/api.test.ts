import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import worker from '../../index'

import type { Env } from '../../context'

// Cast env to have correct types
const testEnv = env as unknown as Env

describe('Srp Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('Srp')
	})

	describe('GET /preview — parameter validation', () => {
		it('returns 400 when all params are missing', async () => {
			const request = new Request('http://example.com/preview')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)
			const body = await response.json<{ error: string }>()
			expect(body.error).toMatch(/characterId/)
			expect(body.error).toMatch(/killmailId/)
			expect(body.error).toMatch(/killmailHash/)
		})

		it('returns 400 when killmailId is missing', async () => {
			const request = new Request('http://example.com/preview?characterId=123&killmailHash=abc')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)
		})

		it('returns 400 when killmailHash is missing', async () => {
			const request = new Request('http://example.com/preview?characterId=123&killmailId=456')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)
		})

		it('returns 400 when characterId is missing', async () => {
			const request = new Request('http://example.com/preview?killmailId=456&killmailHash=abc')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)
		})
	})
})
