import type { UserPermission } from '@repo/groups'

export const GROUPS_WITH_DISCORD_CACHE_KEY = 'groups-with-discord-servers'

export class GroupsDOCache {
	private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes
	private readonly MAX_CACHE_ENTRIES = 1000

	constructor(
		private state: DurableObjectState,
		private envKv: KVNamespace | undefined, // For categories KV cache
		private discordServersCache: Map<string, { data: any[]; expires: number }>,
		private groupMembersCache: Map<string, { data: string[]; expires: number }>,
		private permissionsCache: Map<string, { data: UserPermission[]; expires: number }>,
		private corporationPermissionsCache: Map<string, { data: UserPermission[]; expires: number }>
	) {}

	/**
	 * Set a cache entry with LRU eviction when the cache is full.
	 * Removes the oldest entry (first inserted) when limit is reached.
	 */
	private setCacheEntry<T>(
		cache: Map<string, { data: T; expires: number }>,
		key: string,
		data: T
	): void {
		// Evict oldest entry if cache is at capacity
		if (cache.size >= this.MAX_CACHE_ENTRIES && !cache.has(key)) {
			const oldestKey = cache.keys().next().value
			if (oldestKey !== undefined) {
				cache.delete(oldestKey)
			}
		}
		cache.set(key, { data, expires: Date.now() + this.CACHE_TTL })
	}

	/**
	 * Invalidate the categories cache in Workers KV
	 */
	async invalidateCategoriesCache(): Promise<void> {
		const cacheKey = 'categories:all:v1'
		await this.envKv?.delete(cacheKey)
	}

	/**
	 * Invalidate the groups with Discord attachment cache in DO storage
	 */
	async invalidateGroupsWithDiscordCache(): Promise<void> {
		await this.state.storage.delete(GROUPS_WITH_DISCORD_CACHE_KEY)
	}

	/**
	 * Invalidate the group members cache for a specific group
	 */
	invalidateGroupMembersCache(groupId: string): void {
		this.groupMembersCache.delete(groupId)
	}

	/**
	 * Invalidate permissions cache for a specific user
	 */
	invalidateUserPermissionsCache(userId: string): void {
		this.permissionsCache.delete(userId)
	}

	/**
	 * Invalidate all permissions caches (for global permission changes)
	 */
	invalidateAllPermissionsCache(): void {
		this.permissionsCache.clear()
	}

	/**
	 * Invalidate corporation permissions cache for a specific corporation
	 */
	invalidateCorporationPermissionsCache(corporationId: string): void {
		this.corporationPermissionsCache.delete(corporationId)
		// Also clear user permissions cache since corporation permissions are included in getUserPermissions
		// We don't know which users belong to this corporation without expensive queries, so clear all
		this.permissionsCache.clear()
	}

	// --- User Permission Cache Accessors ---

	getCachedUserPermissions(userId: string): UserPermission[] | null {
		const cached = this.permissionsCache.get(userId)
		if (cached && cached.expires > Date.now()) {
			return cached.data
		}
		return null
	}

	cacheUserPermissions(userId: string, permissions: UserPermission[]): void {
		this.setCacheEntry(this.permissionsCache, userId, permissions)
	}

	// --- Corporation Permission Cache Accessors ---

	getCachedCorporationPermissions(corporationId: string): UserPermission[] | null {
		const cached = this.corporationPermissionsCache.get(corporationId)
		if (cached && cached.expires > Date.now()) {
			return cached.data
		}
		return null
	}

	cacheCorporationPermissions(corporationId: string, permissions: UserPermission[]): void {
		this.setCacheEntry(this.corporationPermissionsCache, corporationId, permissions)
	}
}
