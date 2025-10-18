/**
 * EveUniverse Durable Object Interface
 *
 * This package provides TypeScript interfaces for the EveUniverse Durable Object
 * which caches EVE universe names for IDs (skills, items, systems, regions, etc).
 *
 * The actual implementation lives in apps/esi/src/eve-universe.ts
 */

// ========== Types ==========

export interface UniverseName {
	id: number
	name: string
	category: string
}

export interface NameCacheEntry {
	id: number
	name: string
	category: string
	cached_at: number
}

// ========== Durable Object Interface ==========

/**
 * EveUniverse Durable Object Interface
 *
 * Provides cached lookups for EVE universe names from IDs.
 * Uses the ESI /universe/names endpoint with heavy caching since
 * these values almost never change.
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/esi/src/eve-universe.ts
 */
export interface EveUniverse {
	/**
	 * Get names for multiple IDs
	 * @param ids - Array of IDs to look up
	 * @returns Array of universe names
	 */
	getNames(ids: number[]): Promise<UniverseName[]>

	/**
	 * Get name for a single ID
	 * @param id - ID to look up
	 * @returns Universe name or null if not found
	 */
	getName(id: number): Promise<UniverseName | null>

	/**
	 * Batch upsert names into cache (used for preloading)
	 * @param names - Array of universe names to cache
	 */
	cacheNames(names: UniverseName[]): Promise<void>

	/**
	 * Clear old cache entries
	 * @param olderThan - Timestamp to clear entries older than (default: 30 days ago)
	 */
	clearOldCache(olderThan?: number): Promise<void>
}
