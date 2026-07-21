import { isNull } from 'drizzle-orm'
import { logger } from '@repo/hono-helpers'

import { createEsiDb, eq } from '../storage'
import { esiCache } from '../storage/schema'

import type { EsiDb } from '../storage'
import type { EsiResponse } from './types'

export type CacheScope = 'character' | 'corporation' | 'public' | 'global'

export type CacheScopeContext = {
	scope: CacheScope
	scopeId: string
}

/** Maximum cache age: 12 hours (in milliseconds) - applies retroactively to all cached data */
const MAX_CACHE_AGE_MS = 12 * 60 * 60 * 1000

type SerializedCacheEntry<T> = {
	data: T
	expiresAt: string | null
	etag: string | null
	pages: number | null
	page: number | null
	scope: CacheScope
	scopeId: string
	lastModified?: string // ISO string of when cache entry was written
}

/**
 * Checks if a response is expired
 * Also enforces 12-hour maximum cache age based on lastModified timestamp
 * @param response - The response to check
 * @returns True if the response is expired, false otherwise
 */
function isExpired<T extends { expiresAt: Date | null; lastModified?: Date | null }>(
	response: T
): boolean {
	const now = Date.now()

	// Check if cache entry is older than 12 hours (retroactive enforcement)
	if (response.lastModified) {
		const age = now - response.lastModified.getTime()
		if (age > MAX_CACHE_AGE_MS) {
			return true
		}
	}

	// Check standard expiry
	if (!response.expiresAt) {
		return false
	}
	return now > response.expiresAt.getTime()
}

export class EsiCache {
	private logger = logger.withTags({ component: 'esi-cache' })
	private storage: EsiDb

	constructor(
		private state: DurableObjectState,
		private globalCache: KVNamespace
	) {
		this.storage = createEsiDb(this.state.storage)
	}

	private getCacheKey(scope: CacheScopeContext, path: string, page?: number): string {
		this.logger.debug('Getting cache key', { scope, path, page })
		const baseKey = `esi:${scope.scope}:${scope.scopeId}:${path}`
		if (page !== undefined) {
			return `${baseKey}:page:${page}`
		}
		return baseKey
	}

	private async getLocalCachedResponse<T>(
		cacheKey: string,
		includeExpired: boolean
	): Promise<EsiResponse<T> | null> {
		const cachedResponse = await this.storage.query.esiCache.findFirst({
			where: eq(esiCache.cacheKey, cacheKey),
		})

		if (!cachedResponse) {
			return null
		}

		const expired = isExpired(cachedResponse)

		if (expired && !includeExpired) {
			this.logger.debug('Cached response expired. Deleting from db and returning null ', {
				cacheKey,
			})
			await this.storage.delete(esiCache).where(eq(esiCache.cacheKey, cacheKey))
			return null
		}

		if (!cachedResponse.expiresAt) {
			this.logger.debug('Cached response is missing an expiry. Deleting legacy entry.', {
				cacheKey,
			})
			await this.storage.delete(esiCache).where(eq(esiCache.cacheKey, cacheKey))
			return null
		}

		return {
			data: cachedResponse.data as T,
			expiresAt: cachedResponse.expiresAt ?? null,
			etag: cachedResponse.etag ?? null,
			pages: cachedResponse.pages ?? null,
			page: cachedResponse.page ?? null,
			lastModified: cachedResponse.lastModified ?? undefined,
		}
	}

	private async deleteGlobalCache(cacheKey: string): Promise<void> {
		try {
			await this.globalCache.delete(cacheKey)
		} catch (error) {
			this.logger.warn('Failed to delete global cache entry', {
				cacheKey,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	private async getGlobalCachedResponse<T>(cacheKey: string): Promise<EsiResponse<T> | null> {
		try {
			const cached = await this.globalCache.get<string>(cacheKey)
			if (!cached) {
				return null
			}

			const parsed = JSON.parse(cached) as SerializedCacheEntry<T>
			if (!parsed.expiresAt) {
				this.logger.debug('Global cached response is missing an expiry. Deleting legacy entry.', {
					cacheKey,
				})
				await this.deleteGlobalCache(cacheKey)
				return null
			}

			const expiresAt = new Date(parsed.expiresAt)
			if (Number.isNaN(expiresAt.getTime())) {
				this.logger.debug('Global cached response has an invalid expiry. Deleting legacy entry.', {
					cacheKey,
					expiresAt: parsed.expiresAt,
				})
				await this.deleteGlobalCache(cacheKey)
				return null
			}

			return {
				data: parsed.data,
				expiresAt,
				etag: parsed.etag,
				pages: parsed.pages,
				page: parsed.page,
				lastModified: parsed.lastModified ? new Date(parsed.lastModified) : undefined,
			}
		} catch (error) {
			this.logger.warn('Failed to parse global cache entry', {
				cacheKey,
				error: error instanceof Error ? error.message : String(error),
			})
			await this.deleteGlobalCache(cacheKey)
			return null
		}
	}

	private calculateGlobalTtlSeconds(expiresAt: Date | null): number | null {
		if (!expiresAt) {
			return null
		}
		const ttlMs = expiresAt.getTime() - Date.now()
		if (ttlMs <= 0) {
			return null
		}
		return Math.max(1, Math.floor(ttlMs / 1000))
	}

	async purgeLegacyCacheEntries(): Promise<void> {
		this.logger.info('Purging legacy ESI cache entries without expiry')
		await this.storage.delete(esiCache).where(isNull(esiCache.expiresAt))

		let cursor: string | undefined
		do {
			const listing = await this.globalCache.list({
				prefix: 'esi:',
				cursor,
			})

			for (const entry of listing.keys) {
				try {
					const raw = await this.globalCache.get<string>(entry.name)
					if (!raw) {
						continue
					}

					const parsed = JSON.parse(raw) as Partial<SerializedCacheEntry<unknown>>
					if (parsed.expiresAt) {
						const expiresAt = new Date(parsed.expiresAt)
						if (!Number.isNaN(expiresAt.getTime())) {
							continue
						}
					}

					this.logger.debug('Deleting legacy global cache entry without expiry', {
						cacheKey: entry.name,
					})
					await this.deleteGlobalCache(entry.name)
				} catch (error) {
					this.logger.warn('Failed to inspect global cache entry during legacy purge', {
						cacheKey: entry.name,
						error: error instanceof Error ? error.message : String(error),
					})
					await this.deleteGlobalCache(entry.name)
				}
			}

			if (listing.list_complete) {
				break
			}
			cursor = listing.cursor
		} while (cursor)
	}

	async getCachedResponse<T>(
		scope: CacheScopeContext,
		path: string,
		page?: number,
		includeExpired = false
	): Promise<EsiResponse<T> | null> {
		const cacheKey = this.getCacheKey(scope, path, page)
		const cachedResponse = await this.getLocalCachedResponse<T>(cacheKey, includeExpired)

		if (cachedResponse) {
			if (isExpired(cachedResponse) && includeExpired) {
				this.logger.debug('Returning expired cached response (for ETag/304 handling)', {
					cacheKey,
				})
			} else {
				this.logger.debug('Returning cached response', { cacheKey })
			}
			return cachedResponse
		}

		this.logger.debug('Local cache miss, checking global cache', { cacheKey })
		const globalCachedResponse = await this.getGlobalCachedResponse<T>(cacheKey)

		if (!globalCachedResponse) {
			this.logger.debug('No global cached response found', { cacheKey })
			return null
		}

		const globalExpired = isExpired(globalCachedResponse)
		if (globalExpired && !includeExpired) {
			this.logger.debug('Global cached response expired, deleting', { cacheKey })
			await this.deleteGlobalCache(cacheKey)
			return null
		}

		this.logger.debug('Hydrating local cache from global cache', { cacheKey })
		await this.setCachedResponse(scope, path, globalCachedResponse, page, {
			persistGlobal: false,
		})

		return globalCachedResponse
	}

	private async persistGlobalCache<T>(
		cacheKey: string,
		response: EsiResponse<T>,
		scope: CacheScopeContext
	): Promise<void> {
		const ttlSeconds = this.calculateGlobalTtlSeconds(response.expiresAt ?? null)

		if (ttlSeconds === null) {
			this.logger.debug('Skipping global cache persistence due to missing or expired TTL', {
				cacheKey,
			})
			return
		}

		const serialized: SerializedCacheEntry<T> = {
			data: response.data,
			expiresAt: response.expiresAt ? response.expiresAt.toISOString() : null,
			etag: response.etag,
			page: response.page,
			pages: response.pages,
			scope: scope.scope,
			scopeId: scope.scopeId,
			lastModified: response.lastModified?.toISOString(),
		}

		try {
			await this.globalCache.put(cacheKey, JSON.stringify(serialized), {
				expirationTtl: ttlSeconds,
			})
			this.logger.debug('Persisted response to global cache', { cacheKey, ttlSeconds })
		} catch (error) {
			this.logger.warn('Failed to persist global cache entry', {
				cacheKey,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	async setCachedResponse<T>(
		scope: CacheScopeContext,
		path: string,
		response: EsiResponse<T>,
		page?: number,
		options?: { persistGlobal?: boolean }
	): Promise<void> {
		const cacheKey = this.getCacheKey(scope, path, page)
		const lastModified = new Date()
		const persistGlobal = options?.persistGlobal ?? true

		if (!response.expiresAt) {
			this.logger.warn('Skipping cache write for response without expiry', {
				cacheKey,
				scope,
			})
			await this.storage.delete(esiCache).where(eq(esiCache.cacheKey, cacheKey))
			if (persistGlobal) {
				await this.deleteGlobalCache(cacheKey)
			}
			return
		}

		this.logger.debug('Setting cached response', {
			cacheKey,
			scope,
			lastModified,
			response: {
				expiresAt: response.expiresAt ?? null,
				etag: response.etag ?? null,
				pages: response.pages ?? null,
				page: response.page ?? null,
			},
		})
		try {
			this.logger.debug('Setting cached response in db', { cacheKey, scope })
			// Delete existing entry first (if any) to ensure clean insert
			await this.storage.delete(esiCache).where(eq(esiCache.cacheKey, cacheKey))
			// Insert new entry
			await this.storage.insert(esiCache).values({
				cacheKey,
				data: response.data,
				expiresAt: response.expiresAt ?? null,
				etag: response.etag ?? null,
				lastModified,
				pages: response.pages ?? null,
				page: response.page ?? null,
			})
			this.logger.debug('Cached response set successfully', { cacheKey })

			if (persistGlobal) {
				// Include lastModified in the response for global cache persistence
				await this.persistGlobalCache(cacheKey, { ...response, lastModified }, scope)
			}
		} catch (error) {
			this.logger.error('Error setting cached response', {
				cacheKey,
				error: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}
}
