import { describe, expect, it } from 'vitest'

import { MAX_MARKET_OPEN_DURATION_MS } from '@repo/prediction-markets'

import { exceedsMaxOpenDuration } from '../market-duration'

const NOW = 1_700_000_000_000 // fixed epoch so the boundary is deterministic

describe('exceedsMaxOpenDuration', () => {
	it('allows a close time well within the window', () => {
		expect(exceedsMaxOpenDuration(new Date(NOW + 24 * 60 * 60 * 1000), NOW)).toBe(false)
	})

	it('allows a close time at exactly the max window (inclusive boundary)', () => {
		expect(exceedsMaxOpenDuration(new Date(NOW + MAX_MARKET_OPEN_DURATION_MS), NOW)).toBe(false)
	})

	it('rejects a close time one millisecond past the max window', () => {
		expect(exceedsMaxOpenDuration(new Date(NOW + MAX_MARKET_OPEN_DURATION_MS + 1), NOW)).toBe(true)
	})

	it('rejects a close time far beyond the window', () => {
		expect(exceedsMaxOpenDuration(new Date(NOW + 30 * 24 * 60 * 60 * 1000), NOW)).toBe(true)
	})

	it('does not treat a past close time as exceeding the cap (that is a separate INVALID_CLOSES_AT concern)', () => {
		expect(exceedsMaxOpenDuration(new Date(NOW - 1000), NOW)).toBe(false)
	})

	it('is the 7-day window', () => {
		expect(MAX_MARKET_OPEN_DURATION_MS).toBe(7 * 24 * 60 * 60 * 1000)
	})
})
