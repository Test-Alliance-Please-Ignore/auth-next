import {
	buildPublicEsiUserKey,
	EsiRateLimitGuard,
	normalizeEsiRouteKey,
	parseEsiRateLimitHeaders,
} from '@repo/esi-rate-limit'
import { hashString } from '@repo/fetch-utils'

import type { EsiRateLimitStore } from '@repo/esi-rate-limit'

export type EsiCacheScope = 'character' | 'corporation' | 'public' | 'global'

export type EsiCacheScopeContext = {
	scope: EsiCacheScope
	scopeId: string
}

export interface EsiResponse<T> {
	data: T
	/** Upstream HTTP status when observed; cache-only entries omit it. */
	status?: number
	expiresAt: Date | null
	etag: string | null
	pages: number | null
	page: number | null
	lastModified?: Date
	cached?: boolean
	/** True only when this call conditionally revalidated a prior cached response. */
	revalidated?: boolean
}

/** Serializable response metadata that typed RPC callers may consume. */
export interface EsiResultMeta {
	status: number
	etag: string | null
	expiresAt: string | null
	lastModified: string | null
	pages: number | null
	page: number | null
	cached: boolean
	revalidated: boolean
}

/**
 * Optional endpoint-specific result envelope. ESI retains the raw Response,
 * cache keys, headers, and request policy; callers receive only safe metadata.
 */
export interface EsiResult<T> {
	data: T
	meta: EsiResultMeta
}

/** Safe operational error context for typed ESI callers. */
export class EsiRequestError extends Error {
	constructor(
		message: string,
		readonly context: {
			status: number
			routeKey: string
			retryAfterMs: number | null
			errorLimitRemain: number | null
			errorLimitResetAt: string | null
			upstreamRequestId: string | null
		}
	) {
		super(message)
		this.name = 'EsiRequestError'
	}
}

export function toEsiResult<T>(response: EsiResponse<T>): EsiResult<T> {
	return {
		data: response.data,
		meta: {
			status: response.status ?? 200,
			etag: response.etag,
			expiresAt: response.expiresAt?.toISOString() ?? null,
			lastModified: response.lastModified?.toISOString() ?? null,
			pages: response.pages,
			page: response.page,
			cached: response.cached ?? false,
			revalidated: response.revalidated ?? false,
		},
	}
}

export interface EsiCacheAdapter {
	getCachedResponse<T>(
		scope: EsiCacheScopeContext,
		path: string,
		page?: number,
		includeExpired?: boolean
	): Promise<EsiResponse<T> | null>
	setCachedResponse<T>(
		scope: EsiCacheScopeContext,
		path: string,
		response: EsiResponse<T>,
		page?: number,
		options?: { persistGlobal?: boolean }
	): Promise<void>
}

export interface EsiRequestErrorContext {
	path: string
	routeKey: string
	userKey: string
	response: Response
	body: string
	source?: 'upstream' | 'preflight'
}

export interface EsiRequestResponseContext {
	path: string
	routeKey: string
	userKey: string
	response: Response
}

export interface EsiRequestOptions<T> {
	path: string
	userKey: string
	cacheScope?: EsiCacheScopeContext
	cacheMode?: 'default' | 'no-store'
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
	accessToken?: string | null
	accessTokenFactory?: () => Promise<string | null> | string | null
	cachedResponse?: EsiResponse<T> | null
	jsonBody?: unknown
	extraHeaders?: Record<string, string>
	contentType?: string | false
	timeoutMs?: number
	/** Override the client retry count for this request. Zero means no retry. */
	maxRetries?: number
	maxLocalCacheTtl?: number
	persistGlobalCache?: boolean
	onResponse?: (context: EsiRequestResponseContext) => Promise<void> | void
	parse: (response: Response) => Promise<T> | T
	buildError: (context: EsiRequestErrorContext) => Error | Promise<Error>
}

export interface EsiPaginatedRequestOptions<T> extends Omit<EsiRequestOptions<T[]>, 'path'> {
	path: string
}

export interface EsiRequestClientOptions {
	rateLimits: EsiRateLimitStore
	cache?: EsiCacheAdapter
	debugLogger?: {
		debug(message: string, meta?: Record<string, unknown>): void
	}
	baseUrl?: string
	compatibilityDate?: string
	maxRetries?: number
	fetchImpl?: typeof fetch
}

const DEFAULT_BASE_URL = 'https://esi.evetech.net/latest'
const DEFAULT_COMPATIBILITY_DATE = '2025-11-06'
const DEFAULT_MAX_RETRIES = 5
const DEFAULT_PUBLIC_SCOPE: EsiCacheScopeContext = {
	scope: 'public',
	scopeId: buildPublicEsiUserKey(),
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseEsiCacheExpiry(headers: Headers): Date {
	const now = Date.now()
	const maxExpiry = now + 12 * 60 * 60 * 1000
	let expiresAt: Date

	const expires = headers.get('Expires')
	if (expires) {
		expiresAt = new Date(expires)
	} else {
		const cacheControl = headers.get('Cache-Control')
		if (cacheControl) {
			const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
			if (maxAgeMatch) {
				expiresAt = new Date(now + Number.parseInt(maxAgeMatch[1] ?? '0', 10) * 1000)
			} else {
				expiresAt = new Date(now + 5 * 60 * 1000)
			}
		} else {
			expiresAt = new Date(now + 5 * 60 * 1000)
		}
	}

	if (expiresAt.getTime() > maxExpiry) {
		return new Date(maxExpiry)
	}

	return expiresAt
}

export function parseXPages(headers: Headers): number | null {
	const xPages = headers.get('X-Pages')
	if (!xPages) return null
	const pages = Number.parseInt(xPages, 10)
	return Number.isFinite(pages) ? pages : null
}

export function extractPageFromPath(path: string): number | null {
	const pageMatch = path.match(/[?&]page=(\d+)/)
	return pageMatch ? Number.parseInt(pageMatch[1] ?? '', 10) : null
}

export function removePageFromPath(path: string): string {
	let cleaned = path.replace(/[?&]page=\d+/, '')
	cleaned = cleaned.replace(/[?&]$/, '')
	cleaned = cleaned.replace(/^([^?]*)&/, '$1?')
	return cleaned
}

function buildRequestInit(options: {
	method?: string
	accessToken?: string | null
	jsonBody?: unknown
	extraHeaders?: Record<string, string>
	contentType?: string | false
	timeoutMs?: number
	cachedEtag?: string | null
	compatibilityDate: string
}): RequestInit {
	const method = (options.method ?? (options.jsonBody !== undefined ? 'POST' : 'GET')).toUpperCase()
	const headers: Record<string, string> = {
		'X-Compatibility-Date': options.compatibilityDate,
		Accept: 'application/json',
	}

	if (options.accessToken) {
		headers.Authorization = `Bearer ${options.accessToken}`
	}

	if (
		options.contentType !== false &&
		(options.jsonBody !== undefined || ['POST', 'PUT', 'PATCH'].includes(method))
	) {
		headers['Content-Type'] = 'application/json'
	}

	if (options.extraHeaders) {
		for (const [key, value] of Object.entries(options.extraHeaders)) {
			headers[key] = value
		}
	}

	if (options.cachedEtag) {
		headers['If-None-Match'] = options.cachedEtag
	}

	const requestInit: RequestInit = {
		method,
		headers,
	}

	if (options.jsonBody !== undefined) {
		requestInit.body = JSON.stringify(options.jsonBody)
	}

	if (options.timeoutMs !== undefined) {
		const abortSignal = (
			globalThis as unknown as {
				AbortSignal?: { timeout(ms: number): unknown }
			}
		).AbortSignal?.timeout(options.timeoutMs)
		if (abortSignal) {
			requestInit.signal = abortSignal as RequestInit['signal']
		}
	}

	return requestInit
}

export class EsiRequestClient {
	private readonly rateLimitGuard: EsiRateLimitGuard
	private readonly baseUrl: string
	private readonly compatibilityDate: string
	private readonly maxRetries: number
	private readonly fetchImpl: typeof fetch

	constructor(private readonly options: EsiRequestClientOptions) {
		this.rateLimitGuard = new EsiRateLimitGuard(options.rateLimits)
		this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
		this.compatibilityDate = options.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE
		this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
		this.fetchImpl = options.fetchImpl ?? fetch
	}

	private getCacheScope(scope?: EsiCacheScopeContext): EsiCacheScopeContext {
		return scope ?? DEFAULT_PUBLIC_SCOPE
	}

	private async getCachePath(path: string, method: string, jsonBody?: unknown): Promise<string> {
		let cachePath = removePageFromPath(path)

		if (method === 'POST' && jsonBody !== undefined) {
			const bodyStr = JSON.stringify(jsonBody)
			const bodyHash = await hashString(bodyStr)
			cachePath = `${cachePath}:body:${bodyHash}`
		}

		return cachePath
	}

	private async readResponseErrorBody(response: Response): Promise<string> {
		try {
			return await response.text()
		} catch {
			return ''
		}
	}

	private debug(message: string, meta?: Record<string, unknown>): void {
		this.options.debugLogger?.debug(message, meta)
	}

	private async handleRetryDelay(response: Response, retryCount: number): Promise<void> {
		const retryAfter = response.headers.get('Retry-After')
		let waitSeconds: number
		if (retryAfter) {
			waitSeconds = Number.parseInt(retryAfter, 10)
		} else {
			const baseDelay = 1
			const backoffMultiplier = 2
			waitSeconds = Math.min(baseDelay * Math.pow(backoffMultiplier, retryCount), 60)
		}

		await sleep(waitSeconds * 1000)
	}

	async request<T>(options: EsiRequestOptions<T>): Promise<EsiResponse<T>> {
		const cacheScope = this.getCacheScope(options.cacheScope)
		const cacheMode = options.cacheMode ?? 'default'
		const method = options.method ?? (options.jsonBody !== undefined ? 'POST' : 'GET')
		const persistGlobalCache = options.persistGlobalCache ?? true
		const cachePage = extractPageFromPath(options.path) ?? undefined
		const cachePath = await this.getCachePath(options.path, method, options.jsonBody)

		const providedCached = options.cachedResponse ?? null
		let cached: EsiResponse<T> | null = providedCached
		if (!cached && cacheMode !== 'no-store' && this.options.cache) {
			cached = await this.options.cache.getCachedResponse<T>(
				cacheScope,
				cachePath,
				cachePage,
				false
			)
		}

		if (cached && options.maxLocalCacheTtl !== undefined) {
			const shouldRevalidate =
				!cached.lastModified ||
				(Date.now() - cached.lastModified.getTime()) / 1000 > options.maxLocalCacheTtl

			if (!shouldRevalidate) {
				return { ...cached, cached: true }
			}

			cached = null
		} else if (cached) {
			return { ...cached, cached: true }
		}

		const expiredCached =
			cacheMode === 'no-store' || !this.options.cache
				? null
				: (cached ??
					providedCached ??
					(await this.options.cache.getCachedResponse<T>(cacheScope, cachePath, cachePage, true)))
		const cachedEtag = expiredCached?.etag ?? null
		const userKey = options.userKey
		const routeKey = normalizeEsiRouteKey(options.path)
		let accessToken = options.accessToken
		if (accessToken === undefined && options.accessTokenFactory) {
			accessToken = (await options.accessTokenFactory()) ?? null
		}

		this.debug('ESI request starting', {
			path: options.path,
			routeKey,
			userKey,
			method,
			cacheMode,
			cacheHit: Boolean(cached),
			hasCachedEtag: Boolean(cachedEtag),
			hasAccessToken: Boolean(accessToken),
		})

		const maxRetries = Math.max(0, options.maxRetries ?? this.maxRetries)
		let retryCount = 0
		let response: Response
		const fetchImpl = this.fetchImpl

		while (true) {
			const requestInit = buildRequestInit({
				method,
				accessToken,
				jsonBody: options.jsonBody,
				extraHeaders: options.extraHeaders,
				contentType: options.contentType,
				timeoutMs: options.timeoutMs,
				cachedEtag,
				compatibilityDate: this.compatibilityDate,
			})

			try {
				response = await this.rateLimitGuard.withResponseRateLimit(
					options.path,
					userKey,
					async () => fetchImpl(`${this.baseUrl}${options.path}`, requestInit)
				)
			} catch (error) {
				this.debug('ESI request blocked before fetch', {
					path: options.path,
					routeKey,
					userKey,
					method,
					cacheMode,
					rateLimitSource: 'preflight',
					error: error instanceof Error ? error.message : String(error),
				})
				throw error
			}

			const rateLimitSnapshot = parseEsiRateLimitHeaders(response.headers)
			this.debug('ESI response received', {
				path: options.path,
				routeKey,
				userKey,
				method,
				status: response.status,
				rateLimitSource:
					response.status === 420 || response.status === 429 ? 'upstream' : undefined,
				retryCount,
				rateLimit: rateLimitSnapshot,
			})

			if (response.status === 420 || response.status === 429) {
				if (retryCount >= maxRetries - 1) {
					this.debug('ESI request exhausted retries', {
						path: options.path,
						routeKey,
						userKey,
						method,
						status: response.status,
						retryCount,
						rateLimit: rateLimitSnapshot,
					})
					await options.onResponse?.({
						path: options.path,
						routeKey: normalizeEsiRouteKey(options.path),
						userKey,
						response,
					})
					const body = await this.readResponseErrorBody(response)
					throw await options.buildError({
						path: options.path,
						routeKey: normalizeEsiRouteKey(options.path),
						userKey,
						response,
						body,
						source: 'upstream',
					})
				}

				this.debug('ESI request retry scheduled', {
					path: options.path,
					routeKey,
					userKey,
					method,
					status: response.status,
					retryCount,
					retryAfterSeconds: rateLimitSnapshot.retryAfterSeconds,
				})
				await this.handleRetryDelay(response, retryCount)
				retryCount++
				continue
			}

			break
		}

		await options.onResponse?.({
			path: options.path,
			routeKey: normalizeEsiRouteKey(options.path),
			userKey,
			response,
		})

		if (response.status === 304) {
			if (!expiredCached) {
				throw new Error(
					`ESI response returned 304 but no cached data was available for ${options.path}`
				)
			}

			const newExpiresAt = parseEsiCacheExpiry(response.headers)
			const updatedResponse: EsiResponse<T> = {
				data: expiredCached.data,
				status: response.status,
				expiresAt: newExpiresAt,
				etag: expiredCached.etag,
				pages: expiredCached.pages,
				page: expiredCached.page,
			}

			if (cacheMode !== 'no-store' && this.options.cache) {
				await this.options.cache.setCachedResponse(
					cacheScope,
					cachePath,
					updatedResponse,
					cachePage,
					{
						persistGlobal: persistGlobalCache,
					}
				)
			}

			return { ...updatedResponse, cached: true, revalidated: true }
		}

		if (!response.ok) {
			const body = await this.readResponseErrorBody(response)
			throw await options.buildError({
				path: options.path,
				routeKey: normalizeEsiRouteKey(options.path),
				userKey,
				response,
				body,
				source: 'upstream',
			})
		}

		const data = await options.parse(response)
		const expiresAt = parseEsiCacheExpiry(response.headers)
		const etag = response.headers.get('ETag')
		const pages = parseXPages(response.headers)
		const responsePage = cachePage ?? (pages && pages > 1 ? 1 : null)

		const esiResponse: EsiResponse<T> = {
			data,
			status: response.status,
			expiresAt,
			etag: etag ?? null,
			pages,
			page: responsePage,
			cached: false,
		}

		if (cacheMode !== 'no-store' && this.options.cache) {
			await this.options.cache.setCachedResponse(cacheScope, cachePath, esiResponse, cachePage, {
				persistGlobal: persistGlobalCache,
			})
		}

		return esiResponse
	}

	async requestPaginated<T>(options: EsiPaginatedRequestOptions<T>): Promise<EsiResponse<T[]>> {
		const firstPagePath = options.path.includes('?')
			? `${options.path}&page=1`
			: `${options.path}?page=1`
		const firstPageResponse = await this.request<T[]>({
			...options,
			path: firstPagePath,
		})

		const totalPages = firstPageResponse.pages ?? 1
		if (totalPages <= 1) {
			return firstPageResponse
		}

		const allData: T[] = [
			...(Array.isArray(firstPageResponse.data)
				? firstPageResponse.data
				: [firstPageResponse.data]),
		]

		for (let page = 2; page <= totalPages; page++) {
			const pagePath = options.path.includes('?')
				? `${options.path}&page=${page}`
				: `${options.path}?page=${page}`
			const pageResponse = await this.request<T[]>({
				...options,
				path: pagePath,
			})

			if (Array.isArray(pageResponse.data)) {
				allData.push(...pageResponse.data)
			} else {
				allData.push(pageResponse.data)
			}
		}

		return {
			data: allData,
			expiresAt: firstPageResponse.expiresAt,
			etag: firstPageResponse.etag,
			pages: totalPages,
			page: null,
			cached: firstPageResponse.cached ?? false,
		}
	}
}

export { buildEsiUserKey, buildPublicEsiUserKey } from '@repo/esi-rate-limit'
