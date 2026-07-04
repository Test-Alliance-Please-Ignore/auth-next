import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../esi-proxy', () => ({
	proxyEsiRequest: vi.fn(),
}))

import { previewOAuthAuthorization } from './oauth.service'

describe('oauth service', () => {
	it('accepts local loopback authorize urls even when the provider binding env is production-like', async () => {
		const parseAuthRequest = vi.fn().mockResolvedValue({
			clientId: 'client-1',
			scope: ['profile', 'groups'],
			redirectUri: 'http://127.0.0.1:9786/callback',
			state: 'state-1',
		})
		const lookupClient = vi.fn().mockResolvedValue({
			clientId: 'client-1',
			clientName: 'Client One',
		})
		const env = {
			ENVIRONMENT: 'production',
			OAUTH_PROVIDER: {
				parseAuthRequest,
				lookupClient,
			},
			OAUTH_KV: {
				get: vi.fn().mockResolvedValue({
					scopes: ['profile', 'groups'],
				}),
			},
		} as any

		const preview = await previewOAuthAuthorization(
			env,
			'http://127.0.0.1:5173/authorize?response_type=code&client_id=client-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A9786%2Fcallback&scope=profile+groups&state=state-1',
			'http://127.0.0.1:8787'
		)

		expect(preview).toEqual({
			clientId: 'client-1',
			clientName: 'Client One',
			scope: ['profile', 'groups'],
			state: 'state-1',
		})
		expect(parseAuthRequest).toHaveBeenCalledTimes(1)
		expect(parseAuthRequest.mock.calls[0]?.[0]).toBeInstanceOf(Request)
		expect(new URL(parseAuthRequest.mock.calls[0]?.[0].url ?? '').origin).toBe('http://127.0.0.1:5173')
	})
})
