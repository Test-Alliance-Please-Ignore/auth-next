import { describe, expect, it } from 'vitest'

import { computeResolution, computeWinnings } from '../payout'

describe('computeWinnings', () => {
	it('does not truncate to zero for a sub-pool stake (numerator-first)', () => {
		// stake < poolW would truncate to 0 under a naive stake/poolW division.
		expect(computeWinnings(100n, 200n, 150n, 0n)).toBeGreaterThan(0n)
	})

	it('returns 0 when uncontested (no losing pool)', () => {
		expect(computeWinnings(100n, 0n, 100n, 100n)).toBe(0n)
	})

	it('returns 0 for degenerate inputs', () => {
		expect(computeWinnings(0n, 200n, 150n, 0n)).toBe(0n)
		expect(computeWinnings(100n, 200n, 0n, 0n)).toBe(0n)
	})
})

describe('computeResolution', () => {
	it('matches the worked example and conserves the pool', () => {
		const result = computeResolution(
			[
				{ betId: 'a', userId: 'u1', stake: 100n },
				{ betId: 'b', userId: 'u2', stake: 50n },
			],
			350n, // totalPool
			150n, // poolW (sum of winning stakes)
			100n // 1% rake
		)

		const byBet = Object.fromEntries(result.payouts.map((p) => [p.betId, p.payout]))
		expect(byBet.a).toBe(232n)
		expect(byBet.b).toBe(116n)
		// The full 2 kept here is the intended 1% rake on the 200 losing pool; no dust.
		expect(result.rake).toBe(2n)
		expect(result.dust).toBe(0n)

		const sumPayouts = result.payouts.reduce((acc, p) => acc + p.payout, 0n)
		expect(sumPayouts + result.rake + result.dust).toBe(350n)
	})

	it('preserves principal for every winner in all cases', () => {
		const result = computeResolution(
			[
				{ betId: 'a', userId: 'u1', stake: 1n },
				{ betId: 'b', userId: 'u2', stake: 999n },
			],
			2000n,
			1000n,
			2000n // 20% rake, thin margins
		)
		for (const p of result.payouts) {
			expect(p.payout).toBeGreaterThanOrEqual(p.stake)
		}
		expect(result.rake).toBeGreaterThanOrEqual(0n)
		expect(result.dust).toBeGreaterThanOrEqual(0n)
	})

	it('refunds exactly (no rake, no dust) when uncontested', () => {
		const result = computeResolution(
			[
				{ betId: 'a', userId: 'u1', stake: 100n },
				{ betId: 'b', userId: 'u2', stake: 50n },
			],
			150n,
			150n, // poolW == totalPool ⇒ losingPool 0
			200n
		)
		expect(result.payouts.map((p) => p.payout)).toEqual([100n, 50n])
		expect(result.rake).toBe(0n)
		expect(result.dust).toBe(0n)
	})

	it('separates rake from dust when both are non-zero', () => {
		// 3 winning 1-point stakes; losingPool 1001; 1% rake.
		// rake = floor(1001 * 100 / 10000) = 10; each winning floors 330.33 → 330 (Σ 990);
		// sink = 1004 − (3 + 990) = 11 ⇒ dust = 11 − 10 = 1.
		const result = computeResolution(
			[
				{ betId: 'a', userId: 'u1', stake: 1n },
				{ betId: 'b', userId: 'u2', stake: 1n },
				{ betId: 'c', userId: 'u3', stake: 1n },
			],
			1004n,
			3n,
			100n
		)
		expect(result.rake).toBe(10n)
		expect(result.dust).toBe(1n)
		const sumPayouts = result.payouts.reduce((acc, p) => acc + p.payout, 0n)
		expect(sumPayouts + result.rake + result.dust).toBe(1004n)
	})

	it('routes pure rounding remainder to dust at 0% rake', () => {
		const result = computeResolution(
			[
				{ betId: 'a', userId: 'u1', stake: 1n },
				{ betId: 'b', userId: 'u2', stake: 1n },
				{ betId: 'c', userId: 'u3', stake: 1n },
			],
			10n,
			3n,
			0n
		)
		expect(result.rake).toBe(0n)
		expect(result.dust).toBeGreaterThanOrEqual(0n)
		const sumPayouts = result.payouts.reduce((acc, p) => acc + p.payout, 0n)
		expect(sumPayouts + result.rake + result.dust).toBe(10n)
	})

	it('throws if payouts would exceed the pool (drift guard)', () => {
		// poolW > totalPool is inconsistent and must never silently mint money.
		expect(() =>
			computeResolution([{ betId: 'a', userId: 'u1', stake: 200n }], 100n, 200n, 0n)
		).toThrow()
	})
})
