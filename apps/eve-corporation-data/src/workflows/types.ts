import type { EveCorporationSyncDataType } from '@repo/eve-corporation-data'

/**
 * Workflow parameters for corporation data synchronization
 */
export interface EveCorporationSyncParams {
	/** Corporation ID to sync */
	corporationId: string
	/** Optional: specific data types to sync (defaults to all) */
	dataTypes?: EveCorporationSyncDataType[]
	/** Trigger source (cron or api) */
	trigger: 'cron' | 'api'
}

/**
 * Director info returned from selection step (JSON-serializable)
 */
export interface DirectorInfo {
	directorId: string
	characterId: string
	characterName: string
}

/**
 * Aggregated sync statistics returned from the workflow
 */
export interface SyncStats {
	corporationName?: string
	totalMembers?: number
	departedMembers?: number
	walletsCount?: number
	walletJournalFetchedCount?: number
	walletJournalPersistedNewRows?: number
	walletJournalMaxId?: string | null
	walletJournalMaxDate?: string | null
	walletTransactionsFetchedCount?: number
	walletTransactionsPersistedNewRows?: number
	walletTransactionsMaxId?: string | null
	walletTransactionsMaxDate?: string | null
	assetsCount?: number
	structuresCount?: number
	ordersCount?: number
	contractsCount?: number
	industryJobsCount?: number
	killmailsCount?: number
}

/**
 * Workflow return payload
 */
export interface EveCorporationSyncResult {
	success: true
	corporationId: string
	trigger: 'cron' | 'api'
	stats: SyncStats
}
