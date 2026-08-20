import { describe, expect, it } from 'vitest'

import {
	ACCESS_TOKEN_CACHE_CLEANUP_INTERVAL_MS,
	ACCESS_TOKEN_REFRESH_SAFETY_MARGIN_MS,
	getExpiredAccessTokenCutoff,
	isWarmAccessTokenUsable,
} from '../../lib/access-token-cache'

describe('access-token cache policy', () => {
	it('only serves tokens outside the refresh safety margin', () => {
		const now = 1_000_000

		expect(isWarmAccessTokenUsable(now + ACCESS_TOKEN_REFRESH_SAFETY_MARGIN_MS + 1, now)).toBe(true)
		expect(isWarmAccessTokenUsable(now + ACCESS_TOKEN_REFRESH_SAFETY_MARGIN_MS, now)).toBe(false)
		expect(isWarmAccessTokenUsable(now - 1, now)).toBe(false)
	})

	it('uses the current time as the maintenance expiry cutoff', () => {
		const now = 1_000_000
		expect(getExpiredAccessTokenCutoff(now)).toBe(now)
		expect(ACCESS_TOKEN_CACHE_CLEANUP_INTERVAL_MS).toBe(60 * 60 * 1000)
	})
})
