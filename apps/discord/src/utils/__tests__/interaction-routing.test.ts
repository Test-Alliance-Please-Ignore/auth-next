import { describe, expect, it } from 'vitest'

import { resolveDeferralMode, resolveSubcommandKey } from '../interaction-routing'

import type { DiscordInteractionRouting } from '../../context'

describe('resolveSubcommandKey', () => {
	it('returns null when there are no options', () => {
		expect(resolveSubcommandKey(undefined)).toBeNull()
		expect(resolveSubcommandKey([])).toBeNull()
	})

	it('returns null for a plain value option (not a subcommand)', () => {
		expect(resolveSubcommandKey([{ name: 'amount', type: 4, value: 100 }])).toBeNull()
	})

	it('extracts a subcommand name, lowercased', () => {
		expect(
			resolveSubcommandKey([
				{ name: 'Bet', type: 1, options: [{ name: 'amount', type: 4, value: 5 }] },
			])
		).toBe('bet')
	})

	it('extracts a subcommand group + nested subcommand', () => {
		expect(
			resolveSubcommandKey([{ name: 'Settle', type: 2, options: [{ name: 'Resolve', type: 1 }] }])
		).toBe('settle resolve')
	})

	it('returns the group name alone when there is no nested subcommand', () => {
		expect(resolveSubcommandKey([{ name: 'settle', type: 2 }])).toBe('settle')
	})
})

describe('resolveDeferralMode', () => {
	const routing: DiscordInteractionRouting = {
		commands: {
			market: {
				default: 'defer-public',
				subcommands: { bet: 'defer-ephemeral', balance: 'defer-ephemeral' },
			},
			how: { default: 'sync', subcommands: {} },
		},
	}

	it('defaults unknown commands to sync', () => {
		expect(resolveDeferralMode(routing, 'unknown', null)).toBe('sync')
		expect(resolveDeferralMode(routing, 'unknown', 'whatever')).toBe('sync')
	})

	it('uses the command default when there is no subcommand override', () => {
		expect(resolveDeferralMode(routing, 'market', null)).toBe('defer-public')
		expect(resolveDeferralMode(routing, 'market', 'view')).toBe('defer-public')
	})

	it('uses the subcommand override when present', () => {
		expect(resolveDeferralMode(routing, 'market', 'bet')).toBe('defer-ephemeral')
		expect(resolveDeferralMode(routing, 'market', 'balance')).toBe('defer-ephemeral')
	})

	it('honors a known sync command', () => {
		expect(resolveDeferralMode(routing, 'how', null)).toBe('sync')
	})
})
