import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../esi-proxy', () => ({
	proxyEsiRequest: vi.fn(),
}))

import { previewOAuthAuthorization } from './oauth.service'
import { buildOAuthApiMeResponse } from './oauth.service'

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

	it('adds a synthesized authnext.invalid email address to the profile response', async () => {
		const env = {
			CORE: {
				getUserDetails: vi.fn().mockResolvedValue({
					mainCharacterId: '1402766339',
					is_admin: true,
					characters: [
						{
							characterId: '1402766339',
							characterName: 'Gothicus',
							is_primary: true,
							hasValidToken: true,
						},
					],
					groupMemberships: [
						{
							groupId: 'group-1',
							groupName: 'Example Group',
							membershipLevel: 'member',
							joinedAt: new Date('2025-01-01T00:00:00Z'),
						},
					],
				}),
			},
			GROUPS: {
				getUserPermissions: vi.fn(),
			},
		} as any

		const response = await buildOAuthApiMeResponse(env, {
			sub: '0f5b5f0d-4d6d-4f8e-9c3a-9b9b7f8e1234',
			clientId: 'client-1',
			scope: ['profile', 'groups'],
		})

		expect(response).toEqual(
			expect.objectContaining({
				sub: '0f5b5f0d-4d6d-4f8e-9c3a-9b9b7f8e1234',
				clientId: 'client-1',
				email: '0f5b5f0d-4d6d-4f8e-9c3a-9b9b7f8e1234@authnext.invalid',
				emailVerified: true,
				mainCharacterId: '1402766339',
				groupMemberships: [
					{
						groupId: 'group-1',
						groupName: 'Example Group',
						membershipLevel: 'member',
						joinedAt: '2025-01-01T00:00:00.000Z',
					},
				],
			})
		)
	})

	it('deduplicates identical permission urns and includes the synthetic test-alliance group from permissions', async () => {
		const env = {
			CORE: {
				getUserDetails: vi.fn().mockResolvedValue({
					mainCharacterId: '1402766339',
					is_admin: false,
					characters: [],
					groupMemberships: [
						{
							groupId: 'group-1',
							groupName: 'Example Group',
							membershipLevel: 'member',
							joinedAt: new Date('2025-01-01T00:00:00Z'),
						},
					],
					permissionGrants: [
						{
							urn: 'urn:moons:view',
							name: 'Moons View',
							description: null,
							groupId: 'group-1',
							groupName: 'Example Group',
							targetType: 'all_members',
							source: 'global',
						},
						{
							urn: 'urn:eve:alliance:test-alliance',
							name: 'Test Alliance',
							description: null,
							groupId: 'corp-1',
							groupName: 'Corp Access',
							targetType: 'all_members',
							source: 'global',
						},
						{
							urn: 'urn:eve:alliance:test-alliance',
							name: 'Test Alliance Duplicate',
							description: null,
							groupId: 'corp-2',
							groupName: 'Corp Access Two',
							targetType: 'all_members',
							source: 'group_scoped',
						},
					],
				}),
			},
		} as any

		const response = await buildOAuthApiMeResponse(env, {
			sub: '0f5b5f0d-4d6d-4f8e-9c3a-9b9b7f8e1234',
			clientId: 'client-1',
			scope: ['groups', 'permissions'],
		})

		expect(response).toEqual(
			expect.objectContaining({
				groups: ['example-group', 'test-alliance'],
				permissionUrns: ['urn:moons:view', 'urn:eve:alliance:test-alliance'],
			})
		)
	})

	it('includes the synthetic test-alliance group even without the permissions scope', async () => {
		const env = {
			CORE: {
				getUserDetails: vi.fn().mockResolvedValue({
					mainCharacterId: '1402766339',
					is_admin: false,
					characters: [],
					groupMemberships: [],
					permissionGrants: [
						{
							urn: 'urn:eve:alliance:test-alliance',
							name: 'Test Alliance',
							description: null,
							groupId: 'corp-1',
							groupName: 'Corp Access',
							targetType: 'all_members',
							source: 'global',
						},
					],
				}),
			},
		} as any

		const response = await buildOAuthApiMeResponse(env, {
			sub: '0f5b5f0d-4d6d-4f8e-9c3a-9b9b7f8e1234',
			clientId: 'client-1',
			scope: ['groups'],
		})

		expect(response).toEqual(
			expect.objectContaining({
				groups: ['test-alliance'],
			})
		)
		expect(response).not.toHaveProperty('permissionUrns')
	})
})
