/**
 * LMSR read paths: market detail, a no-money cost/price quote, and a user's open positions. Pure reads
 * over the lmsr_* tables + the fixed-point math library; they mutate nothing.
 */

import { and, desc, eq, sql } from '@repo/db-utils'

import { lmsrMarkets, lmsrOutcomes, lmsrPositions } from '../db/schema'
import { buyCost, pricesBps } from '../lib/lmsr'
import { formatAmount, isPositiveIntegerString, parseAmount } from '../lib/money'
import { buildLmsrMarketDetail, loadLmsrOutcomes } from './lmsr-shared'

import type { LmsrCostPreview, LmsrMarketDetail, LmsrPositionView } from '@repo/prediction-markets'
import type { PmDeps } from './context'

export async function getLmsrMarket(deps: PmDeps, marketId: string): Promise<LmsrMarketDetail | null> {
	return buildLmsrMarketDetail(deps.db, marketId)
}

/** Quote what a buy of `shares` would cost now, plus the outcome's current implied price. Read-only:
 * moves no money and takes no lock, so the quote is advisory (the executing buy re-prices under lock). */
export async function previewLmsrCost(
	deps: PmDeps,
	input: { marketId: string; outcomeId: string; shares: string }
): Promise<LmsrCostPreview | null> {
	if (!isPositiveIntegerString(input.shares)) return null
	const [market] = await deps.db
		.select()
		.from(lmsrMarkets)
		.where(eq(lmsrMarkets.id, input.marketId))
		.limit(1)
	if (!market) return null
	const outcomes = await loadLmsrOutcomes(deps.db, input.marketId)
	const k = outcomes.findIndex((o) => o.id === input.outcomeId)
	if (k < 0) return null

	const qs = outcomes.map((o) => parseAmount(o.netShares))
	const b = parseAmount(market.liquidityParam)
	const cost = buyCost(qs, k, parseAmount(input.shares), b)
	const prices = pricesBps(qs, b)
	return {
		marketId: input.marketId,
		outcomeId: input.outcomeId,
		shares: input.shares,
		cost: formatAmount(cost),
		priceBps: prices[k],
	}
}

export async function getUserLmsrPositions(
	deps: PmDeps,
	userId: string,
	opts?: { marketId?: string }
): Promise<LmsrPositionView[]> {
	const conditions = [eq(lmsrPositions.userId, userId), sql`${lmsrPositions.shares} <> 0`]
	if (opts?.marketId) conditions.push(eq(lmsrPositions.marketId, opts.marketId))
	const rows = await deps.db
		.select({
			marketId: lmsrPositions.marketId,
			outcomeId: lmsrPositions.outcomeId,
			shares: lmsrPositions.shares,
			outcomeLabel: lmsrOutcomes.label,
		})
		.from(lmsrPositions)
		.innerJoin(lmsrOutcomes, eq(lmsrOutcomes.id, lmsrPositions.outcomeId))
		.where(and(...conditions))
		.orderBy(desc(lmsrPositions.updatedAt))
	return rows.map((r) => ({
		marketId: r.marketId,
		outcomeId: r.outcomeId,
		outcomeLabel: r.outcomeLabel,
		shares: r.shares,
	}))
}
