import { DISCORD_SLASH_COMMAND_OPTION_TYPE } from '@repo/discord'
import { getStub } from '@repo/do-utils'

import { formatMarketPoints } from '../../lib/market-embed'
import { ephemeralCommandResponse } from './types'

import type { ProgrammaticCommandDefinition } from './types'
import type { DetailedBetView, PredictionMarkets } from '@repo/prediction-markets'

/** One line per bet: question — outcome — stake (status). */
function formatBetLine(b: DetailedBetView): string {
	const question = b.marketQuestion.length > 70 ? `${b.marketQuestion.slice(0, 69)}…` : b.marketQuestion
	return `• ${question} — **${b.outcomeLabel}** — ${formatMarketPoints(b.amount)} (${b.status})`
}

/**
 * `/market` member commands: check your own balance and active bets. Both are ephemeral and
 * self-only (no other-user data), so no permission gate or name resolution is needed. The
 * betting/resolving surface lives on the forum posts (P2/P3), not on slash commands.
 *
 * The fired subcommand is read from `input.options[0].name` — Discord nests subcommand options,
 * and the M-Enable option flattener does not surface the subcommand name in `optionValues`.
 */
export const MARKET_PROGRAMMATIC_COMMAND: ProgrammaticCommandDefinition = {
	name: 'market',
	description: 'Prediction markets: check your balance and bets.',
	deferral: 'defer-ephemeral',
	options: [
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.SUB_COMMAND,
			name: 'balance',
			description: 'Show your prediction-market points balance.',
		},
		{
			type: DISCORD_SLASH_COMMAND_OPTION_TYPE.SUB_COMMAND,
			name: 'mybets',
			description: 'Show your active prediction-market bets.',
		},
	],
	handler: async ({ input, coreUserId, env }) => {
		const sub = input.options?.[0]?.name
		const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')

		if (sub === 'balance') {
			const { balance } = await prediction.getWalletBalance(coreUserId)
			return ephemeralCommandResponse(`Your balance: **${formatMarketPoints(balance)}**.`)
		}

		if (sub === 'mybets') {
			const bets = await prediction.getUserBetsDetailed(coreUserId, { activeOnly: true })
			if (bets.length === 0) return ephemeralCommandResponse('You have no active bets.')
			return ephemeralCommandResponse(['**Your active bets:**', ...bets.map(formatBetLine)].join('\n'))
		}

		return ephemeralCommandResponse('Unknown subcommand. Try `/market balance` or `/market mybets`.')
	},
}
