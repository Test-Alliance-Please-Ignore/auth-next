import type { Core } from '@repo/core'
import type { DiscordEmbed, MessageContent } from '@repo/discord'

export const IMMUNITAS_ALERT_COOLDOWN_MS = 15 * 60 * 1000
export const IMMUNITAS_ALERT_INITIAL_DELAY_MS = 30 * 1000
export const IMMUNITAS_ALERT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const IMMUNITAS_ALERT_RETRY_MS = 15 * 60 * 1000
export const IMMUNITAS_ALERT_DRAIN_CRON = '0,15,30,45 * * * *'

export type ImmunitasAccessType = 'profile-data' | 'fulcrum-report'
export type ImmunitasAccessRequestorGroup = {
	requestorUserId: string
	requestorLabels: string[]
	attemptCount: number
}

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

function formatRequestorGroups(groups: ImmunitasAccessRequestorGroup[], maxGroups = 6): string {
	if (groups.length === 0) {
		return 'Unknown'
	}

	const visibleGroups = groups.slice(0, maxGroups)
	const remainingGroups = groups.length - visibleGroups.length
	const lines: string[] = []

	for (const group of visibleGroups) {
		const label = group.requestorLabels[0]?.trim() || group.requestorUserId.trim() || 'Unknown requester'
		const attemptLabel =
			group.attemptCount === 1 ? '1 blocked attempt' : `${group.attemptCount} blocked attempts`
		lines.push(`• ${label} (${attemptLabel})`)

		const extraLabels = group.requestorLabels.slice(1, 4)
		for (const extraLabel of extraLabels) {
			lines.push(`  - ${extraLabel}`)
		}

		const remainingLabels = group.requestorLabels.length - 1 - extraLabels.length
		if (remainingLabels > 0) {
			lines.push(`  - +${remainingLabels} more`)
		}
	}

	if (remainingGroups > 0) {
		lines.push(`• +${remainingGroups} more requestors`)
	}

	return lines.join('\n')
}

export function buildImmunitasAccessAlertMessage(input: {
	accessType: ImmunitasAccessType
	targetCharacterLabels: string[]
	requestorGroups: ImmunitasAccessRequestorGroup[]
	attemptCount: number
	updatedAt?: Date
}): MessageContent {
	const accessTypeLabel = getAccessTypeLabel(input.accessType)
	const attemptLabel =
		input.attemptCount === 1 ? 'One blocked attempt' : `${input.attemptCount} blocked attempts`
	const description =
		input.attemptCount === 1
			? 'One blocked attempt against an immunitas account was blocked.'
			: `${input.attemptCount} blocked attempts against an immunitas account were blocked.`
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
			value: formatRequestorGroups(input.requestorGroups),
			inline: false,
		},
	]

	const updatedAt = input.updatedAt ?? new Date()
	return {
		content: '',
		embeds: [
			{
				title: `Unauthorized ${accessTypeLabel.toLowerCase()} access blocked`,
				description,
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
