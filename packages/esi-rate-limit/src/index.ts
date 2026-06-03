// ---------------------------------------------------------------------------
// ESI rate-limit key prefixes
// ---------------------------------------------------------------------------
const ESI_RATE_LIMIT_ROUTE_GROUP_PREFIX = 'esi:rate-limit:route-group:'
const ESI_RATE_LIMIT_BUCKET_PREFIX = 'esi:rate-limit:bucket:'
const ESI_RATE_LIMIT_ERROR_PREFIX = 'esi:rate-limit:error:'
const ESI_RATE_LIMIT_ROUTE_PREFIX = 'esi:rate-limit:route:'

// ---------------------------------------------------------------------------
// ESI rate-limit TTLs
// ---------------------------------------------------------------------------
// Route -> group mappings are comparatively static, so we keep them around a
// long time and only refresh them opportunistically when ESI returns a new
// group header.
const ESI_RATE_LIMIT_ROUTE_GROUP_MAPPING_TTL_SECONDS = 180 * 24 * 60 * 60

// We still cap transient bucket/cooldown records to avoid an upstream bug or a
// malformed response pinning the limiter forever.
const ESI_RATE_LIMIT_MAX_TTL_SECONDS = 6 * 60 * 60
const ESI_RATE_LIMIT_MIN_TTL_SECONDS = 60

export type EsiRateLimitFamily = 'bucket' | 'error-limit' | 'route-breaker'

export interface EsiRateLimitBucketCharge {
	atMs: number
	cost: number
}

export interface EsiRateLimitSnapshot {
	family: EsiRateLimitFamily
	key: string
	routeKey: string
	observedAtMs: number
	expiresAtMs: number
	blockedUntilMs?: number
	group?: string
	userKey?: string
	limit?: number
	remaining?: number
	used?: number
	windowSeconds?: number
	retryAfterSeconds?: number
	charges?: EsiRateLimitBucketCharge[]
}

export interface EsiRateLimitHeadersSnapshot {
	group?: string
	limit?: number
	remaining?: number
	used?: number
	windowSeconds?: number
	retryAfterSeconds?: number
	errorLimitRemain?: number
	errorLimitResetSeconds?: number
}

export interface EsiRateLimitHeadersLike {
	get(name: string): string | null
}

export interface EsiRateLimitResponseLike {
	headers: EsiRateLimitHeadersLike
	status: number
	statusText?: string
	json(): Promise<unknown>
	text(): Promise<string>
	ok?: boolean
}

export interface EsiRateLimitRequestErrorContext<TResponse extends EsiRateLimitResponseLike = EsiRateLimitResponseLike> {
	path: string
	routeKey: string
	userKey: string
	response: TResponse
	body: string
}

export interface EsiRequestOptions<TResponse extends EsiRateLimitResponseLike, TResult> {
	path: string
	userKey: string
	method?: string
	accessToken?: string | null
	jsonBody?: unknown
	extraHeaders?: Record<string, string>
	contentType?: string | false
	timeoutMs?: number
	parse: (response: TResponse) => Promise<TResult> | TResult
	buildError: (context: EsiRateLimitRequestErrorContext<TResponse>) => Error | Promise<Error>
}

export interface EsiRateLimitKVLike {
	get<T>(key: string, type?: 'json'): Promise<T | string | null>
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
	delete(key: string): Promise<void>
}

export function normalizeEsiRouteKey(path: string): string {
	const barePath = path.split('?')[0] ?? path
	const segments = barePath
		.split('/')
		.filter(Boolean)
		.map((segment) => (/^\d+$/.test(segment) ? ':id' : segment))
	return `/${segments.join('/')}`
}

export function buildEsiUserKey(clientId: string, characterId: string): string {
	return `${clientId}:${characterId}`
}

export function buildPublicEsiUserKey(scope = 'public'): string {
	// The worker cannot observe ESI's source IP, so use a stable local scope key
	// for best-effort public route bucket coordination.
	return scope
}

export function buildEsiBucketKey(group: string, userKey: string): string {
	return `${ESI_RATE_LIMIT_BUCKET_PREFIX}${group}:${userKey}`
}

export function buildEsiRouteCooldownKey(routeKey: string, userKey: string): string {
	return `${ESI_RATE_LIMIT_ROUTE_PREFIX}${routeKey}:${userKey}`
}

export function buildEsiRouteErrorKey(routeKey: string, userKey: string): string {
	return `${ESI_RATE_LIMIT_ERROR_PREFIX}${routeKey}:${userKey}`
}

export function buildEsiRouteGroupMappingKey(routeKey: string): string {
	return `${ESI_RATE_LIMIT_ROUTE_GROUP_PREFIX}${routeKey}`
}

export function parseEsiRateLimitWindow(limitHeader: string | null): { limit: number; windowSeconds: number } | null {
	if (!limitHeader) return null

	const trimmed = limitHeader.trim()
	const match = /^(\d+)\s*\/\s*(\d+)([mh])$/i.exec(trimmed)
	if (!match) return null

	const limit = Number.parseInt(match[1] ?? '', 10)
	const windowSize = Number.parseInt(match[2] ?? '', 10)
	const unit = (match[3] ?? '').toLowerCase()
	if (!Number.isFinite(limit) || !Number.isFinite(windowSize) || limit <= 0 || windowSize <= 0) {
		return null
	}

	const windowSeconds = unit === 'h' ? windowSize * 60 * 60 : windowSize * 60
	return { limit, windowSeconds }
}

export function parseEsiRateLimitHeaders(headers: EsiRateLimitHeadersLike): EsiRateLimitHeadersSnapshot {
	const group = headers.get('X-Ratelimit-Group') ?? undefined
	const limitInfo = parseEsiRateLimitWindow(headers.get('X-Ratelimit-Limit'))
	const remaining = parseHeaderInteger(headers, 'X-Ratelimit-Remaining')
	const used = parseHeaderInteger(headers, 'X-Ratelimit-Used')
	const retryAfterSeconds = parseHeaderInteger(headers, 'Retry-After')
	const errorLimitRemain = parseHeaderInteger(headers, 'X-ESI-Error-Limit-Remain')
	const errorLimitResetSeconds = parseHeaderInteger(headers, 'X-ESI-Error-Limit-Reset')

	return {
		group,
		limit: limitInfo?.limit,
		remaining,
		used,
		windowSeconds: limitInfo?.windowSeconds,
		retryAfterSeconds,
		errorLimitRemain,
		errorLimitResetSeconds,
	}
}

function parseHeaderInteger(headers: EsiRateLimitHeadersLike, header: string): number | undefined {
	const value = headers.get(header)
	if (!value) return undefined
	const parsed = Number.parseInt(value, 10)
	return Number.isFinite(parsed) ? parsed : undefined
}

function computeTtlSeconds(nowMs: number, expiresAtMs: number): number {
	return Math.max(
		ESI_RATE_LIMIT_MIN_TTL_SECONDS,
		Math.min(ESI_RATE_LIMIT_MAX_TTL_SECONDS, Math.ceil((expiresAtMs - nowMs) / 1000))
	)
}

function normalizeBucketChargeAtMs(atMs: number): number {
	return Math.floor(atMs / 1000) * 1000
}

function normalizeBucketCharges(
	charges: EsiRateLimitBucketCharge[] | undefined,
	windowSeconds: number,
	nowMs: number
): EsiRateLimitBucketCharge[] {
	if (!charges?.length || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
		return []
	}

	const windowMs = windowSeconds * 1000
	const sortedCharges = charges
		.map((charge) => ({
			atMs: normalizeBucketChargeAtMs(charge.atMs),
			cost: Number.isFinite(charge.cost) ? Math.max(1, Math.floor(charge.cost)) : 0,
		}))
		.filter((charge) => charge.cost > 0)
		.filter((charge) => charge.atMs + windowMs > nowMs)
		.sort((left, right) => left.atMs - right.atMs)

	const mergedCharges: EsiRateLimitBucketCharge[] = []
	for (const charge of sortedCharges) {
		const last = mergedCharges[mergedCharges.length - 1]
		if (last && last.atMs === charge.atMs) {
			last.cost += charge.cost
			continue
		}

		mergedCharges.push({ atMs: charge.atMs, cost: charge.cost })
	}

	return mergedCharges
}

function summarizeBucketCharges(
	charges: EsiRateLimitBucketCharge[],
	limit: number,
	windowSeconds: number,
	nowMs: number
): {
	charges: EsiRateLimitBucketCharge[]
	expiresAtMs: number
	remaining: number
	used: number
	retryAfterSeconds?: number
} {
	const windowMs = windowSeconds * 1000
	const used = charges.reduce((sum, charge) => sum + charge.cost, 0)
	const remaining = Math.max(0, limit - used)
	const expiresAtMs = charges.length > 0 ? charges[charges.length - 1]!.atMs + windowMs : nowMs + windowMs
	const retryAfterSeconds =
		used >= limit && charges.length > 0 ? Math.max(1, Math.ceil((charges[0]!.atMs + windowMs - nowMs) / 1000)) : undefined

	return {
		charges,
		expiresAtMs,
		remaining,
		used,
		retryAfterSeconds,
	}
}

function getBucketRequestCost(status: number): number {
	if (status >= 200 && status < 600) return 1
	return 0
}

export class EsiRateLimitStore {
	constructor(private readonly kv: EsiRateLimitKVLike) {}

	private async getSnapshot(key: string): Promise<EsiRateLimitSnapshot | null> {
		try {
			const snapshot = (await this.kv.get(key, 'json')) as EsiRateLimitSnapshot | null
			if (!snapshot) return null
			if (snapshot.expiresAtMs <= Date.now()) {
				await this.kv.delete(key)
				return null
			}
			if (snapshot.family === 'bucket') {
				const now = Date.now()
				const normalizedCharges = normalizeBucketCharges(snapshot.charges, snapshot.windowSeconds ?? 0, now)
				const blockedUntilMs =
					typeof snapshot.blockedUntilMs === 'number' && snapshot.blockedUntilMs > now
						? snapshot.blockedUntilMs
						: undefined
				if (
					!normalizedCharges.length ||
					snapshot.limit === undefined ||
					snapshot.windowSeconds === undefined
				) {
					if (!blockedUntilMs) {
						await this.kv.delete(key)
						return null
					}
					return {
						...snapshot,
						charges: [],
						blockedUntilMs,
						retryAfterSeconds: Math.max(1, Math.ceil((blockedUntilMs - now) / 1000)),
					}
				}

					const summary = summarizeBucketCharges(normalizedCharges, snapshot.limit, snapshot.windowSeconds, now)
					return {
						...snapshot,
						charges: summary.charges,
						used: snapshot.used ?? summary.used,
						remaining: snapshot.remaining ?? summary.remaining,
						blockedUntilMs,
						expiresAtMs: blockedUntilMs ? Math.max(summary.expiresAtMs, blockedUntilMs) : summary.expiresAtMs,
						retryAfterSeconds: blockedUntilMs
							? Math.max(1, Math.ceil((blockedUntilMs - now) / 1000))
							: snapshot.retryAfterSeconds ?? summary.retryAfterSeconds,
					}
				}
			return snapshot
		} catch {
			return null
		}
	}

	private async putSnapshot(snapshot: EsiRateLimitSnapshot): Promise<void> {
		const ttlSeconds = computeTtlSeconds(snapshot.observedAtMs, snapshot.expiresAtMs)
		await this.kv.put(snapshot.key, JSON.stringify(snapshot), {
			expirationTtl: ttlSeconds,
		})
	}

	async getRouteGroup(routeKey: string): Promise<string | null> {
		try {
			return (await this.kv.get<string>(buildEsiRouteGroupMappingKey(routeKey))) ?? null
		} catch {
			return null
		}
	}

	async rememberRouteGroup(routeKey: string, group: string): Promise<void> {
		await this.kv.put(buildEsiRouteGroupMappingKey(routeKey), group, {
			expirationTtl: ESI_RATE_LIMIT_ROUTE_GROUP_MAPPING_TTL_SECONDS,
		})
	}

	async getBucketSnapshot(group: string, userKey: string): Promise<EsiRateLimitSnapshot | null> {
		return this.getSnapshot(buildEsiBucketKey(group, userKey))
	}

	async putBucketSnapshot(params: Omit<EsiRateLimitSnapshot, 'family' | 'key' | 'observedAtMs' | 'expiresAtMs'> & {
		group: string
		userKey: string
		status: number
		observedAtMs: number
		expiresAtMs: number
	}): Promise<void> {
		const key = buildEsiBucketKey(params.group, params.userKey)
		const existing = await this.getSnapshot(key)
		const existingCharges = existing?.family === 'bucket' ? existing.charges ?? [] : []
		const windowSeconds = params.windowSeconds ?? existing?.windowSeconds ?? 0
		const charges = normalizeBucketCharges(existingCharges, windowSeconds, params.observedAtMs)
		const responseCost = getBucketRequestCost(params.status)
		const nextCharges =
			responseCost > 0
				? normalizeBucketCharges(
						[
							...charges,
							{
								atMs: normalizeBucketChargeAtMs(params.observedAtMs),
								cost: responseCost,
							},
						],
						windowSeconds,
						params.observedAtMs
					)
				: charges
		const blockedUntilMs =
			params.status === 429 && params.retryAfterSeconds !== undefined
				? params.observedAtMs + params.retryAfterSeconds * 1000
				: existing?.blockedUntilMs

		if (
			!nextCharges.length &&
			blockedUntilMs === undefined &&
			params.status !== 429 &&
			responseCost === 0
		) {
			return
		}

		if (params.limit === undefined || params.windowSeconds === undefined) {
			return
		}

			const summary = summarizeBucketCharges(nextCharges, params.limit, params.windowSeconds, params.observedAtMs)

			await this.putSnapshot({
				family: 'bucket',
				key,
				routeKey: params.routeKey,
				group: params.group,
				userKey: params.userKey,
				limit: params.limit,
				remaining: params.remaining ?? summary.remaining,
				used: params.used ?? summary.used,
				windowSeconds: params.windowSeconds,
				retryAfterSeconds:
					blockedUntilMs !== undefined
						? Math.max(1, Math.ceil((blockedUntilMs - params.observedAtMs) / 1000))
						: params.retryAfterSeconds ?? summary.retryAfterSeconds,
				charges: summary.charges,
				blockedUntilMs,
				observedAtMs: params.observedAtMs,
				expiresAtMs: blockedUntilMs ? Math.max(summary.expiresAtMs, blockedUntilMs) : summary.expiresAtMs,
			})
	}

	async getRouteErrorLimit(routeKey: string, userKey: string): Promise<EsiRateLimitSnapshot | null> {
		return this.getSnapshot(buildEsiRouteErrorKey(routeKey, userKey))
	}

	async putRouteErrorLimit(params: Omit<EsiRateLimitSnapshot, 'family' | 'key' | 'observedAtMs' | 'expiresAtMs'> & {
		userKey: string
		routeKey: string
		observedAtMs: number
		expiresAtMs: number
	}): Promise<void> {
		await this.putSnapshot({
			family: 'error-limit',
			key: buildEsiRouteErrorKey(params.routeKey, params.userKey),
			routeKey: params.routeKey,
			userKey: params.userKey,
			limit: params.limit,
			remaining: params.remaining,
			used: params.used,
			windowSeconds: params.windowSeconds,
			retryAfterSeconds: params.retryAfterSeconds,
			observedAtMs: params.observedAtMs,
			expiresAtMs: params.expiresAtMs,
		})
	}

	async getRouteCooldown(routeKey: string, userKey: string): Promise<EsiRateLimitSnapshot | null> {
		return this.getSnapshot(buildEsiRouteCooldownKey(routeKey, userKey))
	}

	async putRouteCooldown(params: Omit<EsiRateLimitSnapshot, 'family' | 'key' | 'observedAtMs' | 'expiresAtMs'> & {
		userKey: string
		observedAtMs: number
		expiresAtMs: number
	}): Promise<void> {
		await this.putSnapshot({
			family: 'route-breaker',
			key: buildEsiRouteCooldownKey(params.routeKey, params.userKey),
			routeKey: params.routeKey,
			userKey: params.userKey,
			limit: params.limit,
			remaining: params.remaining,
			used: params.used,
			windowSeconds: params.windowSeconds,
			retryAfterSeconds: params.retryAfterSeconds,
			observedAtMs: params.observedAtMs,
			expiresAtMs: params.expiresAtMs,
		})
	}
}

export class EsiRateLimitGuard {
	constructor(private readonly store: EsiRateLimitStore) {}

	private isResponseOk(response: EsiRateLimitResponseLike): boolean {
		return response.ok ?? (response.status >= 200 && response.status < 300)
	}

	private async assertAllowance(path: string, userKey: string): Promise<void> {
		const routeKey = normalizeEsiRouteKey(path)
		const now = Date.now()

		const routeGroup = await this.store.getRouteGroup(routeKey)
			if (routeGroup) {
				const bucket = await this.store.getBucketSnapshot(routeGroup, userKey)
				if (bucket && bucket.limit !== undefined) {
					if (bucket.blockedUntilMs !== undefined && bucket.blockedUntilMs > now) {
						const retryAfterSeconds = Math.max(1, Math.ceil((bucket.blockedUntilMs - now) / 1000))
					throw this.buildPreflightError(path, routeKey, 'bucket', retryAfterSeconds, routeGroup, {
						limit: bucket.limit,
						remaining: bucket.remaining,
						used: bucket.used ?? bucket.limit - (bucket.remaining ?? 0),
							windowSeconds: bucket.windowSeconds,
						})
					}

					if (bucket.remaining !== undefined && bucket.remaining <= 0) {
						const retryAfterSeconds = bucket.retryAfterSeconds ?? Math.max(1, Math.ceil((bucket.expiresAtMs - now) / 1000))
						throw this.buildPreflightError(path, routeKey, 'bucket', retryAfterSeconds, routeGroup, {
							limit: bucket.limit,
							remaining: bucket.remaining,
							used: bucket.used ?? bucket.limit - bucket.remaining,
							windowSeconds: bucket.windowSeconds,
						})
					}
				}
			}

		const routeErrorLimit = await this.store.getRouteErrorLimit(routeKey, userKey)
		if (routeErrorLimit) {
			const retryAfterSeconds =
				routeErrorLimit.retryAfterSeconds ?? Math.max(1, Math.ceil((routeErrorLimit.expiresAtMs - now) / 1000))
			throw this.buildPreflightError(path, routeKey, 'error_limit', retryAfterSeconds)
		}

		const routeCooldown = await this.store.getRouteCooldown(routeKey, userKey)
		if (routeCooldown) {
			const retryAfterSeconds =
				routeCooldown.retryAfterSeconds ?? Math.max(1, Math.ceil((routeCooldown.expiresAtMs - now) / 1000))
			throw this.buildPreflightError(path, routeKey, 'route_breaker', retryAfterSeconds)
		}
	}

	private buildPreflightError(
		path: string,
		routeKey: string,
		circuitBreaker: 'error_limit' | 'bucket' | 'route_breaker',
		retryAfterSeconds: number,
		routeGroup?: string,
		bucket?: {
			limit?: number
			remaining?: number
			used?: number
			windowSeconds?: number
		}
	): Error {
		const metadata = JSON.stringify({
			status: 429,
			path,
			source: 'preflight',
			retryAfterSeconds,
			circuitBreaker,
			routeKey,
			routeGroup,
			bucket,
		})
		return new Error(`ESI request failed: 429 Too Many Requests - {"error":"ESI rate limit active"} | metadata=${metadata}`)
	}

	private async updateState(
		path: string,
		headers: EsiRateLimitHeadersLike,
		status: number,
		userKey: string
	): Promise<void> {
		const routeKey = normalizeEsiRouteKey(path)
		const snapshot = parseEsiRateLimitHeaders(headers)
		const now = Date.now()

		if (snapshot.group) {
			await this.store.rememberRouteGroup(routeKey, snapshot.group)
		}

		if (snapshot.errorLimitRemain !== undefined && snapshot.errorLimitResetSeconds !== undefined) {
			const shouldPersistErrorLimit =
				status === 420 || status === 429 || snapshot.errorLimitRemain <= 0
			if (shouldPersistErrorLimit) {
				await this.store.putRouteErrorLimit({
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
			}
			return
		}

		if (status === 429) {
			const retryAfterSeconds = snapshot.retryAfterSeconds ?? 60
			await this.store.putRouteCooldown({
				userKey,
				routeKey,
				limit: snapshot.limit,
				remaining: snapshot.remaining,
				used: snapshot.used,
				windowSeconds: snapshot.windowSeconds,
				retryAfterSeconds,
				observedAtMs: now,
				expiresAtMs: now + retryAfterSeconds * 1000,
			})
			return
		}

		if (snapshot.group && snapshot.limit !== undefined && snapshot.windowSeconds !== undefined) {
			const remaining = snapshot.remaining ?? snapshot.limit
			const used = snapshot.used ?? Math.max(0, snapshot.limit - remaining)
			await this.store.putBucketSnapshot({
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
		}
	}

	private buildRequestInit(options: {
		method?: string
		accessToken?: string | null
		jsonBody?: unknown
		extraHeaders?: Record<string, string>
		contentType?: string | false
		timeoutMs?: number
	}): Record<string, unknown> {
		const method = (options.method ?? (options.jsonBody !== undefined ? 'POST' : 'GET')).toUpperCase()
		const headers: Record<string, string> = {}

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

		const requestInit: Record<string, unknown> = {
			method,
			headers,
		}

		if (options.jsonBody !== undefined) {
			requestInit.body = JSON.stringify(options.jsonBody)
		}

		if (options.timeoutMs !== undefined) {
			const abortSignal = (globalThis as unknown as {
				AbortSignal?: { timeout(ms: number): unknown }
			}).AbortSignal?.timeout(options.timeoutMs)
			if (abortSignal) {
				requestInit.signal = abortSignal
			}
		}

		return requestInit
	}

	async withRateLimit<T>(options: {
		path: string
		userKey: string
		execute: () => Promise<T>
		headers?: EsiRateLimitHeadersLike
		status?: number
	}): Promise<T> {
		await this.assertAllowance(options.path, options.userKey)
		const result = await options.execute()
		if (options.headers && options.status !== undefined) {
			await this.updateState(options.path, options.headers, options.status, options.userKey)
		}
		return result
	}

	async request<TResponse extends EsiRateLimitResponseLike, TResult>(options: {
		path: string
		userKey: string
		method?: string
		accessToken?: string | null
		jsonBody?: unknown
		extraHeaders?: Record<string, string>
		timeoutMs?: number
		parse: (response: TResponse) => Promise<TResult> | TResult
		buildError: (context: EsiRateLimitRequestErrorContext<TResponse>) => Error | Promise<Error>
	}): Promise<TResult> {
		await this.assertAllowance(options.path, options.userKey)
		const requestInit = this.buildRequestInit(options)
		const response = await (globalThis as unknown as {
			fetch(input: string, init?: Record<string, unknown>): Promise<TResponse>
		}).fetch(`https://esi.evetech.net${options.path}`, requestInit)
		await this.updateState(options.path, response.headers, response.status, options.userKey)

		if (!this.isResponseOk(response)) {
			const routeKey = normalizeEsiRouteKey(options.path)
			let body = ''
			try {
				body = await response.text()
			} catch {
				body = ''
			}
			throw await options.buildError({
				path: options.path,
				routeKey,
				userKey: options.userKey,
				response,
				body,
			})
		}

		return await options.parse(response)
	}

	async withResponseRateLimit<T extends EsiRateLimitResponseLike>(
		path: string,
		userKey: string,
		execute: () => Promise<T>
	): Promise<T> {
		await this.assertAllowance(path, userKey)
		const response = await execute()
		await this.updateState(path, response.headers, response.status, userKey)
		return response
	}
}
