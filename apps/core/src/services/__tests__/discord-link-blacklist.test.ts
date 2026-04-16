import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { handleTokens } from '../discord.service'

const {
	createDbMock,
	discordStubMethods,
	hrStubMethods,
	oauthStatesFindFirstMock,
	usersUpdateReturningMock,
	deleteWhereMock,
} = vi.hoisted(() => ({
	createDbMock: vi.fn(),
	discordStubMethods: {
		linkAccountWithTokens: vi.fn(),
	},
	hrStubMethods: {
		isDiscordUserBlacklisted: vi.fn(),
		isUserBlacklisted: vi.fn(),
		getBlacklistsForDiscordUser: vi.fn(),
		createUserBlacklist: vi.fn(),
		createCharacterBlacklist: vi.fn(),
	},
	oauthStatesFindFirstMock: vi.fn(),
	usersUpdateReturningMock: vi.fn(),
	deleteWhereMock: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: (...args: unknown[]) => createDbMock(...args),
}))

vi.mock('@repo/discord', () => ({
	getDiscordStub: vi.fn(() => discordStubMethods),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

const env = {
	DATABASE_URL: 'postgresql://test',
	HR: { name: 'HR' },
} as any

describe('discord link blacklist enforcement', () => {
	beforeEach(() => {
		vi.clearAllMocks()

		const dbMock = {
			query: {
				oauthStates: {
					findFirst: oauthStatesFindFirstMock,
				},
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([]),
				},
			},
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: usersUpdateReturningMock,
					})),
				})),
			})),
			delete: vi.fn(() => ({
				where: deleteWhereMock,
			})),
		}
		createDbMock.mockReturnValue(dbMock)

		oauthStatesFindFirstMock.mockResolvedValue({
			state: 'state-1',
			flowType: 'discord',
			userId: 'core-user-1',
			expiresAt: new Date(Date.now() + 60_000),
		})
		usersUpdateReturningMock.mockResolvedValue([{ id: 'core-user-1' }])
		deleteWhereMock.mockResolvedValue(undefined)
		discordStubMethods.linkAccountWithTokens.mockResolvedValue({
			success: true,
			discordUserId: 'discord-123',
			username: 'pilot',
		})

		vi.mocked(getStub).mockReturnValue(hrStubMethods as any)
		hrStubMethods.isDiscordUserBlacklisted.mockResolvedValue(false)
		hrStubMethods.isUserBlacklisted.mockResolvedValue(false)
		hrStubMethods.getBlacklistsForDiscordUser.mockResolvedValue([])
		hrStubMethods.createUserBlacklist.mockResolvedValue({ id: 'auto-user-blacklist-1' })
		hrStubMethods.createCharacterBlacklist.mockResolvedValue({ id: 'auto-char-blacklist-1' })
	})

	it('auto-blacklists and blocks linking when Discord account is blacklisted', async () => {
		hrStubMethods.isDiscordUserBlacklisted.mockResolvedValue(true)
		hrStubMethods.getBlacklistsForDiscordUser.mockResolvedValue([
			{
				id: 'discord-blacklist-entry-1',
				blacklistedBy: '11111111-1111-4111-8111-111111111111',
			},
		])

		const result = await handleTokens(
			env,
			'core-user-1',
			'access',
			'refresh',
			3600,
			'identify',
			'state-1'
		)

		expect(result).toEqual({ success: false, error: 'Account suspended' })
		expect(hrStubMethods.createUserBlacklist).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'core-user-1',
				discordUserId: 'discord-123',
				triggeredBy: 'discord-blacklist-entry-1',
				isAutoBlacklist: true,
			})
		)
		expect(usersUpdateReturningMock).not.toHaveBeenCalled()
	})

	it('links normally when Discord account is not blacklisted', async () => {
		const result = await handleTokens(
			env,
			'core-user-1',
			'access',
			'refresh',
			3600,
			'identify',
			'state-1'
		)

		expect(result).toEqual({ success: true })
		expect(hrStubMethods.createUserBlacklist).not.toHaveBeenCalled()
		expect(usersUpdateReturningMock).toHaveBeenCalled()
	})
})
