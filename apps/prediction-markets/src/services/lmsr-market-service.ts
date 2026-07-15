/**
 * LMSR market creation. Mirrors the parimutuel `createMarket` structure (validation → rate limit →
 * transaction) and REUSES the shared validation helpers (parseDateOrNull, exceedsMaxOpenDuration,
 * designated-resolvers, money validators) and generic error codes, so nothing is re-implemented. The
 * LMSR-specific parts are the liquidity param `b`, the `ceil(b·ln n)` subsidy, and the house-solvency
 * reservation check.
 */

import { eq } from '@repo/db-utils'
import { captureException } from '@repo/hono-helpers'
import { LMSR_HOUSE_WALLET_USER_ID } from '@repo/prediction-markets'
import { parseDateOrNull } from '@repo/worker-utils'

import { lmsrMarkets, lmsrOutcomes, pmWallets } from '../db/schema'
import { isDesignatedResolver, normalizeDesignatedResolvers } from '../lib/designated-resolvers'
import { isExpectedError, PmError } from '../lib/errors'
import { subsidyPoints } from '../lib/lmsr'
import { exceedsMaxOpenDuration } from '../lib/market-duration'
import { formatAmount, isPositiveIntegerString, parseAmount } from '../lib/money'
import { buildLmsrMarketDetail, logLmsrHistory, sumLiveSubsidies } from './lmsr-shared'
import { consumeRateBudget } from './shared'

import type { CreateLmsrMarketInput, LmsrMarketDetail } from '@repo/prediction-markets'
import type { PmDeps } from './context'

/** Cap outcomes at 20 (same as parimutuel) so a later Discord embed/button surface can't overflow. */
const MAX_LMSR_OUTCOMES = 20

export async function createLmsrMarket(
	deps: PmDeps,
	input: CreateLmsrMarketInput
): Promise<LmsrMarketDetail> {
	const labels = input.outcomes.map((o) => o.trim()).filter(Boolean)
	if (labels.length < 2) throw new PmError('AT_LEAST_TWO_OUTCOMES')
	if (labels.length > MAX_LMSR_OUTCOMES) throw new PmError('TOO_MANY_OUTCOMES')
	if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
		throw new PmError('DUPLICATE_OUTCOMES')
	}
	if (!input.question.trim()) throw new PmError('QUESTION_REQUIRED')
	if (!isPositiveIntegerString(input.liquidityParam)) throw new PmError('LMSR_INVALID_B')
	const closesAt = parseDateOrNull(input.closesAt)
	if (!closesAt) throw new PmError('INVALID_CLOSES_AT')
	const resolvesOn = parseDateOrNull(input.resolvesOn)
	if (!resolvesOn) throw new PmError('INVALID_RESOLVES_ON')
	if (resolvesOn.getTime() < closesAt.getTime()) throw new PmError('RESOLVES_ON_BEFORE_CLOSE')
	// Non-admin markets are capped in how long they may stay open (fail-closed; site admins are exempt).
	if (!input.createdByAdmin && exceedsMaxOpenDuration(closesAt, Date.now())) {
		throw new PmError('MARKET_DURATION_TOO_LONG')
	}

	// Designated resolvers (optional). Core validates tier-membership + creator-exclusion; the DO
	// re-enforces the creator-exclusion backstop. LMSR defers two-of-N, so a size-1 designated set is
	// allowed (single-resolver authority) — no DESIGNATED_RESOLVERS_INSUFFICIENT_FOR_TWO_OF_N guard.
	const designatedResolvers = normalizeDesignatedResolvers(input.designatedResolverIds)
	if (designatedResolvers && isDesignatedResolver(designatedResolvers, input.createdBy)) {
		throw new PmError('CREATOR_IS_RESOLVER')
	}

	const b = parseAmount(input.liquidityParam)
	const n = labels.length
	const subsidy = subsidyPoints(b, n)

	if (input.enforceRateLimit) {
		const rate = await consumeRateBudget(deps.db, input.createdBy, 'lmsr_create')
		if (!rate.allowed) throw new PmError('RATE_LIMITED', { detail: rate.retryAfterMs })
	}

	try {
		return await deps.db.transaction(async (tx) => {
			// Lock the LMSR house wallet FOR UPDATE so the reservation check is atomic against concurrent
			// creates. The required floor is the combined subsidy of every live LMSR market PLUS this new
			// one; buys only raise the house balance, and each resolution lowers balance and committed
			// subsidy by matched amounts, so holding this floor guarantees the house is never insolvent.
			// NO points move at create — the subsidy is a solvency reservation, not a transfer (debiting
			// it would remove points from Σ wallets and break global conservation).
			const [house] = await tx
				.select({ balance: pmWallets.balance })
				.from(pmWallets)
				.where(eq(pmWallets.userId, LMSR_HOUSE_WALLET_USER_ID))
				.for('update')
				.limit(1)
			const houseBalance = parseAmount(house?.balance)
			const committed = await sumLiveSubsidies(tx)
			if (houseBalance < committed + subsidy) {
				throw new PmError('LMSR_HOUSE_UNDERFUNDED')
			}

			const [market] = await tx
				.insert(lmsrMarkets)
				.values({
					question: input.question.trim(),
					description: input.description?.trim() ?? null,
					status: 'open',
					createdBy: input.createdBy,
					closesAt,
					resolvesOn,
					liquidityParam: formatAmount(b),
					outcomeCount: n,
					subsidy: formatAmount(subsidy),
					designatedResolvers: designatedResolvers ?? null,
				})
				.returning()

			await tx
				.insert(lmsrOutcomes)
				.values(labels.map((label, i) => ({ marketId: market.id, label, sortOrder: i })))

			await logLmsrHistory(tx, {
				marketId: market.id,
				actorUserId: input.createdBy,
				action: 'lmsr_market_created',
				newStatus: 'open',
				metadata: {
					outcomes: labels,
					liquidityParam: formatAmount(b),
					subsidy: formatAmount(subsidy),
					designatedResolvers: designatedResolvers ?? null,
				},
			})

			const detail = await buildLmsrMarketDetail(tx, market.id)
			// Impossible (just inserted) — satisfies the non-null return type without an unsafe cast.
			if (!detail) throw new PmError('LMSR_MARKET_NOT_FOUND', { expected: false })
			return detail
		})
	} catch (error) {
		if (!isExpectedError(error)) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'createLmsrMarket' },
			})
		}
		throw error
	}
}
