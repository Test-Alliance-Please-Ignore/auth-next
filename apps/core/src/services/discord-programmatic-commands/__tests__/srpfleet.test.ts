import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SRPFLEET_PROGRAMMATIC_COMMAND } from '../srpfleet'

import type { DiscordEmbed } from '@repo/discord'
import type { ProgrammaticCommandContext, ProgrammaticCommandEnv } from '../types'

const hoisted = vi.hoisted(() => ({
	getConfig: vi.fn(),
	getSrpFleetBroadcastByToken: vi.fn(),
	getSrpFleetSessionDetails: vi.fn(),
	getDoctrineName: vi.fn(),
	getRequestEligibilityData: vi.fn(),
	wasSessionMemberAt: vi.fn(),
	sendMessage: vi.fn(),
	getCachedUserPermissions: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(() => ({
		getConfig: hoisted.getConfig,
		getSrpFleetBroadcastByToken: hoisted.getSrpFleetBroadcastByToken,
		getSrpFleetSessionDetails: hoisted.getSrpFleetSessionDetails,
		getDoctrineName: hoisted.getDoctrineName,
		getRequestEligibilityData: hoisted.getRequestEligibilityData,
		wasSessionMemberAt: hoisted.wasSessionMemberAt,
		sendMessage: hoisted.sendMessage,
	})),
}))

vi.mock('../../../lib/groups-cache', () => ({
	getCachedUserPermissions: hoisted.getCachedUserPermissions,
}))

function ctx(overrides: Partial<ProgrammaticCommandContext> = {}): ProgrammaticCommandContext {
	return {
		optionValues: { token: 'FleetToken', killmail_id: '12345' },
		coreUserId: 'user-1',
		isAdmin: false,
		env: {
			GROUPS: {},
			DISCORD: {},
			PREDICTION_MARKETS: {},
			BROADCASTS: {},
			FLEETS: {},
			SRP: {},
		} as unknown as ProgrammaticCommandEnv,
		input: {
			commandName: 'srpfleet',
			discordUserId: 'discord-1',
			guildId: 'guild-1',
			channelId: 'channel-1',
		},
		interactionId: 'interaction-1',
		...overrides,
	}
}

describe('SRPFLEET_PROGRAMMATIC_COMMAND', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		hoisted.getConfig.mockResolvedValue({
			srpDiscordGuildId: 'guild-1',
			srpDiscordChannelId: 'channel-1',
		})
		hoisted.getSrpFleetBroadcastByToken.mockResolvedValue({
			fleetSessionId: 'session-1',
			doctrineId: null,
			srpToken: 'FleetToken',
			content: {
				fleetName: 'Standing Fleet',
				doctrine: 'Armor HAC',
			},
		})
		hoisted.getSrpFleetSessionDetails.mockResolvedValue({
			sessionId: 'session-1',
			sessionName: 'Tracking Session',
			fleetId: 'fleet-1',
			status: 'ended',
			startedAt: '2026-01-01T10:00:00.000Z',
			endedAt: '2026-01-01T12:00:00.000Z',
			commanderCharacterIds: ['100', '200'],
			commanderCharacterNames: { '100': 'Initial FC', '200': 'Final FC' },
			motd: '<font size="14">Comms<br><b>Standing</b></font>',
		})
		hoisted.getRequestEligibilityData.mockResolvedValue({
			requestId: '12345',
			victimCharacterId: '300',
			victimCharacterName: 'Victim Pilot',
			lossDate: '2026-01-01T11:00:00.000Z',
		})
		hoisted.wasSessionMemberAt.mockResolvedValue(true)
		hoisted.getCachedUserPermissions.mockResolvedValue([{ urn: 'urn:srp:reviewer' }])
		hoisted.sendMessage.mockResolvedValue({ success: true, messageId: 'message-1' })
	})

	it('defers ephemerally and declares the Killmail ID option', () => {
		expect(SRPFLEET_PROGRAMMATIC_COMMAND.deferral).toBe('defer-ephemeral')
		expect(SRPFLEET_PROGRAMMATIC_COMMAND.options?.map((option) => option.name)).toEqual([
			'token',
			'killmail_id',
		])
	})

	it('returns the fleet embed and point-in-time eligibility result', async () => {
		const result = await SRPFLEET_PROGRAMMATIC_COMMAND.handler(ctx())

		expect(result.data?.content).toContain('posted')
		const embed = hoisted.sendMessage.mock.calls[0]?.[2]?.embeds?.[0] as DiscordEmbed | undefined
		expect(embed?.title).toContain('Standing Fleet')
		expect(embed?.fields?.find((field) => field.name === 'MOTD')?.value).toContain('Comms\nStanding')
		expect(embed?.fields?.find((field) => field.name === 'SRP Token')?.value).toBe('FleetToken')
		expect(embed?.fields?.find((field) => field.name === 'Eligibility Check')?.value).toContain(
			'Member of fleet at loss: Yes'
		)
		expect(hoisted.wasSessionMemberAt).toHaveBeenCalledWith(
		'session-1',
		'300',
		'2026-01-01T11:00:00.000Z'
	)
	})

	it('rejects an invocation from the wrong channel before looking up the token', async () => {
		const result = await SRPFLEET_PROGRAMMATIC_COMMAND.handler(
			ctx({ input: { ...ctx().input, channelId: 'other-channel' } })
		)

		expect(result.data?.content).toContain('configured SRP channel')
		expect(hoisted.getSrpFleetBroadcastByToken).not.toHaveBeenCalled()
		expect(hoisted.sendMessage).not.toHaveBeenCalled()
	})

	it('allows site admins without SRP permission URNs', async () => {
		hoisted.getCachedUserPermissions.mockResolvedValue([])
		const result = await SRPFLEET_PROGRAMMATIC_COMMAND.handler(ctx({ isAdmin: true }))

		expect(result.data?.content).toContain('posted')
		expect(hoisted.sendMessage).toHaveBeenCalledTimes(1)
	})

	it('resolves the linked doctrine name without loading doctrine fittings', async () => {
		hoisted.getSrpFleetBroadcastByToken.mockResolvedValue({
			fleetSessionId: 'session-1',
			doctrineId: 'doctrine-1',
			srpToken: 'FleetToken',
			content: { fleetName: 'Standing Fleet' },
		})
		hoisted.getDoctrineName.mockResolvedValue('Armor HAC')

		await SRPFLEET_PROGRAMMATIC_COMMAND.handler(ctx())

		expect(hoisted.getDoctrineName).toHaveBeenCalledWith('doctrine-1')
		const embed = hoisted.sendMessage.mock.calls[0]?.[2]?.embeds?.[0] as DiscordEmbed | undefined
		expect(embed?.fields?.find((field) => field.name === 'Doctrine')?.value).toBe('Armor HAC')
	})
})
