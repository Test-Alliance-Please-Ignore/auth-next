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

/**
 * The house/system wallet. On resolution, the rake (house cut) and rounding dust accumulate here
 * instead of leaving circulation — the points stay conserved and recoverable. The nil UUID is a
 * valid `uuid` that `defaultRandom()` never mints, so it can never collide with a real user id.
 * Surfaced as "System" in admin views and excluded from the member leaderboard.
 */
export const SYSTEM_WALLET_USER_ID = '00000000-0000-0000-0000-000000000000'

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
	/**
	 * Optional set of core user ids to designate as this market's resolver(s). NULL/empty/absent =>
	 * global resolver authority (unchanged behavior). A non-empty set narrows settlement to these ids
	 * (plus admin/manager override). Core validates — before this call — that none is the creator and
	 * that each already holds `urn:markets:resolver` (designation narrows, never grants); the DO
	 * enforces only the structural invariants (creator-exclusion backstop, two-of-N minimum size) and
	 * persists the set lowercased. Ignored/undefined for creators without designation rights.
	 */
	designatedResolverIds?: string[]
	/**
	 * When true, consume the per-user `create_market` rate budget and reject (RATE_LIMITED) if it's
	 * exhausted. Server-set policy flag — the member create route sets it for non-admins; admin
	 * creation leaves it unset (uncapped). Never populated from client input.
	 */
	enforceRateLimit?: boolean
}

/**
 * A partial edit to a non-terminal market. Only the provided fields change; omitted fields are left
 * as-is (pass `description: null` to clear it). Only the safe-to-change fields are editable —
 * economic params (rake/stakes/cap) and outcomes are deliberately excluded.
 */
export interface UpdateMarketInput {
	/** New betting-close time (ISO-8601); must be in the future and the market must be open. */
	closesAt?: string
	question?: string
	/** New description, or `null` to clear it. */
	description?: string | null
}

export interface MarketUpdateResult {
	market: MarketDetail
	/** Which safe fields actually changed (computed under the row lock) — drives the thread notice. */
	changed: { closesAt: boolean; question: boolean; description: boolean }
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
	/** Discord forum thread id for this market's post, or null before the post exists. */
	discordThreadId: string | null
}

export interface MarketDetail extends MarketSummary {
	description: string | null
	/** Discord starter-message id of the forum post (for in-place embed updates). */
	discordMessageId: string | null
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
	/**
	 * The market's designated resolver core user ids, or null when undesignated (global authority).
	 * Only these users (plus admin/manager override) may settle the market. On MarketDetail (not
	 * MarketSummary) so list/refresh payloads stay lean.
	 */
	designatedResolverIds: string[] | null
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

/** A bet enriched with its market question + outcome label (for `/market mybets`). */
export interface DetailedBetView {
	id: string
	marketId: string
	marketQuestion: string
	outcomeLabel: string
	amount: string
	status: BetStatus
	payoutAmount: string | null
	createdAt: string
}

export interface ResolveResult {
	marketId: string
	status: MarketStatus
	/** Set when a two-of-N proposal was recorded but not yet finalized. */
	proposalId?: string
	resolvedOutcomeId?: string | null
}

/** One participant's net result on a settled (resolved/voided) market — the DM target. */
export interface SettlementUser {
	/** Core user id (also the DM target). */
	userId: string
	/** Total staked across this user's bets on the market. */
	staked: string
	/** Total returned to this user (winning payouts, or refunds on a void). */
	returned: string
	/** `returned - staked` (positive = net win, negative = net loss); may be negative. */
	net: string
}

/** The financial outcome of a settled market — drives the resolve thread post + per-user DMs. */
export interface MarketSettlement {
	marketId: string
	status: MarketStatus
	resolvedOutcomeId: string | null
	/** Sum of all stakes on the market (the total pool). */
	totalStaked: string
	/** Sum returned to users (winner payouts, or all stakes on a void). */
	totalPaidOut: string
	/** Sum of stakes on losing outcomes (0 for a void). */
	totalLost: string
	/** Per-user aggregates, one row per participant. */
	users: SettlementUser[]
}

export interface PendingProposalView {
	id: string
	/** Proposed winning outcome, or null for a proposed void. */
	outcomeId: string | null
	proposedBy: string
	createdAt: string
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
// Config
// ---------------------------------------------------------------------------

/**
 * The active config as seen by the admin editor. Money fields are decimal strings. `configured` is
 * false when no active row exists yet — the fields then carry the RUNTIME-EFFECTIVE fallbacks the
 * readers actually use today (rake 0, minStake '1', threshold null), NOT the column defaults, so the
 * admin sees the truth about current behavior.
 */
export interface PmConfigView {
	defaultRakeBps: number
	defaultMinStake: string
	/** NULL disables pool-based two-of-N. */
	twoOfNThreshold: string | null
	/** ISO-8601 when this generation took effect, or null when unseeded. */
	effectiveFrom: string | null
	/** Admin who wrote the active generation, or null (unseeded / pre-audit rows). */
	actorUserId: string | null
	changeNote: string | null
	configured: boolean
}

/** Full-replace config write. `actorUserId` is server-derived (session), never client-supplied. */
export interface UpdateConfigInput {
	actorUserId: string
	defaultRakeBps: number
	defaultMinStake: string
	/** NULL disables pool-based two-of-N. '' / '0' are rejected — send real null to disable. */
	twoOfNThreshold: string | null
	changeNote?: string | null
}

/** A market a threshold change would strand (a lone designated resolver can't reach two-of-N). */
export interface StrandedMarket {
	marketId: string
	question: string
	totalPool: string
	status: MarketStatus
	designatedResolverIds: string[] | null
}

/**
 * The retroactive impact of a candidate `twoOfNThreshold`. Counts are a snapshot at CURRENT pools for
 * closed markets (frozen) — open-market pools can still grow, so `strandedCandidates` flags any
 * size-1 designated open market whenever the candidate is non-null, independent of its current pool.
 */
export interface ThresholdImpact {
	/** twoOfN=false markets (open/closed) that flip false→true at current pools. */
	newlyRequiringCount: number
	/** twoOfN=false markets (open/closed) that flip true→false at current pools. */
	noLongerRequiringCount: number
	/** Size-1 designated markets the change would newly strand — updateConfig hard-rejects if non-empty. */
	strandedCandidates: StrandedMarket[]
}

// ---------------------------------------------------------------------------
// RPC interface
// ---------------------------------------------------------------------------

export interface PredictionMarkets {
	// reads
	getWalletBalance(userId: string): Promise<{ balance: string }>
	listMarkets(filter?: ListMarketsFilter): Promise<MarketSummary[]>
	getMarket(marketId: string): Promise<MarketDetail | null>
	/**
	 * Non-terminal markets (open/closed/resolving) that have no forum post yet
	 * (`discordThreadId IS NULL`), oldest first, bounded — the reconcile cron's backfill work-list.
	 * `minAgeMinutes` skips very fresh markets whose create-route publish may still be in flight.
	 */
	listMarketsNeedingPost(limit?: number, minAgeMinutes?: number): Promise<MarketDetail[]>
	/**
	 * Ids of non-terminal markets that HAVE a post and changed within the last `sinceMinutes`, newest
	 * first, bounded — the reconcile cron's self-healing refresh work-list. A failed post refresh keeps
	 * a fresh `updatedAt`, so it stays here and is retried each tick until the edit lands. Returns ids
	 * (not details) so the caller re-reads current state just before editing.
	 */
	listMarketsToRefresh(sinceMinutes?: number, limit?: number): Promise<string[]>
	getUserBets(
		userId: string,
		opts?: { marketId?: string; activeOnly?: boolean }
	): Promise<BetView[]>
	/** A user's bets joined to market question + outcome label (for `/market mybets`). */
	getUserBetsDetailed(userId: string, opts?: { activeOnly?: boolean }): Promise<DetailedBetView[]>
	/**
	 * The financial settlement of a market (totals + per-user net results). Intended for a market
	 * that has resolved/voided; the caller uses it to post the outcome to the thread and DM each
	 * participant. Returns null if the market doesn't exist.
	 */
	getMarketSettlement(marketId: string): Promise<MarketSettlement | null>
	/**
	 * Terminal (resolved/voided) markets that HAVE a forum post but whose settlement notification never
	 * completed (`settlementAnnouncedAt IS NULL`) — the reconcile cron's settlement self-heal work-list.
	 * Bounded to markets that went terminal within `[now − maxAgeMinutes, now − minAgeMinutes]`: the
	 * lower bound (`minAgeMinutes`) avoids racing a healthy live-path DM fan-out still in flight; the
	 * upper bound (`maxAgeMinutes`) keeps this forward-only (deep history never re-fires) and stops
	 * retrying a permanently-failing market forever. Oldest first, bounded.
	 */
	listMarketsNeedingSettlementNotice(
		limit?: number,
		minAgeMinutes?: number,
		maxAgeMinutes?: number
	): Promise<MarketDetail[]>
	/**
	 * Mark a terminal market's settlement notification (thread result post + result DMs) as delivered.
	 * Idempotent: sets `settlementAnnouncedAt` only when currently NULL and the market is terminal, so a
	 * live-path completion and a racing reconcile pass converge to the same single flag.
	 */
	markSettlementAnnounced(marketId: string): Promise<void>
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
	/** The active config defaults (or runtime fallbacks with `configured:false` when unseeded). */
	getConfig(): Promise<PmConfigView>
	/**
	 * Read-only impact of changing `twoOfNThreshold` to `candidateThreshold` (null = disable). Because
	 * the threshold is read at SETTLE time, changing it retroactively re-evaluates which existing open/
	 * closed markets need two-of-N. Returns the flip counts plus the markets that would be STRANDED (a
	 * lone designated resolver can't supply a second signer). `updateConfig` hard-rejects a change with
	 * any stranded candidate — this preview drives the UI's block message.
	 */
	previewTwoOfNThreshold(candidateThreshold: string | null): Promise<ThresholdImpact>

	// writes
	grantPoints(input: GrantPointsInput): Promise<{ balance: string; deduped: boolean }>
	/**
	 * Onboard a member: create their wallet if it does not exist and deposit a one-time starting
	 * grant. Idempotent per user (keyed on `onboard:{userId}`) — a repeat call grants nothing and
	 * returns `alreadyOnboarded: true`. `granted` is the amount credited on this call ('0' when
	 * already onboarded); `balance` is the resulting wallet balance.
	 */
	onboardUser(
		userId: string
	): Promise<{ balance: string; granted: string; alreadyOnboarded: boolean }>
	createMarket(input: CreateMarketInput): Promise<MarketDetail>
	/**
	 * Edit a non-terminal market's safe fields (closing time / question / description). `closesAt` is
	 * only editable while the market is open. Only fields that actually change are applied; the audit
	 * row records the acting admin. Returns the updated market plus which fields changed (computed
	 * atomically under the row lock) so the caller can refresh the post + announce exactly the changes.
	 */
	updateMarket(
		marketId: string,
		actorUserId: string,
		updates: UpdateMarketInput
	): Promise<MarketUpdateResult>
	/**
	 * Replace the active config (temporal supersession: closes the current active row, inserts a new
	 * active one — an append-only audited value-history). Full-replace: all three defaults are required.
	 * Hard-rejects (THRESHOLD_WOULD_STRAND) a threshold change that would leave a size-1 designated
	 * market unable to reach two-of-N. A no-op (values equal the active row) writes no new generation.
	 */
	updateConfig(input: UpdateConfigInput): Promise<PmConfigView>
	/**
	 * Place a bet. `deduped` is true when this was a duplicate delivery of an already-recorded
	 * bet (same idempotency key) — the prior bet is returned and no money moved. Callers must
	 * gate any non-idempotent side effect (e.g. a public "bet placed" post) on `deduped === false`.
	 */
	placeBet(input: PlaceBetInput): Promise<BetResult & { deduped: boolean }>
	closeMarket(input: { actorUserId: string; marketId: string }): Promise<void>
	/**
	 * Auto-close up to `limit` open markets whose close time has passed (bounded so a backlog
	 * can't blow the reconcile cron's budget; it drains over ticks). Returns the closed ids
	 * (empty on a no-op re-run). Idempotent.
	 */
	closeDueMarkets(limit?: number): Promise<{ closedMarketIds: string[] }>
	proposeResolution(input: {
		resolverId: string
		marketId: string
		outcomeId: string
		/**
		 * When true, skip the per-market designated-resolver membership check ONLY (never the
		 * conflict-of-interest guards). Core sets it for is_admin / `urn:markets:manager` holders so
		 * they retain "resolve any market" authority. Absent/false => the actor must be designated (or
		 * the market must be undesignated). A trusted, DO-unverifiable capability — derive it solely
		 * from a tier check, never a literal.
		 */
		bypassDesignated?: boolean
	}): Promise<ResolveResult>
	approveResolution(input: {
		resolverId: string
		marketId: string
		proposalId: string
		/** See proposeResolution.bypassDesignated. */
		bypassDesignated?: boolean
	}): Promise<ResolveResult>
	/** The single pending resolution proposal for a market (for two-of-N approve), or null. */
	getPendingProposal(marketId: string): Promise<PendingProposalView | null>
	voidMarket(input: {
		actorUserId: string
		marketId: string
		reason: string
		approverId?: string
		/** See proposeResolution.bypassDesignated. */
		bypassDesignated?: boolean
	}): Promise<void>
	/**
	 * Persist the Discord forum post mapping after Core creates the post.
	 * Pure UPDATE — the PM DO never calls Discord itself.
	 */
	attachDiscordPost(input: { marketId: string; threadId: string; messageId: string }): Promise<void>
}
