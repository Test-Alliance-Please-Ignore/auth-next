/**
 * Parimutuel payout math (pure BigInt).
 *
 * Winners receive their principal plus a raked share of the losing pool:
 *   winningsᵢ = floor(stakeᵢ · losingPool · (10000 − rakeBps) / (poolW · 10000))
 *   payoutᵢ   = stakeᵢ + winningsᵢ
 *
 * Properties (see payout.test.ts):
 *  - numerator-first: all multiplication before the single division ⇒ no BigInt
 *    truncation-to-zero.
 *  - principal-preserving: a winner never receives less than their stake.
 *  - rake auto-waived when uncontested (losingPool == 0 ⇒ winnings == 0).
 *  - exact conservation: burn = totalPool − Σpayouts ≥ 0 (absorbs rake + dust).
 */

const BPS_DENOMINATOR = 10_000n

function clampRakeBps(rakeBps: bigint): bigint {
	if (rakeBps < 0n) return 0n
	if (rakeBps > BPS_DENOMINATOR) return BPS_DENOMINATOR
	return rakeBps
}

export function computeWinnings(
	stake: bigint,
	losingPool: bigint,
	poolW: bigint,
	rakeBps: bigint
): bigint {
	if (poolW <= 0n || losingPool <= 0n || stake <= 0n) {
		return 0n
	}
	const rake = clampRakeBps(rakeBps)
	return (stake * losingPool * (BPS_DENOMINATOR - rake)) / (poolW * BPS_DENOMINATOR)
}

export function computePayout(
	stake: bigint,
	losingPool: bigint,
	poolW: bigint,
	rakeBps: bigint
): bigint {
	return stake + computeWinnings(stake, losingPool, poolW, rakeBps)
}

/**
 * Pick a creator-reward share (a fraction of the rake, in basis points) uniformly from the inclusive
 * band [minBps, maxBps]. `rand` is a caller-supplied uniform in [0, 1) (i.e. `Math.random()`) so this
 * stays pure and testable — the randomness is injected, not sourced here.
 *
 * The band is normalized defensively: values are clamped to [0, 10000] and swapped if inverted, so a
 * mis-ordered or out-of-range config can never produce a share above 100% of the rake. When the band
 * collapses to a single point (min == max) that point is returned with no draw.
 */
export function pickCreatorRewardBps(minBps: number, maxBps: number, rand: number): number {
	const lo = Math.min(Math.max(Math.trunc(minBps), 0), 10_000)
	const hi = Math.min(Math.max(Math.trunc(maxBps), 0), 10_000)
	const [low, high] = lo <= hi ? [lo, hi] : [hi, lo]
	if (high <= 0) return 0
	if (low === high) return low
	const span = high - low + 1
	const r = rand >= 0 && rand < 1 ? rand : 0
	return low + Math.min(Math.floor(r * span), span - 1)
}

/**
 * Split a market's rake into the creator's slice and the house remainder, given a share in basis
 * points (fraction of the rake). Floor-first keeps the creator slice ≤ rake, so the house remainder is
 * always ≥ 0 and creatorReward + houseRake == rake exactly (no points created or lost).
 */
export function splitCreatorReward(
	rake: bigint,
	shareBps: number
): { creatorReward: bigint; houseRake: bigint } {
	if (rake <= 0n || shareBps <= 0) {
		return { creatorReward: 0n, houseRake: rake > 0n ? rake : 0n }
	}
	const clamped = BigInt(Math.min(Math.trunc(shareBps), 10_000))
	const creatorReward = (rake * clamped) / BPS_DENOMINATOR
	return { creatorReward, houseRake: rake - creatorReward }
}

export interface ResolutionBet {
	betId: string
	userId: string
	stake: bigint
}

export interface ResolutionPayout extends ResolutionBet {
	payout: bigint
}

export interface ResolutionResult {
	payouts: ResolutionPayout[]
	/** Intended house cut = floor(losingPool · rakeBps / 10000). Routed to a 'rake' line. Always ≥ 0. */
	rake: bigint
	/** Rounding remainder from flooring winner payouts. Routed to a 'burn' line. Always ≥ 0. */
	dust: bigint
}

/**
 * Compute per-bet payouts plus the rake and dust for a resolution.
 * `poolW` must equal the sum of `winningBets` stakes (both derived from the
 * authoritative SUM over active bets in the resolving transaction).
 *
 * Conservation: Σpayouts + rake + dust == totalPool, with rake ≥ 0 and dust ≥ 0.
 */
export function computeResolution(
	winningBets: ResolutionBet[],
	totalPool: bigint,
	poolW: bigint,
	rakeBps: bigint
): ResolutionResult {
	const losingPool = totalPool - poolW
	const rake = losingPool > 0n ? (losingPool * clampRakeBps(rakeBps)) / BPS_DENOMINATOR : 0n
	const payouts = winningBets.map((bet) => ({
		...bet,
		payout: bet.stake + computeWinnings(bet.stake, losingPool, poolW, rakeBps),
	}))
	const sumPayouts = payouts.reduce((acc, p) => acc + p.payout, 0n)
	const sink = totalPool - sumPayouts
	if (sink < 0n) {
		// Impossible with a consistent (poolW, totalPool); guards against drift.
		throw new Error(`prediction-markets: payouts exceed pool (sink=${sink})`)
	}
	const dust = sink - rake
	if (dust < 0n) {
		// Impossible: rake ≤ exact-rake ≤ sink; guards against drift.
		throw new Error(`prediction-markets: rake exceeds sink (rake=${rake}, sink=${sink})`)
	}
	return { payouts, rake, dust }
}
