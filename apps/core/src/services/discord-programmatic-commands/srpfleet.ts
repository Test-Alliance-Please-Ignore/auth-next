import { DISCORD_SLASH_COMMAND_OPTION_TYPE } from '@repo/discord'
import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import { ephemeralCommandResponse } from './types'
import { parseDateOrNull } from '@repo/worker-utils'

import type { Broadcasts } from '@repo/broadcasts'
import type { Discord, DiscordEmbed } from '@repo/discord'
import type { Doctrines } from '@repo/doctrines'
import type { Fleets } from '@repo/fleets'
import type { Srp } from '@repo/srp'
import type { ProgrammaticCommandDefinition } from './types'

const SRP_STAFF_URNS = new Set(['urn:srp:reviewer', 'urn:srp:payer', 'urn:srp:manager'])
const MAX_EMBED_FIELD_LENGTH = 1024

function textValue(value: unknown): string | null {
	if (typeof value === 'string' && value.trim()) return value.trim()
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	if (value && typeof value === 'object') {
		const candidate = value as Record<string, unknown>
		for (const key of ['name', 'label', 'value', 'text', 'custom']) {
			const text = textValue(candidate[key])
			if (text) return text
		}
	}
	return null
}

function truncate(value: string, max = MAX_EMBED_FIELD_LENGTH): string {
	return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

function sanitizeMotd(value: string | null): string {
	if (!value) return 'Unavailable'
	return truncate(
		value
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<[^>]*>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim() || 'Unavailable'
	)
}

function discordTimestamp(value: string | null, fallback: string): string {
	if (!value) return fallback
	const timestamp = parseDateOrNull(value)?.getTime()
	if (timestamp === undefined || timestamp === null || !Number.isFinite(timestamp)) return fallback
	return `<t:${Math.floor(timestamp / 1000)}:f>`
}

function buildComparisonError(message: string): string {
	return `Eligibility comparison unavailable: ${message}`
}

export const SRPFLEET_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'srpfleet',
	description: 'Show SRP fleet details for a fleet broadcast token.',
	categoryName: 'SRP',
	immutableAccessRequirements: ['SRP reviewer', 'SRP payer', 'SRP manager'],
	deferral: 'defer-ephemeral',
	options: [
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.STRING,
			name: 'token',
			description: 'SRP token from the fleet broadcast.',
			required: true,
			min_length: 1,
			max_length: 255,
		},
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.STRING,
			name: 'killmail_id',
			description: 'Killmail ID for an optional SRP eligibility check.',
			required: false,
			max_length: 32,
		},
	],
	handler: async ({ optionValues, coreUserId, isAdmin, env, input }) => {
		if (!isAdmin) {
			const permissions = await getCachedUserPermissions(env, coreUserId)
			if (!permissions.some((permission) => SRP_STAFF_URNS.has(permission.urn))) {
				return ephemeralCommandResponse('You need SRP reviewer, payer, or manager permissions to use this command.')
			}
		}

		const srp = getStub<Srp>(env.SRP, 'default')
		const config = await srp.getConfig()
		const configuredGuildId = config?.srpDiscordGuildId?.trim()
		const configuredChannelId = config?.srpDiscordChannelId?.trim()
		if (!configuredGuildId || !configuredChannelId) {
			return ephemeralCommandResponse('The SRP Discord channel is not configured.')
		}
		if (input.guildId !== configuredGuildId || input.channelId !== configuredChannelId) {
			return ephemeralCommandResponse('This command can only be used in the configured SRP channel.')
		}

		const token = optionValues.token?.trim()
		if (!token) return ephemeralCommandResponse('An SRP broadcast token is required.')

		const broadcasts = getStub<Broadcasts>(env.BROADCASTS, 'default')
		const broadcast = await broadcasts.getSrpFleetBroadcastByToken(token)
		if (!broadcast?.fleetSessionId) {
			return ephemeralCommandResponse('No fleet session was found for that SRP token.')
		}

		const fleets = getStub<Fleets>(env.FLEETS, 'default')
		const details = await fleets.getSrpFleetSessionDetails(broadcast.fleetSessionId)
		if (!details) return ephemeralCommandResponse('The fleet session could not be found.')

		const content = broadcast.content ?? {}
		const fleetName = textValue(content.fleetName) ?? textValue(content.fleet_name) ?? details.sessionName
		let doctrine = textValue(content.doctrine) ?? textValue(content.doctrineName)
		if (!doctrine && broadcast.doctrineId) {
			try {
				const doctrines = getStub<Doctrines>(env.DOCTRINES, 'default')
				doctrine = await doctrines.getDoctrineName(broadcast.doctrineId)
			} catch {
				// Doctrine lookup is best effort; the fleet result remains useful without it.
			}
		}
		doctrine ??= 'Unavailable'
		const commanders = details.commanderCharacterIds.map((id, index) => {
			const name = details.commanderCharacterNames[id] ?? id
			const label = index === 0 ? 'Initial Commander' : index === details.commanderCharacterIds.length - 1 ? 'Final Commander' : 'Commander Handoff'
			return `${label}: ${name}`
		})

		const comparisonId = optionValues.killmail_id?.trim()
		let comparison: string | null = null
		if (comparisonId) {
			try {
				if (!/^\d+$/.test(comparisonId)) {
					comparison = buildComparisonError('Killmail ID must be numeric.')
				} else {
					const request = await srp.getRequestEligibilityData(comparisonId)
					if (!request) {
						comparison = buildComparisonError(`no SRP request was found for Killmail ID ${comparisonId}.`)
					} else {
						const memberAtLoss = await fleets.wasSessionMemberAt(
							details.sessionId,
							request.victimCharacterId,
							request.lossDate
						)
						comparison = [
							`Killmail ID: ${comparisonId}`,
							`Victim: ${request.victimCharacterName}`,
							`Loss time: ${discordTimestamp(request.lossDate, request.lossDate)}`,
							`Member of fleet at loss: ${memberAtLoss ? 'Yes' : 'No'}`,
						].join('\n')
					}
				}
			} catch {
				comparison = buildComparisonError('the request or fleet membership data could not be read.')
			}
		}

		const fields: NonNullable<DiscordEmbed['fields']> = [
			{ name: 'Fleet Commander(s)', value: truncate(commanders.join('\n') || 'Unavailable') },
			{ name: 'Doctrine', value: truncate(doctrine) },
			{ name: 'MOTD', value: sanitizeMotd(details.motd) },
			{ name: 'SRP Token', value: truncate(token) },
			{
				name: 'Fleet Period',
				value: `${discordTimestamp(details.startedAt, 'Unknown start')} - ${discordTimestamp(details.endedAt, 'Ongoing')}`,
			},
		]
		if (comparison) {
			fields.push({
				name: 'Eligibility Check',
				value: truncate(comparison),
			})
		}

		const embed: DiscordEmbed = {
			title: `SRP Fleet Details: ${truncate(fleetName, 200)}`,
			fields,
			color: 0x2f80ed,
		}
		const discord = getStub<Discord>(env.DISCORD, 'default')
		const sent = await discord.sendMessage(configuredGuildId, configuredChannelId, {
			content: '\u200b',
			embeds: [embed],
			allowEveryone: false,
		})
		if (!sent.success) {
			return ephemeralCommandResponse('The fleet details could not be posted to the configured SRP channel.')
		}
		return ephemeralCommandResponse('Fleet details posted to the configured SRP channel.')
	},
}
