import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getStub } from '@repo/do-utils'
import type { Industry } from '@repo/industry'
import worker from '../../index'

describe('Industry Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('Industry')
	})
})

describe('Industry Durable Object', () => {
	it('can be instantiated', async () => {
		const stub = getStub<Industry>(env.INDUSTRY, `test-${Date.now()}-${Math.random()}`)

		// Call fetch to verify the DO can be accessed
		const response = await stub.fetch(new Request('http://example.com/'))

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('Industry')
	})
})
