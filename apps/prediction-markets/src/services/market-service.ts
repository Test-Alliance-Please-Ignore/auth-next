import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from '@repo/db-utils'
import { captureException } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'

import { pmMarketOutcomes, pmMarkets } from '../db/schema'
import { isDesignatedResolver, normalizeDesignatedResolvers } from '../lib/designated-resolvers'
import { isExpectedError, PmError } from '../lib/errors'
import { isPositiveIntegerString } from '../lib/money'
import { assertTransition, isTerminal } from '../lib/state-machine'
import {
	buildMarketDetail,
	buildMarketDetails,
	consumeRateBudget,
	logHistory,
	readActiveConfig,
} from './shared'

import type {
	CreateMarketInput,
	MarketDetail,
	MarketUpdateResult,
	UpdateMarketInput,
} from '@repo/prediction-markets'
import type { PmDeps } from './context'

export async function createMarket(deps: PmDeps, input: CreateMarketInput): Promise<MarketDetail> {
	const labels = input.outcomes.map((o) => o.trim()).filter(Boolean)
	if (labels.length < 2) throw new PmError('AT_LEAST_TWO_OUTCOMES')
	// Cap at 20 so the embed (≤25 fields) and button rows (≤25 buttons / 5 rows) can't
	// overflow Discord limits. The admin route enforces this too; the DO owns the invariant.
	if (labels.length > 20) throw new PmError('TOO_MANY_OUTCOMES')
	if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
		throw new PmError('DUPLICATE_OUTCOMES')
	}
	if (!input.question.trim()) throw new PmError('QUESTION_REQUIRED')
	const closesAt = parseDateOrNull(input.closesAt)
	if (!closesAt) throw new PmError('INVALID_CLOSES_AT')
	// Expected resolution date: REQUIRED at create (the column is nullable only for backward-compat
	// with pre-existing markets) and must be at or after betting close — a market can't be scheduled
	// to resolve before its own bets stop.
	const resolvesOn = parseDateOrNull(input.resolvesOn)
	if (!resolvesOn) throw new PmError('INVALID_RESOLVES_ON')
	if (resolvesOn.getTime() < closesAt.getTime()) throw new PmError('RESOLVES_ON_BEFORE_CLOSE')
	if (input.rakeBps != null && (input.rakeBps < 0 || input.rakeBps > 2000)) {
		throw new PmError('INVALID_RAKE')
	}
	if (input.minStake != null && !isPositiveIntegerString(input.minStake)) {
		throw new PmError('INVALID_MIN_STAKE')
	}
	if (input.maxStake != null && !isPositiveIntegerString(input.maxStake)) {
		throw new PmError('INVALID_MAX_STAKE')
	}
	if (input.perUserCap != null && !isPositiveIntegerString(input.perUserCap)) {
		throw new PmError('INVALID_PER_USER_CAP')
	}

	// Read the active config ONCE and reuse it for the size-1 designated guard AND the market's frozen
	// rake/minStake below. Reading it twice (a separate threshold read here + another inside the tx)
	// let a concurrent updateConfig commit land between them and slip a size-1 designated market past
	// the guard under a threshold the market was then created with. This read sits before the tx's
	// try/catch, so wrap it to keep DO-level Sentry context on an infra failure (e.g. unmigrated table).
	let cfg
	try {
		cfg = await readActiveConfig(deps.db)
	} catch (error) {
		captureException(error as Error, {
			tags: { durableObject: 'PredictionMarketsDO', method: 'createMarket' },
		})
		throw error
	}

	// Designated resolvers (optional). Core has already validated tier-membership + creator-exclusion
	// (it alone can read GROUPS); the DO re-enforces only the structural invariants as a backstop.
	// These throws are OUTSIDE the try below, so they surface to the caller without paging Sentry.
	const designatedResolvers = normalizeDesignatedResolvers(input.designatedResolverIds)
	if (designatedResolvers) {
		if (isDesignatedResolver(designatedResolvers, input.createdBy)) {
			throw new PmError('CREATOR_IS_RESOLVER')
		}
		// Two-of-N settlement needs two DISTINCT approvers. It fires on the explicit `twoOfN` flag OR
		// dynamically once the pool crosses the configured threshold (which happens AFTER create, as
		// bets accumulate). A size-1 designated set can never supply the second distinct signer, so
		// require >=2 whenever two-of-N is even possible for this market.
		//
		// ACCEPTED RESIDUAL (product decision — "allow a single resolver"): this guarantee is
		// CREATE-TIME ONLY. If a size-1 designated market is created while NO threshold is active and
		// an admin LATER activates/lowers `pmConfig.twoOfNThreshold` such that the pool crosses it,
		// requiresTwoOfN() flips true at settle and the sole designated resolver can't self-complete
		// (no distinct second signer). It is still never permanently stuck: a DISTINCT urn:markets:manager
		// can supply the second signature (bypassDesignated waives the designated-membership check), a
		// site admin can adminOverride to collapse two-of-N and resolve/void in one step, or it can simply
		// be voided. We deliberately
		// do NOT weaken requiresTwoOfN for small designated sets, so the two-of-N safeguard on large
		// pools is never silently skipped by designating a single resolver.
		if (designatedResolvers.length < 2) {
			const twoOfNPossible = (input.twoOfN ?? false) || (cfg?.twoOfNThreshold ?? null) != null
			if (twoOfNPossible) throw new PmError('DESIGNATED_RESOLVERS_INSUFFICIENT_FOR_TWO_OF_N')
		}
	}

	// Rate limit member-created markets (opt-in per request; admin creation is uncapped). Consume
	// the budget after input validation but before any write; a rejected create still counts
	// (anti-spam), same as placeBet. `create_market` throttles the public forum-post fan-out.
	if (input.enforceRateLimit) {
		const rate = await consumeRateBudget(deps.db, input.createdBy, 'create_market')
		if (!rate.allowed) throw new PmError('RATE_LIMITED', { detail: rate.retryAfterMs })
	}

	try {
		return await deps.db.transaction(async (tx) => {
			// Defaults come from the single `cfg` snapshot read above (same snapshot as the guard).
			const rakeBps = input.rakeBps ?? cfg?.defaultRakeBps ?? 0
			const minStake = input.minStake ?? cfg?.defaultMinStake ?? '1'

			const [market] = await tx
				.insert(pmMarkets)
				.values({
					question: input.question.trim(),
					description: input.description?.trim() ?? null,
					status: 'open',
					createdBy: input.createdBy,
					closesAt,
					resolvesOn,
					rakeBps,
					minStake,
					maxStake: input.maxStake ?? null,
					perUserCap: input.perUserCap ?? null,
					twoOfN: input.twoOfN ?? false,
					designatedResolvers: designatedResolvers ?? null,
				})
				.returning()

			await tx
				.insert(pmMarketOutcomes)
				.values(labels.map((label, i) => ({ marketId: market.id, label, sortOrder: i })))

			await logHistory(tx, {
				marketId: market.id,
				actorUserId: input.createdBy,
				action: 'created',
				newStatus: 'open',
				metadata: { outcomes: labels, designatedResolvers: designatedResolvers ?? null },
			})

			const detail = await buildMarketDetail(tx, market.id)
			// Internal invariant (the row was just inserted) — page if it ever fails.
			if (!detail) throw new PmError('MARKET_CREATE_FAILED', { expected: false })
			return detail
		})
	} catch (error) {
		captureException(error as Error, {
			tags: { durableObject: 'PredictionMarketsDO', method: 'createMarket' },
		})
		throw error
	}
}

/**
 * Edit a non-terminal market's safe fields (closesAt / question / description). Rejects a
 * resolved/voided market (MARKET_NOT_EDITABLE); `closesAt` is editable only while the market is
 * open (CLOSES_AT_NOT_EDITABLE otherwise — the close time is meaningless on a closed/resolving
 * market) and must be in the future (INVALID_CLOSES_AT). Only fields that ACTUALLY differ from
 * the row are written — computed under the FOR UPDATE lock, so the returned `changed` flags can't
 * be corrupted by a concurrent edit. Records the acting admin + the new values in the audit log.
 */
export async function updateMarket(
	deps: PmDeps,
	marketId: string,
	actorUserId: string,
	updates: UpdateMarketInput
): Promise<MarketUpdateResult> {
	try {
		return await deps.db.transaction(async (tx) => {
			const [market] = await tx
				.select()
				.from(pmMarkets)
				.where(eq(pmMarkets.id, marketId))
				.for('update')
			if (!market) throw new PmError('MARKET_NOT_FOUND')
			if (isTerminal(market.status)) throw new PmError('MARKET_NOT_EDITABLE')

			const set: Partial<typeof pmMarkets.$inferInsert> = {}
			// New values for the fields that genuinely changed — the audit metadata.
			const changes: Record<string, unknown> = {}

			if (updates.closesAt !== undefined) {
				// The close time only governs an OPEN market; editing it on a closed/resolving one
				// would falsely read as "betting reopened" while status stays closed.
				if (market.status !== 'open') throw new PmError('CLOSES_AT_NOT_EDITABLE')
				const closesAt = parseDateOrNull(updates.closesAt)
				if (!closesAt || closesAt.getTime() <= Date.now()) throw new PmError('INVALID_CLOSES_AT')
				// Preserve the create-time invariant: a market can't be scheduled to resolve before its
				// betting closes. NULL-safe — legacy markets have no resolvesOn to violate.
				if (market.resolvesOn && closesAt.getTime() > market.resolvesOn.getTime()) {
					throw new PmError('RESOLVES_ON_BEFORE_CLOSE')
				}
				if (closesAt.getTime() !== market.closesAt.getTime()) {
					set.closesAt = closesAt
					changes.closesAt = closesAt.toISOString()
				}
			}
			if (updates.question !== undefined) {
				const question = updates.question.trim()
				if (!question) throw new PmError('QUESTION_REQUIRED')
				if (question !== market.question) {
					set.question = question
					changes.question = question
				}
			}
			if (updates.description !== undefined) {
				const description = updates.description?.trim() || null
				if (description !== market.description) {
					set.description = description
					changes.description = description
				}
			}

			// Only write + audit when something actually changed (a no-op edit is idempotent).
			if (Object.keys(changes).length > 0) {
				set.updatedAt = new Date()
				await tx.update(pmMarkets).set(set).where(eq(pmMarkets.id, marketId))
				await logHistory(tx, {
					marketId,
					actorUserId,
					action: 'updated',
					previousStatus: market.status,
					newStatus: market.status,
					visibility: 'internal',
					metadata: { changes },
				})
			}

			const detail = await buildMarketDetail(tx, marketId)
			if (!detail) throw new PmError('MARKET_NOT_FOUND')
			return {
				market: detail,
				changed: {
					closesAt: 'closesAt' in changes,
					question: 'question' in changes,
					description: 'description' in changes,
				},
			}
		})
	} catch (error) {
		// Caller-input rejections are expected outcomes — don't page on them.
		if (!isExpectedError(error)) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'updateMarket' },
			})
		}
		throw error
	}
}

/**
 * Persist the Discord forum post mapping after Core creates the post. Pure UPDATE —
 * the PM DO never calls Discord; Core orchestrates the post and writes the ids back here.
 */
export async function attachDiscordPost(
	deps: PmDeps,
	input: {
		marketId: string
		threadId: string
		messageId: string
	}
): Promise<void> {
	await deps.db
		.update(pmMarkets)
		.set({
			discordThreadId: input.threadId,
			discordMessageId: input.messageId,
			updatedAt: new Date(),
		})
		.where(eq(pmMarkets.id, input.marketId))
}

export async function closeMarket(
	deps: PmDeps,
	input: { actorUserId: string; marketId: string }
): Promise<void> {
	try {
		await deps.db.transaction(async (tx) => {
			const [market] = await tx
				.select()
				.from(pmMarkets)
				.where(eq(pmMarkets.id, input.marketId))
				.for('update')
			if (!market) throw new PmError('MARKET_NOT_FOUND')
			assertTransition(market.status, 'closed')
			await tx
				.update(pmMarkets)
				.set({ status: 'closed', updatedAt: new Date() })
				.where(eq(pmMarkets.id, input.marketId))
			await logHistory(tx, {
				marketId: input.marketId,
				actorUserId: input.actorUserId,
				action: 'closed',
				previousStatus: market.status,
				newStatus: 'closed',
			})
		})
	} catch (error) {
		if (!isExpectedError(error)) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'closeMarket' },
			})
		}
		throw error
	}
}

/** Cron sweep: close all open markets whose close time has passed. */
export async function closeDueMarkets(
	deps: PmDeps,
	limit = 25
): Promise<{ closedMarketIds: string[] }> {
	const bounded = Math.min(Math.max(limit, 1), 100)
	try {
		// Bound the batch so a backlog of due markets can't blow the reconcile cron's wall-clock
		// budget; a large backlog drains over successive ticks.
		const due = await deps.db
			.select({ id: pmMarkets.id })
			.from(pmMarkets)
			.where(and(eq(pmMarkets.status, 'open'), sql`${pmMarkets.closesAt} <= now()`))
			.orderBy(asc(pmMarkets.closesAt))
			.limit(bounded)
		if (due.length === 0) return { closedMarketIds: [] }

		// Re-guard BOTH the status AND the due condition in the UPDATE: a market that transitioned
		// (status) or had its close time extended (admin updateMarket) between the select and the
		// update must not be clobbered. Re-checking closes_at <= now() makes an extended market
		// drop out. RETURNING yields the ids actually closed.
		const closed = await deps.db
			.update(pmMarkets)
			.set({ status: 'closed', updatedAt: new Date() })
			.where(
				and(
					inArray(
						pmMarkets.id,
						due.map((d) => d.id)
					),
					eq(pmMarkets.status, 'open'),
					sql`${pmMarkets.closesAt} <= now()`
				)
			)
			.returning({ id: pmMarkets.id })

		for (const market of closed) {
			await logHistory(deps.db, {
				marketId: market.id,
				action: 'closed',
				previousStatus: 'open',
				newStatus: 'closed',
				metadata: { auto: true },
			})
		}
		return { closedMarketIds: closed.map((m) => m.id) }
	} catch (error) {
		captureException(error as Error, {
			tags: { durableObject: 'PredictionMarketsDO', method: 'closeDueMarkets' },
		})
		throw error
	}
}

/**
 * Non-terminal markets with no forum post yet (`discord_thread_id IS NULL`), oldest first,
 * bounded — the reconcile cron's backfill work-list. Drafts and terminal (resolved/voided)
 * markets are excluded. `minAgeMinutes` skips very fresh markets whose create-route publish may
 * still be in flight, so the sweep doesn't race it into a duplicate post.
 */
export async function listMarketsNeedingPost(
	deps: PmDeps,
	limit = 25,
	minAgeMinutes = 2
): Promise<MarketDetail[]> {
	const bounded = Math.min(Math.max(limit, 1), 100)
	const maxCreatedAt = new Date(Date.now() - Math.max(minAgeMinutes, 0) * 60_000)
	const rows = await deps.db
		.select({ id: pmMarkets.id })
		.from(pmMarkets)
		.where(
			and(
				isNull(pmMarkets.discordThreadId),
				inArray(pmMarkets.status, ['open', 'closed', 'resolving']),
				lte(pmMarkets.createdAt, maxCreatedAt)
			)
		)
		.orderBy(asc(pmMarkets.createdAt))
		.limit(bounded)

	return buildMarketDetails(
		deps.db,
		rows.map((r) => r.id)
	)
}

/**
 * Ids of non-terminal markets that HAVE a forum post and were updated within the last
 * `sinceMinutes`, newest first, bounded — the reconcile cron's self-healing refresh work-list.
 * A post whose refresh failed (auto-close tag flip, or a live bet/resolve refresh) keeps a fresh
 * `updated_at`, so it stays in this set and is retried on the next tick until the edit lands.
 * Self-shrinking: once markets stop changing they age out of the window. Returns ids (not details)
 * so the caller re-reads current state just before editing — a stale detail could otherwise clobber
 * a market that went terminal mid-sweep.
 */
export async function listMarketsToRefresh(
	deps: PmDeps,
	sinceMinutes = 15,
	limit = 25
): Promise<string[]> {
	const bounded = Math.min(Math.max(limit, 1), 100)
	const cutoff = new Date(Date.now() - Math.max(sinceMinutes, 1) * 60_000)
	const rows = await deps.db
		.select({ id: pmMarkets.id })
		.from(pmMarkets)
		.where(
			and(
				isNotNull(pmMarkets.discordThreadId),
				inArray(pmMarkets.status, ['open', 'closed', 'resolving']),
				gte(pmMarkets.updatedAt, cutoff)
			)
		)
		.orderBy(desc(pmMarkets.updatedAt))
		.limit(bounded)

	return rows.map((r) => r.id)
}

/**
 * Terminal markets whose settlement result was never posted — the reconcile cron's settlement
 * self-heal work-list. Selects resolved/voided markets that have a forum post, are still
 * `settlementAnnouncedAt IS NULL`, and were last touched within `[now − maxAgeMinutes, now − minAgeMinutes]`.
 * The lower bound clears any in-flight live resolve request (the live path marks the flag right after
 * its post); the upper bound caps retries of a permanently-failing post and bounds the first-deploy
 * re-post window. Keyed off `updatedAt` as a proxy for the terminal-transition time: it's set at the
 * transition and normally not touched again for a terminal market (the refresh pass skips terminal
 * markets), the one exception being a rare `attachDiscordPost` backfill landing on a market that went
 * terminal mid-create — which only nudges `updatedAt` forward by ~one tick (both window bounds move
 * together), so it can delay a self-heal by seconds but never drop it.
 */
export async function listMarketsNeedingSettlementNotice(
	deps: PmDeps,
	limit = 25,
	minAgeMinutes = 15,
	maxAgeMinutes = 360
): Promise<MarketDetail[]> {
	const bounded = Math.min(Math.max(limit, 1), 100)
	const now = Date.now()
	const newestAllowed = new Date(now - Math.max(minAgeMinutes, 0) * 60_000)
	const oldestAllowed = new Date(now - Math.max(maxAgeMinutes, minAgeMinutes) * 60_000)
	const rows = await deps.db
		.select({ id: pmMarkets.id })
		.from(pmMarkets)
		.where(
			and(
				isNull(pmMarkets.settlementAnnouncedAt),
				isNotNull(pmMarkets.discordThreadId),
				inArray(pmMarkets.status, ['resolved', 'voided']),
				lte(pmMarkets.updatedAt, newestAllowed),
				gte(pmMarkets.updatedAt, oldestAllowed)
			)
		)
		.orderBy(asc(pmMarkets.updatedAt))
		.limit(bounded)

	return buildMarketDetails(
		deps.db,
		rows.map((r) => r.id)
	)
}

/**
 * Mark a terminal market's settlement notification as delivered. Idempotent and self-guarding:
 * the `settlementAnnouncedAt IS NULL` + terminal-status predicate means a live-path completion and a
 * racing reconcile self-heal converge on one flag, and it can never be set on a non-terminal market.
 * Deliberately does NOT bump `updatedAt` — the self-heal work-list keys off `updatedAt` as the
 * terminal-transition time, which must stay stable.
 */
export async function markSettlementAnnounced(deps: PmDeps, marketId: string): Promise<void> {
	await deps.db
		.update(pmMarkets)
		.set({ settlementAnnouncedAt: new Date() })
		.where(
			and(
				eq(pmMarkets.id, marketId),
				isNull(pmMarkets.settlementAnnouncedAt),
				inArray(pmMarkets.status, ['resolved', 'voided'])
			)
		)
}
