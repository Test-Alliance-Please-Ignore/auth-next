/**
 * Prediction-markets lifecycle notifications: forum-thread posts on close/resolve/void, plus a
 * private DM to each participant with their wager result. Core is the sole Discord orchestrator
 * (the PM DO never calls Discord); these are best-effort — a Discord failure never rolls back the
 * already-committed market state.
 *
 * Thread posts carry only aggregate numbers (never per-user amounts); the individual breakdown
 * goes to each bettor privately via DM.
 */

import { logger } from '@repo/hono-helpers'

import {
	buildMarketCloseAnnouncement,
	buildMarketResolveAnnouncement,
	buildMarketVoidAnnouncement,
	buildWagerResultDm,
} from '../lib/market-embed'

import type { Discord } from '@repo/discord'
import type { MarketDetail, MarketSettlement } from '@repo/prediction-markets'

/** Post the "betting is closed" notice to a market's forum thread. No-op if it has no post. */
export async function announceMarketClosed(
	discord: Discord,
	guildId: string,
	market: MarketDetail
): Promise<void> {
	if (!market.discordThreadId) return
	const res = await discord.sendMessage(guildId, market.discordThreadId, {
		content: buildMarketCloseAnnouncement(),
		allowEveryone: false,
	})
	if (!res.success) {
		logger.warn('[PMNotify] close announcement failed', { marketId: market.id, error: res.error })
	}
}

/** The winning-outcome label for a settled market, or null on a void / if unresolvable. */
function winningOutcomeLabel(market: MarketDetail, settlement: MarketSettlement): string | null {
	if (settlement.status === 'voided') return null
	return market.outcomes.find((o) => o.id === settlement.resolvedOutcomeId)?.label ?? null
}

/**
 * Post the settled market's outcome + aggregate totals to its thread (aggregate only — never a
 * per-user amount; those go out privately via DM). Best-effort; no-op if the market has no post.
 * Fast (one message) so it can stay on the interactive resolve path.
 */
export async function announceMarketResolved(
	discord: Discord,
	guildId: string,
	market: MarketDetail,
	settlement: MarketSettlement
): Promise<void> {
	if (!market.discordThreadId) return
	const content =
		settlement.status === 'voided'
			? buildMarketVoidAnnouncement(settlement.totalStaked)
			: buildMarketResolveAnnouncement(
					winningOutcomeLabel(market, settlement) ?? 'the winning outcome',
					settlement.totalPaidOut,
					settlement.totalLost
				)
	const res = await discord.sendMessage(guildId, market.discordThreadId, {
		content,
		allowEveryone: false,
	})
	if (!res.success) {
		logger.warn('[PMNotify] resolve announcement failed', { marketId: market.id, error: res.error })
	}
}

/**
 * Cap on how many result DMs one settlement sends. A settlement fans out one DM per participant;
 * this bounds the work against Discord's aggressive DM-open rate limit and the Worker subrequest
 * budget. Realistic markets are far below it; a market past the cap logs its overflow.
 */
const MAX_RESULT_DMS = 400

/**
 * DM each participant their private wager result. Fans out (one DM per user), so callers run this
 * OFF the interactive path (e.g. in the RPC's `ctx.waitUntil`) — Discord rate-limits DM-opens
 * hard, so a large market's loop is slow and must never block the resolver's confirmation. Each DM
 * is independently guarded so one closed inbox never blocks the rest.
 */
export async function dmWagerResults(
	discord: Discord,
	market: MarketDetail,
	settlement: MarketSettlement
): Promise<void> {
	const voided = settlement.status === 'voided'
	const outcomeLabel = winningOutcomeLabel(market, settlement)
	const recipients = settlement.users.slice(0, MAX_RESULT_DMS)
	if (settlement.users.length > 0) {
		logger.info('[PMNotify] DMing wager results', {
			marketId: market.id,
			participants: settlement.users.length,
			dming: recipients.length,
			overflow: settlement.users.length - recipients.length,
		})
	}
	for (const user of recipients) {
		const content = buildWagerResultDm({
			question: market.question,
			voided,
			outcomeLabel,
			staked: user.staked,
			returned: user.returned,
			net: user.net,
		})
		try {
			const res = await discord.sendDirectMessage(user.userId, { content, allowEveryone: false })
			if (!res.success) {
				logger.warn('[PMNotify] result DM failed', {
					marketId: market.id,
					userId: user.userId,
					error: res.error,
				})
			}
		} catch (error) {
			logger.warn('[PMNotify] result DM threw', {
				marketId: market.id,
				userId: user.userId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}
}
