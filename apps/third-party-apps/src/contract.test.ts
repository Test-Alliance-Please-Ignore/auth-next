import { describe, expect, it, vi } from 'vitest'

import {
	THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT,
	mapClientSummary,
	normalizeScopes,
	requestedScopesAreAllowed,
} from './oauth-contract'

describe('third-party apps oauth contract', () => {
	it('exposes the expected provider configuration', () => {
		expect(THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT).toEqual(
			expect.objectContaining({
				apiRoute: '/oauth/api/',
				authorizeEndpoint: '/authorize',
				tokenEndpoint: '/oauth/token',
				allowImplicitFlow: false,
				disallowPublicClientRegistration: true,
				scopesSupported: expect.arrayContaining(['profile']),
			})
		)
	})

	it('maps client summaries', async () => {
		const env = {
			OAUTH_KV: {
				get: vi.fn().mockResolvedValue({
					scopes: ['profile', 'groups'],
				}),
			},
		} as any

		const summary = await mapClientSummary(
			env,
			{
				clientId: 'client-1',
				clientSecret: 'hashed-secret',
				clientName: 'Client One',
				redirectUris: ['https://example.app/callback'],
				tokenEndpointAuthMethod: 'client_secret_basic',
				grantTypes: ['authorization_code'],
				responseTypes: ['code'],
				registrationDate: 1710000000,
			},
			{ includeClientSecret: true }
		)

		expect(summary).toEqual(
			expect.objectContaining({
				clientId: 'client-1',
				clientSecret: 'hashed-secret',
				clientName: 'Client One',
				redirectUris: ['https://example.app/callback'],
				scopes: ['profile', 'groups'],
				tokenEndpointAuthMethod: 'client_secret_basic',
				grantTypes: ['authorization_code'],
				responseTypes: ['code'],
				createdAt: '2024-03-09T16:00:00.000Z',
				updatedAt: '2024-03-09T16:00:00.000Z',
			})
		)
		expect(env.OAUTH_KV.get).toHaveBeenCalledWith('oauth-client-meta:client-1', 'json')
	})

	it('normalizes scopes and only allows requested scopes from the configured allowlist', () => {
		expect(normalizeScopes(['profile', 'profile', 'groups'])).toEqual(['profile', 'groups'])
		expect(requestedScopesAreAllowed(['profile', 'groups'], ['profile', 'groups'])).toBe(true)
		expect(requestedScopesAreAllowed(['profile', 'permissions'], ['profile', 'groups'])).toBe(false)
		expect(() => normalizeScopes(['profile', 'not-a-scope'])).toThrow('Unsupported OAuth scope(s): not-a-scope')
	})
})
