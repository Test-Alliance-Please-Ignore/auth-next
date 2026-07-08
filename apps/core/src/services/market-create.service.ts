/**
 * Shared prediction-market creation: validate → createMarket (source of truth) → best-effort
 * publish the forum post. Used by BOTH the admin route and the member (urn:markets:creator) route
 * so the two stay in lockstep. Core is the sole Discord orchestrator; the PM DO never calls Discord.
 */

import { z } from 'zod'

import { inArray } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { users } from '../db/schema'
import { hasMarketPermission } from '../lib/market-permissions'
import { publishMarketPost } from './discord-market-post.service'

import type { Context } from 'hono'
import type { Discord } from '@repo/discord'
import type { MarketDetail, PredictionMarkets } from '@repo/prediction-markets'
import type { App, Env } from '../context'
import type { createDb } from '../db'

type CoreDb = ReturnType<typeof createDb>

/** Bindings + forum config the create flow needs. GROUPS is required to tier-validate designated resolvers. */
export type CreateMarketEnv = Pick<
	Env,
	'PREDICTION_MARKETS' | 'DISCORD' | 'GROUPS' | 'PM_FORUM_GUILD_ID' | 'PM_FORUM_CATEGORY_ID'
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
		.refine(
			(o) => new Set(o.map((s) => s.toLowerCase())).size === o.length,
			'outcomes must be distinct'
		),
	closesAt: z
		.string()
		.datetime()
		.refine((s) => new Date(s).getTime() > Date.now(), 'closesAt must be in the future'),
	rakeBps: z.number().int().min(0).max(2000).optional(),
	minStake: positiveIntString.optional(),
	maxStake: positiveIntString.optional(),
	perUserCap: positiveIntString.optional(),
	twoOfN: z.boolean().optional(),
	// Optional designated resolver core user ids. Lowercase-canonicalized so a case-variant uuid can't
	// defeat the creator-exclusion / distinctness checks (Postgres stores uuid lowercased). Admin/
	// manager surface only — the slim creator schema below deliberately omits it (creators can't
	// designate in v1). Membership + resolver-tier + creator-exclusion are validated server-side.
	designatedResolverIds: z
		.array(
			z
				.string()
				.uuid()
				.transform((s) => s.toLowerCase())
		)
		.max(10)
		.optional(),
})

export type CreateMarketBody = z.infer<typeof createMarketSchema>

/**
 * Slim schema for lower-trust `urn:markets:creator` users: question/outcomes/close only. The
 * economic params (rakeBps, min/max stake, per-user cap, twoOfN) are omitted — a creator can't set
 * them (zod strips any that are sent), so they fall back to the pmConfig defaults in createMarket.
 * Managers/admins use the full createMarketSchema. Its output is a subset of CreateMarketBody.
 */
export const createMarketCreatorSchema = createMarketSchema.pick({
	question: true,
	description: true,
	outcomes: true,
	closesAt: true,
})

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
	'CREATOR_IS_RESOLVER',
	// Single generic code for any bad designated id (unknown user OR lacks the resolver tier). Kept
	// deliberately coarse so the response can't be used as a user-existence / tier-membership oracle.
	'DESIGNATED_RESOLVER_INVALID',
	'DESIGNATED_RESOLVERS_INSUFFICIENT_FOR_TWO_OF_N',
] as const

const CREATE_BAD_REQUEST_SET = new Set<string>(CREATE_MARKET_BAD_REQUEST_CODES)

/** Map a create-market error to the right HTTP status (used by the member create route). */
export function mapMarketCreateError(c: Context<App>, error: unknown) {
	if (error instanceof z.ZodError) {
		return c.json({ error: 'Validation failed', issues: error.issues }, 400)
	}
	const msg = error instanceof Error ? error.message : String(error)
	if (msg.startsWith('RATE_LIMITED')) {
		const retryAfterMs = Number(msg.split(':')[1]) || 0
		return c.json(
			{ error: 'You’re creating markets too fast — try again shortly.', retryAfterMs },
			429
		)
	}
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
 * Validate a create-time designated-resolver set (ids already lowercase-canonicalized by zod). This
 * is where "designation NARROWS, never GRANTS" is enforced: the DO can't read GROUPS, so Core proves
 * — before createMarket — that (a) the creator isn't designating themselves, and (b) every designee
 * already holds `urn:markets:resolver` (checked with THAT user's own is_admin, not the creator's).
 * Any unknown user OR missing-tier collapses to the single generic DESIGNATED_RESOLVER_INVALID so the
 * endpoint can't be turned into a user-existence / tier oracle.
 */
async function validateDesignatedResolvers(
	db: CoreDb,
	env: CreateMarketEnv,
	createdBy: string,
	ids: string[]
): Promise<void> {
	const unique = [...new Set(ids)]
	if (unique.includes(createdBy.toLowerCase())) throw new Error('CREATOR_IS_RESOLVER')

	const rows = await db
		.select({ id: users.id, isAdmin: users.is_admin })
		.from(users)
		.where(inArray(users.id, unique))
	const adminById = new Map(rows.map((r) => [r.id.toLowerCase(), r.isAdmin]))
	// Unknown user id → generic invalid (no distinct "not found" signal).
	if (unique.some((id) => !adminById.has(id))) throw new Error('DESIGNATED_RESOLVER_INVALID')

	// Each designee must independently hold the resolver tier (evaluated with their own admin flag).
	const tierOk = await Promise.all(
		unique.map((id) => hasMarketPermission(env, id, 'resolver', adminById.get(id) ?? false))
	)
	if (tierOk.some((ok) => !ok)) throw new Error('DESIGNATED_RESOLVER_INVALID')
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
	input: CreateMarketBody,
	opts?: { enforceRateLimit?: boolean }
): Promise<CreateMarketResult> {
	// Tier-validate designated resolvers before creating (the DO can't read GROUPS). The DO re-checks
	// creator-exclusion + set sizing as a structural backstop.
	if (input.designatedResolverIds && input.designatedResolverIds.length > 0) {
		await validateDesignatedResolvers(db, env, createdBy, input.designatedResolverIds)
	}

	const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')
	const market = await prediction.createMarket({
		createdBy,
		...input,
		enforceRateLimit: opts?.enforceRateLimit,
	})

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
