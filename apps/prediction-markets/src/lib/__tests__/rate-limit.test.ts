import { describe, expect, it } from 'vitest'

import { nextRateState } from '../rate-limit'

const budget = { limit: 5, windowMs: 10_000 }

describe('nextRateState (fixed-window)', () => {
	it('starts a fresh window when the previous one expired', () => {
		const s = nextRateState(1_000, 5, 20_000, budget) // 19s later, > 10s window
		expect(s.newWindowStartMs).toBe(20_000)
		expect(s.newCount).toBe(1)
		expect(s.allowed).toBe(true)
		expect(s.retryAfterMs).toBe(0)
	})

	it('increments within the window and allows up to the limit', () => {
		const s = nextRateState(1_000, 4, 5_000, budget) // count 4 → 5 (== limit)
		expect(s.newCount).toBe(5)
		expect(s.allowed).toBe(true)
		expect(s.newWindowStartMs).toBe(1_000)
	})

	it('rejects past the limit and reports retryAfter to the window end', () => {
		const now = 5_000
		const s = nextRateState(1_000, 5, now, budget) // count 5 → 6 (> limit)
		expect(s.newCount).toBe(6)
		expect(s.allowed).toBe(false)
		expect(s.retryAfterMs).toBe(1_000 + 10_000 - now) // 6000ms until window end
	})

	it('resets exactly at the window boundary', () => {
		const s = nextRateState(0, 5, 10_000, budget) // now - start === windowMs ⇒ expired
		expect(s.newCount).toBe(1)
		expect(s.allowed).toBe(true)
	})
})
