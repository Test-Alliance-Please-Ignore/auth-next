import { describe, expect, it } from 'vitest'

import { computeRampRetryAfterSeconds } from './auth-esi-ramp'

describe('auth-esi ramp helper', () => {
	it('keeps retry-after within enforced [5, 60] bounds', () => {
		expect(computeRampRetryAfterSeconds(500, () => 0)).toBe(5)
		expect(computeRampRetryAfterSeconds(500_000, () => 0.99999)).toBeLessThanOrEqual(60)
		expect(computeRampRetryAfterSeconds(500_000, () => 0.99999)).toBeGreaterThanOrEqual(5)
	})

	it('uses full jitter range up to derived base value', () => {
		// remainingRampMs=20000 => base=5
		expect(computeRampRetryAfterSeconds(20_000, () => 0)).toBe(5)
		expect(computeRampRetryAfterSeconds(20_000, () => 0.99999)).toBe(5)

		// remainingRampMs=120000 => base=30
		expect(computeRampRetryAfterSeconds(120_000, () => 0)).toBe(5)
		expect(computeRampRetryAfterSeconds(120_000, () => 0.5)).toBe(15)
		expect(computeRampRetryAfterSeconds(120_000, () => 0.99999)).toBe(30)
	})
})
