/**
 * Prediction Markets (admin) feature types.
 *
 * Re-exports shared row types from @repo/prediction-markets and defines
 * UI-facing request/response/filter shapes for the Layer-1 admin API.
 * All monetary fields are integer strings (numeric) — DISPLAY ONLY, never Number() math.
 */

import type {
	CreateMarketInput,
	GlobalLedgerRow,
	GrantPointsInput,
	LedgerType,
	MarketDetail,
	MarketHistoryRow,
	MarketStatus,
	MarketSummary,
	Paged,
	PmConfigView,
	StrandedMarket,
	ThresholdImpact,
	UpdateConfigInput,
	UpdateMarketInput,
	WalletRow,
} from '@repo/prediction-markets'

export type {
	GlobalLedgerRow,
	LedgerType,
	MarketDetail,
	MarketHistoryRow,
	MarketStatus,
	MarketSummary,
	// Re-exported from the DO contract so the L1 list endpoints share one paged envelope.
	Paged,
	PmConfigView,
	StrandedMarket,
	ThresholdImpact,
	WalletRow,
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

/**
 * Deposit (grant) wire body. Derived from the DO contract minus the server-injected `actorUserId`
 * (the core route fills it from the session), so it can never drift from GrantPointsInput.
 */
export type DepositRequest = Omit<GrantPointsInput, 'actorUserId'>

export interface DepositResponse {
	/** Resulting wallet balance, integer string. */
	balance: string
	deduped: boolean
}

// --- markets ---------------------------------------------------------------

/**
 * Market-create wire body. Derived from the DO contract minus the fields the server injects from the
 * session (`createdBy`) and the server-set policy flags (`enforceRateLimit`, `createdByAdmin`), so the
 * admin and member create forms stay in lockstep with CreateMarketInput without exposing a server-only
 * flag as client-settable.
 */
export type CreateMarketRequest = Omit<
	CreateMarketInput,
	'createdBy' | 'enforceRateLimit' | 'createdByAdmin'
>

export interface CreateMarketResponse {
	market: MarketDetail
	/** Discord forum post ids, or null if posting failed / not configured. */
	post: { threadId: string; messageId: string } | null
	/** Human-readable reason the forum post did not publish (market still created). */
	postError: string | null
}

/** Partial admin edit of a market's safe fields (at least one present). Identical to the DO contract. */
export type UpdateMarketRequest = UpdateMarketInput

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

/**
 * Full-replace config write. Derived from the DO contract minus the server-injected `actorUserId`.
 * (Previously re-declared here with `changeNote: string`, which had drifted from the contract's
 * `changeNote?: string | null` — deriving keeps the wire type and the DO input in lockstep.)
 */
export type UpdateConfigRequest = Omit<UpdateConfigInput, 'actorUserId'>
