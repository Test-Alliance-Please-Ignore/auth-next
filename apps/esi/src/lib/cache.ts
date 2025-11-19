import { logger } from '@repo/hono-helpers'

import { createEsiDb, eq } from '../storage'
import { esiCache } from '../storage/schema'

import type { EsiDb } from '../storage'
import type { EsiResponse } from './types'

/**
 * Checks if a response is expired
 * @param response - The response to check
 * @returns True if the response is expired, false otherwise
 */
function isExpired<T extends { expiresAt: Date | null }>(response: T): boolean {
	// If expires at is not set, the response never expires
	if (!response.expiresAt) {
		return false
	}
	return Date.now() > response.expiresAt.getTime()
}

export class EsiCache {
	private logger = logger.withTags({ component: 'esi-cache' })
	private storage: EsiDb

	constructor(private state: DurableObjectState) {
		this.storage = createEsiDb(this.state.storage)
	}

	private getCacheKey(characterId: string, path: string): string {
		this.logger.debug('Getting cache key', { characterId, path })
		return `esi:${characterId}:${path}`
	}

	async getCachedResponse<T>(characterId: string, path: string): Promise<EsiResponse<T> | null> {
		const cacheKey = this.getCacheKey(characterId, path)
		const cachedResponse = await this.storage.query.esiCache.findFirst({
			where: eq(esiCache.cacheKey, cacheKey),
		})

		if (!cachedResponse) {
			this.logger.debug('No cached response found', { cacheKey })
			return null
		}

		if (isExpired(cachedResponse)) {
			this.logger.debug('Cached response expired. Deleting from db and returning null ', {
				cacheKey,
			})
			await this.storage.delete(esiCache).where(eq(esiCache.cacheKey, cacheKey))
			return null
		}

		this.logger.debug('Returning cached response', { cacheKey })
		return {
			data: cachedResponse.data as T,
			expiresAt: cachedResponse.expiresAt ?? null,
			etag: cachedResponse.etag ?? null,
			pages: cachedResponse.pages ?? null,
			page: cachedResponse.page ?? null,
		}
	}

	async setCachedResponse<T>(
		characterId: string,
		path: string,
		response: EsiResponse<T>
	): Promise<void> {
		const cacheKey = this.getCacheKey(characterId, path)
		const lastModified = new Date()

		this.logger.debug('Setting cached response', {
			cacheKey,
			lastModified,
			response: {
				expiresAt: response.expiresAt ?? null,
				etag: response.etag ?? null,
				pages: response.pages ?? null,
				page: response.page ?? null,
			},
		})
		try {
			this.logger.debug('Inserting cached response into db', { cacheKey })
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
