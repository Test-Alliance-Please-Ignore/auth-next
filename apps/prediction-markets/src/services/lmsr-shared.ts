/**
 * Shared helpers for the isolated LMSR services — the single home for LMSR-only cross-cutting logic
 * (audit history, ledger metadata, view mapping, the subsidy-reservation query), so create/trade/read
 * services never re-implement them. Money credit/debit reuse the SHARED `creditWallet`/`debitWallet`
 * primitives (services/shared.ts); this module holds only what is genuinely LMSR-specific.
 */

import { asc, eq, inArray, sql } from '@repo/db-utils'

import { lmsrMarketHistory, lmsrMarkets, lmsrOutcomes } from '../db/schema'
import { pricesBps } from '../lib/lmsr'
import { parseAmount } from '../lib/money'

import type { LmsrMarketDetail, LmsrMarketStatus, LmsrTradeResult, Visibility } from '@repo/prediction-markets'
import type { PmExecutor } from './context'
import type { LmsrMarket, LmsrOutcome, LmsrTrade } from '../db/schema'

/** The `metadata.source` marker on every LMSR ledger line (booked as the shared `adjustment` type). */
export const LMSR_LEDGER_SOURCE = 'lmsr'

/** Statuses whose subsidy still counts against the LMSR house's required reservation floor. */
const LIVE_LMSR_STATUSES = ['open', 'closed', 'resolving'] as const

export interface LmsrHistoryEntry {
	marketId: string
	actorUserId?: string | null
	action: string
	previousStatus?: LmsrMarketStatus | null
	newStatus?: LmsrMarketStatus | null
	visibility?: Visibility
	metadata?: unknown
}

/** Append one immutable row to `lmsr_market_history` (the LMSR-only audit trail). Mirrors the shared
 * `logHistory` but writes the LMSR table so parimutuel audit feeds are never polluted. */
export async function logLmsrHistory(executor: PmExecutor, entry: LmsrHistoryEntry): Promise<void> {
	await executor.insert(lmsrMarketHistory).values({
		marketId: entry.marketId,
		actorUserId: entry.actorUserId ?? null,
		action: entry.action,
		previousStatus: entry.previousStatus ?? null,
		newStatus: entry.newStatus ?? null,
		visibility: entry.visibility ?? 'public',
		metadata: entry.metadata ?? null,
	})
}

/** The `metadata` payload for an LMSR `pm_ledger` line, so the shared ledger stays disambiguable by
 * mechanism without a new ledger enum value (mirrors the awardRandomBonus `source: 'bonus'` pattern). */
export function lmsrLedgerMetadata(
	kind: 'buy' | 'sell' | 'payout' | 'subsidy',
	marketId: string,
	tradeId?: string
): Record<string, unknown> {
	return { source: LMSR_LEDGER_SOURCE, kind, marketId, ...(tradeId ? { tradeId } : {}) }
}

/** Sum the reserved subsidy across all currently-live LMSR markets — the house's required balance floor
 * (checked, never debited, at create). */
export async function sumLiveSubsidies(tx: PmExecutor): Promise<bigint> {
	const [row] = await tx
		.select({ total: sql<string>`coalesce(sum(${lmsrMarkets.subsidy}), 0)` })
		.from(lmsrMarkets)
		.where(inArray(lmsrMarkets.status, [...LIVE_LMSR_STATUSES]))
	return parseAmount(row.total)
}

/** Outcomes of a market, ordered by `sortOrder` — the stable index order the cost/price math relies on. */
export function loadLmsrOutcomes(executor: PmExecutor, marketId: string): Promise<LmsrOutcome[]> {
	return executor
		.select()
		.from(lmsrOutcomes)
		.where(eq(lmsrOutcomes.marketId, marketId))
		.orderBy(asc(lmsrOutcomes.sortOrder))
}

/** Map a market row + its outcomes into the RPC detail view, computing per-outcome implied prices. */
export function toLmsrMarketDetail(market: LmsrMarket, outcomes: LmsrOutcome[]): LmsrMarketDetail {
	const ordered = [...outcomes].sort((a, b) => a.sortOrder - b.sortOrder)
	const b = parseAmount(market.liquidityParam)
	const qs = ordered.map((o) => parseAmount(o.netShares))
	const prices = b > 0n ? pricesBps(qs, b) : ordered.map(() => 0)
	return {
		id: market.id,
		question: market.question,
		status: market.status,
		closesAt: market.closesAt.toISOString(),
		liquidityParam: market.liquidityParam,
		outcomeCount: market.outcomeCount,
		createdAt: market.createdAt.toISOString(),
		discordThreadId: market.discordThreadId,
		description: market.description,
		discordMessageId: market.discordMessageId,
		createdBy: market.createdBy,
		resolvesOn: market.resolvesOn ? market.resolvesOn.toISOString() : null,
		subsidy: market.subsidy,
		resolvedOutcomeId: market.resolvedOutcomeId,
		resolvedBy: market.resolvedBy,
		resolvedAt: market.resolvedAt ? market.resolvedAt.toISOString() : null,
		voidReason: market.voidReason,
		designatedResolverIds: market.designatedResolvers,
		outcomes: ordered.map((o, i) => ({
			id: o.id,
			label: o.label,
			netShares: o.netShares,
			sortOrder: o.sortOrder,
			priceBps: prices[i],
		})),
	}
}

/** Load a market + its outcomes and build the detail view, or null if the market is gone. */
export async function buildLmsrMarketDetail(
	executor: PmExecutor,
	marketId: string
): Promise<LmsrMarketDetail | null> {
	const [market] = await executor
		.select()
		.from(lmsrMarkets)
		.where(eq(lmsrMarkets.id, marketId))
		.limit(1)
	if (!market) return null
	const outcomes = await loadLmsrOutcomes(executor, marketId)
	return toLmsrMarketDetail(market, outcomes)
}

export function toLmsrTradeResult(trade: LmsrTrade): LmsrTradeResult {
	return {
		id: trade.id,
		marketId: trade.marketId,
		userId: trade.userId,
		outcomeId: trade.outcomeId,
		side: trade.side,
		shares: trade.shares,
		costPoints: trade.costPoints,
		createdAt: trade.createdAt.toISOString(),
	}
}
