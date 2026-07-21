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
import {
	CharacterDeletedError,
	EsiRequestClient,
	buildEsiUserKey,
	buildPublicEsiUserKey,
	type EsiCacheScopeContext,
	type EsiResponse,
} from '@repo/esi'
import { EveCorporationData } from '@repo/eve-corporation-data'
import { logger } from '@repo/hono-helpers'
import { EsiRateLimitStore, normalizeEsiRouteKey, parseEsiRateLimitHeaders } from '@repo/esi-rate-limit'

import { EsiCache } from './cache'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'

// ========================================================================
// OPTIONS & TYPES
// ========================================================================

/**
 * Options for fetchEsi and fetchEsiPaginated
 */
export interface FetchEsiOptions<B = unknown> {
	method?: 'GET' | 'POST'
	/** Request body for POST requests */
	body?: B
	/** Cache policy for this request. Stateful/auth-sensitive endpoints should use `no-store`. */
	cacheMode?: 'default' | 'no-store'
	/** Whether cache writes should be mirrored to KV/global cache when caching is enabled. */
	persistGlobalCache?: boolean
	/** Override the default cache scope (defaults to authenticated scope or public) */
	cacheScopeOverride?: EsiCacheScopeContext
	/**
	 * Maximum seconds to trust cache before ETag revalidation.
	 * If set, even non-expired cache entries will trigger conditional requests
	 * after this many seconds since the cache was written.
	 * Useful for long-cached endpoints where data might change (e.g., character names).
	 */
	maxLocalCacheTtl?: number
}

// ========================================================================
// PUBLIC DATA FETCHING
// ========================================================================
export class EsiFetcher {
	private characterId: string | null = null
	private cache: EsiCache
	private cacheScope: EsiCacheScopeContext | null = null
	private defaultCacheMode: 'default' | 'no-store' = 'default'
	private readonly esiRateLimits: EsiRateLimitStore
	private readonly requestClient: EsiRequestClient

	private static readonly PUBLIC_SCOPE: EsiCacheScopeContext = {
		scope: 'public',
		scopeId: 'public',
	}

	constructor(
		private state: DurableObjectState,
		private env: Env
	) {
		this.cache = new EsiCache(this.state, this.env.ESI_GLOBAL_CACHE)
		this.esiRateLimits = new EsiRateLimitStore(this.env.ESI_RATE_LIMITS)
		this.requestClient = new EsiRequestClient({
			rateLimits: this.esiRateLimits,
			cache: this.cache,
			debugLogger: logger,
			compatibilityDate: '2025-11-06',
		})
	}

	setDefaultCacheMode(mode: 'default' | 'no-store'): void {
		this.defaultCacheMode = mode
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
		return token
	}

	// ========================================================================
	// HELPER METHODS
	// ========================================================================

	/** Maximum cache TTL: 12 hours (in milliseconds) */
	private static readonly MAX_CACHE_TTL_MS = 12 * 60 * 60 * 1000

	/**
	 * Parse cache expiry from ESI response headers
	 * Checks Expires header first, then Cache-Control max-age, defaults to 5 minutes
	 * IMPORTANT: Caps all cache TTLs to 12 hours maximum regardless of ESI headers
	 */
	private parseEsiCacheExpiry(headers: Headers): Date {
		const now = Date.now()
		const maxExpiry = now + EsiFetcher.MAX_CACHE_TTL_MS
		let expiresAt: Date

		// Check Expires header first
		const expires = headers.get('Expires')
		if (expires) {
			expiresAt = new Date(expires)
		} else {
			// Check Cache-Control header
			const cacheControl = headers.get('Cache-Control')
			if (cacheControl) {
				const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
				if (maxAgeMatch) {
					expiresAt = new Date(now + parseInt(maxAgeMatch[1], 10) * 1000)
				} else {
					// Default: 5 minutes
					expiresAt = new Date(now + 5 * 60 * 1000)
				}
			} else {
				// Default: 5 minutes
				expiresAt = new Date(now + 5 * 60 * 1000)
			}
		}

		// Cap at 12 hours maximum
		if (expiresAt.getTime() > maxExpiry) {
			return new Date(maxExpiry)
		}

		return expiresAt
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
	 * Parse JSON response bodies with defensive error handling so unexpected
	 * non-JSON upstream bodies fail with actionable context.
	 */
	private async parseJsonBodySafe<T>(response: Response, path: string): Promise<T> {
		if (response.status === 204) {
			return null as T
		}

		const bodyText = await response.text()
		if (!bodyText.trim()) {
			return null as T
		}

		try {
			return JSON.parse(bodyText) as T
		} catch (error) {
			const contentType = response.headers.get('content-type') ?? 'unknown'
			const snippet = bodyText.slice(0, 240)
			logger.error('[EsiFetcher] Failed to parse JSON response body', {
				path,
				status: response.status,
				statusText: response.statusText,
				contentType,
				bodySnippet: snippet,
				error: error instanceof Error ? error.message : String(error),
			})
			throw new Error(
				`ESI response parse failed for ${path}: expected JSON but received ${contentType}`
			)
		}
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
	 * Includes authentication, compatibility date, content type for POST, and ETag if provided
	 */
	private async buildRequestHeaders(
		cachedEtag: string | null,
		method: 'GET' | 'POST' = 'GET'
	): Promise<{ headers: Record<string, string>; authenticated: boolean }> {
		const headers: Record<string, string> = {
			'X-Compatibility-Date': '2025-11-06',
			Accept: 'application/json',
		}
		let authenticated = false

		// Add Content-Type for POST requests
		if (method === 'POST') {
			headers['Content-Type'] = 'application/json'
		}

		// Add authentication if character is authenticated
		if (this.characterId) {
			try {
				const token = await this.fetchBearerToken()
				headers['Authorization'] = `Bearer ${token}`
				authenticated = true
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

		return { headers, authenticated }
	}

	/**
	 * Get the active cache scope (defaults to public if unauthenticated)
	 */
	private getActiveCacheScope(): EsiCacheScopeContext {
		return this.cacheScope ?? EsiFetcher.PUBLIC_SCOPE
	}

	private getRateLimitUserKey(authenticated: boolean): string {
		if (authenticated && this.characterId) {
			return buildEsiUserKey(this.env.EVE_SSO_CLIENT_ID, this.characterId)
		}
		return buildPublicEsiUserKey()
	}

	private async assertEsiRateLimitAllowance(path: string, userKey: string): Promise<void> {
		const routeKey = normalizeEsiRouteKey(path)
		const now = Date.now()

		const routeGroup = await this.esiRateLimits.getRouteGroup(routeKey)
		if (routeGroup) {
			const bucket = await this.esiRateLimits.getBucketSnapshot(routeGroup, userKey)
			if (bucket) {
				const retryAfterSeconds = bucket.retryAfterSeconds ?? Math.max(1, Math.ceil((bucket.expiresAtMs - now) / 1000))
				throw this.buildRateLimitPreflightError(path, routeKey, 'bucket', retryAfterSeconds, routeGroup)
			}
		}

		const routeErrorLimit = await this.esiRateLimits.getRouteErrorLimit(routeKey, userKey)
		if (routeErrorLimit) {
			const retryAfterSeconds =
				routeErrorLimit.retryAfterSeconds ?? Math.max(1, Math.ceil((routeErrorLimit.expiresAtMs - now) / 1000))
			throw this.buildRateLimitPreflightError(path, routeKey, 'error_limit', retryAfterSeconds)
		}

		const routeCooldown = await this.esiRateLimits.getRouteCooldown(routeKey, userKey)
		if (routeCooldown) {
			const retryAfterSeconds =
				routeCooldown.retryAfterSeconds ?? Math.max(1, Math.ceil((routeCooldown.expiresAtMs - now) / 1000))
			throw this.buildRateLimitPreflightError(path, routeKey, 'route_breaker', retryAfterSeconds)
		}
	}

	private buildRateLimitPreflightError(
		path: string,
		routeKey: string,
		circuitBreaker: 'error_limit' | 'bucket' | 'route_breaker',
		retryAfterSeconds: number,
		routeGroup?: string
	): Error {
		const metadata = JSON.stringify({
			status: 429,
			path,
			retryAfterSeconds,
			circuitBreaker,
			routeKey,
			routeGroup,
		})
		return new Error(`ESI request failed: 429 Too Many Requests - {"error":"ESI rate limit active"} | metadata=${metadata}`)
	}

	private async updateEsiRateLimitState(
		path: string,
		headers: Headers,
		status: number,
		userKey: string
	): Promise<void> {
		const routeKey = normalizeEsiRouteKey(path)
		const snapshot = parseEsiRateLimitHeaders(headers)
		const now = Date.now()

		if (snapshot.group) {
			await this.esiRateLimits.rememberRouteGroup(routeKey, snapshot.group)
		}

		if (snapshot.errorLimitRemain !== undefined && snapshot.errorLimitResetSeconds !== undefined) {
			await this.esiRateLimits.putRouteErrorLimit({
				userKey,
				routeKey,
				remaining: snapshot.errorLimitRemain,
				limit: snapshot.errorLimitRemain,
				used: snapshot.used,
				windowSeconds: snapshot.errorLimitResetSeconds,
				retryAfterSeconds: snapshot.retryAfterSeconds,
				observedAtMs: now,
				expiresAtMs: now + snapshot.errorLimitResetSeconds * 1000,
			})
			return
		}

		if (snapshot.group && snapshot.limit !== undefined && snapshot.windowSeconds !== undefined) {
			const remaining = snapshot.remaining ?? snapshot.limit
			const used = snapshot.used ?? Math.max(0, snapshot.limit - remaining)
			await this.esiRateLimits.putBucketSnapshot({
				group: snapshot.group,
				userKey,
				routeKey,
				status,
				limit: snapshot.limit,
				remaining,
				used,
				windowSeconds: snapshot.windowSeconds,
				retryAfterSeconds: snapshot.retryAfterSeconds,
				observedAtMs: now,
				expiresAtMs: now + snapshot.windowSeconds * 1000,
			})
			return
		}

		if (status === 429) {
			const retryAfterSeconds = snapshot.retryAfterSeconds ?? snapshot.errorLimitResetSeconds
			if (retryAfterSeconds !== undefined) {
				await this.esiRateLimits.putRouteCooldown({
					userKey,
					routeKey,
					retryAfterSeconds,
					observedAtMs: now,
					expiresAtMs: now + retryAfterSeconds * 1000,
				})
			}
		}
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
		cleaned = cleaned.replace(/^([^?]*)&/, '$1?')
		return cleaned
	}

	// ========================================================================
	// FETCH METHODS
	// ========================================================================

	/**
	 * Fetch data from ESI API (unpaginated endpoints)
	 * Handles caching, ETag-based conditional requests, and rate limiting
	 * @param path - ESI API path
	 * @param options - Optional fetch options (method, body, cache scope override, max local cache TTL)
	 */
	async fetchEsi<T, B = unknown>(
		path: string,
		options?: FetchEsiOptions<B>
	): Promise<EsiResponse<T>> {
		const cacheScope = options?.cacheScopeOverride ?? this.getActiveCacheScope()
		const cacheMode = options?.cacheMode ?? this.defaultCacheMode
		const method = options?.method ?? 'GET'
		const accessToken = this.characterId
			? await this.fetchBearerToken().catch((error) => {
					logger.warn('[EsiFetcher] Failed to fetch bearer token, continuing without auth', {
						error: error instanceof Error ? error.message : String(error),
					})
					return null
				})
			: null
		const authenticated = accessToken !== null
		const userKey = this.getRateLimitUserKey(authenticated)

		return await this.requestClient.request<T>({
			path,
			userKey,
			cacheScope,
			cacheMode,
			method,
			accessToken,
			jsonBody: options?.body,
			maxLocalCacheTtl: options?.maxLocalCacheTtl,
			persistGlobalCache: options?.persistGlobalCache ?? true,
			parse: (response) => this.parseJsonBodySafe<T>(response, path),
			buildError: async ({ response, body }) => {
				if (response.status === 404 && body.includes('Character has been deleted')) {
					const charMatch = path.match(/\/characters\/(\d+)/)
					if (charMatch) {
						const deletedCharId = charMatch[1]
						try {
							const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
							await tokenStore.markCharacterDeleted(deletedCharId)
						} catch (markError) {
							logger.warn('[EsiFetcher] Failed to mark character as deleted', {
								characterId: deletedCharId,
								error: markError instanceof Error ? markError.message : String(markError),
							})
						}
						throw new CharacterDeletedError(deletedCharId)
					}
				}

				logger.error('[EsiFetcher] ESI request failed', {
					path,
					status: response.status,
					statusText: response.statusText,
					errorText: body || 'Unknown error',
				})
				return new Error(
					`ESI request failed: ${response.status} ${response.statusText} - ${body || 'Unknown error'}`
				)
			},
		})
	}

	/**
	 * Fetch paginated data from ESI API
	 * Automatically fetches all pages and combines results
	 * @param path - ESI API path
	 * @param options - Optional fetch options (method, body, cache scope override, max local cache TTL)
	 */
	async fetchEsiPaginated<T, B = unknown>(
		path: string,
		options?: FetchEsiOptions<B>
	): Promise<EsiResponse<T[]>> {
		const cacheScope = options?.cacheScopeOverride ?? this.getActiveCacheScope()
		const method = options?.method ?? 'GET'
		const accessToken = this.characterId
			? await this.fetchBearerToken().catch((error) => {
					logger.warn('[EsiFetcher] Failed to fetch bearer token, continuing without auth', {
						error: error instanceof Error ? error.message : String(error),
					})
					return null
				})
			: null
		const authenticated = accessToken !== null
		const userKey = this.getRateLimitUserKey(authenticated)

		return await this.requestClient.requestPaginated<T>({
			path,
			userKey,
			cacheScope,
			cacheMode: options?.cacheMode ?? this.defaultCacheMode,
			method,
			accessToken,
			jsonBody: options?.body,
			maxLocalCacheTtl: options?.maxLocalCacheTtl,
			persistGlobalCache: options?.persistGlobalCache ?? true,
			parse: (response) => this.parseJsonBodySafe<T[]>(response, path),
			buildError: async ({ response, body }) => {
				if (response.status === 404 && body.includes('Character has been deleted')) {
					const charMatch = path.match(/\/characters\/(\d+)/)
					if (charMatch) {
						const deletedCharId = charMatch[1]
						try {
							const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
							await tokenStore.markCharacterDeleted(deletedCharId)
						} catch (markError) {
							logger.warn('[EsiFetcher] Failed to mark character as deleted', {
								characterId: deletedCharId,
								error: markError instanceof Error ? markError.message : String(markError),
							})
						}
						throw new CharacterDeletedError(deletedCharId)
					}
				}

				logger.error('[EsiFetcher] ESI request failed', {
					path,
					status: response.status,
					statusText: response.statusText,
					errorText: body || 'Unknown error',
				})
				return new Error(
					`ESI request failed: ${response.status} ${response.statusText} - ${body || 'Unknown error'}`
				)
			},
		})
	}
}
