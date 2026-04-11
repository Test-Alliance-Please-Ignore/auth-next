import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import adminRoutes from '../admin'

import type { SessionUser } from '../../context'

const { enforceRevokedAuthorizationDiscordAccessMock } = vi.hoisted(() => ({
	enforceRevokedAuthorizationDiscordAccessMock: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../services/discord.service', () => ({
	enforceRevokedAuthorizationDiscordAccess: enforceRevokedAuthorizationDiscordAccessMock,
}))

const env = {
	DATABASE_URL: 'postgresql://test',
	DISCORD: { name: 'DISCORD' },
} as any

const discordStub = {
	getDiscordUserStatus: vi.fn(),
	revokeAuthorization: vi.fn(),
}

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

describe('admin discord revoke route', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getStub).mockImplementation((namespace: any) => {
			if (namespace === env.DISCORD) return discordStub as any
			throw new Error('Unexpected namespace')
		})
		discordStub.getDiscordUserStatus.mockResolvedValue({
			userId: 'discord-user-1',
			username: 'tester',
			discriminator: '0',
			scopes: [],
			coreUserId: '11111111-1111-4111-8111-111111111111',
			lastSuccessfulAuth: new Date(),
			authRevoked: false,
			authRevokedAt: null,
		})
		discordStub.revokeAuthorization.mockResolvedValue(true)
		enforceRevokedAuthorizationDiscordAccessMock.mockResolvedValue({
			results: [],
			totalUpdated: 0,
			totalFailed: 0,
		})
	})

	it('revokes authorization and enforces managed-role stripping', async () => {
		const app = createApp(makeUser())

		const response = await app.request(
			'/api/admin/users/11111111-1111-4111-8111-111111111111/discord/revoke',
			{ method: 'POST' },
			env
		)

		expect(response.status).toBe(200)
		expect(discordStub.revokeAuthorization).toHaveBeenCalledWith(
			'11111111-1111-4111-8111-111111111111'
		)
		expect(enforceRevokedAuthorizationDiscordAccessMock).toHaveBeenCalledWith(
			env,
			'11111111-1111-4111-8111-111111111111'
		)
	})
})
