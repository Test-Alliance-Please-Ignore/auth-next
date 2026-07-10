import { and, desc, eq, sql } from '@repo/db-utils'

import {
	pmBets,
	pmConfig,
	pmMarketHistory,
	pmMarketOutcomes,
	pmMarkets,
	pmRateLimits,
} from '../db/schema'
import { parseAmount } from '../lib/money'
import { RATE_BUDGETS } from '../lib/rate-limit'

import type {
	BetResult,
	GlobalLedgerRow,
	MarketDetail,
	MarketHistoryRow,
	PmConfigView,
} from '@repo/prediction-markets'
import type { PmBet, PmConfig, PmLedgerRow, PmMarket, PmMarketHistoryRow } from '../db/schema'
import type { HistoryEntry, PmDatabase, PmExecutor, PmTransaction } from './context'

export async function logHistory(executor: PmExecutor, entry: HistoryEntry): Promise<void> {
	await executor.insert(pmMarketHistory).values({
		marketId: entry.marketId,
		actorUserId: entry.actorUserId ?? null,
		action: entry.action,
		previousStatus: entry.previousStatus ?? null,
		newStatus: entry.newStatus ?? null,
		visibility: entry.visibility ?? 'public',
		metadata: entry.metadata ?? null,
	})
}

export async function buildMarketDetail(
	executor: PmExecutor,
	marketId: string
): Promise<MarketDetail | null> {
	const [market] = await executor
		.select()
		.from(pmMarkets)
		.where(eq(pmMarkets.id, marketId))
		.limit(1)
	if (!market) return null

	const outcomes = await executor
		.select()
		.from(pmMarketOutcomes)
		.where(eq(pmMarketOutcomes.marketId, marketId))
		.orderBy(pmMarketOutcomes.sortOrder)

	const total = parseAmount(market.totalPool)
	return {
		id: market.id,
		question: market.question,
		description: market.description,
		status: market.status,
		createdBy: market.createdBy,
		closesAt: market.closesAt.toISOString(),
		totalPool: market.totalPool,
		outcomeCount: outcomes.length,
		createdAt: market.createdAt.toISOString(),
		discordThreadId: market.discordThreadId,
		discordMessageId: market.discordMessageId,
		rakeBps: market.rakeBps,
		minStake: market.minStake,
		maxStake: market.maxStake,
		perUserCap: market.perUserCap,
		twoOfN: market.twoOfN,
		resolvesOn: market.resolvesOn ? market.resolvesOn.toISOString() : null,
		resolvedOutcomeId: market.resolvedOutcomeId,
		resolvedBy: market.resolvedBy,
		resolvedAt: market.resolvedAt ? market.resolvedAt.toISOString() : null,
		voidReason: market.voidReason,
		designatedResolverIds: market.designatedResolvers,
		outcomes: outcomes.map((o) => ({
			id: o.id,
			label: o.label,
			poolAmount: o.poolAmount,
			sortOrder: o.sortOrder,
			impliedOddsBps: total > 0n ? Number((parseAmount(o.poolAmount) * 10_000n) / total) : null,
		})),
	}
}

/** Build full details for a list of market ids, skipping any that vanished. */
export async function buildMarketDetails(
	db: PmDatabase,
	marketIds: string[]
): Promise<MarketDetail[]> {
	const details: MarketDetail[] = []
	for (const id of marketIds) {
		const detail = await buildMarketDetail(db, id)
		if (detail) details.push(detail)
	}
	return details
}

export async function sumStakes(
	tx: PmTransaction,
	marketId: string,
	outcomeId?: string
): Promise<bigint> {
	const conditions = [eq(pmBets.marketId, marketId), eq(pmBets.status, 'active')]
	if (outcomeId) conditions.push(eq(pmBets.outcomeId, outcomeId))
	const [row] = await tx
		.select({ total: sql<string>`coalesce(sum(${pmBets.amount}), 0)` })
		.from(pmBets)
		.where(and(...conditions))
	return parseAmount(row.total)
}

export async function hasPosition(
	tx: PmTransaction,
	marketId: string,
	userId: string
): Promise<boolean> {
	const [row] = await tx
		.select({ n: sql<number>`count(*)::int` })
		.from(pmBets)
		.where(and(eq(pmBets.marketId, marketId), eq(pmBets.userId, userId)))
	return (row?.n ?? 0) > 0
}

export async function requiresTwoOfN(tx: PmTransaction, market: PmMarket): Promise<boolean> {
	if (market.twoOfN) return true
	const [cfg] = await tx
		.select({ threshold: pmConfig.twoOfNThreshold })
		.from(pmConfig)
		.where(eq(pmConfig.isActive, true))
		.orderBy(desc(pmConfig.effectiveFrom))
		.limit(1)
	if (cfg?.threshold != null) {
		return parseAmount(market.totalPool) >= parseAmount(cfg.threshold)
	}
	return false
}

/** The single active config row (WHERE is_active ORDER BY effective_from DESC LIMIT 1), or undefined. */
export async function readActiveConfig(db: PmDatabase): Promise<PmConfig | undefined> {
	const [cfg] = await db
		.select()
		.from(pmConfig)
		.where(eq(pmConfig.isActive, true))
		.orderBy(desc(pmConfig.effectiveFrom))
		.limit(1)
	return cfg
}

/**
 * Consume one unit of a user's fixed-window budget for `command`. Atomic committed upsert
 * (a single Postgres row per user+command, row-lock-serialized) — safe under the DO's
 * yield-at-await concurrency. SQL mirrors `nextRateState`. Unknown command ⇒ unlimited.
 */
export async function consumeRateBudget(
	db: PmDatabase,
	userId: string,
	command: string
): Promise<{ allowed: boolean; retryAfterMs: number }> {
	const budget = RATE_BUDGETS[command]
	if (!budget) return { allowed: true, retryAfterMs: 0 }
	// `<=` (not `<`) so this exactly mirrors nextRateState's `elapsed >= windowMs` at the boundary.
	const expired = sql`${pmRateLimits.windowStart} <= now() - (interval '1 millisecond' * ${budget.windowMs})`
	const [row] = await db
		.insert(pmRateLimits)
		.values({ userId, command, windowStart: new Date(), count: 1 })
		.onConflictDoUpdate({
			target: [pmRateLimits.userId, pmRateLimits.command],
			set: {
				count: sql`case when ${expired} then 1 else ${pmRateLimits.count} + 1 end`,
				windowStart: sql`case when ${expired} then now() else ${pmRateLimits.windowStart} end`,
			},
		})
		.returning({ count: pmRateLimits.count, windowStart: pmRateLimits.windowStart })
	const allowed = row.count <= budget.limit
	const retryAfterMs = allowed
		? 0
		: Math.max(0, row.windowStart.getTime() + budget.windowMs - Date.now())
	return { allowed, retryAfterMs }
}

export function toBetResult(bet: PmBet): BetResult {
	return {
		id: bet.id,
		marketId: bet.marketId,
		outcomeId: bet.outcomeId,
		userId: bet.userId,
		amount: bet.amount,
		status: bet.status,
		payoutAmount: bet.payoutAmount,
		createdAt: bet.createdAt.toISOString(),
	}
}

export function toConfigView(row: PmConfig): PmConfigView {
	return {
		defaultRakeBps: row.defaultRakeBps,
		defaultMinStake: row.defaultMinStake,
		twoOfNThreshold: row.twoOfNThreshold,
		creatorRewardMinBps: row.creatorRewardMinBps,
		creatorRewardMaxBps: row.creatorRewardMaxBps,
		effectiveFrom: row.effectiveFrom.toISOString(),
		actorUserId: row.actorUserId,
		changeNote: row.changeNote,
		configured: true,
	}
}

export function toGlobalLedgerRow(r: PmLedgerRow): GlobalLedgerRow {
	return {
		id: r.id,
		userId: r.userId,
		amount: r.amount,
		type: r.type,
		marketId: r.marketId,
		betId: r.betId,
		balanceAfter: r.balanceAfter,
		idempotencyKey: r.idempotencyKey,
		metadata: r.metadata,
		createdAt: r.createdAt.toISOString(),
	}
}

export function toMarketHistoryRow(r: PmMarketHistoryRow): MarketHistoryRow {
	return {
		id: r.id,
		marketId: r.marketId,
		actorUserId: r.actorUserId,
		action: r.action,
		previousStatus: r.previousStatus,
		newStatus: r.newStatus,
		visibility: r.visibility,
		metadata: r.metadata,
		createdAt: r.createdAt.toISOString(),
	}
}
