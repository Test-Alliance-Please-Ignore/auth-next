import { DurableObject } from 'cloudflare:workers'

import type { Env } from './context'
import {
	consumeThirdPartyAppQuota,
	observeThirdPartyAppQuota,
	type ThirdPartyAppQuotaClient,
	type ThirdPartyAppQuotaDecision,
	type ThirdPartyAppQuotaState,
} from './quota-state'

export {
	consumeThirdPartyAppQuota,
	observeThirdPartyAppQuota,
	refillThirdPartyAppQuota,
	THIRD_PARTY_APP_PROXY_FALLBACK_LIMIT,
	THIRD_PARTY_APP_PROXY_FALLBACK_WINDOW_SECONDS,
	THIRD_PARTY_APP_PROXY_MAX_TOKENS,
	THIRD_PARTY_APP_PROXY_MIN_TOKENS,
	THIRD_PARTY_APP_PROXY_SHARE_PERCENT,
	type ThirdPartyAppQuotaBucketState,
	type ThirdPartyAppQuotaClient,
	type ThirdPartyAppQuotaDecision,
	type ThirdPartyAppQuotaState,
} from './quota-state'

export class ThirdPartyAppQuota extends DurableObject<Env> implements ThirdPartyAppQuotaClient {
	private quotaState: ThirdPartyAppQuotaState | null = null
	private readonly storage: DurableObjectStorage

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.storage = state.storage
		void state.blockConcurrencyWhile(async () => {
			this.quotaState = (await this.storage.get<ThirdPartyAppQuotaState>('quota')) ?? null
		})
	}

	async consume(clientId: string, bucketKey: string, cost = 1): Promise<ThirdPartyAppQuotaDecision> {
		if (!clientId) {
			throw new Error('clientId is required')
		}
		if (!bucketKey) {
			throw new Error('bucketKey is required')
		}

		const nowMs = Date.now()
		const result = consumeThirdPartyAppQuota(this.quotaState, nowMs, bucketKey, cost)
		this.quotaState = result.state
		await this.storage.put('quota', this.quotaState)
		return result.decision
	}

	async observe(
		clientId: string,
		bucketKey: string,
		observedBucketKey: string,
		esiLimit: number,
		windowSeconds: number
	): Promise<void> {
		if (!clientId) {
			throw new Error('clientId is required')
		}
		if (!bucketKey) {
			throw new Error('bucketKey is required')
		}
		if (!observedBucketKey) {
			throw new Error('observedBucketKey is required')
		}

		const nowMs = Date.now()
		this.quotaState = observeThirdPartyAppQuota(
			this.quotaState,
			nowMs,
			bucketKey,
			observedBucketKey,
			esiLimit,
			windowSeconds
		)
		await this.storage.put('quota', this.quotaState)
	}
}
