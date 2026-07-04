export const THIRD_PARTY_APP_PROXY_SHARE_PERCENT = 25
export const THIRD_PARTY_APP_PROXY_MIN_TOKENS = 10
export const THIRD_PARTY_APP_PROXY_MAX_TOKENS = 500
export const THIRD_PARTY_APP_PROXY_FALLBACK_LIMIT = 20
export const THIRD_PARTY_APP_PROXY_FALLBACK_WINDOW_SECONDS = 60

export interface ThirdPartyAppQuotaBucketState {
	tokens: number
	lastRefillAtMs: number
	limit: number
	windowSeconds: number
}

export interface ThirdPartyAppQuotaState {
	buckets: Record<string, ThirdPartyAppQuotaBucketState>
}

export interface ThirdPartyAppQuotaDecision {
	allowed: boolean
	limit: number
	remaining: number
	retryAfterSeconds?: number
}

export interface ThirdPartyAppQuotaClient {
	consume(clientId: string, bucketKey: string, cost?: number): Promise<ThirdPartyAppQuotaDecision>
	observe(
		clientId: string,
		bucketKey: string,
		observedBucketKey: string,
		esiLimit: number,
		windowSeconds: number
	): Promise<void>
}

function deriveQuotaLimit(esiLimit: number): number {
	const scaled = Math.floor((Math.max(1, Math.floor(esiLimit)) * THIRD_PARTY_APP_PROXY_SHARE_PERCENT) / 100)
	return Math.max(THIRD_PARTY_APP_PROXY_MIN_TOKENS, Math.min(THIRD_PARTY_APP_PROXY_MAX_TOKENS, scaled))
}

function createBucket(
	nowMs: number,
	limit: number,
	windowSeconds: number,
	tokens = limit
): ThirdPartyAppQuotaBucketState {
	const safeLimit = Math.max(1, Math.floor(limit))
	const safeWindowSeconds = Math.max(1, Math.floor(windowSeconds))
	return {
		tokens: Math.min(safeLimit, Math.max(0, tokens)),
		lastRefillAtMs: nowMs,
		limit: safeLimit,
		windowSeconds: safeWindowSeconds,
	}
}

function refillBucket(bucket: ThirdPartyAppQuotaBucketState, nowMs: number): ThirdPartyAppQuotaBucketState {
	const elapsedMs = Math.max(0, nowMs - bucket.lastRefillAtMs)
	const refillRatePerMs = bucket.limit / Math.max(1, bucket.windowSeconds * 1000)
	const refill = elapsedMs * refillRatePerMs
	return {
		...bucket,
		tokens: Math.min(bucket.limit, bucket.tokens + refill),
		lastRefillAtMs: nowMs,
	}
}

export function refillThirdPartyAppQuota(
	state: ThirdPartyAppQuotaState | null,
	nowMs: number
): ThirdPartyAppQuotaState {
	if (!state) {
		return { buckets: {} }
	}

	const buckets: ThirdPartyAppQuotaState['buckets'] = {}
	for (const [bucketKey, bucket] of Object.entries(state.buckets)) {
		buckets[bucketKey] = refillBucket(bucket, nowMs)
	}

	return { buckets }
}

function getBucketState(
	state: ThirdPartyAppQuotaState | null,
	bucketKey: string,
	nowMs: number,
	fallbackLimit = THIRD_PARTY_APP_PROXY_FALLBACK_LIMIT,
	fallbackWindowSeconds = THIRD_PARTY_APP_PROXY_FALLBACK_WINDOW_SECONDS
): { state: ThirdPartyAppQuotaState; bucket: ThirdPartyAppQuotaBucketState } {
	const refilled = refillThirdPartyAppQuota(state, nowMs)
	const existing = refilled.buckets[bucketKey]
	if (existing) {
		return { state: refilled, bucket: existing }
	}

	const initialBucket = createBucket(nowMs, fallbackLimit, fallbackWindowSeconds)
	return {
		state: {
			buckets: {
				...refilled.buckets,
				[bucketKey]: initialBucket,
			},
		},
		bucket: initialBucket,
	}
}

export function consumeThirdPartyAppQuota(
	state: ThirdPartyAppQuotaState | null,
	nowMs: number,
	bucketKey: string,
	cost = 1,
	fallbackLimit = THIRD_PARTY_APP_PROXY_FALLBACK_LIMIT,
	fallbackWindowSeconds = THIRD_PARTY_APP_PROXY_FALLBACK_WINDOW_SECONDS
): { state: ThirdPartyAppQuotaState; decision: ThirdPartyAppQuotaDecision } {
	const safeCost = Math.max(1, Math.floor(cost))
	const { state: refilled, bucket } = getBucketState(state, bucketKey, nowMs, fallbackLimit, fallbackWindowSeconds)
	const remaining = bucket.tokens - safeCost

	if (remaining < 0) {
		const refillRatePerMs = bucket.limit / Math.max(1, bucket.windowSeconds * 1000)
		const deficit = Math.abs(remaining)
		const retryAfterMs = Math.ceil(deficit / refillRatePerMs)
		return {
			state: refilled,
			decision: {
				allowed: false,
				limit: bucket.limit,
				remaining: Math.max(0, Math.floor(bucket.tokens)),
				retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
			},
		}
	}

	return {
		state: {
			buckets: {
				...refilled.buckets,
				[bucketKey]: {
					...bucket,
					tokens: remaining,
					lastRefillAtMs: nowMs,
				},
			},
		},
		decision: {
			allowed: true,
			limit: bucket.limit,
			remaining: Math.max(0, Math.floor(remaining)),
		},
	}
}

export function observeThirdPartyAppQuota(
	state: ThirdPartyAppQuotaState | null,
	nowMs: number,
	bucketKey: string,
	observedBucketKey: string,
	esiLimit: number,
	windowSeconds: number
): ThirdPartyAppQuotaState {
	const safeLimit = deriveQuotaLimit(esiLimit)
	const safeWindowSeconds = Math.max(1, Math.floor(windowSeconds))
	const refilled = refillThirdPartyAppQuota(state, nowMs)
	const sourceBucket = refilled.buckets[bucketKey] ?? createBucket(nowMs, safeLimit, safeWindowSeconds)
	const nextBucket = {
		...sourceBucket,
		tokens: Math.min(safeLimit, sourceBucket.tokens),
		lastRefillAtMs: nowMs,
		limit: safeLimit,
		windowSeconds: safeWindowSeconds,
	}

	if (bucketKey === observedBucketKey) {
		return {
			buckets: {
				...refilled.buckets,
				[bucketKey]: nextBucket,
			},
		}
	}

	const nextBuckets = { ...refilled.buckets }
	delete nextBuckets[bucketKey]
	nextBuckets[observedBucketKey] = nextBucket

	return {
		buckets: nextBuckets,
	}
}
