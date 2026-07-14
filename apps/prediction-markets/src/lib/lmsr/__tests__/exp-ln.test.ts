import { describe, expect, it } from 'vitest'

import { expNeg, expNonPositive, lnFixed } from '../exp-ln'
import { ONE } from '../fixed'

import type { Fixed } from '../fixed'

/** Fixed → real number, for comparing against the JS float oracle (test-only, never used for money). */
function toNum(x: Fixed): number {
	return Number(x) / 1e18
}

describe('expNeg', () => {
	it('exp(0) = 1 exactly', () => {
		expect(expNeg(0n)).toBe(ONE)
	})

	it('matches Math.exp(−t) across the domain (rel err < 1e-9)', () => {
		// Exact-fraction inputs so the argument itself carries no float error.
		const inputs: Array<[Fixed, number]> = [
			[ONE / 4n, 0.25],
			[ONE / 2n, 0.5],
			[ONE, 1],
			[2n * ONE, 2],
			[5n * ONE, 5],
			[10n * ONE, 10],
			[20n * ONE, 20],
			[40n * ONE, 40],
		]
		for (const [t, tReal] of inputs) {
			const got = toNum(expNeg(t))
			const want = Math.exp(-tReal)
			expect(Math.abs(got - want)).toBeLessThan(want * 1e-9 + 1e-15)
		}
	})

	it('is in (0, ONE] and strictly decreasing in t', () => {
		let prev = ONE + 1n
		for (let t = 0n; t <= 30n * ONE; t += ONE) {
			const e = expNeg(t)
			expect(e).toBeGreaterThanOrEqual(0n)
			expect(e).toBeLessThanOrEqual(ONE)
			expect(e).toBeLessThan(prev)
			prev = e
		}
	})

	it('clamps to 0 far below one ULP', () => {
		expect(expNeg(48n * ONE)).toBe(0n)
		expect(expNeg(100n * ONE)).toBe(0n)
	})

	it('expNonPositive(x) = expNeg(−x) for x ≤ 0', () => {
		expect(expNonPositive(-3n * ONE)).toBe(expNeg(3n * ONE))
		expect(expNonPositive(0n)).toBe(ONE)
	})
})

describe('lnFixed', () => {
	it('ln(1) = 0', () => {
		expect(lnFixed(ONE)).toBe(0n)
	})

	it('ln(2) = LN2 within one ULP', () => {
		const got = lnFixed(2n * ONE)
		expect(got).toBeGreaterThanOrEqual(693_147_180_559_945_000n)
		expect(got).toBeLessThanOrEqual(693_147_180_559_946_000n)
	})

	it('matches Math.log(s) across [1, 20] (rel err < 1e-9)', () => {
		const inputs: Array<[Fixed, number]> = [
			[3n * ONE / 2n, 1.5],
			[2n * ONE, 2],
			[3n * ONE, 3],
			[5n * ONE, 5],
			[10n * ONE, 10],
			[16n * ONE, 16],
			[20n * ONE, 20],
		]
		for (const [s, sReal] of inputs) {
			const got = toNum(lnFixed(s))
			const want = Math.log(sReal)
			expect(Math.abs(got - want)).toBeLessThan(want * 1e-9 + 1e-15)
		}
	})

	it('round-trips: expNeg(lnFixed(s)) ≈ 1/s', () => {
		for (const s of [2n * ONE, 3n * ONE, 7n * ONE, 15n * ONE]) {
			const got = toNum(expNeg(lnFixed(s)))
			const want = 1 / toNum(s)
			expect(Math.abs(got - want)).toBeLessThan(want * 1e-9 + 1e-15)
		}
	})
})
