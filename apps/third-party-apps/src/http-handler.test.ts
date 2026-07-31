import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleThirdPartyAppsHttpRequest, isOAuthHttpRoute } from './http-handler'

const oauthFetchMock = vi.hoisted(() => vi.fn())

vi.mock('./oauth-api-handler', () => ({
	THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS: {
		apiHandler: {},
		defaultHandler: {},
		scopesSupported: [],
	},
}))

vi.mock('@cloudflare/workers-oauth-provider', () => ({
	OAuthProvider: vi.fn(function () {
		return {
			fetch: oauthFetchMock,
		}
	}),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

describe('third-party apps http handler', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		oauthFetchMock.mockResolvedValue(new Response('ok', { status: 200 }))
	})

	it('recognizes oauth http routes', () => {
		expect(
			isOAuthHttpRoute(new Request('http://127.0.0.1:8787/.well-known/oauth-authorization-server'))
		).toBe(true)
		expect(isOAuthHttpRoute(new Request('http://127.0.0.1:8787/authorize'))).toBe(true)
		expect(isOAuthHttpRoute(new Request('http://127.0.0.1:8787/oauth/token'))).toBe(true)
		expect(isOAuthHttpRoute(new Request('http://127.0.0.1:8787/oauth/api/me'))).toBe(true)
		expect(
			isOAuthHttpRoute(new Request('http://127.0.0.1:8787/__internal/oauth/authorize/preview'))
		).toBe(true)
		expect(isOAuthHttpRoute(new Request('http://127.0.0.1:8787/not-oauth'))).toBe(false)
	})

	it('serves oauth discovery from the worker and points authorization to the ui in development', async () => {
		const response = await handleThirdPartyAppsHttpRequest(
			new Request('http://127.0.0.1:8787/.well-known/oauth-authorization-server'),
			{
				ENVIRONMENT: 'production',
			} as never,
			{} as ExecutionContext
		)

		expect(response?.status).toBe(200)
		expect(await response?.json()).toEqual(
			expect.objectContaining({
				issuer: 'http://127.0.0.1:8787',
				authorization_endpoint: 'http://127.0.0.1:5173/authorize',
				token_endpoint: 'http://127.0.0.1:8787/oauth/token',
			})
		)
		expect(oauthFetchMock).not.toHaveBeenCalled()
	})

	it('preserves the issuer hostname when building the local dev authorize endpoint', async () => {
		const response = await handleThirdPartyAppsHttpRequest(
			new Request('http://localhost:8787/.well-known/oauth-authorization-server'),
			{
				ENVIRONMENT: 'development',
			} as never,
			{} as ExecutionContext
		)

		expect(response?.status).toBe(200)
		expect(await response?.json()).toEqual(
			expect.objectContaining({
				issuer: 'http://localhost:8787',
				authorization_endpoint: 'http://localhost:5173/authorize',
			})
		)
	})

	it('returns null for non-oauth routes', async () => {
		const response = await handleThirdPartyAppsHttpRequest(
			new Request('http://127.0.0.1:8787/not-oauth'),
			{
				ENVIRONMENT: 'development',
			} as never,
			{} as ExecutionContext
		)

		expect(response).toBeNull()
		expect(oauthFetchMock).not.toHaveBeenCalled()
	})
})
