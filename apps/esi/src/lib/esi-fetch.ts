/**
 * ESI Fetch Service
 *
 * Contains all ESI fetching logic extracted from the Durable Object.
 * These functions are pure business logic that can be called from workflows or DO methods.
 *
 * This separation allows:
 * - Workflows to orchestrate fetching without coupling to DO
 * - DO to focus on data storage operations
 * - Easy testing of fetch logic
 * - Reusability across different contexts
 */

import { getStub } from '@repo/do-utils'
import { EveCorporationData } from '@repo/eve-corporation-data'
import { logger } from '@repo/hono-helpers'

import { EsiCache } from './cache'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'
import type { CacheScopeContext } from './cache'
import type { EsiResponse } from './types'

// ========================================================================
// PUBLIC DATA FETCHING
// ========================================================================
export class EsiFetcher {
	private characterId: string | null = null
	private cache: EsiCache
	private cacheScope: CacheScopeContext | null = null

	private static readonly PUBLIC_SCOPE: CacheScopeContext = {
		scope: 'public',
		scopeId: 'public',
	}

	constructor(
		private state: DurableObjectState,
		private env: Env
	) {
		this.cache = new EsiCache(this.state, this.env.ESI_GLOBAL_CACHE)
	}

	async clearAuthentication(): Promise<void> {
		this.characterId = null
		this.cacheScope = null
	}

	async authenticateWithCorporation(corporationId: string): Promise<void> {
		logger.info(`[EsiFetcher] Authenticating with corporation: ${corporationId}`)

		const corporationData = getStub<EveCorporationData>(
			this.env.EVE_CORPORATION_DATA,
			corporationId
		)

		logger.info(`[EsiFetcher] Getting load-balanced director for corporation: ${corporationId}`)
		const directorId = await corporationData.getLoadBalancedDirector(corporationId)
		logger.info(`[EsiFetcher] Load-balanced director: ${directorId}`)

		if (!directorId) {
			throw new Error('No director found for corporation')
		}
		await this.authenticateWithCharacter(directorId)
		this.cacheScope = { scope: 'corporation', scopeId: corporationId }
	}

	async authenticateWithCharacter(characterId: string): Promise<void> {
		logger.info(`[EsiFetcher] Authenticating with character: ${characterId}`)
		if (typeof characterId !== 'string') {
			throw new Error('Character ID must be a string')
		}
		if (!characterId) {
			throw new Error('Character ID is required')
		}
		this.characterId = characterId
		this.cacheScope = { scope: 'character', scopeId: characterId }
	}

	async fetchBearerToken(): Promise<string> {
		if (!this.characterId) {
			throw new Error('No character ID authenticated')
		}
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const token = await tokenStore.getAccessToken(this.characterId)
		if (!token) {
			throw new Error('No token found for character')
		}
		return `Bearer ${token}`
	}

	// ========================================================================
	// HELPER METHODS
	// ========================================================================

	/**
	 * Parse cache expiry from ESI response headers
	 * Checks Expires header first, then Cache-Control max-age, defaults to 5 minutes
	 */
	private parseEsiCacheExpiry(headers: Headers): Date {
		// Check Expires header first
		const expires = headers.get('Expires')
		if (expires) {
			return new Date(expires)
		}

		// Check Cache-Control header
		const cacheControl = headers.get('Cache-Control')
		if (cacheControl) {
			const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
			if (maxAgeMatch) {
				return new Date(Date.now() + parseInt(maxAgeMatch[1], 10) * 1000)
			}
		}

		// Default: 5 minutes
		return new Date(Date.now() + 5 * 60 * 1000)
	}

	/**
	 * Parse X-Pages header from ESI response
	 * Returns null if header is not present or invalid
	 */
	private parseXPages(headers: Headers): number | null {
		const xPages = headers.get('X-Pages')
		if (!xPages) {
			return null
		}
		const pages = parseInt(xPages, 10)
		return isNaN(pages) ? null : pages
	}

	/**
	 * Handle rate limiting by waiting for Retry-After header
	 * Throws error if max retries exceeded
	 */
	private async handleRateLimit(response: Response, retryCount: number): Promise<void> {
		const maxRetries = 5
		if (retryCount >= maxRetries) {
			throw new Error(`Rate limit exceeded after ${maxRetries} retries. Status: ${response.status}`)
		}

		// Use Retry-After header if available, otherwise use exponential backoff
		const retryAfter = response.headers.get('Retry-After')
		let waitSeconds: number

		if (retryAfter) {
			waitSeconds = parseInt(retryAfter, 10)
		} else {
			// Exponential backoff: 1s, 2s, 4s, 8s, 16s
			const baseDelay = 1
			const backoffMultiplier = 2
			waitSeconds = Math.min(baseDelay * Math.pow(backoffMultiplier, retryCount), 60) // Cap at 60s
		}

		logger.info(
			`[EsiFetcher] Rate limited (${response.status}), waiting ${waitSeconds}s before retry ${retryCount + 1}/${maxRetries}`
		)
		await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
	}

	/**
	 * Build request headers for ESI API calls
	 * Includes authentication, compatibility date, and ETag if provided
	 */
	private async buildRequestHeaders(cachedEtag: string | null): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			'X-Compatibility-Date': '2025-11-06',
			Accept: 'application/json',
		}

		// Add authentication if character is authenticated
		if (this.characterId) {
			try {
				const token = await this.fetchBearerToken()
				headers['Authorization'] = token
			} catch (error) {
				// If token fetch fails, continue without auth (for public endpoints)
				logger.warn('[EsiFetcher] Failed to fetch bearer token, continuing without auth', {
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		// Add ETag for conditional request
		if (cachedEtag) {
			headers['If-None-Match'] = cachedEtag
		}

		return headers
	}

	/**
	 * Get the active cache scope (defaults to public if unauthenticated)
	 */
	private getActiveCacheScope(): CacheScopeContext {
		return this.cacheScope ?? EsiFetcher.PUBLIC_SCOPE
	}

	/**
	 * Extract page number from URL path
	 */
	private extractPageFromPath(path: string): number | null {
		const pageMatch = path.match(/[?&]page=(\d+)/)
		return pageMatch ? parseInt(pageMatch[1], 10) : null
	}

	/**
	 * Remove page parameter from path for cache key generation
	 */
	private removePageFromPath(path: string): string {
		// Remove page parameter from query string
		let cleaned = path.replace(/[?&]page=\d+/, '')
		// Clean up trailing ? or & if they're now at the end
		cleaned = cleaned.replace(/[?&]$/, '')
		// If we removed ?page=X and now have & at the start, replace with ?
		cleaned = cleaned.replace(/^([^?]*)\&/, '$1?')
		return cleaned
	}

	// ========================================================================
	// FETCH METHODS
	// ========================================================================

	/**
	 * Fetch data from ESI API (unpaginated endpoints)
	 * Handles caching, ETag-based conditional requests, and rate limiting
	 * @param path - ESI API path
	 * @param cacheScopeOverride - Optional override for cache scope (defaults to authenticated scope or public)
	 */
	async fetchEsi<T>(path: string, cacheScopeOverride?: CacheScopeContext): Promise<EsiResponse<T>> {
		const cacheScope = cacheScopeOverride ?? this.getActiveCacheScope()
		const page = this.extractPageFromPath(path)
		const cachePage = page ?? undefined
		// Use path without page parameter for cache key
		const cachePath = this.removePageFromPath(path)

		// 1. Check cache for valid (non-expired) entries
		const cached = await this.cache.getCachedResponse<T>(cacheScope, cachePath, cachePage, false)
		if (cached) {
			logger.debug('[EsiFetcher] Cache hit', { path, cacheScope })
			return cached
		}

		// 2. Get expired cache entry for ETag (even if expired, we can use ETag for conditional request)
		const expiredCached = await this.cache.getCachedResponse<T>(
			cacheScope,
			cachePath,
			cachePage,
			true
		)
		const cachedEtag = expiredCached?.etag ?? null
		const headers = await this.buildRequestHeaders(cachedEtag)

		// 3. Make request with retry logic for rate limiting
		let retryCount = 0
		let response: Response

		while (true) {
			try {
				response = await fetch(`https://esi.evetech.net/latest${path}`, { headers })

				// Handle rate limiting (420 and 429 are both rate limit errors)
				if (response.status === 420 || response.status === 429) {
					await this.handleRateLimit(response, retryCount)
					retryCount++
					continue // Retry the request
				}

				// Break out of retry loop for other status codes
				break
			} catch (error) {
				logger.error('[EsiFetcher] Network error during fetch', {
					path,
					error: error instanceof Error ? error.message : String(error),
				})
				throw new Error(
					`ESI fetch failed for ${path}: ${error instanceof Error ? error.message : String(error)}`
				)
			}
		}

		// 4. Handle 304 Not Modified
		if (response.status === 304) {
			// We need the cached data (even if expired) to return it
			if (!expiredCached) {
				// This shouldn't happen, but if it does, treat as cache miss
				logger.warn('[EsiFetcher] 304 received but no cached data available', { path, cacheScope })
				// Fall through to make a new request
			} else {
				// Update cache expiry with new expiry from response
				const newExpiresAt = this.parseEsiCacheExpiry(response.headers)
				const updatedResponse: EsiResponse<T> = {
					data: expiredCached.data,
					expiresAt: newExpiresAt,
					etag: expiredCached.etag,
					pages: expiredCached.pages,
					page: expiredCached.page,
				}
				await this.cache.setCachedResponse(cacheScope, cachePath, updatedResponse, cachePage)
				logger.debug('[EsiFetcher] 304 Not Modified, returning cached response', {
					path,
					cacheScope,
				})
				return updatedResponse
			}
		}

		// 5. Handle error responses
		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error')
			logger.error('[EsiFetcher] ESI request failed', {
				path,
				status: response.status,
				statusText: response.statusText,
				errorText,
			})
			throw new Error(
				`ESI request failed: ${response.status} ${response.statusText} - ${errorText}`
			)
		}

		// 6. Parse response
		const data = (await response.json()) as T
		const expiresAt = this.parseEsiCacheExpiry(response.headers)
		const etag = response.headers.get('ETag')
		const pages = this.parseXPages(response.headers)
		const responsePage = page ?? (pages && pages > 1 ? 1 : null)

		const esiResponse: EsiResponse<T> = {
			data,
			expiresAt,
			etag: etag ?? null,
			pages,
			page: responsePage,
		}

		// 7. Cache response
		await this.cache.setCachedResponse(cacheScope, cachePath, esiResponse, cachePage)

		logger.debug('[EsiFetcher] Successfully fetched and cached response', {
			path,
			cacheScope,
			hasEtag: !!etag,
			pages,
		})

		return esiResponse
	}

	/**
	 * Fetch paginated data from ESI API
	 * Automatically fetches all pages and combines results
	 */
	async fetchEsiPaginated<T>(path: string): Promise<EsiResponse<T[]>> {
		const cacheScope = this.getActiveCacheScope()

		// 1. Fetch first page
		const firstPagePath = path.includes('?') ? `${path}&page=1` : `${path}?page=1`
		const firstPageResponse = await this.fetchEsi<T[]>(firstPagePath, cacheScope)

		// 2. Check if pagination is needed
		const totalPages = firstPageResponse.pages ?? 1

		if (totalPages <= 1) {
			// Single page, return as-is
			return firstPageResponse
		}

		// 3. Fetch remaining pages
		const pagePromises: Promise<EsiResponse<T[]>>[] = []
		for (let page = 2; page <= totalPages; page++) {
			const pagePath = path.includes('?') ? `${path}&page=${page}` : `${path}?page=${page}`
			pagePromises.push(this.fetchEsi<T[]>(pagePath, cacheScope))
		}

		// 4. Wait for all pages (with rate limiting handled by fetchEsi)
		const remainingPages = await Promise.all(pagePromises)

		// 5. Combine all pages
		const allData: T[] = [
			...(Array.isArray(firstPageResponse.data)
				? firstPageResponse.data
				: [firstPageResponse.data]),
		]

		for (const pageResponse of remainingPages) {
			if (Array.isArray(pageResponse.data)) {
				allData.push(...pageResponse.data)
			} else {
				allData.push(pageResponse.data)
			}
		}

		// 6. Return combined response
		// Use the first page's expiry and ETag (they should be similar)
		return {
			data: allData,
			expiresAt: firstPageResponse.expiresAt,
			etag: firstPageResponse.etag,
			pages: totalPages,
			page: null, // Combined result, no single page
		}
	}
}
