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

export interface TypeInfo {
	type_id: number
	name: string
	group_id: number
	description: string
	published: boolean
	cached_at: number
}

export interface GroupInfo {
	group_id: number
	name: string
	category_id: number
	published: boolean
	cached_at: number
}

export interface CategoryInfo {
	category_id: number
	name: string
	published: boolean
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

	/**
	 * Get type information for multiple type IDs (includes group_id)
	 * @param typeIds - Array of type IDs to look up
	 * @returns Array of type information
	 */
	getTypes(typeIds: number[]): Promise<TypeInfo[]>

	/**
	 * Get group information for multiple group IDs (includes category_id)
	 * @param groupIds - Array of group IDs to look up
	 * @returns Array of group information
	 */
	getGroups(groupIds: number[]): Promise<GroupInfo[]>

	/**
	 * Get category information for multiple category IDs
	 * @param categoryIds - Array of category IDs to look up
	 * @returns Array of category information
	 */
	getCategories(categoryIds: number[]): Promise<CategoryInfo[]>

	/**
	 * Get complete skill hierarchy information for multiple skill IDs
	 * Returns skill name, group name, and category name for each skill
	 * @param skillIds - Array of skill IDs to look up
	 * @returns Array of skill hierarchy information
	 */
	getSkillHierarchy(skillIds: number[]): Promise<Array<{
		skill_id: number
		skill_name: string
		group_id: number
		group_name: string
		category_id: number
		category_name: string
	}>>
}
