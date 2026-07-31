import { describe, expect, it, vi } from 'vitest'

import { DiscordDO } from '../../durable-object'

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {},
}))

const {
	getGuildMemberMock,
	getGuildRolesMock,
	updateGuildMemberRolesMock,
	banGuildMemberMock,
	DiscordBotServiceMock,
} = vi.hoisted(() => {
	const getGuildMemberMock = vi.fn()
	const getGuildRolesMock = vi.fn()
	const updateGuildMemberRolesMock = vi.fn()
	const banGuildMemberMock = vi.fn()
	const DiscordBotServiceMock = vi.fn(function () {
		return {
			getGuildMember: getGuildMemberMock,
			getGuildRoles: getGuildRolesMock,
			updateGuildMemberRoles: updateGuildMemberRolesMock,
			banGuildMember: banGuildMemberMock,
		}
	})

	return {
		getGuildMemberMock,
		getGuildRolesMock,
		updateGuildMemberRolesMock,
		banGuildMemberMock,
		DiscordBotServiceMock,
	}
})

vi.mock('../discord-bot.service', () => ({
	DiscordBotService: DiscordBotServiceMock,
	fetchWithRetry: vi.fn(),
}))

describe('DiscordDO.revokeAccessAndBan', () => {
	it('returns failure results when Discord account is not linked', async () => {
		const fakeThis = {
			env: {},
			getUserByCoreUserId: vi.fn().mockResolvedValue(null),
		}

		const result = await DiscordDO.prototype.revokeAccessAndBan.call(
			fakeThis as any,
			'core-user-1',
			['guild-1', 'guild-2'],
			'blacklisted'
		)

		expect(result).toEqual([
			{
				guildId: 'guild-1',
				success: false,
				rolesCleared: false,
				banned: false,
				errorMessage: 'Discord account not linked',
			},
			{
				guildId: 'guild-2',
				success: false,
				rolesCleared: false,
				banned: false,
				errorMessage: 'Discord account not linked',
			},
		])
		expect(DiscordBotServiceMock).not.toHaveBeenCalled()
	})

	it('clears roles when member exists and bans across all provided guilds', async () => {
		getGuildMemberMock.mockImplementation(async (guildId: string) =>
			guildId === 'guild-1' ? { user: { id: 'discord-user-1' } } : null
		)
		updateGuildMemberRolesMock.mockResolvedValue({ success: true })
		banGuildMemberMock.mockResolvedValue({ success: true })

		const fakeThis = {
			env: { DISCORD_BOT_TOKEN: 'token' },
			getUserByCoreUserId: vi.fn().mockResolvedValue({
				id: 'discord-row-1',
				userId: 'discord-user-1',
			}),
		}

		const result = await DiscordDO.prototype.revokeAccessAndBan.call(
			fakeThis as any,
			'core-user-1',
			['guild-1', 'guild-2'],
			'security action'
		)

		expect(updateGuildMemberRolesMock).toHaveBeenCalledTimes(1)
		expect(updateGuildMemberRolesMock).toHaveBeenCalledWith('guild-1', 'discord-user-1', [])
		expect(banGuildMemberMock).toHaveBeenCalledTimes(2)
		expect(banGuildMemberMock).toHaveBeenCalledWith('guild-1', 'discord-user-1', 'security action')
		expect(banGuildMemberMock).toHaveBeenCalledWith('guild-2', 'discord-user-1', 'security action')
		expect(result).toEqual([
			{
				guildId: 'guild-1',
				success: true,
				kicked: false,
				rolesCleared: true,
				banned: true,
				errorMessage: undefined,
			},
			{
				guildId: 'guild-2',
				success: true,
				kicked: false,
				rolesCleared: false,
				banned: true,
				errorMessage: undefined,
			},
		])
	})
})

describe('DiscordDO.getUserGuildMembershipDetails', () => {
	it('retries guild member lookups after a Discord 429', async () => {
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

		getGuildMemberMock
			.mockRejectedValueOnce(Object.assign(new Error('Discord API error: 429'), { status: 429 }))
			.mockResolvedValueOnce({ roles: ['managed-role'] })
		getGuildRolesMock.mockResolvedValue([{ id: 'managed-role', name: 'Managed Role' }])

		const fakeThis = {
			env: { DISCORD_BOT_TOKEN: 'token' },
			getUserByCoreUserId: vi.fn().mockResolvedValue({
				id: 'discord-row-1',
				userId: 'discord-user-1',
			}),
			withDiscordMembershipRetry: (DiscordDO.prototype as any).withDiscordMembershipRetry,
		}

		vi.useFakeTimers()
		try {
			const promise = DiscordDO.prototype.getUserGuildMembershipDetails.call(
				fakeThis as any,
				'core-user-1',
				['guild-1']
			)
			await vi.advanceTimersByTimeAsync(1000)
			const result = await promise

			expect(getGuildMemberMock.mock.calls.length).toBeGreaterThanOrEqual(2)
			expect(result).toEqual([
				{
					guildId: 'guild-1',
					isMember: true,
					currentRoleIds: ['managed-role'],
					currentRoles: [{ roleId: 'managed-role', roleName: 'Managed Role' }],
				},
			])
		} finally {
			vi.useRealTimers()
			randomSpy.mockRestore()
		}
	})
})
