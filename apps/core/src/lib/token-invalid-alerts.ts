import type { Core } from '@repo/core'
import type { DiscordEmbed, MessageContent } from '@repo/discord'

export const TOKEN_INVALID_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000
export const TOKEN_INVALID_ALERT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const TOKEN_INVALID_ALERT_RETRY_MS = 60 * 60 * 1000

export async function queueTokenInvalidationAlertsForUser(
	core: Pick<Core, 'queueTokenInvalidationAlerts'>,
	input: {
		userId: string
		characterIds: string[]
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
	const normalizedCharacterIds = [
		...new Set(input.characterIds.map((characterId) => String(characterId).trim())),
	].filter(Boolean)

	if (normalizedCharacterIds.length === 0) {
		return null
	}

	return core.queueTokenInvalidationAlerts({
		userId: input.userId,
		characterIds: normalizedCharacterIds,
		source: input.source,
	})
}

function formatCharacterList(names: string[], maxItems = 8): string {
	if (names.length === 0) {
		return 'Unknown character'
	}

	const visible = names.slice(0, maxItems)
	const remaining = names.length - visible.length
	const lines = visible.map((name) => `• ${name}`)
	if (remaining > 0) {
		lines.push(`• +${remaining} more`)
	}
	return lines.join('\n')
}

export function buildTokenInvalidationMessage(input: {
	characterNames: string[]
	invalidCharacterCount: number
	updatedAt?: Date
}): MessageContent {
	const countLabel =
		input.invalidCharacterCount === 1
			? 'One of your character tokens is invalid'
			: `${input.invalidCharacterCount} of your character tokens are invalid`

	const fields: DiscordEmbed['fields'] = [
		{
			name: 'Characters',
			value: formatCharacterList(input.characterNames),
			inline: false,
		},
		{
			name: 'What this means',
			value:
				'Automated character data syncs may pause for affected characters until you reauthenticate them.',
			inline: false,
		},
	]

	const updatedAt = input.updatedAt ?? new Date()
	return {
		content: '',
		embeds: [
			{
				title: countLabel,
				description:
					'We detected ESI access problems for one or more linked characters on your account.',
				color: 0xf59e0b,
				fields,
				footer: {
					text: 'Token invalidation notice',
				},
				timestamp: updatedAt.toISOString(),
			},
		],
	}
}
