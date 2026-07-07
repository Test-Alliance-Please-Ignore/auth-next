/**
 * Prediction-markets forum-post reconciliation (the M2.5 sweep).
 *
 * The Discord side of a market is best-effort: a bet/resolve refresh, the initial post, and
 * auto-close on `closesAt` can all fail silently, leaving the DB and the forum posts drifting.
 * This periodic sweep (driven by Core's cron — Core is the only worker binding both the PM DO and
 * the Discord DO; the PM DO must never call Discord) heals that drift in three bounded passes:
 *
 *   (a) auto-close markets past their close time (bounded; a backlog drains over ticks);
 *   (b) refresh drifted posts — embed + status-appropriate buttons + tag/lock — driven by a
 *       self-shrinking "recently changed, has a post" list, NOT by the one-shot close result, so a
 *       refresh that fails (a just-closed market's tag flip, or a failed live bet/resolve refresh)
 *       is retried on later ticks until it lands;
 *   (c) backfill posts for non-terminal markets that never got one.
 *
 * Every pass is bounded and per-market isolated: one bad market never aborts the run.
 */

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { announceMarketClosed } from './discord-market-notify.service'
import {
	applyMarketPostStatus,
	publishMarketPost,
	updateMarketPostFromDetail,
} from './discord-market-post.service'

import type { createDb } from '../db'
import type { Env } from '../context'
import type { Discord } from '@repo/discord'
import type { PredictionMarkets } from '@repo/prediction-markets'

type CoreDb = ReturnType<typeof createDb>

/** Bindings + config the reconcile sweep needs. */
export type ReconcileEnv = Pick<
	Env,
	'PREDICTION_MARKETS' | 'DISCORD' | 'PM_FORUM_GUILD_ID' | 'PM_FORUM_CATEGORY_ID'
>

export interface ReconcileResult {
	/** Markets auto-closed this pass (past their close time). */
	closed: number
	/** Posts refreshed (embed + buttons + tag/lock) this pass. */
	refreshed: number
	/** Missing posts successfully backfilled this pass. */
	posted: number
	/** Per-market failures (refresh or backfill) that were isolated and skipped. */
	failed: number
	/** True when the sweep was skipped because the forum guild/category isn't configured. */
	skipped: boolean
}

/** Per-pass caps — keep a run inside the cron's wall-clock budget; backlogs drain over ticks. */
const CLOSE_LIMIT = 25
const REFRESH_LIMIT = 25
const BACKFILL_LIMIT = 25
/** Only refresh posts touched within this window — bounds the heal pass to actually-drifted posts. */
const REFRESH_SINCE_MINUTES = 15

export async function reconcileMarketPosts(db: CoreDb, env: ReconcileEnv): Promise<ReconcileResult> {
	const result: ReconcileResult = { closed: 0, refreshed: 0, posted: 0, failed: 0, skipped: false }

	// Without a configured forum guild + category there is nowhere to post; do nothing.
	if (!env.PM_FORUM_GUILD_ID || !env.PM_FORUM_CATEGORY_ID) {
		result.skipped = true
		return result
	}
	const guildId = env.PM_FORUM_GUILD_ID
	const categoryId = env.PM_FORUM_CATEGORY_ID

	const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')
	const discord = getStub<Discord>(env.DISCORD, 'default')

	// (a) Auto-close due markets (bounded). Their posts are refreshed by pass (b): a just-closed
	// market's `updatedAt` is fresh, so it lands in the refresh list below on this same tick.
	const { closedMarketIds } = await prediction.closeDueMarkets(CLOSE_LIMIT)
	result.closed = closedMarketIds.length
	// Announce each auto-close to its thread. closedMarketIds only holds markets that transitioned
	// open→closed this pass, so this fires once per market. Best-effort and per-market isolated.
	for (const marketId of closedMarketIds) {
		try {
			const market = await prediction.getMarket(marketId)
			if (market) await announceMarketClosed(discord, guildId, market)
		} catch (error) {
			result.failed++
			logger.warn('[PMReconcile] auto-close announcement failed', {
				marketId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// (b) Refresh drifted posts (embed + status buttons + tag/lock). Driven by a self-shrinking
	// "recently changed, has a post" list rather than the one-shot close result, so a refresh that
	// failed on a prior tick is retried here until it lands — this is what makes the sweep heal.
	const refreshIds = await prediction.listMarketsToRefresh(REFRESH_SINCE_MINUTES, REFRESH_LIMIT)
	for (const marketId of refreshIds) {
		try {
			// Re-read current state just before editing: the market may have changed since the list
			// was built. Terminal (resolved/voided) markets are owned by the live resolve/void path,
			// which archives+locks the post — never let a stale heal edit clobber it back to an
			// active state (and a terminal market leaves this list, so such a clobber wouldn't heal).
			const market = await prediction.getMarket(marketId)
			if (!market || market.status === 'resolved' || market.status === 'voided') continue
			const edit = await updateMarketPostFromDetail(discord, market)
			if (edit.success) {
				await applyMarketPostStatus(db, discord, guildId, market)
				result.refreshed++
			} else {
				// Soft failure (e.g. the Discord edit 4xx/5xx'd and was swallowed). Count it and leave
				// the market in the refresh set (its updatedAt is unchanged) so a later tick retries.
				result.failed++
			}
		} catch (error) {
			result.failed++
			logger.warn('[PMReconcile] failed to refresh market post', {
				marketId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// (c) Backfill posts for non-terminal markets that never got one (e.g. publishMarketPost failed
	// at create time). Grace-filtered so it won't race a create-route publish still in flight.
	const missing = await prediction.listMarketsNeedingPost(BACKFILL_LIMIT)
	for (const market of missing) {
		try {
			await publishMarketPost(db, discord, prediction, guildId, categoryId, market)
			result.posted++
		} catch (error) {
			result.failed++
			// Known v1 hazard: publishMarketPost creates the thread THEN attaches it to the market. If
			// the attach fails, the market keeps a null thread id and reappears here next tick — so a
			// *persistently* failing attach re-posts every pass, not just once. Accepted for v1 (matches
			// the create route); logged loudly so an operator can spot and clean up duplicates. A claim
			// row (reserve the thread id before creating) is the durable fix, deferred to a follow-up.
			logger.warn('[PMReconcile] failed to backfill market post', {
				marketId: market.id,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	return result
}
