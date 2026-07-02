import type { DiscordEmbed, MessageContent } from '@repo/discord'

import {
	ALERT_DESTINATION_TYPES,
	type AlertDestinationRecord,
	type AlertDestinationType,
	type AlertRegistryEntry,
	type AlertTypeDefinition,
} from './alert-routing'

export const CORPORATION_ALERT_TYPES = [
	'corp_application_submitted',
	'corp_application_first_time_accepted',
] as const
export type CorporationAlertType = (typeof CORPORATION_ALERT_TYPES)[number]

export const CORPORATION_ALERT_DESTINATION_TYPES = ALERT_DESTINATION_TYPES
export type CorporationAlertDestinationType = AlertDestinationType

export interface CorporationAlertTypeDefinition extends AlertTypeDefinition<CorporationAlertType> {
	type: CorporationAlertType
}

export interface CorporationAlertDestinationRecord extends AlertDestinationRecord {
	corporationId: string
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

export interface CorporationAlertApplicationFirstTimeAcceptedPayload {
	applicationId: string
	corporationId: string
	corporationName: string
	applicantCharacterId: string
	applicantCharacterName: string
	altCharacterCount: number
	isFirstApplication: boolean
	acceptedAt: string
}

export interface CorporationAlertPayloadByType {
	corp_application_submitted: CorporationAlertApplicationSubmittedPayload
	corp_application_first_time_accepted: CorporationAlertApplicationFirstTimeAcceptedPayload
}

type CorporationAlertRegistry = {
	[K in CorporationAlertType]: AlertRegistryEntry<CorporationAlertPayloadByType[K]>
}

const ALERT_TYPE_DEFINITIONS: CorporationAlertTypeDefinition[] = [
	{
		type: 'corp_application_submitted',
		label: 'Corporation Application Submitted',
		description: 'Sent when a new HR application is submitted to this corporation.',
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'discord_webhook', 'group'],
	},
	{
		type: 'corp_application_first_time_accepted',
		label: 'Corporation Application Accepted (First-Time)',
		description: 'Sent when a first-time HR application is accepted for this corporation.',
		supportedDestinationTypes: ['discord_channel', 'discord_user', 'discord_webhook', 'group'],
	},
]

const DISCORD_ALERT_COLORS = {
	applicationSubmitted: 0x3b82f6,
	applicationAccepted: 0x22c55e,
}

function formatDiscordTimestamp(date: Date): string {
	return `<t:${Math.floor(date.getTime() / 1000)}:F>`
}

function buildApplicationFields(
	applicantLabel: string,
	applicationTypeLabel: string
): DiscordEmbed['fields'] {
	return [
		{
			name: 'Applicant',
			value: applicantLabel,
			inline: true,
		},
		{
			name: 'Application Type',
			value: applicationTypeLabel,
			inline: true,
		},
	]
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
	const submittedAt = new Date(payload.submittedAt)
	const applicantLabel =
		payload.altCharacterCount > 0
			? `${payload.applicantCharacterName} (+${payload.altCharacterCount} alts)`
			: payload.applicantCharacterName

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
				fields: buildApplicationFields(
					applicantLabel,
					payload.isFirstApplication ? 'First application' : 'Repeat application'
				),
				timestamp: submittedAt.toISOString(),
			},
		],
	}
}

export function buildCorporationApplicationFirstTimeAcceptedMessage(
	payload: CorporationAlertApplicationFirstTimeAcceptedPayload
): MessageContent {
	const applicantPortrait = `https://images.evetech.net/characters/${payload.applicantCharacterId}/portrait?size=256`
	const applicationUrl = `https://pleaseignore.app/corporations/${payload.corporationId}/applications/${payload.applicationId}`
	const acceptedAt = new Date(payload.acceptedAt)
	const applicantLabel =
		payload.altCharacterCount > 0
			? `${payload.applicantCharacterName} (+${payload.altCharacterCount} alts)`
			: payload.applicantCharacterName

	return {
		content: '',
		embeds: [
			{
				title: `First application to ${payload.corporationName} accepted`,
				description: `[View Application](${applicationUrl})`,
				color: DISCORD_ALERT_COLORS.applicationAccepted,
				thumbnail: {
					url: applicantPortrait,
				},
				fields: buildApplicationFields(applicantLabel, 'First application'),
				timestamp: acceptedAt.toISOString(),
			},
		],
	}
}

export const corporationAlertRegistry = {
	corp_application_submitted: {
		definition: ALERT_TYPE_DEFINITIONS[0],
		buildMessage: buildCorporationApplicationSubmittedMessage,
	},
	corp_application_first_time_accepted: {
		definition: ALERT_TYPE_DEFINITIONS[1],
		buildMessage: buildCorporationApplicationFirstTimeAcceptedMessage,
	},
} satisfies CorporationAlertRegistry
