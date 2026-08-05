import { TimeCache } from '@repo/hono-helpers'

import type { managedCorporations } from '../db/schema'

type CorporationRow = typeof managedCorporations.$inferSelect

export type CorporationStaticRow = Omit<
	CorporationRow,
	'lastSync' | 'lastVerified' | 'isVerified' | 'healthyDirectorCount'
>
export type CorporationDirectorStatus = Pick<
	CorporationRow,
	'lastVerified' | 'isVerified' | 'healthyDirectorCount'
>
export type CorporationSyncStatus = Pick<CorporationRow, 'lastSync'>

export type CorporationListCacheEntry = {
	data: CorporationStaticRow[]
	totalCount: number
}

// Static corporation metadata changes infrequently. Mutations clear the affected
// page cache, while this TTL remains a backstop for writes from other processes.
export const CORPORATION_LIST_CACHE_TTL_MS = 60 * 60 * 1000
export const CORPORATION_STATUS_CACHE_TTL_MS = 15 * 60 * 1000

export const corporationListCache = new TimeCache<CorporationListCacheEntry>(
	CORPORATION_LIST_CACHE_TTL_MS,
	250
)
export const corporationDirectorStatusCache = new TimeCache<CorporationDirectorStatus>(
	CORPORATION_STATUS_CACHE_TTL_MS,
	1000
)
export const corporationSyncStatusCache = new TimeCache<CorporationSyncStatus>(
	CORPORATION_STATUS_CACHE_TTL_MS,
	1000
)
export const corporationHealthCache = new TimeCache<number | null>(
	CORPORATION_STATUS_CACHE_TTL_MS,
	1000
)

export function clearCorporationListCache(): void {
	corporationListCache.clear()
}

export function clearCorporationDirectorHealthCache(corporationId: string): void {
	corporationDirectorStatusCache.delete(corporationId)
	corporationHealthCache.delete(corporationId)
}

export function clearCorporationSyncStatusCache(corporationId: string): void {
	corporationSyncStatusCache.delete(corporationId)
}

export function clearCorporationStatusCache(corporationId: string): void {
	clearCorporationDirectorHealthCache(corporationId)
	clearCorporationSyncStatusCache(corporationId)
}
