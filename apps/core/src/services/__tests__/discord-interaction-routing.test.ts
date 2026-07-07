import { describe, expect, it } from 'vitest'

import { buildDiscordInteractionRouting } from '../discord-commands.service'

describe('buildDiscordInteractionRouting', () => {
	it('routes the ping-slow diagnostic command as defer-ephemeral', () => {
		const routing = buildDiscordInteractionRouting()
		expect(routing.commands['ping-slow']).toEqual({
			default: 'defer-ephemeral',
			subcommands: {},
		})
	})

	it('leaves instant commands (how, evetime) as sync', () => {
		const routing = buildDiscordInteractionRouting()
		expect(routing.commands['how']?.default).toBe('sync')
		expect(routing.commands['evetime']?.default).toBe('sync')
	})
})
