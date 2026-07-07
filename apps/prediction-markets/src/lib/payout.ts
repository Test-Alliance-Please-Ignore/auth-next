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
