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
	MarketHistoryRow,
	MarketStatus,
	WalletRow,
} from '@repo/prediction-markets'

export type { GlobalLedgerRow, LedgerType, MarketHistoryRow, MarketStatus, WalletRow }

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
