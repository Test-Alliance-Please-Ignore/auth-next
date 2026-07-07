/**
 * Discord component / modal-submit handling for prediction markets.
 *
 * P2 handles the bet flow's modal submit: a member clicks a "bet" button (the interactions
 * worker opens the stake modal inline), enters an amount, and this runs `placeBet`, refreshes
 * the public post embed, and returns an ephemeral confirmation. Resolver component actions
 * (close/resolve/void) arrive in P3. Core is the sole Discord orchestrator.
 */

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { users } from '../db/schema'
import { BET_AMOUNT_INPUT_ID, customIdAction, decodeBetTarget } from '../lib/market-custom-id'
import { formatMarketPoints } from '../lib/market-embed'
import { updateMarketPostFromDetail } from './discord-market-post.service'

import type { createDb } from '../db'
import type { Env } from '../context'
import type { Discord, DiscordEmbed } from '@repo/discord'
import type { PredictionMarkets } from '@repo/prediction-markets'

const EPHEMERAL_FLAG = 1 << 6

/** Bindings the component/modal path needs (money DO + Discord DO for the post refresh). */
export type ComponentEnv = Pick<Env, 'DISCORD' | 'PREDICTION_MARKETS'>

export interface DiscordComponentResult {
	response: { type: number; data: { content: string; flags?: number; embeds?: DiscordEmbed[] } }
	coreUserId: string | null
	reason: string
}

export interface ExecuteModalSubmitInput {
	customId: string
	/** Modal text-input values keyed by their custom_id. */
	fields: Record<string, string>
	discordUserId: string
	/** The modal-submit interaction id — the idempotency key for placeBet. */
	interactionId?: string | null
	guildId?: string | null
	channelId?: string | null
}

const BET_ERROR_MESSAGES: Record<string, string> = {
	MARKET_NOT_FOUND: 'That market no longer exists.',
	MARKET_NOT_OPEN: 'This market is not open for betting.',
	MARKET_CLOSED: 'Betting has closed on this market.',
	OUTCOME_NOT_FOUND: 'That outcome is no longer available.',
	STAKE_BELOW_MIN: 'Your stake is below the minimum for this market.',
	STAKE_ABOVE_MAX: 'Your stake is above the maximum for this market.',
	PER_USER_CAP_EXCEEDED: 'That would exceed your per-user cap on this market.',
	INSUFFICIENT_FUNDS: 'Not enough points — ask an admin for a grant, or lower your stake.',
	INVALID_AMOUNT: 'Enter a whole number of points.',
}

function ephemeral(
	content: string,
	reason: string,
	coreUserId: string | null = null
): DiscordComponentResult {
	return { response: { type: 4, data: { content, flags: EPHEMERAL_FLAG } }, coreUserId, reason }
}

/**
 * Handle a modal submit. Deferred (ephemeral) by the interactions worker, so this may take
 * >3s; the returned `response.data.content` is delivered as the followup.
 */
export async function executeDiscordModalSubmit(
	db: ReturnType<typeof createDb>,
	env: ComponentEnv,
	input: ExecuteModalSubmitInput
): Promise<DiscordComponentResult> {
	if (customIdAction(input.customId) !== 'betmodal') {
		return ephemeral('Unsupported modal.', 'invalid-component')
	}

	const target = decodeBetTarget(input.customId)
	if (!target) return ephemeral('Could not read this bet. Please try again.', 'invalid-component')

	if (!input.interactionId) {
		// Real interactions always carry an id; guard so a bet is never placed without a key.
		return ephemeral('Could not process this bet. Please try again.', 'invalid-component')
	}

	const user = await db.query.users.findFirst({
		where: eq(users.discordUserId, input.discordUserId),
		columns: { id: true },
	})
	if (!user) {
		return ephemeral(
			'Your Discord account is not linked to a core user. Link it in the app first.',
			'not-linked'
		)
	}

	const amountRaw = (input.fields[BET_AMOUNT_INPUT_ID] ?? '').trim()
	if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
		return ephemeral('Enter a whole number of points greater than zero.', 'invalid-amount', user.id)
	}

	const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')
	try {
		const bet = await prediction.placeBet({
			userId: user.id,
			marketId: target.marketId,
			outcomeId: target.outcomeId,
			amount: amountRaw,
			idempotencyKey: input.interactionId,
		})

		// Refresh the public post embed (pools/odds) + grab the outcome label — best-effort.
		let outcomeLabel = ''
		try {
			const market = await prediction.getMarket(target.marketId)
			if (market) {
				outcomeLabel = market.outcomes.find((o) => o.id === target.outcomeId)?.label ?? ''
				await updateMarketPostFromDetail(getStub<Discord>(env.DISCORD, 'default'), market)
			}
		} catch (err) {
			logger.warn('[DiscordComponents] post refresh after bet failed', {
				marketId: target.marketId,
				error: err instanceof Error ? err.message : String(err),
			})
		}

		const on = outcomeLabel ? ` on **${outcomeLabel}**` : ''
		return ephemeral(`Bet placed: ${formatMarketPoints(bet.amount)}${on}.`, 'ok', user.id)
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		if (msg.startsWith('RATE_LIMITED')) {
			const ms = Number(msg.split(':')[1]) || 0
			const secs = Math.max(1, Math.ceil(ms / 1000))
			return ephemeral(`Slow down — try again in ${secs}s.`, 'rate-limited', user.id)
		}
		const friendly = BET_ERROR_MESSAGES[msg]
		if (friendly) return ephemeral(friendly, 'bet-error', user.id)
		logger.error('[DiscordComponents] placeBet failed', { marketId: target.marketId, error: msg })
		return ephemeral('Could not place your bet. Please try again later.', 'error', user.id)
	}
}
