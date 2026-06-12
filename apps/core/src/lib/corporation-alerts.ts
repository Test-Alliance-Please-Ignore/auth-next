import type { DiscordEmbed, MessageContent } from '@repo/discord'

export const CORPORATION_ALERT_TYPES = ['corp_application_submitted'] as const
export type CorporationAlertType = (typeof CORPORATION_ALERT_TYPES)[number]

export const CORPORATION_ALERT_DESTINATION_TYPES = ['discord_channel', 'discord_user'] as const
export type CorporationAlertDestinationType = (typeof CORPORATION_ALERT_DESTINATION_TYPES)[number]

export interface CorporationAlertTypeDefinition {
	type: CorporationAlertType
	label: string
	description: string
	supportedDestinationTypes: CorporationAlertDestinationType[]
}

export interface CorporationAlertDestinationRecord {
	id: string
	corporationId: string
	alertType: string
	destinationType: string
	discordServerId: string | null
	channelId: string | null
	coreUserId: string | null
	destinationConfig: Record<string, unknown>
	isEnabled: boolean
	createdBy: string | null
	updatedBy: string | null
	createdAt: Date
	updatedAt: Date
}

export interface CorporationAlertApplicationSubmittedPayload {
	applicationId: string
	corporationId: string
	corporationName: string
	applicantCharacterId: string
	applicantCharacterName: string
	altCharacterCount: number
	isFirstApplication: boolean
	submittedAt: string
}

export interface CorporationAlertPayloadByType {
	corp_application_submitted: CorporationAlertApplicationSubmittedPayload
}

const ALERT_TYPE_DEFINITIONS: CorporationAlertTypeDefinition[] = [
	{
		type: 'corp_application_submitted',
		label: 'Corporation Application Submitted',
		description: 'Sent when a new HR application is submitted to this corporation.',
		supportedDestinationTypes: ['discord_channel', 'discord_user'],
	},
]

const DISCORD_ALERT_COLORS = {
	applicationSubmitted: 0x3b82f6,
}

export function getCorporationAlertTypeDefinitions(): CorporationAlertTypeDefinition[] {
	return [...ALERT_TYPE_DEFINITIONS]
}

export function isCorporationAlertType(value: string): value is CorporationAlertType {
	return (CORPORATION_ALERT_TYPES as readonly string[]).includes(value)
}

export function isCorporationAlertDestinationType(
	value: string
): value is CorporationAlertDestinationType {
	return (CORPORATION_ALERT_DESTINATION_TYPES as readonly string[]).includes(value)
}

export function buildCorporationApplicationSubmittedMessage(
	payload: CorporationAlertApplicationSubmittedPayload
): MessageContent {
	const applicantPortrait = `https://images.evetech.net/characters/${payload.applicantCharacterId}/portrait?size=256`
	const applicationUrl = `https://pleaseignore.app/corporations/${payload.corporationId}/applications/${payload.applicationId}`
	const applicantLabel =
		payload.altCharacterCount > 0
			? `${payload.applicantCharacterName} (+${payload.altCharacterCount} alts)`
			: payload.applicantCharacterName

	const fields: DiscordEmbed['fields'] = [
		{
			name: 'Applicant',
			value: applicantLabel,
			inline: true,
		},
		{
			name: 'Application Type',
			value: payload.isFirstApplication ? 'First application' : 'Repeat application',
			inline: true,
		},
	]

	return {
		content: '',
		embeds: [
			{
				title: `New application to ${payload.corporationName} submitted`,
				description: `[View Application](${applicationUrl})`,
				color: DISCORD_ALERT_COLORS.applicationSubmitted,
				thumbnail: {
					url: applicantPortrait,
				},
				fields,
				footer: {
					text: `Submitted at ${new Date(payload.submittedAt).toISOString()}`,
				},
				timestamp: new Date(payload.submittedAt).toISOString(),
			},
		],
	}
}

export const corporationAlertRegistry = {
	corp_application_submitted: {
		definition: ALERT_TYPE_DEFINITIONS[0],
		buildMessage: buildCorporationApplicationSubmittedMessage,
	},
} as const
