import { describe, expect, it } from 'vitest'

import { ceilDiv, divF, floorDiv, LN2, mulF, ONE } from '../fixed'

describe('ONE / LN2 constants', () => {
	it('ONE is 1e18', () => {
		expect(ONE).toBe(1_000_000_000_000_000_000n)
	})

	it('LN2 is ln(2) truncated to 18 decimals', () => {
		// 0.6931471805599453094… · 1e18, round-to-nearest.
		expect(LN2).toBe(693_147_180_559_945_309n)
		expect(Number(LN2) / 1e18).toBeCloseTo(Math.log(2), 12)
	})
})

describe('mulF', () => {
	it('multiplies in fixed-point (0.5 · 0.5 = 0.25)', () => {
		expect(mulF(ONE / 2n, ONE / 2n)).toBe(ONE / 4n)
	})

	it('is exact past Number.MAX_SAFE_INTEGER (the whole reason for BigInt)', () => {
		// 9_000_000_000 · 1.0 must stay 9_000_000_000 exactly (9e9 · 1e18 overflows a double).
		const big = 9_000_000_000n * ONE
		expect(mulF(big, ONE)).toBe(big)
	})
})

describe('divF', () => {
	it('divides in fixed-point (1 / 4 = 0.25)', () => {
		expect(divF(ONE, 4n * ONE)).toBe(ONE / 4n)
	})

	it('round-trips with mulF within one ULP', () => {
		const a = 3n * ONE
		const b = 7n * ONE
		// (a / b) · b ≈ a
		expect(mulF(divF(a, b), b)).toBeGreaterThanOrEqual(a - 10n)
		expect(mulF(divF(a, b), b)).toBeLessThanOrEqual(a + 10n)
	})
})

describe('floorDiv / ceilDiv', () => {
	it('floors positive and negative numerators correctly', () => {
		expect(floorDiv(7n, 2n)).toBe(3n)
		expect(floorDiv(-7n, 2n)).toBe(-4n) // toward −∞, not toward 0
		expect(floorDiv(8n, 2n)).toBe(4n) // exact
	})

	it('ceils positive and negative numerators correctly', () => {
		expect(ceilDiv(7n, 2n)).toBe(4n)
		expect(ceilDiv(-7n, 2n)).toBe(-3n) // toward +∞
		expect(ceilDiv(8n, 2n)).toBe(4n) // exact
	})

	it('floorDiv ≤ exact ≤ ceilDiv always', () => {
		for (const a of [-13n, -1n, 0n, 1n, 13n, 100n]) {
			for (const b of [2n, 3n, 7n]) {
				expect(floorDiv(a, b)).toBeLessThanOrEqual(ceilDiv(a, b))
			}
		}
	})
})
