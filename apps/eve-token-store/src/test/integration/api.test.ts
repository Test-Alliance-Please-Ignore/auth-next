import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'
import type { EveTokenStore } from '@repo/eve-token-store'

import type { Env } from '../../context'
import worker from '../../index'

// Cast env to have correct types
const testEnv = env as unknown as Env

describe('EveTokenStore Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('EVE Token Store')
	})

	it('handles GET /tokens', async () => {
		const request = new Request('http://example.com/tokens')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const data = await response.json()
		expect(data).toHaveProperty('count')
		expect(data).toHaveProperty('tokens')
	})
})

describe('EveTokenStore Durable Object RPC', () => {
	it('can list tokens', async () => {
		const stub = getStub<EveTokenStore>(testEnv.EVE_TOKEN_STORE, 'test-list-tokens')

		const tokens = await stub.listTokens()

		expect(Array.isArray(tokens)).toBe(true)
	})

	it('returns null for non-existent token info', async () => {
		const stub = getStub<EveTokenStore>(testEnv.EVE_TOKEN_STORE, 'test-token-info')

		const tokenInfo = await stub.getTokenInfo('non-existent-hash')

		expect(tokenInfo).toBeNull()
	})
})
