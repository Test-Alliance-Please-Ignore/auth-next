import { logger } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'
import {
	buildEsiUserKey,
	EsiRequestClient,
	extractPageFromPath,
	type EsiCacheAdapter,
	type EsiCacheScopeContext,
	type EsiResponse,
} from '@repo/esi'
import {
	EsiRateLimitStore,
	parseEsiRateLimitHeaders,
	normalizeEsiRouteKey,
} from '@repo/esi-rate-limit'
import { getStub } from '@repo/do-utils'

import type { Env } from './context'
import type { ThirdPartyAppQuotaClient } from './quota'

export interface EsiProxyPayload {
	status: number
	statusText: string
	headers: Array<[string, string]>
	body: string
}

export class EsiProxyUpstreamError extends Error {
	constructor(
		public readonly status: number,
		public readonly statusText: string,
		public readonly headers: Array<[string, string]>,
		public readonly body: string
	) {
		super(`ESI proxy upstream request failed with ${status} ${statusText}`)
	}
}

const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'content-length',
	'content-encoding',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
])

function toProxyHeaders(headers: Array<[string, string]>): Headers {
	const responseHeaders = new Headers()
	for (const [key, value] of headers) {
		if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
			responseHeaders.append(key, value)
		}
	}
	return responseHeaders
}

function cacheKey(scope: EsiCacheScopeContext, path: string, page?: number): string {
	return `esi:proxy:${scope.scope}:${scope.scopeId}:${path}${page !== undefined ? `:page:${page}` : ''}`
}

class ThirdPartyAppsProxyCache implements EsiCacheAdapter {
	private readonly memory = new Map<string, EsiResponse<EsiProxyPayload>>()

	constructor(private readonly kv: KVNamespace) {}

	private deserialize<T>(value: string): EsiResponse<T> | null {
		try {
			const parsed = JSON.parse(value) as {
				data: T
				expiresAt: string | null
				etag: string | null
				pages: number | null
				page: number | null
				lastModified?: string
			}
			return {
				data: parsed.data,
				expiresAt: parseDateOrNull(parsed.expiresAt),
				etag: parsed.etag,
				pages: parsed.pages,
				page: parsed.page,
				lastModified: parseDateOrNull(parsed.lastModified) ?? undefined,
			}
		} catch (error) {
			logger.warn('[ThirdPartyAppsProxyCache] Failed to parse cache entry', {
				error: error instanceof Error ? error.message : String(error),
			})
			return null
		}
	}

	private isExpired(response: EsiResponse<unknown>): boolean {
		if (!response.expiresAt) return false
		return response.expiresAt.getTime() <= Date.now()
	}

	async getCachedResponse<T>(
		scope: EsiCacheScopeContext,
		path: string,
		page?: number,
		includeExpired = false
	): Promise<EsiResponse<T> | null> {
		const key = cacheKey(scope, path, page)
		const memoryHit = this.memory.get(key) as EsiResponse<T> | undefined
		if (memoryHit) {
			if (!includeExpired && this.isExpired(memoryHit)) {
				this.memory.delete(key)
			} else {
				return memoryHit
			}
		}

		const cached = await this.kv.get(key)
		if (!cached) {
			return null
		}

		const parsed = this.deserialize<T>(cached)
		if (!parsed) {
			await this.kv.delete(key)
			return null
		}

		if (!includeExpired && this.isExpired(parsed)) {
			await this.kv.delete(key)
			return null
		}

		this.memory.set(key, parsed as EsiResponse<EsiProxyPayload>)
		return parsed
	}

	async setCachedResponse<T>(
		scope: EsiCacheScopeContext,
		path: string,
		response: EsiResponse<T>,
		page?: number,
		options?: { persistGlobal?: boolean }
	): Promise<void> {
		const key = cacheKey(scope, path, page)
		const payload = {
			data: response.data,
			expiresAt: response.expiresAt ? response.expiresAt.toISOString() : null,
			etag: response.etag,
			pages: response.pages,
			page: response.page,
			lastModified: response.lastModified ? response.lastModified.toISOString() : undefined,
		}
		const typedResponse = response as EsiResponse<EsiProxyPayload>
		this.memory.set(key, typedResponse)
		if (options?.persistGlobal === false) {
			return
		}

		const expiresAt = response.expiresAt?.getTime() ?? Date.now() + 5 * 60 * 1000
		const ttlSeconds = Math.max(60, Math.min(12 * 60 * 60, Math.ceil((expiresAt - Date.now()) / 1000)))
		await this.kv.put(key, JSON.stringify(payload), {
			expirationTtl: ttlSeconds,
		})
	}
}

function buildProxyResponse(
	payload: EsiProxyPayload,
	headers?: HeadersInit
): Response {
	const responseHeaders = toProxyHeaders(payload.headers)
	if (headers) {
		const extraHeaders = new Headers(headers)
		for (const [key, value] of extraHeaders.entries()) {
			responseHeaders.set(key, value)
		}
	}

	return new Response(payload.body, {
		status: payload.status,
		statusText: payload.statusText,
		headers: responseHeaders,
	})
}

async function parseProxyJsonBody(request: Request, method: string): Promise<{
	ok: true
	value: unknown
} | {
	ok: false
	response: Response
}> {
	if (['GET', 'HEAD'].includes(method)) {
		return { ok: true, value: undefined }
	}

	const rawBody = await request.text()
	if (!rawBody.trim()) {
		return { ok: true, value: undefined }
	}

	const contentType = request.headers.get('content-type')
	if (contentType && !contentType.toLowerCase().includes('application/json')) {
		return {
			ok: false,
			response: Response.json(
				{
					error: 'unsupported_media_type',
					message: 'ESI proxy write requests must use a JSON request body.',
				},
				{ status: 415 }
			),
		}
	}

	try {
		return { ok: true, value: JSON.parse(rawBody) as unknown }
	} catch {
		return {
			ok: false,
			response: Response.json(
				{
					error: 'invalid_request',
					message: 'ESI proxy write request body must be valid JSON.',
				},
				{ status: 400 }
			),
		}
	}
}

export async function proxyEsiRequest(params: {
	env: Env
	request: Request
	path: string
	clientId: string
	characterId: string
	accessToken: string
	cacheScope: EsiCacheScopeContext
}): Promise<Response> {
	const rateLimits = new EsiRateLimitStore(params.env.ESI_RATE_LIMITS)
	const cache = new ThirdPartyAppsProxyCache(params.env.ESI_PROXY_CACHE)
	const client = new EsiRequestClient({
		rateLimits,
		cache,
		debugLogger: logger,
		baseUrl: 'https://esi.evetech.net',
		compatibilityDate: '2025-11-06',
	})

	const method = params.request.method.toUpperCase()
	const cachePage = extractPageFromPath(params.path) ?? undefined
	const routeKey = normalizeEsiRouteKey(params.path)
	const knownGroup = await rateLimits.getRouteGroup(routeKey)
	const parsedBody = await parseProxyJsonBody(params.request, method)
	if (!parsedBody.ok) {
		return parsedBody.response
	}
	const freshCached = await cache.getCachedResponse<EsiProxyPayload>(params.cacheScope, params.path, cachePage, false)

	if (freshCached) {
		return buildProxyResponse(freshCached.data, {
			'X-Third-Party-Cache': 'HIT',
			'X-Third-Party-Proxy-Mode': 'cached',
			'X-Third-Party-Quota-Remaining': 'skipped',
		})
	}

	const quotaBucketKey = knownGroup ?? routeKey
	const quota = getStub<ThirdPartyAppQuotaClient>(params.env.THIRD_PARTY_APP_QUOTA, params.clientId)
	const quotaDecision = await quota.consume(params.clientId, quotaBucketKey, 1)
	if (!quotaDecision.allowed) {
		return Response.json(
			{
				error: 'rate_limited',
				message: 'This third-party application has reached its proxy quota.',
			},
			{
				status: 429,
				headers: {
					'Retry-After': String(quotaDecision.retryAfterSeconds ?? 1),
					'X-RateLimit-Limit': String(quotaDecision.limit),
					'X-RateLimit-Remaining': String(quotaDecision.remaining),
				},
			}
		)
	}

	const supportsBody = !['GET', 'HEAD'].includes(method)
	const contentType = params.request.headers.get('content-type')
	const accept = params.request.headers.get('accept') ?? 'application/json'
	let observedRateLimit = parseEsiRateLimitHeaders(new Headers())
	let observedResponseStatus: number | null = null
	let networkRequestSeen = false

	try {
		const result = await client.request<EsiProxyPayload>({
			path: params.path,
			userKey: buildEsiUserKey(params.env.EVE_SSO_CLIENT_ID, params.characterId),
			cacheScope: params.cacheScope,
			cacheMode: supportsBody ? 'no-store' : 'default',
			accessToken: params.accessToken,
			method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
			jsonBody: parsedBody.value,
			extraHeaders: {
				Accept: accept,
				'User-Agent': 'PleaseIgnore-ThirdPartyApps/1.0',
				...(contentType ? { 'Content-Type': contentType } : {}),
			},
			contentType: contentType ?? false,
			onResponse: ({ response }) => {
				networkRequestSeen = true
				observedResponseStatus = response.status
				observedRateLimit = parseEsiRateLimitHeaders(response.headers)
			},
			parse: async (response) => ({
				status: response.status,
				statusText: response.statusText,
				headers: Array.from(response.headers.entries()),
				body: await response.text(),
			}),
			buildError: async ({ response, body }) =>
				new EsiProxyUpstreamError(
					response.status,
					response.statusText,
					Array.from(response.headers.entries()),
					body
				),
		})

		if (networkRequestSeen && observedRateLimit.group && observedRateLimit.limit && observedRateLimit.windowSeconds) {
			await quota.observe(
				params.clientId,
				quotaBucketKey,
				observedRateLimit.group,
				observedRateLimit.limit,
				observedRateLimit.windowSeconds
			)
		}

		return buildProxyResponse(result.data, {
			'X-Third-Party-Cache': observedResponseStatus === 304 ? 'REVALIDATED' : 'MISS',
			'X-Third-Party-Proxy-Mode': networkRequestSeen ? 'upstream' : 'cached',
			'X-Third-Party-Quota-Limit': String(quotaDecision.limit),
			'X-Third-Party-Quota-Remaining': String(quotaDecision.remaining),
			...(observedRateLimit.group ? { 'X-Third-Party-ESI-Group': observedRateLimit.group } : {}),
		})
	} catch (error) {
		if (error instanceof EsiProxyUpstreamError) {
			return buildProxyResponse({
				status: error.status,
				statusText: error.statusText,
				headers: error.headers,
				body: error.body,
			}, {
				'X-Third-Party-Cache': observedResponseStatus === 304 ? 'REVALIDATED' : 'MISS',
				'X-Third-Party-Proxy-Mode': networkRequestSeen ? 'upstream' : 'cached',
				'X-Third-Party-Quota-Limit': String(quotaDecision.limit),
				'X-Third-Party-Quota-Remaining': String(quotaDecision.remaining),
				...(observedRateLimit.group ? { 'X-Third-Party-ESI-Group': observedRateLimit.group } : {}),
			})
		}

		logger.warn('[ThirdPartyAppsProxy] Unexpected upstream proxy failure', {
			path: params.path,
			error: error instanceof Error ? error.message : String(error),
		})
		return Response.json(
			{
				error: 'bad_gateway',
				message: 'Failed to reach the ESI upstream service.',
			},
			{ status: 502 }
		)
	}
}
