import { describe, expect, it } from 'vitest'

import {
	computeResolution,
	computeWinnings,
	pickCreatorRewardBps,
	splitCreatorReward,
} from '../payout'

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

describe('pickCreatorRewardBps', () => {
	it('maps the ends of [0,1) to the band endpoints (inclusive)', () => {
		expect(pickCreatorRewardBps(1000, 5000, 0)).toBe(1000) // rand=0 → low
		expect(pickCreatorRewardBps(1000, 5000, 0.999999)).toBe(5000) // rand→1 → high (inclusive)
	})

	it('stays within the band across the unit interval', () => {
		for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999999]) {
			const v = pickCreatorRewardBps(1000, 5000, r)
			expect(v).toBeGreaterThanOrEqual(1000)
			expect(v).toBeLessThanOrEqual(5000)
		}
	})

	it('returns the point when the band collapses (min == max)', () => {
		expect(pickCreatorRewardBps(2500, 2500, 0)).toBe(2500)
		expect(pickCreatorRewardBps(2500, 2500, 0.5)).toBe(2500)
	})

	it('treats an all-zero band as disabled (always 0)', () => {
		expect(pickCreatorRewardBps(0, 0, 0)).toBe(0)
		expect(pickCreatorRewardBps(0, 0, 0.99)).toBe(0)
	})

	it('normalizes an inverted band and clamps out-of-range input', () => {
		// swapped bounds behave like the ordered band
		expect(pickCreatorRewardBps(5000, 1000, 0)).toBe(1000)
		// negatives clamp to 0, > 10000 clamps to 10000
		expect(pickCreatorRewardBps(-500, 20_000, 0)).toBe(0)
		expect(pickCreatorRewardBps(-500, 20_000, 0.999999)).toBe(10_000)
	})

	it('guards against an out-of-range rand', () => {
		expect(pickCreatorRewardBps(1000, 5000, 1)).toBe(1000) // rand≥1 treated as 0
		expect(pickCreatorRewardBps(1000, 5000, -1)).toBe(1000)
	})
})

describe('splitCreatorReward', () => {
	it('splits the rake and conserves it exactly (floor-first)', () => {
		const { creatorReward, houseRake } = splitCreatorReward(1000n, 2500) // 25%
		expect(creatorReward).toBe(250n)
		expect(houseRake).toBe(750n)
		expect(creatorReward + houseRake).toBe(1000n)
	})

	it('floors the creator slice so the house never goes negative', () => {
		const { creatorReward, houseRake } = splitCreatorReward(7n, 3333) // 33.33% of 7 = 2.33
		expect(creatorReward).toBe(2n)
		expect(houseRake).toBe(5n)
		expect(creatorReward + houseRake).toBe(7n)
	})

	it('pays nothing when the share is 0 or the rake is 0 (feature disabled / no rake)', () => {
		expect(splitCreatorReward(1000n, 0)).toEqual({ creatorReward: 0n, houseRake: 1000n })
		expect(splitCreatorReward(0n, 5000)).toEqual({ creatorReward: 0n, houseRake: 0n })
	})

	it('can pay the whole rake at 100% and clamps beyond it', () => {
		expect(splitCreatorReward(1000n, 10_000)).toEqual({ creatorReward: 1000n, houseRake: 0n })
		expect(splitCreatorReward(1000n, 99_999)).toEqual({ creatorReward: 1000n, houseRake: 0n })
	})
})
