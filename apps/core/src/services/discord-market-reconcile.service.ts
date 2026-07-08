/**
 * Prediction-markets forum-post reconciliation (the M2.5 sweep).
 *
 * The Discord side of a market is best-effort: a bet/resolve refresh, the initial post, and
 * auto-close on `closesAt` can all fail silently, leaving the DB and the forum posts drifting.
 * This periodic sweep (driven by Core's cron — Core is the only worker binding both the PM DO and
 * the Discord DO; the PM DO must never call Discord) heals that drift in four bounded passes:
 *
 *   (a) auto-close markets past their close time (bounded; a backlog drains over ticks);
 *   (b) refresh drifted posts — embed + status-appropriate buttons + tag/lock — driven by a
 *       self-shrinking "recently changed, has a post" list, NOT by the one-shot close result, so a
 *       refresh that fails (a just-closed market's tag flip, or a failed live bet/resolve refresh)
 *       is retried on later ticks until it lands;
 *   (c) backfill posts for non-terminal markets that never got one;
 *   (d) re-post the terminal (resolved/voided) aggregate result to the thread for markets whose live
 *       path never landed it (Core evicted before the post), keyed off a persisted
 *       `settlementAnnouncedAt` flag. At-least-once for the public post (marked only once the post
 *       succeeds); per-participant DMs are re-sent alongside but stay best-effort (not tracked).
 *
 * Every pass is bounded and per-market isolated: one bad market never aborts the run.
 */

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	announceMarketClosed,
	announceMarketResolved,
	dmWagerResults,
} from './discord-market-notify.service'
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
	/** Terminal-settlement notifications re-sent this pass (cross-eviction self-heal). */
	notified: number
	/** Per-market failures (refresh, backfill, or settlement notify) that were isolated and skipped. */
	failed: number
	/** True when the sweep was skipped because the forum guild/category isn't configured. */
	skipped: boolean
}

/** Per-pass caps — keep a run inside the cron's wall-clock budget; backlogs drain over ticks. */
const CLOSE_LIMIT = 25
const REFRESH_LIMIT = 25
const BACKFILL_LIMIT = 25
const SETTLEMENT_NOTICE_LIMIT = 10
/** Only refresh posts touched within this window — bounds the heal pass to actually-drifted posts. */
const REFRESH_SINCE_MINUTES = 15
/**
 * Settlement self-heal grace: only self-heal once a market has been terminal at least this long. The
 * live path marks the flag synchronously right after its thread post, so a NULL flag on a market this
 * old means that post genuinely never landed (evicted / failed) — not that a resolve request is still
 * in flight. Comfortably clears any in-flight live request.
 */
const SETTLEMENT_GRACE_MINUTES = 15
/**
 * Settlement self-heal ceiling: ignore markets that went terminal longer ago than this. Bounds retries
 * of a permanently-failing post (e.g. its thread was deleted) so it ages out instead of re-posting
 * forever, and bounds the one-time first-deploy re-post of markets settled by the pre-column live path
 * to this trailing window.
 */
const SETTLEMENT_MAX_AGE_MINUTES = 360

export async function reconcileMarketPosts(db: CoreDb, env: ReconcileEnv): Promise<ReconcileResult> {
	const result: ReconcileResult = {
		closed: 0,
		refreshed: 0,
		posted: 0,
		notified: 0,
		failed: 0,
		skipped: false,
	}

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

	// (d) Settlement self-heal. The live resolve/void path posts the aggregate result to the thread and
	// marks the market announced the instant that post lands (see announceSettlement); a Core eviction
	// before that post leaves `settlementAnnouncedAt IS NULL`, with no other trace. This pass re-posts
	// the result for any terminal market still NULL past the grace window and marks it done ONLY once the
	// post actually succeeds — so a market is never abandoned by a transient Discord failure (it stays
	// NULL and a later tick retries, until it lands or ages past maxAge). Order matters: mark BEFORE the
	// DM fan-out, exactly like the live path, so the flag reflects "public result delivered" and a slow
	// fan-out can't hold it open for a concurrent tick to re-fire on.
	//
	// Guarantees & residuals: the thread post is at-least-once (healed across eviction/transient
	// failure). Per-participant DMs are best-effort — sent once here after the post lands, not tracked or
	// retried per-recipient. Because the mark is gated on the post (not the fan-out) and set before the
	// DMs, the double-notify window shrinks to a single post call; two ticks overlapping within it (rare
	// — 5-min cron, sub-second window) at worst duplicate one thread post. First-deploy caveat: terminal
	// markets already announced by the pre-column live path have a NULL flag and will be re-posted once
	// if they resolved within maxAge of the migration (bounded, one-time; empty in practice until the
	// feature is actually deployed).
	const unannounced = await prediction.listMarketsNeedingSettlementNotice(
		SETTLEMENT_NOTICE_LIMIT,
		SETTLEMENT_GRACE_MINUTES,
		SETTLEMENT_MAX_AGE_MINUTES
	)
	for (const market of unannounced) {
		try {
			const settlement = await prediction.getMarketSettlement(market.id)
			if (!settlement) {
				// Terminal market with no settlement data (shouldn't happen) — mark it so the work-list
				// stops re-selecting it rather than spinning every tick.
				await prediction.markSettlementAnnounced(market.id)
				continue
			}
			const posted = await announceMarketResolved(discord, guildId, market, settlement)
			// Post failed (Discord 4xx/5xx/rate-limit) — count it and leave the flag NULL so a later tick
			// retries (until it lands or ages past maxAge). Don't DM against a market whose public result
			// never landed (avoids re-DM spam on a broken thread). Mirrors pass (b)'s soft-failure handling.
			if (!posted) {
				result.failed++
				continue
			}
			await prediction.markSettlementAnnounced(market.id)
			result.notified++
			// Best-effort per-recipient; runs after the mark, so a DM failure never un-marks / re-posts.
			await dmWagerResults(discord, market, settlement)
		} catch (error) {
			result.failed++
			logger.warn('[PMReconcile] settlement self-heal failed', {
				marketId: market.id,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	return result
}
