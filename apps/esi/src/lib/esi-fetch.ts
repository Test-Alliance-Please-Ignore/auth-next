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

import { AsyncLocalStorage } from 'node:async_hooks'

import { getStub } from '@repo/do-utils'
import {
	buildEsiUserKey,
	buildPublicEsiUserKey,
	canonicalizeEsiEntityId,
	CharacterDeletedError,
	EsiRequestClient,
	EsiRequestError,
} from '@repo/esi'
import {
	EsiRateLimitStore,
	normalizeEsiRouteKey,
	parseEsiRateLimitHeaders,
} from '@repo/esi-rate-limit'
import { logger } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'

import { EsiCache } from './cache'

import type { EsiCacheScopeContext, EsiResponse } from '@repo/esi'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'

// ========================================================================
// OPTIONS & TYPES
// ========================================================================

/**
 * Options for fetchEsi and fetchEsiPaginated
 */
export interface FetchEsiOptions<B = unknown> {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
	/** Override the ESI compatibility date for this request. */
	compatibilityDate?: string
	/** Include the ESI version path configured on the request client. */
	includeVersionPath?: boolean
	/** Request body for mutation requests. */
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
	/** Override the underlying ESI request retry count for latency-sensitive calls. */
	maxRetries?: number
	/** Abort the underlying ESI fetch after this many milliseconds. */
	timeoutMs?: number
}

/** Authentication and cache policy for one inbound ESI RPC call. */
type EsiRequestContext = {
	authCharacterId: string | null
	cacheScope: EsiCacheScopeContext
	userKey: string
}

// ========================================================================
// PUBLIC DATA FETCHING
// ========================================================================
export class EsiFetcher {
	private cache: EsiCache
	private readonly esiRateLimits: EsiRateLimitStore
	private readonly requestClient: EsiRequestClient
	private readonly requestContext = new AsyncLocalStorage<EsiRequestContext>()

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

	async withCorporationContext<T>(
		corporationId: string,
		operation: () => Promise<T>,
		authCharacterId?: string
	): Promise<T> {
		const corporationData = getStub<EveCorporationData>(
			this.env.EVE_CORPORATION_DATA,
			corporationId
		)
		const directorId = authCharacterId
			? canonicalizeEsiEntityId(authCharacterId, 'character')
			: await corporationData.getLoadBalancedDirector(corporationId)
		if (!directorId) {
			throw new Error('No director found for corporation')
		}

		return await this.requestContext.run(
			{
				authCharacterId: directorId,
				cacheScope: { scope: 'corporation', scopeId: corporationId },
				userKey: buildEsiUserKey(this.env.EVE_SSO_CLIENT_ID, directorId),
			},
			operation
		)
	}

	async withCharacterContext<T>(characterId: string, operation: () => Promise<T>): Promise<T> {
		if (!characterId) throw new Error('Character ID is required')

		return await this.requestContext.run(
			{
				authCharacterId: characterId,
				cacheScope: { scope: 'character', scopeId: characterId },
				userKey: buildEsiUserKey(this.env.EVE_SSO_CLIENT_ID, characterId),
			},
			operation
		)
	}

	async withPublicContext<T>(operation: () => Promise<T>): Promise<T> {
		return await this.requestContext.run(
			{
				authCharacterId: null,
				cacheScope: EsiFetcher.PUBLIC_SCOPE,
				userKey: buildPublicEsiUserKey(),
			},
			operation
		)
	}

	private getRequestContext(): EsiRequestContext {
		const context = this.requestContext.getStore()
		if (!context) {
			throw new Error('ESI request attempted outside an authentication context')
		}
		return context
	}

	private async fetchBearerToken(characterId: string): Promise<string> {
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const token = await tokenStore.getAccessToken(characterId)
		if (!token) {
			throw new Error('No token found for character')
		}
		return token
	}

	// ========================================================================
	// RESPONSE HANDLING
	// ========================================================================

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
	 * Build the same structured error for single-page and paginated requests.
	 * Keeping this in one place ensures callers can consistently classify ESI
	 * failures regardless of which transport helper they use.
	 */
	private async buildEsiRequestError(
		path: string,
		response: Response,
		body: string
	): Promise<Error> {
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
				return new CharacterDeletedError(deletedCharId)
			}
		}

		logger.error('[EsiFetcher] ESI request failed', {
			path,
			status: response.status,
			statusText: response.statusText,
			errorText: body || 'Unknown error',
		})
		const rateLimit = parseEsiRateLimitHeaders(response.headers)
		const retryAfterMs =
			typeof rateLimit.retryAfterSeconds === 'number' ? rateLimit.retryAfterSeconds * 1_000 : null
		const errorLimitResetAt =
			typeof rateLimit.errorLimitResetSeconds === 'number'
				? new Date(Date.now() + rateLimit.errorLimitResetSeconds * 1_000).toISOString()
				: null
		const metadata = {
			status: response.status,
			path,
			retryAfterSeconds: rateLimit.retryAfterSeconds ?? null,
			errorLimitRemain: rateLimit.errorLimitRemain ?? null,
			errorLimitResetSeconds: rateLimit.errorLimitResetSeconds ?? null,
		}

		return new EsiRequestError(
			`ESI request failed: ${response.status} ${response.statusText} - ${body || 'Unknown error'} | metadata=${JSON.stringify(metadata)}`,
			{
				status: response.status,
				routeKey: normalizeEsiRouteKey(path),
				retryAfterMs,
				errorLimitRemain: rateLimit.errorLimitRemain ?? null,
				errorLimitResetAt,
				upstreamRequestId:
					response.headers.get('X-Request-ID') ?? response.headers.get('X-Correlation-ID') ?? null,
			}
		)
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
		const context = this.getRequestContext()
		const cacheScope = options?.cacheScopeOverride ?? context.cacheScope
		const cacheMode = options?.cacheMode ?? 'default'
		const method = options?.method ?? 'GET'
		const accessToken = context.authCharacterId
			? await this.fetchBearerToken(context.authCharacterId)
			: null

		return await this.requestClient.request<T>({
			path,
			userKey: context.userKey,
			compatibilityDate: options?.compatibilityDate,
			includeVersionPath: options?.includeVersionPath,
			cacheScope,
			cacheMode,
			method,
			accessToken,
			jsonBody: options?.body,
			timeoutMs: options?.timeoutMs,
			maxRetries: options?.maxRetries,
			maxLocalCacheTtl: options?.maxLocalCacheTtl,
			persistGlobalCache: options?.persistGlobalCache ?? context.authCharacterId === null,
			parse: (response) => this.parseJsonBodySafe<T>(response, path),
			buildError: ({ response, body }) => this.buildEsiRequestError(path, response, body),
		})
	}

	/**
	 * Fetch newest-first pages until a domain-provided watermark is reached.
	 * The caller owns the watermark and deduplication; ESI owns request policy.
	 */
	async fetchEsiPagesUntilWatermark<T extends { id: string | number; date?: string | Date }>(
		basePath: string,
		watermark: { maxId: string | null; maxDate: string | null },
		options?: FetchEsiOptions
	): Promise<{ data: T[]; pages: number; pagesFetched: number; stoppedAtWatermark: boolean }> {
		if (!watermark.maxId) {
			const result = await this.fetchEsiPaginated<T>(basePath, options)
			return {
				data: result.data,
				pages: result.pages ?? 1,
				pagesFetched: result.pages ?? 1,
				stoppedAtWatermark: false,
			}
		}

		const cleanPath = basePath.replace(/[?&]page=\d+/, '')
		const separator = cleanPath.includes('?') ? '&' : '?'
		const firstPage = await this.fetchEsi<T[]>(`${cleanPath}${separator}page=1`, options)
		const pages = firstPage.pages ?? 1
		const data = [...firstPage.data]
		const maxDate = parseDateOrNull(watermark.maxDate)
		let pagesFetched = 1
		let watermarkSeen = false

		const compareNumericIds = (left: string, right: string): number => {
			const leftValue = BigInt(left)
			const rightValue = BigInt(right)
			return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1
		}
		const reachedWatermark = (entries: T[]): boolean => {
			if (entries.some((entry) => String(entry.id) === watermark.maxId)) {
				watermarkSeen = true
			}
			if (!watermarkSeen) {
				return false
			}
			return !entries.some((entry) => {
				const entryId = String(entry.id)
				if (entryId === watermark.maxId) return false
				if (compareNumericIds(entryId, watermark.maxId!) > 0) return true
				const entryDate = parseDateOrNull(entry.date)
				return maxDate !== null && entryDate !== null && entryDate >= maxDate
			})
		}

		if (reachedWatermark(firstPage.data)) {
			return { data, pages, pagesFetched, stoppedAtWatermark: true }
		}

		for (let page = 2; page <= pages; page += 1) {
			const response = await this.fetchEsi<T[]>(`${cleanPath}${separator}page=${page}`, options)
			pagesFetched += 1
			data.push(...response.data)
			if (reachedWatermark(response.data)) {
				return { data, pages, pagesFetched, stoppedAtWatermark: true }
			}
		}

		return { data, pages, pagesFetched, stoppedAtWatermark: false }
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
		const context = this.getRequestContext()
		const cacheScope = options?.cacheScopeOverride ?? context.cacheScope
		const method = options?.method ?? 'GET'
		const accessToken = context.authCharacterId
			? await this.fetchBearerToken(context.authCharacterId)
			: null

		return await this.requestClient.requestPaginated<T>({
			path,
			userKey: context.userKey,
			compatibilityDate: options?.compatibilityDate,
			includeVersionPath: options?.includeVersionPath,
			cacheScope,
			cacheMode: options?.cacheMode ?? 'default',
			method,
			accessToken,
			jsonBody: options?.body,
			timeoutMs: options?.timeoutMs,
			maxRetries: options?.maxRetries,
			maxLocalCacheTtl: options?.maxLocalCacheTtl,
			persistGlobalCache: options?.persistGlobalCache ?? context.authCharacterId === null,
			parse: (response) => this.parseJsonBodySafe<T[]>(response, path),
			buildError: ({ response, body }) => this.buildEsiRequestError(path, response, body),
		})
	}
}
