import { DurableObject } from 'cloudflare:workers'

import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from '@repo/db-utils'
import { captureException } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'

import { createDb } from './db'
import {
	pmBets,
	pmConfig,
	pmLedger,
	pmMarketHistory,
	pmMarketOutcomes,
	pmMarkets,
	pmRateLimits,
	pmResolutionProposals,
	pmWallets,
} from './db/schema'
import { formatAmount, isPositiveIntegerString, negateAmount, parseAmount } from './lib/money'
import { RATE_BUDGETS } from './lib/rate-limit'
import { computeResolution } from './lib/payout'
import { assertTransition, isTerminal } from './lib/state-machine'

import type {
	BetResult,
	BetView,
	CreateMarketInput,
	GlobalLedgerOpts,
	GlobalLedgerRow,
	GrantPointsInput,
	LeaderboardRow,
	LedgerRow,
	ListMarketsFilter,
	ListWalletsOpts,
	MarketDetail,
	MarketHistoryOpts,
	MarketHistoryRow,
	MarketStatus,
	MarketSummary,
	Paged,
	PlaceBetInput,
	PredictionMarkets,
	ResolveResult,
	Visibility,
	WalletRow,
} from '@repo/prediction-markets'
import type { Env } from './context'
import type { PmBet, PmLedgerRow, PmMarket, PmMarketHistoryRow } from './db/schema'

type PmDatabase = ReturnType<typeof createDb>
type PmTransaction = Parameters<Parameters<PmDatabase['transaction']>[0]>[0]
type PmExecutor = PmDatabase | PmTransaction

interface HistoryEntry {
	marketId: string
	actorUserId?: string | null
	action: string
	previousStatus?: MarketStatus | null
	newStatus?: MarketStatus | null
	visibility?: Visibility
	metadata?: unknown
}

/** placeBet throws these on normal user-facing rejections — not paged to Sentry. */
const EXPECTED_BET_ERRORS = new Set([
	'MARKET_NOT_FOUND',
	'MARKET_NOT_OPEN',
	'MARKET_CLOSED',
	'OUTCOME_NOT_FOUND',
	'STAKE_BELOW_MIN',
	'STAKE_ABOVE_MAX',
	'PER_USER_CAP_EXCEEDED',
	'INSUFFICIENT_FUNDS',
])

/**
 * Prediction Markets Durable Object.
 *
 * A single ('default') instance holds the Neon WebSocket pool (built once in the
 * constructor) and serves all reads + writes. Postgres row locks (`FOR UPDATE`) and
 * atomic guarded updates provide correctness; the DO's single-threaded execution is a
 * backstop. Money is `numeric` in the DB (strings in JS) and computed with BigInt.
 *
 * Per CLAUDE.md: this DO never derives entity ids from `state.id` — every method takes
 * ids as parameters and every query is WHERE-filtered by them.
 */
export class PredictionMarketsDO extends DurableObject<Env> implements PredictionMarkets {
	private db: PmDatabase

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	// =====================================================================
	// Reads
	// =====================================================================

	async getWalletBalance(userId: string): Promise<{ balance: string }> {
		const [wallet] = await this.db
			.select({ balance: pmWallets.balance })
			.from(pmWallets)
			.where(eq(pmWallets.userId, userId))
			.limit(1)
		return { balance: wallet?.balance ?? '0' }
	}

	async listMarkets(filter?: ListMarketsFilter): Promise<MarketSummary[]> {
		const limit = Math.min(filter?.limit ?? 25, 100)
		const rows = await this.db
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

	async getMarket(marketId: string): Promise<MarketDetail | null> {
		return this.buildMarketDetail(this.db, marketId)
	}

	async getUserBets(
		userId: string,
		opts?: { marketId?: string; activeOnly?: boolean }
	): Promise<BetView[]> {
		const conditions = [eq(pmBets.userId, userId)]
		if (opts?.marketId) conditions.push(eq(pmBets.marketId, opts.marketId))
		if (opts?.activeOnly) conditions.push(eq(pmBets.status, 'active'))

		const rows = await this.db
			.select()
			.from(pmBets)
			.where(and(...conditions))
			.orderBy(desc(pmBets.createdAt))
			.limit(200)
		return rows.map((b) => this.toBetResult(b))
	}

	async getLeaderboard(opts?: {
		window?: 'all' | '30d'
		limit?: number
	}): Promise<LeaderboardRow[]> {
		const limit = Math.min(opts?.limit ?? 25, 100)
		const result = await this.db.execute(sql`
			select w.user_id as "userId", w.balance as "balance",
				coalesce(
					(select sum(l.amount) from pm_ledger l
					 where l.user_id = w.user_id and l.type in ('wager','payout','refund')),
					0
				) as "netProfit"
			from pm_wallets w
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

	async getLedger(
		userId: string,
		opts?: { limit?: number; cursor?: string }
	): Promise<LedgerRow[]> {
		const limit = Math.min(opts?.limit ?? 50, 200)
		const rows = await this.db
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

	async listWallets(opts?: ListWalletsOpts): Promise<Paged<WalletRow>> {
		const limit = Math.min(Math.max(opts?.limit ?? 25, 1), 100)
		const offset = Math.max(opts?.offset ?? 0, 0)
		const column =
			opts?.sort === 'updatedAt'
				? pmWallets.updatedAt
				: opts?.sort === 'userId'
					? pmWallets.userId
					: pmWallets.balance
		const direction = opts?.order === 'asc' ? asc : desc
		const where = opts?.userIds?.length ? inArray(pmWallets.userId, opts.userIds) : undefined

		const rows = await this.db
			.select()
			.from(pmWallets)
			.where(where)
			.orderBy(direction(column), desc(pmWallets.userId))
			.limit(limit)
			.offset(offset)
		const [{ total }] = await this.db
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

	async getGlobalLedger(opts?: GlobalLedgerOpts): Promise<Paged<GlobalLedgerRow>> {
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

		const rows = await this.db
			.select()
			.from(pmLedger)
			.where(where)
			.orderBy(desc(pmLedger.createdAt), desc(pmLedger.id))
			.limit(limit)
			.offset(offset)
		const [{ total }] = await this.db
			.select({ total: sql<number>`count(*)::int` })
			.from(pmLedger)
			.where(where)

		return { rows: rows.map((r) => this.toGlobalLedgerRow(r)), total }
	}

	async getGlobalMarketHistory(opts?: MarketHistoryOpts): Promise<Paged<MarketHistoryRow>> {
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

		const rows = await this.db
			.select()
			.from(pmMarketHistory)
			.where(where)
			.orderBy(desc(pmMarketHistory.createdAt), desc(pmMarketHistory.id))
			.limit(limit)
			.offset(offset)
		const [{ total }] = await this.db
			.select({ total: sql<number>`count(*)::int` })
			.from(pmMarketHistory)
			.where(where)

		return { rows: rows.map((r) => this.toMarketHistoryRow(r)), total }
	}

	async getMarketHistory(
		marketId: string,
		opts?: { includeInternal?: boolean; limit?: number; offset?: number }
	): Promise<Paged<MarketHistoryRow>> {
		return this.getGlobalMarketHistory({
			marketId,
			includeInternal: opts?.includeInternal ?? false,
			limit: opts?.limit,
			offset: opts?.offset,
		})
	}

	// =====================================================================
	// Writes
	// =====================================================================

	async grantPoints(input: GrantPointsInput): Promise<{ balance: string; deduped: boolean }> {
		if (!isPositiveIntegerString(input.amount)) {
			throw new Error('INVALID_AMOUNT')
		}
		if (!input.reason?.trim()) {
			throw new Error('REASON_REQUIRED')
		}
		// Defense-in-depth: the route also blocks this, but never let an admin fund their own wallet.
		if (input.actorUserId === input.targetUserId) {
			throw new Error('SELF_TARGET_FORBIDDEN')
		}
		try {
			return await this.db.transaction(async (tx) => {
				// Idempotent grant: a repeated key must match the original (user, amount, type),
				// otherwise a reused/forged key would silently drop a real deposit.
				if (input.idempotencyKey) {
					const [existing] = await tx
						.select()
						.from(pmLedger)
						.where(eq(pmLedger.idempotencyKey, input.idempotencyKey))
						.limit(1)
					if (existing) {
						const same =
							existing.type === 'grant' &&
							existing.userId === input.targetUserId &&
							parseAmount(existing.amount) === parseAmount(input.amount)
						if (!same) {
							throw new Error('IDEMPOTENCY_KEY_CONFLICT')
						}
						const [wallet] = await tx
							.select({ balance: pmWallets.balance })
							.from(pmWallets)
							.where(eq(pmWallets.userId, input.targetUserId))
							.limit(1)
						return { balance: wallet?.balance ?? '0', deduped: true }
					}
				}

				await tx
					.insert(pmWallets)
					.values({ userId: input.targetUserId, balance: '0' })
					.onConflictDoNothing()

				const [credited] = await tx
					.update(pmWallets)
					.set({
						balance: sql`${pmWallets.balance} + ${input.amount}::numeric`,
						updatedAt: new Date(),
					})
					.where(eq(pmWallets.userId, input.targetUserId))
					.returning({ balance: pmWallets.balance })

				await tx.insert(pmLedger).values({
					userId: input.targetUserId,
					amount: input.amount,
					type: 'grant',
					balanceAfter: credited.balance,
					idempotencyKey: input.idempotencyKey ?? null,
					metadata: { actorUserId: input.actorUserId, reason: input.reason },
				})

				return { balance: credited.balance, deduped: false }
			})
		} catch (error) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'grantPoints' },
			})
			throw error
		}
	}

	async createMarket(input: CreateMarketInput): Promise<MarketDetail> {
		const labels = input.outcomes.map((o) => o.trim()).filter(Boolean)
		if (labels.length < 2) throw new Error('AT_LEAST_TWO_OUTCOMES')
		if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
			throw new Error('DUPLICATE_OUTCOMES')
		}
		if (!input.question.trim()) throw new Error('QUESTION_REQUIRED')
		const closesAt = parseDateOrNull(input.closesAt)
		if (!closesAt) throw new Error('INVALID_CLOSES_AT')
		if (input.rakeBps != null && (input.rakeBps < 0 || input.rakeBps > 2000)) {
			throw new Error('INVALID_RAKE')
		}
		if (input.minStake != null && !isPositiveIntegerString(input.minStake)) {
			throw new Error('INVALID_MIN_STAKE')
		}
		if (input.maxStake != null && !isPositiveIntegerString(input.maxStake)) {
			throw new Error('INVALID_MAX_STAKE')
		}
		if (input.perUserCap != null && !isPositiveIntegerString(input.perUserCap)) {
			throw new Error('INVALID_PER_USER_CAP')
		}

		try {
			return await this.db.transaction(async (tx) => {
				const [cfg] = await tx
					.select()
					.from(pmConfig)
					.where(eq(pmConfig.isActive, true))
					.orderBy(desc(pmConfig.effectiveFrom))
					.limit(1)

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
						rakeBps,
						minStake,
						maxStake: input.maxStake ?? null,
						perUserCap: input.perUserCap ?? null,
						twoOfN: input.twoOfN ?? false,
					})
					.returning()

				await tx
					.insert(pmMarketOutcomes)
					.values(labels.map((label, i) => ({ marketId: market.id, label, sortOrder: i })))

				await this.logHistory(tx, {
					marketId: market.id,
					actorUserId: input.createdBy,
					action: 'created',
					newStatus: 'open',
					metadata: { outcomes: labels },
				})

				const detail = await this.buildMarketDetail(tx, market.id)
				if (!detail) throw new Error('MARKET_CREATE_FAILED')
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
	 * Persist the Discord forum post mapping after Core creates the post. Pure UPDATE —
	 * the PM DO never calls Discord; Core orchestrates the post and writes the ids back here.
	 */
	async attachDiscordPost(input: {
		marketId: string
		threadId: string
		messageId: string
	}): Promise<void> {
		await this.db
			.update(pmMarkets)
			.set({
				discordThreadId: input.threadId,
				discordMessageId: input.messageId,
				updatedAt: new Date(),
			})
			.where(eq(pmMarkets.id, input.marketId))
	}

	/**
	 * Consume one unit of a user's fixed-window budget for `command`. Atomic committed upsert
	 * (a single Postgres row per user+command, row-lock-serialized) — safe under the DO's
	 * yield-at-await concurrency. SQL mirrors `nextRateState`. Unknown command ⇒ unlimited.
	 */
	private async consumeRateBudget(
		userId: string,
		command: string
	): Promise<{ allowed: boolean; retryAfterMs: number }> {
		const budget = RATE_BUDGETS[command]
		if (!budget) return { allowed: true, retryAfterMs: 0 }
		// `<=` (not `<`) so this exactly mirrors nextRateState's `elapsed >= windowMs` at the boundary.
		const expired = sql`${pmRateLimits.windowStart} <= now() - (interval '1 millisecond' * ${budget.windowMs})`
		const [row] = await this.db
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

	async placeBet(input: PlaceBetInput): Promise<BetResult> {
		if (!isPositiveIntegerString(input.amount)) throw new Error('INVALID_AMOUNT')
		const amount = parseAmount(input.amount)

		// Dedupe pre-check (outside the txn): a duplicate delivery (same interaction id) returns
		// the prior bet WITHOUT consuming rate budget. The in-txn onConflictDoNothing below is the
		// race backstop for two identical deliveries that both pass this check.
		const [priorBet] = await this.db
			.select()
			.from(pmBets)
			.where(eq(pmBets.idempotencyKey, input.idempotencyKey))
			.limit(1)
		if (priorBet) return this.toBetResult(priorBet)

		// Rate limit (committed atomic upsert, before the bet txn): a rejected bet still consumes
		// budget (anti-spam); idempotent retries never reach here (handled above).
		const rate = await this.consumeRateBudget(input.userId, 'bet')
		if (!rate.allowed) throw new Error(`RATE_LIMITED:${rate.retryAfterMs}`)

		try {
			return await this.db.transaction(async (tx) => {
				// Lock the market row: serializes bet-vs-bet and bet-vs-resolve on this market.
				const [market] = await tx
					.select()
					.from(pmMarkets)
					.where(eq(pmMarkets.id, input.marketId))
					.for('update')
				if (!market) throw new Error('MARKET_NOT_FOUND')
				if (market.status !== 'open') throw new Error('MARKET_NOT_OPEN')
				if (market.closesAt.getTime() <= Date.now()) throw new Error('MARKET_CLOSED')

				const [outcome] = await tx
					.select({ id: pmMarketOutcomes.id })
					.from(pmMarketOutcomes)
					.where(
						and(
							eq(pmMarketOutcomes.id, input.outcomeId),
							eq(pmMarketOutcomes.marketId, input.marketId)
						)
					)
					.limit(1)
				if (!outcome) throw new Error('OUTCOME_NOT_FOUND')

				if (amount < parseAmount(market.minStake)) throw new Error('STAKE_BELOW_MIN')
				if (market.maxStake != null && amount > parseAmount(market.maxStake)) {
					throw new Error('STAKE_ABOVE_MAX')
				}
				if (market.perUserCap != null) {
					const [capRow] = await tx
						.select({ total: sql<string>`coalesce(sum(${pmBets.amount}), 0)` })
						.from(pmBets)
						.where(
							and(
								eq(pmBets.marketId, input.marketId),
								eq(pmBets.userId, input.userId),
								eq(pmBets.status, 'active')
							)
						)
					if (parseAmount(capRow.total) + amount > parseAmount(market.perUserCap)) {
						throw new Error('PER_USER_CAP_EXCEEDED')
					}
				}

				// Insert the bet as the idempotency gate BEFORE any money moves. A duplicate
				// delivery (same interaction id) hits the unique index and returns the existing
				// bet without debiting.
				const inserted = await tx
					.insert(pmBets)
					.values({
						marketId: input.marketId,
						outcomeId: input.outcomeId,
						userId: input.userId,
						amount: input.amount,
						status: 'active',
						idempotencyKey: input.idempotencyKey,
					})
					.onConflictDoNothing({ target: pmBets.idempotencyKey })
					.returning()

				if (inserted.length === 0) {
					const [existing] = await tx
						.select()
						.from(pmBets)
						.where(eq(pmBets.idempotencyKey, input.idempotencyKey))
						.limit(1)
					return this.toBetResult(existing)
				}
				const bet = inserted[0]

				// Atomic overdraft-safe debit. 0 rows ⇒ insufficient funds ⇒ rolls back the bet.
				const debited = await tx
					.update(pmWallets)
					.set({
						balance: sql`${pmWallets.balance} - ${input.amount}::numeric`,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(pmWallets.userId, input.userId),
							sql`${pmWallets.balance} >= ${input.amount}::numeric`
						)
					)
					.returning({ balance: pmWallets.balance })
				if (debited.length === 0) throw new Error('INSUFFICIENT_FUNDS')

				await tx.insert(pmLedger).values({
					userId: input.userId,
					amount: negateAmount(input.amount),
					type: 'wager',
					marketId: input.marketId,
					betId: bet.id,
					balanceAfter: debited[0].balance,
				})

				await tx
					.update(pmMarketOutcomes)
					.set({ poolAmount: sql`${pmMarketOutcomes.poolAmount} + ${input.amount}::numeric` })
					.where(eq(pmMarketOutcomes.id, input.outcomeId))
				await tx
					.update(pmMarkets)
					.set({
						totalPool: sql`${pmMarkets.totalPool} + ${input.amount}::numeric`,
						updatedAt: new Date(),
					})
					.where(eq(pmMarkets.id, input.marketId))

				await this.logHistory(tx, {
					marketId: input.marketId,
					actorUserId: input.userId,
					action: 'bet_placed',
					visibility: 'internal',
					metadata: { outcomeId: input.outcomeId, amount: input.amount },
				})

				return this.toBetResult(bet)
			})
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			// Business rejections (insufficient funds, market closed, …) are normal user-facing
			// outcomes, not server errors — don't page Sentry on them.
			if (!EXPECTED_BET_ERRORS.has(msg)) {
				captureException(error as Error, {
					tags: {
						durableObject: 'PredictionMarketsDO',
						method: 'placeBet',
						marketId: input.marketId,
					},
				})
			}
			throw error
		}
	}

	async closeMarket(input: { actorUserId: string; marketId: string }): Promise<void> {
		try {
			await this.db.transaction(async (tx) => {
				const [market] = await tx
					.select()
					.from(pmMarkets)
					.where(eq(pmMarkets.id, input.marketId))
					.for('update')
				if (!market) throw new Error('MARKET_NOT_FOUND')
				assertTransition(market.status, 'closed')
				await tx
					.update(pmMarkets)
					.set({ status: 'closed', updatedAt: new Date() })
					.where(eq(pmMarkets.id, input.marketId))
				await this.logHistory(tx, {
					marketId: input.marketId,
					actorUserId: input.actorUserId,
					action: 'closed',
					previousStatus: market.status,
					newStatus: 'closed',
				})
			})
		} catch (error) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'closeMarket' },
			})
			throw error
		}
	}

	/** Cron sweep: close all open markets whose close time has passed. */
	async closeDueMarkets(): Promise<{ closed: number }> {
		try {
			const closed = await this.db
				.update(pmMarkets)
				.set({ status: 'closed', updatedAt: new Date() })
				.where(and(eq(pmMarkets.status, 'open'), sql`${pmMarkets.closesAt} <= now()`))
				.returning({ id: pmMarkets.id })

			for (const market of closed) {
				await this.logHistory(this.db, {
					marketId: market.id,
					action: 'closed',
					previousStatus: 'open',
					newStatus: 'closed',
					metadata: { auto: true },
				})
			}
			return { closed: closed.length }
		} catch (error) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'closeDueMarkets' },
			})
			throw error
		}
	}

	async proposeResolution(input: {
		resolverId: string
		marketId: string
		outcomeId: string
	}): Promise<ResolveResult> {
		try {
			return await this.db.transaction(async (tx) => {
				const [market] = await tx
					.select()
					.from(pmMarkets)
					.where(eq(pmMarkets.id, input.marketId))
					.for('update')
				if (!market) throw new Error('MARKET_NOT_FOUND')
				if (market.status !== 'closed') throw new Error('MARKET_NOT_CLOSED')

				const [outcome] = await tx
					.select({ id: pmMarketOutcomes.id })
					.from(pmMarketOutcomes)
					.where(
						and(
							eq(pmMarketOutcomes.id, input.outcomeId),
							eq(pmMarketOutcomes.marketId, input.marketId)
						)
					)
					.limit(1)
				if (!outcome) throw new Error('OUTCOME_NOT_FOUND')

				if (market.createdBy === input.resolverId) throw new Error('CREATOR_CANNOT_RESOLVE')
				if (await this.hasPosition(tx, input.marketId, input.resolverId)) {
					throw new Error('RESOLVER_HAS_POSITION')
				}

				if (!(await this.requiresTwoOfN(tx, market))) {
					const finalStatus = await this.executeResolution(
						tx,
						market,
						input.outcomeId,
						input.resolverId
					)
					return {
						marketId: market.id,
						status: finalStatus,
						resolvedOutcomeId: finalStatus === 'resolved' ? input.outcomeId : null,
					}
				}

				assertTransition(market.status, 'resolving')
				await tx
					.update(pmMarkets)
					.set({ status: 'resolving', updatedAt: new Date() })
					.where(eq(pmMarkets.id, market.id))
				const [proposal] = await tx
					.insert(pmResolutionProposals)
					.values({
						marketId: market.id,
						outcomeId: input.outcomeId,
						proposedBy: input.resolverId,
						status: 'pending',
					})
					.returning()
				await this.logHistory(tx, {
					marketId: market.id,
					actorUserId: input.resolverId,
					action: 'resolution_proposed',
					previousStatus: 'closed',
					newStatus: 'resolving',
					metadata: { outcomeId: input.outcomeId, proposalId: proposal.id },
				})
				return {
					marketId: market.id,
					status: 'resolving',
					proposalId: proposal.id,
					resolvedOutcomeId: null,
				}
			})
		} catch (error) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'proposeResolution' },
			})
			throw error
		}
	}

	async approveResolution(input: {
		resolverId: string
		marketId: string
		proposalId: string
	}): Promise<ResolveResult> {
		try {
			return await this.db.transaction(async (tx) => {
				const [market] = await tx
					.select()
					.from(pmMarkets)
					.where(eq(pmMarkets.id, input.marketId))
					.for('update')
				if (!market) throw new Error('MARKET_NOT_FOUND')
				if (market.status !== 'resolving') throw new Error('MARKET_NOT_RESOLVING')

				const [proposal] = await tx
					.select()
					.from(pmResolutionProposals)
					.where(eq(pmResolutionProposals.id, input.proposalId))
					.limit(1)
				if (!proposal || proposal.marketId !== input.marketId) {
					throw new Error('PROPOSAL_NOT_FOUND')
				}
				if (proposal.status !== 'pending') throw new Error('PROPOSAL_NOT_PENDING')

				// Two distinct resolvers, neither the creator, neither holding a position.
				if (proposal.proposedBy === input.resolverId) throw new Error('APPROVER_MUST_DIFFER')
				if (market.createdBy === input.resolverId) throw new Error('CREATOR_CANNOT_RESOLVE')
				if (await this.hasPosition(tx, input.marketId, input.resolverId)) {
					throw new Error('RESOLVER_HAS_POSITION')
				}

				let finalStatus: MarketStatus
				let resolvedOutcomeId: string | null = null
				if (!proposal.outcomeId) {
					await this.executeVoidRefund(tx, market, input.resolverId, 'resolution voided by approval')
					finalStatus = 'voided'
				} else {
					finalStatus = await this.executeResolution(
						tx,
						market,
						proposal.outcomeId,
						input.resolverId
					)
					resolvedOutcomeId = finalStatus === 'resolved' ? proposal.outcomeId : null
				}

				await tx
					.update(pmResolutionProposals)
					.set({ status: 'approved', approvedBy: input.resolverId, resolvedAt: new Date() })
					.where(eq(pmResolutionProposals.id, proposal.id))
				await this.logHistory(tx, {
					marketId: market.id,
					actorUserId: input.resolverId,
					action: 'resolution_approved',
					metadata: { proposalId: proposal.id },
				})
				return { marketId: market.id, status: finalStatus, resolvedOutcomeId }
			})
		} catch (error) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'approveResolution' },
			})
			throw error
		}
	}

	async voidMarket(input: {
		actorUserId: string
		marketId: string
		reason: string
		approverId?: string
	}): Promise<void> {
		if (!input.reason.trim()) throw new Error('VOID_REASON_REQUIRED')
		try {
			await this.db.transaction(async (tx) => {
				const [market] = await tx
					.select()
					.from(pmMarkets)
					.where(eq(pmMarkets.id, input.marketId))
					.for('update')
				if (!market) throw new Error('MARKET_NOT_FOUND')
				if (isTerminal(market.status)) throw new Error('MARKET_TERMINAL')

				// Contested markets (bets on 2+ outcomes) require a distinct second approver.
				const [distinctRow] = await tx
					.select({ n: sql<number>`count(distinct ${pmBets.outcomeId})::int` })
					.from(pmBets)
					.where(and(eq(pmBets.marketId, input.marketId), eq(pmBets.status, 'active')))
				const contested = (distinctRow?.n ?? 0) >= 2
				if (contested && (!input.approverId || input.approverId === input.actorUserId)) {
					throw new Error('CONTESTED_VOID_REQUIRES_APPROVER')
				}

				await this.executeVoidRefund(tx, market, input.actorUserId, input.reason.trim())
			})
		} catch (error) {
			captureException(error as Error, {
				tags: { durableObject: 'PredictionMarketsDO', method: 'voidMarket' },
			})
			throw error
		}
	}

	// =====================================================================
	// Private helpers
	// =====================================================================

	/**
	 * Distribute a resolved market's pool to winners (principal + raked net winnings) and
	 * burn the remainder. Payout basis (totalPool, poolW) is the authoritative SUM over
	 * active bets, not cached columns. If nobody bet the winning outcome, void & refund.
	 */
	private async executeResolution(
		tx: PmTransaction,
		market: PmMarket,
		winningOutcomeId: string,
		resolverId: string
	): Promise<MarketStatus> {
		const totalPool = await this.sumStakes(tx, market.id)
		const poolW = await this.sumStakes(tx, market.id, winningOutcomeId)

		if (poolW === 0n) {
			await this.executeVoidRefund(tx, market, resolverId, 'no winning bets')
			return 'voided'
		}

		const winners = await tx
			.select()
			.from(pmBets)
			.where(
				and(
					eq(pmBets.marketId, market.id),
					eq(pmBets.outcomeId, winningOutcomeId),
					eq(pmBets.status, 'active')
				)
			)
			.orderBy(pmBets.userId, pmBets.id)

		const { payouts, rake, dust } = computeResolution(
			winners.map((w) => ({ betId: w.id, userId: w.userId, stake: parseAmount(w.amount) })),
			totalPool,
			poolW,
			BigInt(market.rakeBps)
		)

		// Credit winners in deterministic user order (multi-wallet deadlock-safe).
		for (const p of payouts) {
			const updated = await tx
				.update(pmBets)
				.set({ status: 'won', payoutAmount: formatAmount(p.payout) })
				.where(and(eq(pmBets.id, p.betId), eq(pmBets.status, 'active')))
				.returning({ id: pmBets.id })
			if (updated.length === 0) continue // already credited on a retry

			const [credited] = await tx
				.update(pmWallets)
				.set({
					balance: sql`${pmWallets.balance} + ${formatAmount(p.payout)}::numeric`,
					updatedAt: new Date(),
				})
				.where(eq(pmWallets.userId, p.userId))
				.returning({ balance: pmWallets.balance })
			await tx.insert(pmLedger).values({
				userId: p.userId,
				amount: formatAmount(p.payout),
				type: 'payout',
				marketId: market.id,
				betId: p.betId,
				balanceAfter: credited?.balance ?? null,
			})
		}

		await tx
			.update(pmBets)
			.set({ status: 'lost' })
			.where(
				and(
					eq(pmBets.marketId, market.id),
					ne(pmBets.outcomeId, winningOutcomeId),
					eq(pmBets.status, 'active')
				)
			)

		// House cut and rounding dust are recorded as distinct sink lines (both leave circulation).
		if (rake > 0n) {
			await tx.insert(pmLedger).values({
				userId: null,
				amount: formatAmount(rake),
				type: 'rake',
				marketId: market.id,
			})
		}
		if (dust > 0n) {
			await tx.insert(pmLedger).values({
				userId: null,
				amount: formatAmount(dust),
				type: 'burn',
				marketId: market.id,
			})
		}

		assertTransition(market.status, 'resolved')
		await tx
			.update(pmMarkets)
			.set({
				status: 'resolved',
				resolvedOutcomeId: winningOutcomeId,
				resolvedBy: resolverId,
				resolvedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(pmMarkets.id, market.id))
		await this.logHistory(tx, {
			marketId: market.id,
			actorUserId: resolverId,
			action: 'resolved',
			previousStatus: market.status,
			newStatus: 'resolved',
			visibility: 'public',
			metadata: {
				winningOutcomeId,
				totalPool: formatAmount(totalPool),
				poolW: formatAmount(poolW),
				rake: formatAmount(rake),
				dust: formatAmount(dust),
			},
		})
		return 'resolved'
	}

	/** Refund every active bet at full stake and mark the market voided. */
	private async executeVoidRefund(
		tx: PmTransaction,
		market: PmMarket,
		actorUserId: string,
		reason: string
	): Promise<void> {
		const bets = await tx
			.select()
			.from(pmBets)
			.where(and(eq(pmBets.marketId, market.id), eq(pmBets.status, 'active')))
			.orderBy(pmBets.userId, pmBets.id)

		for (const bet of bets) {
			const updated = await tx
				.update(pmBets)
				.set({ status: 'refunded', payoutAmount: null })
				.where(and(eq(pmBets.id, bet.id), eq(pmBets.status, 'active')))
				.returning({ id: pmBets.id })
			if (updated.length === 0) continue

			const [credited] = await tx
				.update(pmWallets)
				.set({
					balance: sql`${pmWallets.balance} + ${bet.amount}::numeric`,
					updatedAt: new Date(),
				})
				.where(eq(pmWallets.userId, bet.userId))
				.returning({ balance: pmWallets.balance })
			await tx.insert(pmLedger).values({
				userId: bet.userId,
				amount: bet.amount,
				type: 'refund',
				marketId: market.id,
				betId: bet.id,
				balanceAfter: credited?.balance ?? null,
			})
		}

		assertTransition(market.status, 'voided')
		await tx
			.update(pmMarkets)
			.set({ status: 'voided', voidReason: reason, updatedAt: new Date() })
			.where(eq(pmMarkets.id, market.id))
		await this.logHistory(tx, {
			marketId: market.id,
			actorUserId,
			action: 'voided',
			previousStatus: market.status,
			newStatus: 'voided',
			visibility: 'public',
			metadata: { reason },
		})
	}

	private async sumStakes(
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

	private async hasPosition(
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

	private async requiresTwoOfN(tx: PmTransaction, market: PmMarket): Promise<boolean> {
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

	private async buildMarketDetail(
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
			resolvedOutcomeId: market.resolvedOutcomeId,
			resolvedBy: market.resolvedBy,
			resolvedAt: market.resolvedAt ? market.resolvedAt.toISOString() : null,
			voidReason: market.voidReason,
			outcomes: outcomes.map((o) => ({
				id: o.id,
				label: o.label,
				poolAmount: o.poolAmount,
				sortOrder: o.sortOrder,
				impliedOddsBps: total > 0n ? Number((parseAmount(o.poolAmount) * 10_000n) / total) : null,
			})),
		}
	}

	private async logHistory(executor: PmExecutor, entry: HistoryEntry): Promise<void> {
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

	private toGlobalLedgerRow(r: PmLedgerRow): GlobalLedgerRow {
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

	private toMarketHistoryRow(r: PmMarketHistoryRow): MarketHistoryRow {
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

	private toBetResult(bet: PmBet): BetResult {
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
}
