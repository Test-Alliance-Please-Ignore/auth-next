import { describe, expect, it, vi } from 'vitest'

const {
	getGuildMemberMock,
	updateGuildMemberRolesMock,
	banGuildMemberMock,
	DiscordBotServiceMock,
} = vi.hoisted(() => {
	const getGuildMemberMock = vi.fn()
	const updateGuildMemberRolesMock = vi.fn()
	const banGuildMemberMock = vi.fn()
	const DiscordBotServiceMock = vi.fn().mockImplementation(() => ({
		getGuildMember: getGuildMemberMock,
		updateGuildMemberRoles: updateGuildMemberRolesMock,
		banGuildMember: banGuildMemberMock,
	}))

	return {
		getGuildMemberMock,
		updateGuildMemberRolesMock,
		banGuildMemberMock,
		DiscordBotServiceMock,
	}
})

vi.mock('../discord-bot.service', () => ({
	DiscordBotService: DiscordBotServiceMock,
	fetchWithRetry: vi.fn(),
}))

import { DiscordDO } from '../../durable-object'

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
		expect(banGuildMemberMock).toHaveBeenCalledWith(
			'guild-1',
			'discord-user-1',
			'security action'
		)
		expect(banGuildMemberMock).toHaveBeenCalledWith(
			'guild-2',
			'discord-user-1',
			'security action'
		)
		expect(result).toEqual([
			{
				guildId: 'guild-1',
				success: true,
				rolesCleared: true,
				banned: true,
				errorMessage: undefined,
			},
			{
				guildId: 'guild-2',
				success: true,
				rolesCleared: false,
				banned: true,
				errorMessage: undefined,
			},
		])
	})
})
