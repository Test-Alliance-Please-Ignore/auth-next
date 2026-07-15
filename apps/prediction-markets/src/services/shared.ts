import { and, desc, eq, sql } from '@repo/db-utils'

import {
	pmBets,
	pmConfig,
	pmLedger,
	pmMarketHistory,
	pmMarketOutcomes,
	pmMarkets,
	pmRateLimits,
	pmWallets,
} from '../db/schema'
import { formatAmount, parseAmount } from '../lib/money'
import { RATE_BUDGETS } from '../lib/rate-limit'

import type {
	BetResult,
	GlobalLedgerRow,
	MarketDetail,
	MarketHistoryRow,
	PmConfigView,
} from '@repo/prediction-markets'
import type {
	NewPmLedgerRow,
	PmBet,
	PmConfig,
	PmLedgerRow,
	PmMarket,
	PmMarketHistoryRow,
} from '../db/schema'
import type { HistoryEntry, PmDatabase, PmExecutor, PmTransaction } from './context'

/**
 * The single audited money-credit primitive. Optionally lazily creates the wallet row, applies one
 * atomic balance increment, and appends the matching `pm_ledger` line carrying the running
 * `balanceAfter`. Every credit (payout / refund / creator_reward / rake / burn / grant) routes
 * through here so the credit-then-record invariant — and the balanceAfter snapshot — lives in
 * exactly one place rather than being hand-rolled per call site.
 *
 * `amount` is a non-negative points bigint. Because every caller has already ensured (or is about
 * to ensure) the wallet exists, `credited` is always present; the `?? null` fallbacks are defensive.
 * Returns the post-credit balance string (null only if the wallet row vanished mid-transaction).
 */
export async function creditWallet(
	tx: PmExecutor,
	args: {
		userId: string
		amount: bigint
		type: NewPmLedgerRow['type']
		marketId?: string
		betId?: string
		idempotencyKey?: string
		metadata?: unknown
		/** Lazily `INSERT ... ON CONFLICT DO NOTHING` the wallet row first (default true). Pass false
		 * when the caller has already created/locked the wallet in this transaction. */
		ensureWallet?: boolean
	}
): Promise<{ balanceAfter: string | null }> {
	const {
		userId,
		amount,
		type,
		marketId,
		betId,
		idempotencyKey,
		metadata,
		ensureWallet = true,
	} = args
	if (ensureWallet) {
		await tx.insert(pmWallets).values({ userId, balance: '0' }).onConflictDoNothing()
	}
	const formatted = formatAmount(amount)
	const [credited] = await tx
		.update(pmWallets)
		.set({ balance: sql`${pmWallets.balance} + ${formatted}::numeric`, updatedAt: new Date() })
		.where(eq(pmWallets.userId, userId))
		.returning({ balance: pmWallets.balance })
	await tx.insert(pmLedger).values({
		userId,
		amount: formatted,
		type,
		marketId: marketId ?? null,
		betId: betId ?? null,
		balanceAfter: credited?.balance ?? null,
		idempotencyKey: idempotencyKey ?? null,
		metadata: metadata ?? null,
	})
	return { balanceAfter: credited?.balance ?? null }
}

/**
 * The single audited money-DEBIT primitive — the guarded, overdraft-safe mirror of {@link creditWallet}.
 *
 * Atomically decrements the balance only if it covers `amount` (the guard lives INSIDE the WHERE, so
 * 0 affected rows means insufficient funds — also covering a wallet row that does not exist, which can
 * never be debited); on success it appends the matching NEGATIVE `pm_ledger` line carrying the running
 * `balanceAfter`. Returns `null` on insufficient funds so the caller throws the appropriate PmError.
 *
 * This is the reusable form of the guarded-debit idiom that placeBet/awardRandomBonus currently inline;
 * new money paths (LMSR) route through it so the debit-then-record invariant lives in one place.
 */
export async function debitWallet(
	tx: PmExecutor,
	args: {
		userId: string
		amount: bigint
		type: NewPmLedgerRow['type']
		marketId?: string
		betId?: string
		idempotencyKey?: string
		metadata?: unknown
	}
): Promise<{ balanceAfter: string } | null> {
	const { userId, amount, type, marketId, betId, idempotencyKey, metadata } = args
	const formatted = formatAmount(amount)
	const debited = await tx
		.update(pmWallets)
		.set({ balance: sql`${pmWallets.balance} - ${formatted}::numeric`, updatedAt: new Date() })
		.where(and(eq(pmWallets.userId, userId), sql`${pmWallets.balance} >= ${formatted}::numeric`))
		.returning({ balance: pmWallets.balance })
	if (debited.length === 0) return null
	await tx.insert(pmLedger).values({
		userId,
		amount: formatAmount(-amount),
		type,
		marketId: marketId ?? null,
		betId: betId ?? null,
		balanceAfter: debited[0].balance,
		idempotencyKey: idempotencyKey ?? null,
		metadata: metadata ?? null,
	})
	return { balanceAfter: debited[0].balance }
}

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
