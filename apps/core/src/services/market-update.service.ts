/**
 * Admin market edit → apply the change, refresh the forum post embed, and announce what changed in
 * the thread. Core is the sole Discord orchestrator; the PM DO never calls Discord. The DB write is
 * source-of-truth; the Discord side effects are best-effort (a failure never rolls back the edit).
 */

import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { announceMarketUpdated } from './discord-market-notify.service'
import { updateMarketPostFromDetail } from './discord-market-post.service'

import type { createDb } from '../db'
import type { Env } from '../context'
import type { Discord } from '@repo/discord'
import type { MarketDetail, PredictionMarkets } from '@repo/prediction-markets'

type CoreDb = ReturnType<typeof createDb>

export type UpdateMarketEnv = Pick<Env, 'PREDICTION_MARKETS' | 'DISCORD' | 'PM_FORUM_GUILD_ID'>

/**
 * Partial market edit — the safe-to-change fields only. At least one must be present.
 * `description: null` clears the description; economic params + outcomes are not editable.
 */
export const updateMarketSchema = z
	.object({
		closesAt: z
			.string()
			.datetime()
			.refine((s) => new Date(s).getTime() > Date.now(), 'closesAt must be in the future')
			.optional(),
		question: z.string().trim().min(3).max(500).optional(),
		description: z.string().trim().max(2000).nullable().optional(),
	})
	.refine(
		(v) => v.closesAt !== undefined || v.question !== undefined || v.description !== undefined,
		'at least one field to update is required'
	)

export type UpdateMarketBody = z.infer<typeof updateMarketSchema>

export interface UpdateMarketResult {
	market: MarketDetail
}

/**
 * Apply an admin edit to a market, then (best-effort) refresh its forum-post embed and post a
 * "market updated" notice listing the fields that actually changed. `updateMarket` throws
 * MARKET_NOT_FOUND when the market doesn't exist; other domain rejections (MARKET_NOT_EDITABLE /
 * CLOSES_AT_NOT_EDITABLE / INVALID_CLOSES_AT / …) propagate to the caller's error mapping. The
 * changed-field set is computed atomically inside the DO (under the row lock), so the announcement
 * can't be mis-attributed by a concurrent edit. `db` is unused today but kept for signature parity.
 */
export async function updateAndAnnounceMarket(
	_db: CoreDb,
	env: UpdateMarketEnv,
	actorUserId: string,
	marketId: string,
	updates: UpdateMarketBody
): Promise<UpdateMarketResult> {
	const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')
	const { market, changed } = await prediction.updateMarket(marketId, actorUserId, updates)

	// Best-effort Discord side effects: refresh the pinned embed (reflects new close time / text),
	// then post the change notice. Never fails the edit — the DB write already committed.
	try {
		const discord = getStub<Discord>(env.DISCORD, 'default')
		await updateMarketPostFromDetail(discord, market)
		await announceMarketUpdated(discord, env.PM_FORUM_GUILD_ID ?? '', market, {
			closesAt: changed.closesAt ? market.closesAt : undefined,
			question: changed.question,
			description: changed.description,
		})
	} catch (err) {
		logger.warn('[MarketUpdate] post refresh / announce failed', {
			marketId,
			error: err instanceof Error ? err.message : String(err),
		})
	}

	return { market }
}
