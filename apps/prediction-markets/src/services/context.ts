import type { MarketStatus, Visibility } from '@repo/prediction-markets'
import type { createDb } from '../db'

export type PmDatabase = ReturnType<typeof createDb>
export type PmTransaction = Parameters<Parameters<PmDatabase['transaction']>[0]>[0]
export type PmExecutor = PmDatabase | PmTransaction

export interface PmDeps {
	db: PmDatabase
}

export interface HistoryEntry {
	marketId: string
	actorUserId?: string | null
	action: string
	previousStatus?: MarketStatus | null
	newStatus?: MarketStatus | null
	visibility?: Visibility
	metadata?: unknown
}

/** One-time starting grant deposited on a member's first `/market onboard`. */
export const ONBOARDING_GRANT = '50'
/** Ledger reason recorded for the onboarding grant. */
export const ONBOARDING_REASON = 'Initial onboarding'
/**
 * Actor recorded for system-issued grants (e.g. onboarding). A sentinel string that is never a
 * real user id, so grantPoints' self-target guard is not tripped when a member onboards themselves.
 */
export const SYSTEM_ACTOR = 'system'

/**
 * Pull the underlying driver error off a Drizzle "Failed query: …" wrapper. Drizzle surfaces only
 * the SQL + params in `.message`; the real Postgres reason (e.g. `relation "pm_rate_limits" does
 * not exist`) lives on `.cause`. Logging the cause is what turns an opaque failure into a diagnosis.
 */
export function dbErrorCause(error: unknown): string | undefined {
	const cause = (error as { cause?: unknown } | null)?.cause
	if (cause == null) return undefined
	return cause instanceof Error ? cause.message : String(cause)
}
