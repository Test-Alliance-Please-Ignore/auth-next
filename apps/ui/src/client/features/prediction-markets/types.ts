/**
 * Prediction Markets (admin) feature types.
 *
 * Re-exports shared row types from @repo/prediction-markets and defines
 * UI-facing request/response/filter shapes for the Layer-1 admin API.
 * All monetary fields are integer strings (numeric) — DISPLAY ONLY, never Number() math.
 */

import type {
	GlobalLedgerRow,
	LedgerType,
	MarketDetail,
	MarketHistoryRow,
	MarketStatus,
	MarketSummary,
	PmConfigView,
	StrandedMarket,
	ThresholdImpact,
	WalletRow,
} from '@repo/prediction-markets'

export type {
	GlobalLedgerRow,
	LedgerType,
	MarketDetail,
	MarketHistoryRow,
	MarketStatus,
	MarketSummary,
	PmConfigView,
	StrandedMarket,
	ThresholdImpact,
	WalletRow,
}

/** Generic paged envelope returned by every L1 list endpoint. */
export interface Paged<T> {
	rows: T[]
	total: number
}

/** Enriched display identity attached to wallet/ledger rows by the core route. */
export interface DisplayIdentity {
	userName: string | null
	mainCharacterId: string | null
}

export type AdminWalletRow = WalletRow & DisplayIdentity

export interface WalletDetail extends DisplayIdentity {
	userId: string
	balance: string
}

export type AdminLedgerRow = GlobalLedgerRow & DisplayIdentity

export type AdminMarketHistoryRow = MarketHistoryRow & {
	actor: DisplayIdentity | null
}

// --- filters ---------------------------------------------------------------

export interface WalletsFilters {
	search?: string
	sort?: 'balance' | 'updatedAt' | 'userId'
	order?: 'asc' | 'desc'
	limit?: number
	offset?: number
}

export interface LedgerFilters {
	limit?: number
	offset?: number
}

export interface AuditLedgerFilters {
	userId?: string
	type?: LedgerType
	marketId?: string
	since?: string
	until?: string
	limit?: number
	offset?: number
}

export interface MarketHistoryFilters {
	marketId?: string
	includeInternal?: boolean
	since?: string
	until?: string
	limit?: number
	offset?: number
}

// --- deposit mutation ------------------------------------------------------

export interface DepositRequest {
	targetUserId: string
	/** Integer string (numeric). DISPLAY ONLY — never Number() arithmetic. */
	amount: string
	reason: string
	idempotencyKey?: string
}

export interface DepositResponse {
	/** Resulting wallet balance, integer string. */
	balance: string
	deduped: boolean
}

// --- markets ---------------------------------------------------------------

export interface CreateMarketRequest {
	question: string
	description?: string
	outcomes: string[]
	/** ISO-8601 timestamp when betting closes. */
	closesAt: string
	/** ISO-8601 expected resolution date. Required; must be at or after closesAt. */
	resolvesOn: string
	rakeBps?: number
	/** Integer strings (numeric). DISPLAY ONLY — never Number() arithmetic. */
	minStake?: string
	maxStake?: string
	perUserCap?: string
	twoOfN?: boolean
	/**
	 * Optional core user ids to designate as this market's resolver(s). Admin surface only; the server
	 * validates each holds the resolver tier and rejects designating the creator. Omit/empty => the
	 * market uses global resolver authority.
	 */
	designatedResolverIds?: string[]
}

export interface CreateMarketResponse {
	market: MarketDetail
	/** Discord forum post ids, or null if posting failed / not configured. */
	post: { threadId: string; messageId: string } | null
	/** Human-readable reason the forum post did not publish (market still created). */
	postError: string | null
}

/** Partial admin edit of a market's safe fields. At least one must be present. */
export interface UpdateMarketRequest {
	/** ISO-8601; must be in the future. */
	closesAt?: string
	question?: string
	description?: string | null
}

export interface UpdateMarketResponse {
	market: MarketDetail
}

export interface MarketsFilters {
	status?: MarketStatus
	limit?: number
}

export interface MarketsResponse {
	markets: MarketSummary[]
	/** Configured markets guild id, for building forum thread deep-links. */
	guildId: string | null
}

// --- config ----------------------------------------------------------------

/** Full-replace config write. Monetary fields are integer strings; threshold null = disable two-of-N. */
export interface UpdateConfigRequest {
	defaultRakeBps: number
	defaultMinStake: string
	twoOfNThreshold: string | null
	changeNote?: string
}
