/**
 * @repo/prediction-markets
 *
 * Shared types and interfaces for the Prediction Markets Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 *
 * All monetary amounts are integer "points" represented as decimal strings
 * (backed by Postgres `numeric`), computed with BigInt in the worker.
 */

export type MarketStatus = 'draft' | 'open' | 'closed' | 'resolving' | 'resolved' | 'voided'
export type BetStatus = 'active' | 'won' | 'lost' | 'refunded'
export type LedgerType = 'grant' | 'wager' | 'refund' | 'payout' | 'rake' | 'burn' | 'adjustment'
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'superseded'
export type Visibility = 'public' | 'internal'

// ---------------------------------------------------------------------------
// Write inputs
// ---------------------------------------------------------------------------

export interface GrantPointsInput {
	/** Admin/manager performing the deposit. */
	actorUserId: string
	/** Account receiving the points. */
	targetUserId: string
	/** Positive integer amount as a decimal string. */
	amount: string
	reason: string
	/** Optional idempotency key to dedupe a repeated grant. */
	idempotencyKey?: string
}

export interface CreateMarketInput {
	createdBy: string
	question: string
	description?: string
	/** Two or more distinct outcome labels. */
	outcomes: string[]
	/** ISO-8601 timestamp when betting closes. */
	closesAt: string
	rakeBps?: number
	minStake?: string
	maxStake?: string
	perUserCap?: string
	twoOfN?: boolean
}

export interface PlaceBetInput {
	userId: string
	marketId: string
	outcomeId: string
	amount: string
	/** Idempotency key (the Discord interaction id for bot bets). */
	idempotencyKey: string
}

// ---------------------------------------------------------------------------
// Read views
// ---------------------------------------------------------------------------

export interface OutcomeView {
	id: string
	label: string
	poolAmount: string
	sortOrder: number
	/** Implied probability in basis points (pool / total), or null when no bets yet. */
	impliedOddsBps: number | null
}

export interface MarketSummary {
	id: string
	question: string
	status: MarketStatus
	closesAt: string
	totalPool: string
	outcomeCount: number
	createdAt: string
}

export interface MarketDetail extends MarketSummary {
	description: string | null
	createdBy: string
	rakeBps: number
	minStake: string
	maxStake: string | null
	perUserCap: string | null
	twoOfN: boolean
	resolvedOutcomeId: string | null
	resolvedBy: string | null
	resolvedAt: string | null
	voidReason: string | null
	outcomes: OutcomeView[]
}

export interface BetResult {
	id: string
	marketId: string
	outcomeId: string
	userId: string
	amount: string
	status: BetStatus
	payoutAmount: string | null
	createdAt: string
}

export type BetView = BetResult

export interface ResolveResult {
	marketId: string
	status: MarketStatus
	/** Set when a two-of-N proposal was recorded but not yet finalized. */
	proposalId?: string
	resolvedOutcomeId?: string | null
}

export interface LeaderboardRow {
	userId: string
	balance: string
	/** Net betting P&L (payouts + refunds − wagers), excludes grants. */
	netProfit: string
}

export interface LedgerRow {
	id: string
	amount: string
	type: LedgerType
	marketId: string | null
	betId: string | null
	balanceAfter: string | null
	createdAt: string
	metadata: unknown
}

export interface ListMarketsFilter {
	status?: MarketStatus
	limit?: number
	cursor?: string
}

// ---------------------------------------------------------------------------
// Admin views (wallets + audit)
// ---------------------------------------------------------------------------

export interface WalletRow {
	userId: string
	balance: string
	updatedAt: string
}

/** A ledger row with its owning user id (the base `LedgerRow` omits it) + idempotency key for audit. */
export interface GlobalLedgerRow extends LedgerRow {
	userId: string | null
	idempotencyKey: string | null
}

export interface MarketHistoryRow {
	id: string
	marketId: string
	actorUserId: string | null
	action: string
	previousStatus: MarketStatus | null
	newStatus: MarketStatus | null
	visibility: Visibility
	metadata: unknown
	createdAt: string
}

export interface Paged<T> {
	rows: T[]
	total: number
}

export interface ListWalletsOpts {
	/** Restrict to these user ids (used by the admin route to apply a name search). */
	userIds?: string[]
	sort?: 'balance' | 'updatedAt' | 'userId'
	order?: 'asc' | 'desc'
	limit?: number
	offset?: number
}

export interface GlobalLedgerOpts {
	userId?: string
	type?: LedgerType
	marketId?: string
	/** ISO-8601 lower bound (inclusive). */
	since?: string
	/** ISO-8601 upper bound (inclusive). */
	until?: string
	limit?: number
	offset?: number
}

export interface MarketHistoryOpts {
	marketId?: string
	/** Admin-only: include `internal`-visibility rows. Defaults false. */
	includeInternal?: boolean
	since?: string
	until?: string
	limit?: number
	offset?: number
}

// ---------------------------------------------------------------------------
// RPC interface
// ---------------------------------------------------------------------------

export interface PredictionMarkets {
	// reads
	getWalletBalance(userId: string): Promise<{ balance: string }>
	listMarkets(filter?: ListMarketsFilter): Promise<MarketSummary[]>
	getMarket(marketId: string): Promise<MarketDetail | null>
	getUserBets(userId: string, opts?: { marketId?: string; activeOnly?: boolean }): Promise<BetView[]>
	getLeaderboard(opts?: { window?: 'all' | '30d'; limit?: number }): Promise<LeaderboardRow[]>
	getLedger(userId: string, opts?: { limit?: number; cursor?: string }): Promise<LedgerRow[]>

	// admin reads (offset + total)
	listWallets(opts?: ListWalletsOpts): Promise<Paged<WalletRow>>
	/** Global financial audit feed; also serves the per-user ledger via `{ userId }`. */
	getGlobalLedger(opts?: GlobalLedgerOpts): Promise<Paged<GlobalLedgerRow>>
	getGlobalMarketHistory(opts?: MarketHistoryOpts): Promise<Paged<MarketHistoryRow>>
	getMarketHistory(
		marketId: string,
		opts?: { includeInternal?: boolean; limit?: number; offset?: number }
	): Promise<Paged<MarketHistoryRow>>

	// writes
	grantPoints(input: GrantPointsInput): Promise<{ balance: string; deduped: boolean }>
	createMarket(input: CreateMarketInput): Promise<MarketDetail>
	placeBet(input: PlaceBetInput): Promise<BetResult>
	closeMarket(input: { actorUserId: string; marketId: string }): Promise<void>
	closeDueMarkets(): Promise<{ closed: number }>
	proposeResolution(input: {
		resolverId: string
		marketId: string
		outcomeId: string
	}): Promise<ResolveResult>
	approveResolution(input: {
		resolverId: string
		marketId: string
		proposalId: string
	}): Promise<ResolveResult>
	voidMarket(input: {
		actorUserId: string
		marketId: string
		reason: string
		approverId?: string
	}): Promise<void>
}
