import type { Core } from '@repo/core'
import type { DiscordEmbed, MessageContent } from '@repo/discord'

export const IMMUNITAS_ALERT_COOLDOWN_MS = 15 * 60 * 1000
export const IMMUNITAS_ALERT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const IMMUNITAS_ALERT_RETRY_MS = 15 * 60 * 1000
export const IMMUNITAS_ALERT_DRAIN_CRON = '0,15,30,45 * * * *'

export type ImmunitasAccessType = 'profile-data' | 'fulcrum-report'

function formatLabelList(labels: string[], maxItems = 8): string {
	if (labels.length === 0) {
		return 'Unknown'
	}

	const visible = labels.slice(0, maxItems)
	const remaining = labels.length - visible.length
	const lines = visible.map((label) => `• ${label}`)
	if (remaining > 0) {
		lines.push(`• +${remaining} more`)
	}
	return lines.join('\n')
}

function getAccessTypeLabel(accessType: ImmunitasAccessType): string {
	return accessType === 'profile-data' ? 'Profile data' : 'Fulcrum report'
}

export function buildImmunitasAccessAlertMessage(input: {
	accessType: ImmunitasAccessType
	targetCharacterLabels: string[]
	requestorLabels: string[]
	attemptCount: number
	updatedAt?: Date
}): MessageContent {
	const accessTypeLabel = getAccessTypeLabel(input.accessType)
	const attemptLabel =
		input.attemptCount === 1 ? 'One blocked attempt' : `${input.attemptCount} blocked attempts`
	const fields: DiscordEmbed['fields'] = [
		{
			name: 'Access Type',
			value: accessTypeLabel,
			inline: true,
		},
		{
			name: 'Target Characters',
			value: formatLabelList(input.targetCharacterLabels),
			inline: false,
		},
		{
			name: 'Attempted By',
			value: formatLabelList(input.requestorLabels),
			inline: false,
		},
	]

	const updatedAt = input.updatedAt ?? new Date()
	return {
		content: '',
		embeds: [
			{
				title: `Unauthorized ${accessTypeLabel.toLowerCase()} access blocked`,
				description: `${attemptLabel} against an immunitas account were blocked.`,
				color: 0xef4444,
				fields,
				footer: {
					text: 'Immunitas access notice',
				},
				timestamp: updatedAt.toISOString(),
			},
		],
	}
}

export async function queueImmunitasAccessAlertForUser(
	core: Pick<Core, 'queueImmunitasAccessAlert'>,
	input: {
		targetUserId: string
		targetCharacterLabel: string
		requestorUserId: string
		requestorCharacterLabel: string | null
		accessType: ImmunitasAccessType
		source?: string
	}
): Promise<
	| {
			added: number
			skipped: number
			pendingCount: number
	  }
	| null
> {
	const targetCharacterLabel = input.targetCharacterLabel.trim()
	if (!targetCharacterLabel) {
		return null
	}

	const requestorCharacterLabel =
		input.requestorCharacterLabel?.trim() || input.requestorUserId.trim() || 'Unknown requester'

	return core.queueImmunitasAccessAlert({
		targetUserId: input.targetUserId,
		targetCharacterLabel,
		requestorUserId: input.requestorUserId,
		requestorCharacterLabel,
		accessType: input.accessType,
		source: input.source,
	})
}
