import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from '@repo/db-utils'
import { EXCLUDED_WALLET_USER_IDS } from '@repo/prediction-markets'
import { parseDateOrNull } from '@repo/worker-utils'

import {
	pmBets,
	pmLedger,
	pmMarketHistory,
	pmMarketOutcomes,
	pmMarkets,
	pmWallets,
} from '../db/schema'
import { formatAmount, parseAmount } from '../lib/money'
import { buildMarketDetail, toBetResult, toGlobalLedgerRow, toMarketHistoryRow } from './shared'

import type {
	BetView,
	DetailedBetView,
	GlobalLedgerOpts,
	GlobalLedgerRow,
	LeaderboardRow,
	LedgerRow,
	ListMarketsFilter,
	ListWalletsOpts,
	MarketDetail,
	MarketHistoryOpts,
	MarketHistoryRow,
	MarketSettlement,
	MarketSummary,
	Paged,
	WalletRow,
} from '@repo/prediction-markets'
import type { PmDeps } from './context'

export async function getWalletBalance(deps: PmDeps, userId: string): Promise<{ balance: string }> {
	const [wallet] = await deps.db
		.select({ balance: pmWallets.balance })
		.from(pmWallets)
		.where(eq(pmWallets.userId, userId))
		.limit(1)
	return { balance: wallet?.balance ?? '0' }
}

export async function listMarkets(
	deps: PmDeps,
	filter?: ListMarketsFilter
): Promise<MarketSummary[]> {
	const limit = Math.min(filter?.limit ?? 25, 100)
	const rows = await deps.db
		.select({
			id: pmMarkets.id,
			question: pmMarkets.question,
			status: pmMarkets.status,
			closesAt: pmMarkets.closesAt,
			totalPool: pmMarkets.totalPool,
			createdAt: pmMarkets.createdAt,
			discordThreadId: pmMarkets.discordThreadId,
			outcomeCount: sql<number>`(select count(*)::int from ${pmMarketOutcomes} where ${pmMarketOutcomes.marketId} = ${pmMarkets.id})`,
		})
		.from(pmMarkets)
		.where(filter?.status ? eq(pmMarkets.status, filter.status) : undefined)
		.orderBy(desc(pmMarkets.createdAt))
		.limit(limit)

	return rows.map((r) => ({
		id: r.id,
		question: r.question,
		status: r.status,
		closesAt: r.closesAt.toISOString(),
		totalPool: r.totalPool,
		outcomeCount: r.outcomeCount,
		createdAt: r.createdAt.toISOString(),
		discordThreadId: r.discordThreadId,
	}))
}

export async function getMarket(deps: PmDeps, marketId: string): Promise<MarketDetail | null> {
	return buildMarketDetail(deps.db, marketId)
}

export async function getUserBets(
	deps: PmDeps,
	userId: string,
	opts?: { marketId?: string; activeOnly?: boolean }
): Promise<BetView[]> {
	const conditions = [eq(pmBets.userId, userId)]
	if (opts?.marketId) conditions.push(eq(pmBets.marketId, opts.marketId))
	if (opts?.activeOnly) conditions.push(eq(pmBets.status, 'active'))

	const rows = await deps.db
		.select()
		.from(pmBets)
		.where(and(...conditions))
		.orderBy(desc(pmBets.createdAt))
		.limit(200)
	return rows.map((b) => toBetResult(b))
}

/** A user's bets joined to market question + outcome label (for `/market mybets`). */
export async function getUserBetsDetailed(
	deps: PmDeps,
	userId: string,
	opts?: { activeOnly?: boolean }
): Promise<DetailedBetView[]> {
	const conditions = [eq(pmBets.userId, userId)]
	if (opts?.activeOnly) conditions.push(eq(pmBets.status, 'active'))

	const rows = await deps.db
		.select({
			id: pmBets.id,
			marketId: pmBets.marketId,
			marketQuestion: pmMarkets.question,
			outcomeLabel: pmMarketOutcomes.label,
			amount: pmBets.amount,
			status: pmBets.status,
			payoutAmount: pmBets.payoutAmount,
			createdAt: pmBets.createdAt,
		})
		.from(pmBets)
		.innerJoin(pmMarkets, eq(pmMarkets.id, pmBets.marketId))
		.innerJoin(pmMarketOutcomes, eq(pmMarketOutcomes.id, pmBets.outcomeId))
		.where(and(...conditions))
		.orderBy(desc(pmBets.createdAt))
		.limit(25)
	return rows.map((r) => ({
		id: r.id,
		marketId: r.marketId,
		marketQuestion: r.marketQuestion,
		outcomeLabel: r.outcomeLabel,
		amount: r.amount,
		status: r.status,
		payoutAmount: r.payoutAmount,
		createdAt: r.createdAt.toISOString(),
	}))
}

/**
 * Aggregate a market's financial settlement: overall totals + one net-result row per
 * participant. Reads every bet on the market (bounded by market size) and folds them by user —
 * a won bet returns its `payoutAmount`, a refunded bet returns its stake, a lost bet returns
 * nothing. Intended for a resolved/voided market; returns null if the market doesn't exist.
 */
export async function getMarketSettlement(
	deps: PmDeps,
	marketId: string
): Promise<MarketSettlement | null> {
	const [market] = await deps.db
		.select({
			status: pmMarkets.status,
			resolvedOutcomeId: pmMarkets.resolvedOutcomeId,
		})
		.from(pmMarkets)
		.where(eq(pmMarkets.id, marketId))
		.limit(1)
	if (!market) return null

	const bets = await deps.db
		.select({
			userId: pmBets.userId,
			amount: pmBets.amount,
			status: pmBets.status,
			payoutAmount: pmBets.payoutAmount,
		})
		.from(pmBets)
		.where(eq(pmBets.marketId, marketId))
		.orderBy(pmBets.userId)

	let totalStaked = 0n
	let totalPaidOut = 0n
	let totalLost = 0n
	const byUser = new Map<string, { staked: bigint; returned: bigint }>()
	for (const bet of bets) {
		const stake = parseAmount(bet.amount)
		// Money returned to the bettor: full payout for a win, stake back for a refund, nothing
		// for a loss. (An 'active' bet on an unsettled market returns nothing here.)
		let returned = 0n
		if (bet.status === 'won') returned = parseAmount(bet.payoutAmount)
		else if (bet.status === 'refunded') returned = stake
		else if (bet.status === 'lost') totalLost += stake

		totalStaked += stake
		totalPaidOut += returned
		const acc = byUser.get(bet.userId) ?? { staked: 0n, returned: 0n }
		acc.staked += stake
		acc.returned += returned
		byUser.set(bet.userId, acc)
	}

	const users = Array.from(byUser, ([userId, acc]) => ({
		userId,
		staked: formatAmount(acc.staked),
		returned: formatAmount(acc.returned),
		net: formatAmount(acc.returned - acc.staked),
	}))

	return {
		marketId,
		status: market.status,
		resolvedOutcomeId: market.resolvedOutcomeId,
		totalStaked: formatAmount(totalStaked),
		totalPaidOut: formatAmount(totalPaidOut),
		totalLost: formatAmount(totalLost),
		users,
	}
}

export async function getLeaderboard(
	deps: PmDeps,
	opts?: {
		window?: 'all' | '30d'
		limit?: number
	}
): Promise<LeaderboardRow[]> {
	const limit = Math.min(opts?.limit ?? 25, 100)
	const result = await deps.db.execute(sql`
		select w.user_id as "userId", w.balance as "balance",
			coalesce(
				(select sum(l.amount) from pm_ledger l
				 where l.user_id = w.user_id and l.type in ('wager','payout','refund')),
				0
			) as "netProfit"
		from pm_wallets w
		where w.user_id not in (${sql.join(EXCLUDED_WALLET_USER_IDS.map((id) => sql`${id}`), sql`, `)})
		order by w.balance desc
		limit ${limit}
	`)
	const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? []
	return rows.map((r) => ({
		userId: String(r.userId),
		balance: String(r.balance),
		netProfit: String(r.netProfit),
	}))
}

export async function getLedger(
	deps: PmDeps,
	userId: string,
	opts?: { limit?: number; cursor?: string }
): Promise<LedgerRow[]> {
	const limit = Math.min(opts?.limit ?? 50, 200)
	const rows = await deps.db
		.select()
		.from(pmLedger)
		.where(eq(pmLedger.userId, userId))
		.orderBy(desc(pmLedger.createdAt))
		.limit(limit)
	return rows.map((r) => ({
		id: r.id,
		amount: r.amount,
		type: r.type,
		marketId: r.marketId,
		betId: r.betId,
		balanceAfter: r.balanceAfter,
		createdAt: r.createdAt.toISOString(),
		metadata: r.metadata,
	}))
}

// ---- admin reads (offset + total) ----

export async function listWallets(deps: PmDeps, opts?: ListWalletsOpts): Promise<Paged<WalletRow>> {
	const limit = Math.min(Math.max(opts?.limit ?? 25, 1), 100)
	const offset = Math.max(opts?.offset ?? 0, 0)
	const column =
		opts?.sort === 'updatedAt'
			? pmWallets.updatedAt
			: opts?.sort === 'userId'
				? pmWallets.userId
				: pmWallets.balance
	const direction = opts?.order === 'asc' ? asc : desc
	// Internal accumulator wallets (the parimutuel SYSTEM house + the LMSR liquidity house) are not
	// user wallets — keep them out of the admin wallet grid (and its deposit/ledger actions). Their
	// entries still appear in the audit ledger. EXCLUDED_WALLET_USER_IDS is the single source shared
	// with getLeaderboard and awardRandomBonus so every house is filtered uniformly.
	const excludeHouses = notInArray(pmWallets.userId, [...EXCLUDED_WALLET_USER_IDS])
	const where = opts?.userIds?.length
		? and(inArray(pmWallets.userId, opts.userIds), excludeHouses)
		: excludeHouses

	const rows = await deps.db
		.select()
		.from(pmWallets)
		.where(where)
		.orderBy(direction(column), desc(pmWallets.userId))
		.limit(limit)
		.offset(offset)
	const [{ total }] = await deps.db
		.select({ total: sql<number>`count(*)::int` })
		.from(pmWallets)
		.where(where)

	return {
		rows: rows.map((w) => ({
			userId: w.userId,
			balance: w.balance,
			updatedAt: w.updatedAt.toISOString(),
		})),
		total,
	}
}

export async function getGlobalLedger(
	deps: PmDeps,
	opts?: GlobalLedgerOpts
): Promise<Paged<GlobalLedgerRow>> {
	const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200)
	const offset = Math.max(opts?.offset ?? 0, 0)
	const since = parseDateOrNull(opts?.since)
	const until = parseDateOrNull(opts?.until)
	const where = and(
		opts?.userId ? eq(pmLedger.userId, opts.userId) : undefined,
		opts?.type ? eq(pmLedger.type, opts.type) : undefined,
		opts?.marketId ? eq(pmLedger.marketId, opts.marketId) : undefined,
		since ? gte(pmLedger.createdAt, since) : undefined,
		until ? lte(pmLedger.createdAt, until) : undefined
	)

	const rows = await deps.db
		.select()
		.from(pmLedger)
		.where(where)
		.orderBy(desc(pmLedger.createdAt), desc(pmLedger.id))
		.limit(limit)
		.offset(offset)
	const [{ total }] = await deps.db
		.select({ total: sql<number>`count(*)::int` })
		.from(pmLedger)
		.where(where)

	return { rows: rows.map((r) => toGlobalLedgerRow(r)), total }
}

export async function getGlobalMarketHistory(
	deps: PmDeps,
	opts?: MarketHistoryOpts
): Promise<Paged<MarketHistoryRow>> {
	const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200)
	const offset = Math.max(opts?.offset ?? 0, 0)
	const since = parseDateOrNull(opts?.since)
	const until = parseDateOrNull(opts?.until)
	const where = and(
		opts?.marketId ? eq(pmMarketHistory.marketId, opts.marketId) : undefined,
		// Default to public-only; internal rows (e.g. bet_placed) carry bettor identity.
		opts?.includeInternal ? undefined : eq(pmMarketHistory.visibility, 'public'),
		since ? gte(pmMarketHistory.createdAt, since) : undefined,
		until ? lte(pmMarketHistory.createdAt, until) : undefined
	)

	const rows = await deps.db
		.select()
		.from(pmMarketHistory)
		.where(where)
		.orderBy(desc(pmMarketHistory.createdAt), desc(pmMarketHistory.id))
		.limit(limit)
		.offset(offset)
	const [{ total }] = await deps.db
		.select({ total: sql<number>`count(*)::int` })
		.from(pmMarketHistory)
		.where(where)

	return { rows: rows.map((r) => toMarketHistoryRow(r)), total }
}

export async function getMarketHistory(
	deps: PmDeps,
	marketId: string,
	opts?: { includeInternal?: boolean; limit?: number; offset?: number }
): Promise<Paged<MarketHistoryRow>> {
	return getGlobalMarketHistory(deps, {
		marketId,
		includeInternal: opts?.includeInternal ?? false,
		limit: opts?.limit,
		offset: opts?.offset,
	})
}
