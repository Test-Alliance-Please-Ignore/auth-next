import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

import { THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS } from './oauth-provider'

describe('third-party apps oauth provider', () => {
	it('returns not found for authorize requests', async () => {
		const response = await THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS.defaultHandler.fetch(
			new Request(
				'http://127.0.0.1:8787/authorize?response_type=code&client_id=client-1&state=abc'
			),
			{
				ENVIRONMENT: 'development',
			} as never,
			{} as ExecutionContext
		)

		expect(response.status).toBe(404)
	})

	it('handles internal authorization preview requests through the default handler', async () => {
		const response = await THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS.defaultHandler.fetch(
			new Request('http://127.0.0.1:8787/__internal/oauth/authorize/preview', {
				method: 'POST',
				body: JSON.stringify({
					requestUrl:
						'http://127.0.0.1:5173/authorize?response_type=code&client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A9786%2Fcallback&scope=profile&state=abc',
					expectedOrigin: 'http://127.0.0.1:8787',
				}),
			}),
			{
				ENVIRONMENT: 'production',
				OAUTH_PROVIDER: {
					parseAuthRequest: async () => ({
						clientId: 'client-1',
						scope: ['profile'],
						redirectUri: 'http://127.0.0.1:9786/callback',
						state: 'abc',
					}),
					lookupClient: async () => ({ clientId: 'client-1', clientName: 'Client One' }),
				},
				OAUTH_KV: {
					get: async () => ({ scopes: ['profile'] }),
				},
			} as never,
			{} as ExecutionContext
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			clientId: 'client-1',
			clientName: 'Client One',
			scope: ['profile'],
			state: 'abc',
		})
	})

	it('returns not found for non-authorize requests', async () => {
		const response = await THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS.defaultHandler.fetch(
			new Request('http://127.0.0.1:8787/not-authorize'),
			{
				ENVIRONMENT: 'development',
			} as never,
			{} as ExecutionContext
		)

		expect(response.status).toBe(404)
	})
})
