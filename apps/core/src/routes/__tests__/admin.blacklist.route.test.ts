import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import adminRoutes from '../admin'

import type { SessionUser } from '../../context'

const { createDbMock, invalidateAllUserSessionsMock, enforceBlacklistedDiscordAccessMock } =
	vi.hoisted(() => ({
		createDbMock: vi.fn(),
		invalidateAllUserSessionsMock: vi.fn(),
		enforceBlacklistedDiscordAccessMock: vi.fn(),
	}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: (...args: unknown[]) => createDbMock(...args),
}))

vi.mock('../../services/session.service', () => ({
	SessionService: vi.fn().mockImplementation(() => ({
		invalidateAllUserSessions: invalidateAllUserSessionsMock,
	})),
}))

vi.mock('../../services/discord.service', () => ({
	enforceBlacklistedDiscordAccess: enforceBlacklistedDiscordAccessMock,
}))

const env = {
	DATABASE_URL: 'postgresql://test',
	HR: { name: 'HR' },
	GROUPS: { name: 'GROUPS' },
} as any

const hrStub = {
	createUserBlacklist: vi.fn(),
	createCharacterBlacklist: vi.fn(),
}

const groupsStub = {
	getUserMemberships: vi.fn(),
	removeMember: vi.fn(),
}

const dbQueryMocks = {
	userCharacters: {
		findMany: vi.fn(),
		findFirst: vi.fn(),
	},
	users: {
		findFirst: vi.fn(),
	},
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

describe('admin blacklist cleanup hooks', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		createDbMock.mockReturnValue({ query: dbQueryMocks })
		hrStub.createUserBlacklist.mockResolvedValue({ id: 'user-bl-entry' })
		hrStub.createCharacterBlacklist.mockResolvedValue({ id: 'char-bl-entry' })
		groupsStub.getUserMemberships.mockResolvedValue([])
		groupsStub.removeMember.mockResolvedValue(undefined)
		invalidateAllUserSessionsMock.mockResolvedValue(undefined)
		enforceBlacklistedDiscordAccessMock.mockResolvedValue(undefined)
		dbQueryMocks.userCharacters.findMany.mockResolvedValue([])
		dbQueryMocks.userCharacters.findFirst.mockResolvedValue(undefined)
		dbQueryMocks.users.findFirst.mockResolvedValue({ discordUserId: null })

		vi.mocked(getStub).mockImplementation((namespace: any) => {
			if (namespace === env.HR) return hrStub as any
			if (namespace === env.GROUPS) return groupsStub as any
			throw new Error('Unexpected namespace')
		})
	})

	it('removes blacklisted user from all groups and enforces Discord revocation on /blacklist/user', async () => {
		const app = createApp(makeUser())
		dbQueryMocks.users.findFirst.mockResolvedValue({ discordUserId: 'discord-blacklisted-1' })
		groupsStub.getUserMemberships.mockResolvedValue([
			{
				groupId: 'group-1',
				groupName: 'Group 1',
				categoryName: 'Cat',
				isOwner: false,
				isAdmin: false,
				joinedAt: new Date(),
			},
			{
				groupId: 'group-2',
				groupName: 'Group 2',
				categoryName: 'Cat',
				isOwner: false,
				isAdmin: false,
				joinedAt: new Date(),
			},
		])

		const response = await app.request(
			'/api/admin/blacklist/user',
			{
				method: 'POST',
				body: JSON.stringify({
					userId: '11111111-1111-4111-8111-111111111111',
					reason: 'policy violation',
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(invalidateAllUserSessionsMock).toHaveBeenCalledWith(
			'11111111-1111-4111-8111-111111111111'
		)
		expect(groupsStub.getUserMemberships).toHaveBeenCalledWith(
			'11111111-1111-4111-8111-111111111111'
		)
		expect(groupsStub.removeMember).toHaveBeenCalledWith(
			'group-1',
			'00000000-0000-0000-0000-000000000001',
			'11111111-1111-4111-8111-111111111111'
		)
		expect(groupsStub.removeMember).toHaveBeenCalledWith(
			'group-2',
			'00000000-0000-0000-0000-000000000001',
			'11111111-1111-4111-8111-111111111111'
		)
		expect(enforceBlacklistedDiscordAccessMock).toHaveBeenCalledWith(
			env,
			'11111111-1111-4111-8111-111111111111',
			'Blacklisted by admin 00000000-0000-0000-0000-000000000001'
		)
		expect(hrStub.createUserBlacklist).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: '11111111-1111-4111-8111-111111111111',
				discordUserId: 'discord-blacklisted-1',
			})
		)
	})

	it('removes character-linked auto-blacklisted users from groups on /blacklist/character', async () => {
		const app = createApp(makeUser())
		dbQueryMocks.userCharacters.findMany.mockResolvedValue([
			{ userId: '22222222-2222-2222-2222-222222222222', characterId: '9001' },
		])
		dbQueryMocks.users.findFirst.mockResolvedValue({ discordUserId: 'discord-user-2222' })
		groupsStub.getUserMemberships.mockResolvedValue([
			{
				groupId: 'group-3',
				groupName: 'Group 3',
				categoryName: 'Cat',
				isOwner: false,
				isAdmin: false,
				joinedAt: new Date(),
			},
		])

		const response = await app.request(
			'/api/admin/blacklist/character',
			{
				method: 'POST',
				body: JSON.stringify({
					characterId: '9001',
					reason: 'security action',
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(hrStub.createUserBlacklist).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: '22222222-2222-2222-2222-222222222222',
				discordUserId: 'discord-user-2222',
			})
		)
		expect(invalidateAllUserSessionsMock).toHaveBeenCalledWith(
			'22222222-2222-2222-2222-222222222222'
		)
		expect(groupsStub.getUserMemberships).toHaveBeenCalledWith(
			'22222222-2222-2222-2222-222222222222'
		)
		expect(groupsStub.removeMember).toHaveBeenCalledWith(
			'group-3',
			'00000000-0000-0000-0000-000000000001',
			'22222222-2222-2222-2222-222222222222'
		)
		expect(enforceBlacklistedDiscordAccessMock).toHaveBeenCalledWith(
			env,
			'22222222-2222-2222-2222-222222222222',
			'Blacklisted via character 9001'
		)
	})

	it('links auto-created character blacklist metadata to created user blacklist entry id', async () => {
		const app = createApp(makeUser())
		hrStub.createUserBlacklist.mockResolvedValue({ id: 'user-blacklist-entry-1' })
		hrStub.createCharacterBlacklist.mockResolvedValue({ id: 'char-blacklist-entry-1' })
		dbQueryMocks.userCharacters.findMany
			.mockResolvedValueOnce([
				{
					userId: '11111111-1111-4111-8111-111111111111',
					characterId: '9002',
					characterName: 'Pilot Two',
				},
			])
			.mockResolvedValueOnce([
				{
					userId: '11111111-1111-4111-8111-111111111111',
					characterId: '9002',
					characterName: 'Pilot Two',
				},
			])

		const response = await app.request(
			'/api/admin/blacklist/user',
			{
				method: 'POST',
				body: JSON.stringify({
					userId: '11111111-1111-4111-8111-111111111111',
					reason: 'policy violation',
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(hrStub.createCharacterBlacklist).toHaveBeenCalledWith(
			expect.objectContaining({
				characterId: '9002',
				metadata: expect.objectContaining({
					triggeredByUserBlacklist: 'user-blacklist-entry-1',
				}),
			})
		)
	})
})
