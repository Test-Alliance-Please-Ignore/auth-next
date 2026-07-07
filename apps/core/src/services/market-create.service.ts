/**
 * Shared prediction-market creation: validate → createMarket (source of truth) → best-effort
 * publish the forum post. Used by BOTH the admin route and the member (urn:markets:creator) route
 * so the two stay in lockstep. Core is the sole Discord orchestrator; the PM DO never calls Discord.
 */

import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { publishMarketPost } from './discord-market-post.service'

import type { createDb } from '../db'
import type { App, Env } from '../context'
import type { Context } from 'hono'
import type { Discord } from '@repo/discord'
import type { MarketDetail, PredictionMarkets } from '@repo/prediction-markets'

type CoreDb = ReturnType<typeof createDb>

/** Bindings + forum config the create flow needs. */
export type CreateMarketEnv = Pick<
	Env,
	'PREDICTION_MARKETS' | 'DISCORD' | 'PM_FORUM_GUILD_ID' | 'PM_FORUM_CATEGORY_ID'
>

const positiveIntString = z
	.string()
	.regex(/^\d+$/, 'must be a positive integer')
	.refine((v) => BigInt(v) > 0n, 'must be greater than 0')

export const createMarketSchema = z.object({
	question: z.string().trim().min(3).max(500),
	description: z.string().trim().max(2000).optional(),
	outcomes: z
		.array(z.string().trim().min(1).max(100))
		.min(2)
		.max(20)
		// case-insensitive dedupe: the PM DO rejects DUPLICATE_OUTCOMES the same way.
		.refine((o) => new Set(o.map((s) => s.toLowerCase())).size === o.length, 'outcomes must be distinct'),
	closesAt: z
		.string()
		.datetime()
		.refine((s) => new Date(s).getTime() > Date.now(), 'closesAt must be in the future'),
	rakeBps: z.number().int().min(0).max(2000).optional(),
	minStake: positiveIntString.optional(),
	maxStake: positiveIntString.optional(),
	perUserCap: positiveIntString.optional(),
	twoOfN: z.boolean().optional(),
})

export type CreateMarketBody = z.infer<typeof createMarketSchema>

/** createMarket domain errors that are the caller's fault (bad input) → 400, not a server 500. */
export const CREATE_MARKET_BAD_REQUEST_CODES = [
	'AT_LEAST_TWO_OUTCOMES',
	'TOO_MANY_OUTCOMES',
	'DUPLICATE_OUTCOMES',
	'QUESTION_REQUIRED',
	'INVALID_CLOSES_AT',
	'INVALID_RAKE',
	'INVALID_MIN_STAKE',
	'INVALID_MAX_STAKE',
	'INVALID_PER_USER_CAP',
] as const

const CREATE_BAD_REQUEST_SET = new Set<string>(CREATE_MARKET_BAD_REQUEST_CODES)

/** Map a create-market error to the right HTTP status (shared by the admin + member routes). */
export function mapMarketCreateError(c: Context<App>, error: unknown) {
	if (error instanceof z.ZodError) {
		return c.json({ error: 'Validation failed', issues: error.issues }, 400)
	}
	const msg = error instanceof Error ? error.message : String(error)
	if (CREATE_BAD_REQUEST_SET.has(msg)) {
		return c.json({ error: msg }, 400)
	}
	logger.error('[MarketCreate] create failed', { error: msg })
	return c.json({ error: msg }, 500)
}

export interface CreateMarketResult {
	market: MarketDetail
	post: { threadId: string; messageId: string } | null
	postError: string | null
}

/**
 * Create a market (source of truth first), then best-effort publish its forum post. Never throws
 * for a Discord failure — it surfaces as `postError` (the market already exists, so a post failure
 * is recoverable, never a lost market). `createdBy` MUST come from the session, never the client.
 */
export async function createAndPublishMarket(
	db: CoreDb,
	env: CreateMarketEnv,
	createdBy: string,
	input: CreateMarketBody
): Promise<CreateMarketResult> {
	const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')
	const market = await prediction.createMarket({ createdBy, ...input })

	let post: { threadId: string; messageId: string } | null = null
	let postError: string | null = null
	if (!env.PM_FORUM_GUILD_ID || !env.PM_FORUM_CATEGORY_ID) {
		postError = 'PM_FORUM_GUILD_ID / PM_FORUM_CATEGORY_ID not configured'
	} else {
		try {
			post = await publishMarketPost(
				db,
				getStub<Discord>(env.DISCORD, 'default'),
				prediction,
				env.PM_FORUM_GUILD_ID,
				env.PM_FORUM_CATEGORY_ID,
				market
			)
		} catch (err) {
			postError = err instanceof Error ? err.message : String(err)
			logger.error('[MarketCreate] forum post failed', { marketId: market.id, error: postError })
		}
	}
	return { market, post, postError }
}
