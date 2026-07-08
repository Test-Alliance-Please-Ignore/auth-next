import { DurableObject } from 'cloudflare:workers'

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from '@repo/db-utils'
import { captureException, logger } from '@repo/hono-helpers'
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
	DetailedBetView,
	LeaderboardRow,
	LedgerRow,
	ListMarketsFilter,
	ListWalletsOpts,
	MarketDetail,
	MarketHistoryOpts,
	MarketHistoryRow,
	MarketSettlement,
	MarketStatus,
	MarketSummary,
	Paged,
	PendingProposalView,
	MarketUpdateResult,
	PlaceBetInput,
	PredictionMarkets,
	ResolveResult,
	UpdateMarketInput,
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

/** One-time starting grant deposited on a member's first `/market onboard`. */
const ONBOARDING_GRANT = '50'
/** Ledger reason recorded for the onboarding grant. */
const ONBOARDING_REASON = 'Initial onboarding'
/**
 * Actor recorded for system-issued grants (e.g. onboarding). A sentinel string that is never a
 * real user id, so grantPoints' self-target guard is not tripped when a member onboards themselves.
 */
const SYSTEM_ACTOR = 'system'

/** placeBet throws these on normal user-facing rejections — not paged to Sentry. */
const EXPECTED_BET_ERRORS = new Set([
	'MARKET_NOT_FOUND',
	'MARKET_NOT_OPEN',
	'MARKET_CLOSED',
	'CREATOR_CANNOT_BET',
	'OUTCOME_NOT_FOUND',
	'STAKE_BELOW_MIN',
	'STAKE_ABOVE_MAX',
	'PER_USER_CAP_EXCEEDED',
	'INSUFFICIENT_FUNDS',
])

/**
 * True for expected bet rejections — the user-facing outcomes we deliberately don't page on.
 * Covers the coded domain errors above plus INVALID_AMOUNT and the RATE_LIMITED:<ms> throw.
 */
function isExpectedBetError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error)
	return EXPECTED_BET_ERRORS.has(msg) || msg === 'INVALID_AMOUNT' || msg.startsWith('RATE_LIMITED')
}

/**
 * Pull the underlying driver error off a Drizzle "Failed query: …" wrapper. Drizzle surfaces only
 * the SQL + params in `.message`; the real Postgres reason (e.g. `relation "pm_rate_limits" does
 * not exist`) lives on `.cause`. Logging the cause is what turns an opaque failure into a diagnosis.
 */
function dbErrorCause(error: unknown): string | undefined {
	const cause = (error as { cause?: unknown } | null)?.cause
	if (cause == null) return undefined
	return cause instanceof Error ? cause.message : String(cause)
}

/** Resolver methods (close/resolve/approve/void) throw these on normal rejections — not paged. */
const EXPECTED_RESOLVER_ERRORS = new Set([
	'MARKET_NOT_FOUND',
	'MARKET_NOT_CLOSED',
	'MARKET_NOT_RESOLVING',
	'MARKET_TERMINAL',
	'OUTCOME_NOT_FOUND',
	'CREATOR_CANNOT_RESOLVE',
	'RESOLVER_HAS_POSITION',
	'APPROVER_MUST_DIFFER',
	'PROPOSAL_NOT_FOUND',
	'PROPOSAL_NOT_PENDING',
	'CONTESTED_VOID_REQUIRES_APPROVER',
	'VOID_REASON_REQUIRED',
])

/** updateMarket throws these on normal caller-input rejections — not paged to Sentry. */
const EXPECTED_MARKET_EDIT_ERRORS = new Set([
	'MARKET_NOT_FOUND',
	'MARKET_NOT_EDITABLE',
	'CLOSES_AT_NOT_EDITABLE',
	'INVALID_CLOSES_AT',
	'QUESTION_REQUIRED',
])

/** True for expected resolver rejections, incl. the raw assertTransition (stale-state) string. */
function isExpectedResolverError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error)
	return (
		EXPECTED_RESOLVER_ERRORS.has(msg) ||
		msg.startsWith('prediction-markets: invalid market transition')
	)
}

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

	/** A user's bets joined to market question + outcome label (for `/market mybets`). */
	async getUserBetsDetailed(
		userId: string,
		opts?: { activeOnly?: boolean }
	): Promise<DetailedBetView[]> {
		const conditions = [eq(pmBets.userId, userId)]
		if (opts?.activeOnly) conditions.push(eq(pmBets.status, 'active'))

		const rows = await this.db
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
	async getMarketSettlement(marketId: string): Promise<MarketSettlement | null> {
		const [market] = await this.db
			.select({
				status: pmMarkets.status,
				resolvedOutcomeId: pmMarkets.resolvedOutcomeId,
			})
			.from(pmMarkets)
			.where(eq(pmMarkets.id, marketId))
			.limit(1)
		if (!market) return null

		const bets = await this.db
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
				// Ensure the wallet row exists, then lock it FOR UPDATE. Locking BEFORE the idempotency
				// pre-check serializes concurrent grants to the same user, so a losing race sees the
				// winner's committed ledger row here and dedupes gracefully — rather than racing past
				// the pre-check into a ledger unique-violation (money was always safe, but the raw
				// 23505 pages Sentry and surfaces a spurious failure to an already-granted user).
				await tx
					.insert(pmWallets)
					.values({ userId: input.targetUserId, balance: '0' })
					.onConflictDoNothing()
				const [locked] = await tx
					.select({ balance: pmWallets.balance })
					.from(pmWallets)
					.where(eq(pmWallets.userId, input.targetUserId))
					.for('update')
					.limit(1)

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
						return { balance: locked?.balance ?? '0', deduped: true }
					}
				}

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
			// A mismatched idempotency key is a caller-side outcome (the admin route maps it to 409;
			// onboardUser handles it), not an infra failure — don't page on it.
			if (!(error instanceof Error && error.message === 'IDEMPOTENCY_KEY_CONFLICT')) {
				captureException(error as Error, {
					tags: { durableObject: 'PredictionMarketsDO', method: 'grantPoints' },
				})
			}
			throw error
		}
	}

	/**
	 * Onboard a member: ensure their wallet exists and deposit the one-time ONBOARDING_GRANT.
	 * Built on grantPoints as a system-actor grant keyed on `onboard:{userId}`, so it inherits
	 * wallet creation, the atomic credit, and idempotency — and is once-per-user: a repeat call
	 * (`deduped`) grants nothing and reports `alreadyOnboarded: true`.
	 *
	 * If a member already onboarded when ONBOARDING_GRANT was a DIFFERENT size, the repeat grant
	 * collides on the key at a mismatched amount (IDEMPOTENCY_KEY_CONFLICT). Once-per-user still
	 * holds — treat it as already onboarded rather than erroring or topping up.
	 */
	async onboardUser(
		userId: string
	): Promise<{ balance: string; granted: string; alreadyOnboarded: boolean }> {
		try {
			const { balance, deduped } = await this.grantPoints({
				actorUserId: SYSTEM_ACTOR,
				targetUserId: userId,
				amount: ONBOARDING_GRANT,
				reason: ONBOARDING_REASON,
				idempotencyKey: `onboard:${userId}`,
			})
			return { balance, granted: deduped ? '0' : ONBOARDING_GRANT, alreadyOnboarded: deduped }
		} catch (error) {
			if (error instanceof Error && error.message === 'IDEMPOTENCY_KEY_CONFLICT') {
				const { balance } = await this.getWalletBalance(userId)
				return { balance, granted: '0', alreadyOnboarded: true }
			}
			throw error
		}
	}

	async createMarket(input: CreateMarketInput): Promise<MarketDetail> {
		const labels = input.outcomes.map((o) => o.trim()).filter(Boolean)
		if (labels.length < 2) throw new Error('AT_LEAST_TWO_OUTCOMES')
		// Cap at 20 so the embed (≤25 fields) and button rows (≤25 buttons / 5 rows) can't
		// overflow Discord limits. The admin route enforces this too; the DO owns the invariant.
		if (labels.length > 20) throw new Error('TOO_MANY_OUTCOMES')
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

		// Rate limit member-created markets (opt-in per request; admin creation is uncapped). Consume
		// the budget after input validation but before any write; a rejected create still counts
		// (anti-spam), same as placeBet. `create_market` throttles the public forum-post fan-out.
		if (input.enforceRateLimit) {
			const rate = await this.consumeRateBudget(input.createdBy, 'create_market')
			if (!rate.allowed) throw new Error(`RATE_LIMITED:${rate.retryAfterMs}`)
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
	 * Edit a non-terminal market's safe fields (closesAt / question / description). Rejects a
	 * resolved/voided market (MARKET_NOT_EDITABLE); `closesAt` is editable only while the market is
	 * open (CLOSES_AT_NOT_EDITABLE otherwise — the close time is meaningless on a closed/resolving
	 * market) and must be in the future (INVALID_CLOSES_AT). Only fields that ACTUALLY differ from
	 * the row are written — computed under the FOR UPDATE lock, so the returned `changed` flags can't
	 * be corrupted by a concurrent edit. Records the acting admin + the new values in the audit log.
	 */
	async updateMarket(
		marketId: string,
		actorUserId: string,
		updates: UpdateMarketInput
	): Promise<MarketUpdateResult> {
		try {
			return await this.db.transaction(async (tx) => {
				const [market] = await tx
					.select()
					.from(pmMarkets)
					.where(eq(pmMarkets.id, marketId))
					.for('update')
				if (!market) throw new Error('MARKET_NOT_FOUND')
				if (isTerminal(market.status)) throw new Error('MARKET_NOT_EDITABLE')

				const set: Partial<typeof pmMarkets.$inferInsert> = {}
				// New values for the fields that genuinely changed — the audit metadata.
				const changes: Record<string, unknown> = {}

				if (updates.closesAt !== undefined) {
					// The close time only governs an OPEN market; editing it on a closed/resolving one
					// would falsely read as "betting reopened" while status stays closed.
					if (market.status !== 'open') throw new Error('CLOSES_AT_NOT_EDITABLE')
					const closesAt = parseDateOrNull(updates.closesAt)
					if (!closesAt || closesAt.getTime() <= Date.now()) throw new Error('INVALID_CLOSES_AT')
					if (closesAt.getTime() !== market.closesAt.getTime()) {
						set.closesAt = closesAt
						changes.closesAt = closesAt.toISOString()
					}
				}
				if (updates.question !== undefined) {
					const question = updates.question.trim()
					if (!question) throw new Error('QUESTION_REQUIRED')
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
					await this.logHistory(tx, {
						marketId,
						actorUserId,
						action: 'updated',
						previousStatus: market.status,
						newStatus: market.status,
						visibility: 'internal',
						metadata: { changes },
					})
				}

				const detail = await this.buildMarketDetail(tx, marketId)
				if (!detail) throw new Error('MARKET_NOT_FOUND')
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
			const msg = error instanceof Error ? error.message : String(error)
			if (!EXPECTED_MARKET_EDIT_ERRORS.has(msg)) {
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

	async placeBet(input: PlaceBetInput): Promise<BetResult & { deduped: boolean }> {
		// The try spans the WHOLE method — the dedupe SELECT and the rate-limit upsert run before
		// the txn and can also fail (e.g. a missing table/migration or a Neon outage). They used to
		// throw outside any catch, so those infra errors were never logged or paged and surfaced to
		// the member as a bare "Could not place your bet". Wrapping everything closes that gap.
		try {
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
			if (priorBet) return { ...this.toBetResult(priorBet), deduped: true }

			// Rate limit (committed atomic upsert, before the bet txn): a rejected bet still consumes
			// budget (anti-spam); idempotent retries never reach here (handled above).
			const rate = await this.consumeRateBudget(input.userId, 'bet')
			if (!rate.allowed) throw new Error(`RATE_LIMITED:${rate.retryAfterMs}`)

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
				// Governance: a creator can't take a position on their own market (mirrors the
				// creator-can't-resolve / resolver-holds-no-position guards elsewhere).
				if (market.createdBy === input.userId) throw new Error('CREATOR_CANNOT_BET')

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
					return { ...this.toBetResult(existing), deduped: true }
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

				return { ...this.toBetResult(bet), deduped: false }
			})
		} catch (error) {
			// Business rejections (insufficient funds, market closed, rate-limited, invalid amount)
			// are normal user-facing outcomes — don't log or page on them. Everything else (a failed
			// query, a missing table/migration, a Neon outage) is an infra failure: log it WITH the
			// underlying driver cause and page Sentry, so a bet never dies as a silent "try again".
			if (!isExpectedBetError(error)) {
				const cause = dbErrorCause(error)
				logger.error('[PredictionMarkets] placeBet failed', {
					marketId: input.marketId,
					outcomeId: input.outcomeId,
					userId: input.userId,
					error: error instanceof Error ? error.message : String(error),
					cause,
				})
				captureException(error as Error, {
					tags: {
						durableObject: 'PredictionMarketsDO',
						method: 'placeBet',
						marketId: input.marketId,
						userId: input.userId,
					},
					extra: { cause, outcomeId: input.outcomeId },
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
			if (!isExpectedResolverError(error)) {
				captureException(error as Error, {
					tags: { durableObject: 'PredictionMarketsDO', method: 'closeMarket' },
				})
			}
			throw error
		}
	}

	/** Cron sweep: close all open markets whose close time has passed. */
	async closeDueMarkets(limit = 25): Promise<{ closedMarketIds: string[] }> {
		const bounded = Math.min(Math.max(limit, 1), 100)
		try {
			// Bound the batch so a backlog of due markets can't blow the reconcile cron's wall-clock
			// budget; a large backlog drains over successive ticks.
			const due = await this.db
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
			const closed = await this.db
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
				await this.logHistory(this.db, {
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
	async listMarketsNeedingPost(limit = 25, minAgeMinutes = 2): Promise<MarketDetail[]> {
		const bounded = Math.min(Math.max(limit, 1), 100)
		const maxCreatedAt = new Date(Date.now() - Math.max(minAgeMinutes, 0) * 60_000)
		const rows = await this.db
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

		return this.buildMarketDetails(rows.map((r) => r.id))
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
	async listMarketsToRefresh(sinceMinutes = 15, limit = 25): Promise<string[]> {
		const bounded = Math.min(Math.max(limit, 1), 100)
		const cutoff = new Date(Date.now() - Math.max(sinceMinutes, 1) * 60_000)
		const rows = await this.db
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

	/** Build full details for a list of market ids, skipping any that vanished. */
	private async buildMarketDetails(marketIds: string[]): Promise<MarketDetail[]> {
		const details: MarketDetail[] = []
		for (const id of marketIds) {
			const detail = await this.buildMarketDetail(this.db, id)
			if (detail) details.push(detail)
		}
		return details
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
			if (!isExpectedResolverError(error)) {
				captureException(error as Error, {
					tags: { durableObject: 'PredictionMarketsDO', method: 'proposeResolution' },
				})
			}
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
			if (!isExpectedResolverError(error)) {
				captureException(error as Error, {
					tags: { durableObject: 'PredictionMarketsDO', method: 'approveResolution' },
				})
			}
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
			if (!isExpectedResolverError(error)) {
				captureException(error as Error, {
					tags: { durableObject: 'PredictionMarketsDO', method: 'voidMarket' },
				})
			}
			throw error
		}
	}

	/** The single pending resolution proposal for a market (two-of-N approve), or null. */
	async getPendingProposal(marketId: string): Promise<PendingProposalView | null> {
		const [p] = await this.db
			.select()
			.from(pmResolutionProposals)
			.where(
				and(
					eq(pmResolutionProposals.marketId, marketId),
					eq(pmResolutionProposals.status, 'pending')
				)
			)
			.limit(1)
		if (!p) return null
		return {
			id: p.id,
			outcomeId: p.outcomeId,
			proposedBy: p.proposedBy,
			createdAt: p.createdAt.toISOString(),
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
