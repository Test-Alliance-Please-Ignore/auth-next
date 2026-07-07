import { DISCORD_SLASH_COMMAND_OPTION_TYPE } from '@repo/discord'

import { commandResponse } from './types'

import type { ProgrammaticCommandDefinition } from './types'

const DEFAULT_DELAY_SECONDS = 2
const MIN_DELAY_SECONDS = 1
const MAX_DELAY_SECONDS = 10

function resolveDelaySeconds(raw: string | undefined): number {
	const parsed = Number.parseInt(raw ?? '', 10)
	if (!Number.isFinite(parsed)) {
		return DEFAULT_DELAY_SECONDS
	}
	return Math.min(Math.max(parsed, MIN_DELAY_SECONDS), MAX_DELAY_SECONDS)
}

/**
 * Throwaway diagnostic command to validate the deferred-interaction framework (M-Enable)
 * end to end. It waits — optionally longer than Discord's ~3s ACK deadline — then replies
 * ephemerally, proving the type:5 ACK + followup-edit path works and that handler context
 * (identity + interaction id) is threaded through. Uses `deferral: 'defer-ephemeral'`.
 *
 * Remove once deferred interactions are validated in a test guild.
 */
export const PING_SLOW_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'ping-slow',
	description: 'Diagnostics: wait, then reply (tests deferred interactions).',
	options: [
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.INTEGER,
			name: 'seconds',
			description: `Seconds to wait before replying (${MIN_DELAY_SECONDS}-${MAX_DELAY_SECONDS}, default ${DEFAULT_DELAY_SECONDS}).`,
			required: false,
			min_value: MIN_DELAY_SECONDS,
			max_value: MAX_DELAY_SECONDS,
		},
	],
	deferral: 'defer-ephemeral',
	handler: async ({ optionValues, coreUserId, isAdmin, interactionId }) => {
		const seconds = resolveDelaySeconds(optionValues.seconds)
		const startedAt = Date.now()
		await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
		const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)

		return commandResponse(
			[
				`🏓 Pong after ${elapsedSeconds}s — deferred interaction delivered.`,
				`• coreUserId: \`${coreUserId}\``,
				`• isAdmin: \`${isAdmin}\``,
				`• interactionId: \`${interactionId ?? 'n/a'}\``,
			].join('\n')
		)
	},
}
