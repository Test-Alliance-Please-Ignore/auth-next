import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	consumeThirdPartyAppQuota,
	observeThirdPartyAppQuota,
	refillThirdPartyAppQuota,
	THIRD_PARTY_APP_PROXY_FALLBACK_LIMIT,
} from './quota-state'

describe('third-party app quota', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-04T00:00:00.000Z'))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('starts full and consumes tokens', () => {
		const now = Date.now()
		const result = consumeThirdPartyAppQuota(null, now, 'esi:group:market')

		expect(result.state.buckets['esi:group:market']?.tokens).toBe(THIRD_PARTY_APP_PROXY_FALLBACK_LIMIT - 1)
		expect(result.decision.allowed).toBe(true)
		expect(result.decision.remaining).toBe(THIRD_PARTY_APP_PROXY_FALLBACK_LIMIT - 1)
		expect(result.decision.limit).toBe(THIRD_PARTY_APP_PROXY_FALLBACK_LIMIT)
	})

	it('refills over time using the bucket window', () => {
		const start = Date.now()
		const state = refillThirdPartyAppQuota(
			{
				buckets: {
					'esi:group:market': {
						tokens: 0,
						lastRefillAtMs: start - 30_000,
						limit: 60,
						windowSeconds: 60,
					},
				},
			},
			start
		)

		expect(state.buckets['esi:group:market']?.tokens).toBeCloseTo(30, 3)
		expect(state.buckets['esi:group:market']?.lastRefillAtMs).toBe(start)
	})

	it('returns a retry-after when exhausted', () => {
		const now = Date.now()
		const exhausted = consumeThirdPartyAppQuota(
			{
				buckets: {
					'esi:group:market': {
						tokens: 0,
						lastRefillAtMs: now,
						limit: 1,
						windowSeconds: 60,
					},
				},
			},
			now,
			'esi:group:market',
			1,
			1,
			60
		)

		expect(exhausted.decision.allowed).toBe(false)
		expect(exhausted.decision.retryAfterSeconds).toBeGreaterThanOrEqual(1)
		expect(exhausted.decision.limit).toBe(1)
		expect(exhausted.decision.remaining).toBe(0)
	})

	it('migrates route-key state to the observed ESI group and applies the share limit', () => {
		const now = Date.now()
		const state = observeThirdPartyAppQuota(
			{
				buckets: {
					'/characters/:id/mail': {
						tokens: 12,
						lastRefillAtMs: now,
						limit: 20,
						windowSeconds: 60,
					},
				},
			},
			now,
			'/characters/:id/mail',
			'esi:group:mail',
			200,
			60
		)

		expect(state.buckets['/characters/:id/mail']).toBeUndefined()
		expect(state.buckets['esi:group:mail']?.limit).toBe(50)
		expect(state.buckets['esi:group:mail']?.tokens).toBe(12)
	})
})
