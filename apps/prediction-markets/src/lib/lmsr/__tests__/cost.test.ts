import { describe, expect, it } from 'vitest'

import { buyCost, costErrorMargin, costFixed, pricesBps, sellProceeds, subsidyPoints } from '../cost'
import { ONE } from '../fixed'

import type { Fixed } from '../fixed'

function toPoints(c: Fixed): number {
	return Number(c) / 1e18
}

/** Deterministic LCG so the conservation simulation is exactly reproducible (no Math.random). */
function makeRng(seed: number): () => number {
	let s = seed >>> 0
	return () => {
		s = (Math.imul(s, 1_103_515_245) + 12_345) & 0x7fffffff
		return s / 0x7fffffff
	}
}

describe('costFixed', () => {
	it('C(0) = b·ln(n) at the uniform start', () => {
		const b = 10_000n
		for (const n of [2, 3, 4, 8]) {
			const q = Array(n).fill(0n)
			const c = toPoints(costFixed(q, b))
			expect(c).toBeCloseTo(Number(b) * Math.log(n), 2)
		}
	})

	it('is strictly increasing when shares are added', () => {
		const b = 5_000n
		const q = [0n, 0n, 0n]
		const c0 = costFixed(q, b)
		const c1 = costFixed([100n, 0n, 0n], b)
		expect(c1).toBeGreaterThan(c0)
	})
})

describe('pricesBps', () => {
	it('is uniform (10000/n each) at the zero state and sums to ~10000', () => {
		const b = 10_000n
		const p = pricesBps([0n, 0n, 0n, 0n], b)
		for (const bps of p) expect(bps).toBeGreaterThanOrEqual(2499)
		for (const bps of p) expect(bps).toBeLessThanOrEqual(2501)
		const sum = p.reduce((a, x) => a + x, 0)
		expect(sum).toBeGreaterThanOrEqual(9998)
		expect(sum).toBeLessThanOrEqual(10_000)
	})

	it('drives a heavily-bought outcome toward certainty (price → ~10000)', () => {
		const b = 1_000n
		// Buy a lot of outcome 0 relative to b, so its price dominates.
		const p = pricesBps([50_000n, 0n, 0n], b)
		expect(p[0]).toBeGreaterThan(9_900)
		expect(p[1]).toBeLessThan(100)
	})
})

describe('buyCost', () => {
	it('rejects a non-positive delta', () => {
		expect(() => buyCost([0n, 0n], 0, 0n, 1_000n)).toThrow()
		expect(() => buyCost([0n, 0n], 0, -5n, 1_000n)).toThrow()
	})

	it('is positive and monotonically increasing in delta', () => {
		const b = 10_000n
		const q = [0n, 0n]
		let prev = 0n
		for (const delta of [1n, 10n, 100n, 1_000n]) {
			const cost = buyCost(q, 0, delta, b)
			expect(cost).toBeGreaterThan(0n)
			expect(cost).toBeGreaterThan(prev)
			prev = cost
		}
	})

	it('costs less than delta per share when the outcome is an underdog', () => {
		// Buying the (uniform) outcome, each share's price < 1, so cost < delta.
		const b = 10_000n
		const delta = 100n
		expect(buyCost([0n, 0n, 0n, 0n], 0, delta, b)).toBeLessThan(delta)
	})
})

describe('sellProceeds', () => {
	it('rejects overselling / non-positive delta (no shorting)', () => {
		expect(() => sellProceeds([10n, 0n], 0, 0n, 1_000n)).toThrow()
		expect(() => sellProceeds([10n, 0n], 0, 20n, 1_000n)).toThrow()
	})

	it('a buy-then-sell round trip never pays out more than it cost (the spread)', () => {
		const b = 10_000n
		const q = [500n, 500n, 500n]
		const delta = 200n
		const cost = buyCost(q, 0, delta, b)
		const q2 = [q[0] + delta, q[1], q[2]]
		const proceeds = sellProceeds(q2, 0, delta, b)
		expect(proceeds).toBeLessThanOrEqual(cost)
		expect(proceeds).toBeGreaterThanOrEqual(0n)
	})
})

describe('subsidyPoints', () => {
	it('covers b·ln(n) (rounded up)', () => {
		const b = 10_000n
		for (const n of [2, 3, 4, 8, 16]) {
			const subsidy = subsidyPoints(b, n)
			expect(subsidy).toBeGreaterThanOrEqual(BigInt(Math.ceil(Number(b) * Math.log(n))))
		}
	})

	it('requires at least 2 outcomes', () => {
		expect(() => subsidyPoints(1_000n, 1)).toThrow()
	})
})

describe('conservation & bounded-loss (the safety invariant)', () => {
	// This is the whole reason the fixed-point/quantization design exists: across ANY trade sequence,
	// the pre-funded maker (subsidy + points collected on buys) must be able to pay every winning
	// share exactly 1 point and never go negative — i.e. the maker's loss never exceeds the subsidy.
	it('the maker is never insolvent for any outcome, across randomized trade sequences', () => {
		for (const [seed, n, b] of [
			[1, 2, 1_000n],
			[7, 3, 10_000n],
			[42, 4, 10_000n],
			[99, 6, 5_000n],
			[123, 8, 50_000n],
		] as const) {
			const rng = makeRng(seed)
			const q: bigint[] = Array(n).fill(0n)
			const subsidy = subsidyPoints(b, n)
			let collected = 0n

			for (let t = 0; t < 300; t++) {
				const k = Math.floor(rng() * n)
				const delta = BigInt(1 + Math.floor(rng() * 100))
				const cost = buyCost(q, k, delta, b)
				expect(cost).toBeGreaterThanOrEqual(0n)
				collected += cost
				q[k] += delta
			}

			// Resolve to EVERY outcome and assert the maker can always pay it out and stay ≥ 0.
			for (let w = 0; w < n; w++) {
				const payout = q[w] // each winning share redeems for exactly 1 point
				const houseBalance = subsidy + collected - payout
				expect(houseBalance).toBeGreaterThanOrEqual(0n)
				// And the maker's realized loss never exceeds the pre-funded subsidy.
				const makerLoss = payout - collected // may be negative (a profit)
				expect(makerLoss).toBeLessThanOrEqual(subsidy)
			}
		}
	})

	it('holds in the worst case: buy heavily on one outcome, then resolve to it', () => {
		const n = 3
		const b = 10_000n
		const q: bigint[] = Array(n).fill(0n)
		const subsidy = subsidyPoints(b, n)
		let collected = 0n
		for (let t = 0; t < 50; t++) {
			collected += buyCost(q, 0, 1_000n, b) // hammer outcome 0
			q[0] += 1_000n
		}
		const houseBalance = subsidy + collected - q[0] // resolve to the hammered outcome
		expect(houseBalance).toBeGreaterThanOrEqual(0n)
	})
})

describe('costErrorMargin', () => {
	it('is a tiny fraction of one point for realistic b', () => {
		// The outward safety margin must never dominate a real cost: << 1 point.
		expect(toPoints(costErrorMargin(1_000_000n, 8))).toBeLessThan(1)
	})
})
