import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import adminRoutes from '../admin'

import type { SessionUser } from '../../context'

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [],
		is_admin: true,
		roles: [ROLE_CORE_ALLIANCE_MEMBER],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user?: SessionUser) {
	const app = new Hono<{
		Bindings: any
		Variables: { user?: SessionUser }
	}>()

	if (user) {
		app.use('*', async (c, next) => {
			c.set('user', user)
			await next()
		})
	}

	app.route('/api/admin', adminRoutes)
	return app
}

describe('admin oauth inspection route', () => {
	const adminStub = {
		getUserDetails: vi.fn(),
	}

	const env = {
		ADMIN: adminStub,
	} as any

	beforeEach(() => {
		vi.clearAllMocks()
		adminStub.getUserDetails.mockResolvedValue({
			id: '11111111-1111-4111-8111-111111111111',
			mainCharacterId: '7001',
			is_admin: false,
			discordUserId: null,
			discord: null,
			characters: [
				{
					characterId: '7001',
					characterName: 'Alpha Pilot',
					characterOwnerHash: 'owner-hash-1',
					corporationId: '101',
					corporationName: 'Example Corp',
					allianceId: '202',
					allianceName: 'Example Alliance',
					is_primary: true,
					linkedAt: new Date('2026-06-30T12:00:00.000Z'),
					hasValidToken: true,
					isBlacklisted: false,
				},
			],
			groupMemberships: [
				{
					groupId: 'group-1',
					groupName: 'Operations Team',
					membershipLevel: 'owner',
					joinedAt: new Date('2026-06-15T00:00:00.000Z'),
				},
			],
			permissionGrants: [
				{
					permissionId: 'perm-1',
					urn: 'urn:test:inspect',
					name: 'Inspect',
					description: 'Inspect access',
					groupId: 'group-1',
					groupName: 'Operations Team',
					targetType: 'all_members',
					source: 'global',
				},
			],
			createdAt: new Date('2026-06-01T00:00:00.000Z'),
			updatedAt: new Date('2026-06-30T12:00:00.000Z'),
		})
	})

	it('returns the oauth resolver payload for the requested user', async () => {
		const app = createApp(makeUser())

		const response = await app.request(
			'/api/admin/users/11111111-1111-4111-8111-111111111111/oauth/inspect',
			{},
			env
		)

		expect(response.status).toBe(200)
		expect(adminStub.getUserDetails).toHaveBeenCalledWith(
			'11111111-1111-4111-8111-111111111111',
			'00000000-0000-0000-0000-000000000001'
		)
		expect(await response.json()).toEqual(
			expect.objectContaining({
				userId: '11111111-1111-4111-8111-111111111111',
				scopes: ['profile', 'groups', 'permissions'],
				response: expect.objectContaining({
					sub: '11111111-1111-4111-8111-111111111111',
					clientId: 'admin-user-profile-inspection',
					scope: ['profile', 'groups', 'permissions'],
					mainCharacterId: '7001',
					isAdmin: false,
					email: '11111111-1111-4111-8111-111111111111@authnext.invalid',
					emailVerified: true,
					groups: ['operations-team'],
					permissionUrns: ['urn:test:inspect'],
				}),
			})
		)
	})
})
