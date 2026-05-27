import { describe, expect, it } from 'vitest'

import { computeCircuitOpenUntil } from './auth-esi-breaker'

describe('auth-esi breaker helper', () => {
	it('clamps breaker open duration to configured min/max', () => {
		const now = 1_000_000
		const min = 5_000
		const max = 300_000

		const low = computeCircuitOpenUntil({
			nowMs: now,
			retryAfterSeconds: 1,
			minOpenMs: min,
			maxOpenMs: max,
			random: () => 0,
		})
		expect(low - now).toBe(min)

		const high = computeCircuitOpenUntil({
			nowMs: now,
			retryAfterSeconds: 1000,
			minOpenMs: min,
			maxOpenMs: max,
			random: () => 0,
		})
		expect(high - now).toBe(max)
	})

	it('adds bounded jitter on top of clamped base duration', () => {
		const now = 1_000_000
		const min = 5_000
		const max = 300_000
		const noJitter = computeCircuitOpenUntil({
			nowMs: now,
			retryAfterSeconds: 10,
			minOpenMs: min,
			maxOpenMs: max,
			random: () => 0,
		})
		const maxJitter = computeCircuitOpenUntil({
			nowMs: now,
			retryAfterSeconds: 10,
			minOpenMs: min,
			maxOpenMs: max,
			random: () => 0.99999,
		})
		expect(maxJitter).toBeGreaterThan(noJitter)
		expect(maxJitter - noJitter).toBeLessThan(Math.floor(10_000 * 0.25))
	})
})
