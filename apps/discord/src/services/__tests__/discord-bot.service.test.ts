import { afterEach, describe, expect, it, vi } from 'vitest'

import { DiscordBotService } from '../discord-bot.service'

const env = {
	DISCORD_BOT_TOKEN: 'bot-token',
	DISCORD_PROXY_HOST: '',
	DISCORD_PROXY_USERNAME: '',
	DISCORD_PROXY_PASSWORD: '',
	DISCORD_PROXY_PORT_START: '',
	DISCORD_PROXY_PORT_COUNT: '',
} as any

describe('DiscordBotService.banGuildMember', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('returns success when Discord ban endpoint succeeds', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
		vi.stubGlobal('fetch', fetchMock)

		const service = new DiscordBotService(env)
		const result = await service.banGuildMember('guild-1', 'user-1', 'blacklisted')

		expect(result).toEqual({ success: true })
		expect(fetchMock).toHaveBeenCalledWith(
			'https://discord.com/api/v10/guilds/guild-1/bans/user-1',
			expect.objectContaining({
				method: 'PUT',
			})
		)
	})

	it('returns permission error when bot lacks ban permission', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ message: 'Missing Permissions' }), { status: 403 })
		)
		vi.stubGlobal('fetch', fetchMock)

		const service = new DiscordBotService(env)
		const result = await service.banGuildMember('guild-1', 'user-1')

		expect(result.success).toBe(false)
		expect(result.errorMessage).toBe('Bot lacks BAN_MEMBERS permission')
	})
})
