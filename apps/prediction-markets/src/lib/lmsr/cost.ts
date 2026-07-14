/**
 * The LMSR cost-function engine (pure BigInt) — the money-relevant surface of the fixed-point library.
 *
 * Cost function: C(q) = b·ln(Σ_i exp(q_i/b))   where q_i = net shares of outcome i (≥ 0, no shorting)
 * and b = liquidity parameter in points. A trade's integer point cost is quantized here at the wallet
 * boundary; the trade functions are DIRECTIONAL — a buy is charged an over-estimate and a sell pays an
 * under-estimate of the true real cost, so the market maker can never be short (see the conservation
 * and bounded-loss proofs in __tests__/cost.test.ts).
 *
 * Redemption (settled elsewhere): each winning share redeems for exactly 1 point, so a market's max
 * maker loss is b·ln(n), pre-funded by {@link subsidyPoints}.
 */

import { ceilDiv, floorDiv, ONE } from './fixed'
import { expNeg, lnFixed } from './exp-ln'

import type { Fixed } from './fixed'

/**
 * OUTWARD per-evaluation error margin for one {@link costFixed} call, in Fixed units (points · ONE).
 *
 * Each fixed-point op contributes a few ULP of rounding error to the dimensionless ln Σ exp(q_i/b):
 * n exp terms (~4 ULP each ⇒ 4n in the sum) plus the ln (~2 ULP, its 1/S ≤ 1 sensitivity does not
 * amplify since S ≥ 1). Multiplied by b (points) this bounds |Ĉ − C_true·ONE| ≤ b·(4n + 2); we use
 * b·(8n + 16) for generous headroom. Added OUTWARD when quantizing a trade cost so a buy is charged at
 * least the true real cost. For any realistic b this margin is a minuscule fraction of one point, so
 * it never changes the charged integer cost in practice — it only closes the theoretical gap.
 */
export function costErrorMargin(b: bigint, n: number): Fixed {
	return b * (8n * BigInt(n) + 16n)
}

/**
 * C(q) = b·ln(Σ_i exp(q_i/b)) as Fixed (points · ONE).
 *
 * Uses the log-sum-exp trick to keep every exp argument ≤ 0 and the sum in [1, n]: with
 * M = max_i ceil(q_i/b),  C = b·(M + ln Σ_i exp(q_i/b − M)). The argmax term shifts to exactly 0
 * (exp = 1), so S ∈ [ONE, n·ONE] and lnFixed stays in its domain. `qs` are net shares per outcome
 * (each ≥ 0); `b` is the liquidity parameter in points (> 0).
 */
export function costFixed(qs: readonly bigint[], b: bigint): Fixed {
	// ratio_i = ceil(q_i/b) as Fixed. Rounding all i the SAME way keeps the argmax's shifted arg
	// exactly 0, so its exp term is exactly ONE and S ≥ ONE.
	const ratios = qs.map((q) => ceilDiv(q * ONE, b))
	let m = ratios[0]
	for (const r of ratios) if (r > m) m = r

	let s: Fixed = 0n
	for (const r of ratios) {
		s += expNeg(m - r) // m − r ≥ 0; exp(−(m − r)) ∈ (0, ONE]
	}
	const shifted = m + lnFixed(s) // = ln Σ exp(q_i/b), as Fixed
	return b * shifted // points · ONE
}

/**
 * Integer points a buyer pays to add `delta` (> 0) shares of outcome `k` — an OVER-estimate of the
 * true real cost C(q + Δ·e_k) − C(q), so the maker is never short.
 */
export function buyCost(qs: readonly bigint[], k: number, delta: bigint, b: bigint): bigint {
	if (delta <= 0n) throw new Error('lmsr: buy delta must be positive')
	const before = costFixed(qs, b)
	const q2 = qs.slice()
	q2[k] += delta
	const after = costFixed(q2, b)
	const margin = costErrorMargin(b, qs.length)
	// (after − before + 2·margin) ≥ (C_true(q') − C_true(q))·ONE; ceil to whole points.
	return ceilDiv(after - before + 2n * margin, ONE)
}

/**
 * Integer points a seller receives for removing `delta` (> 0) shares of outcome `k` — an UNDER-estimate
 * of the true proceeds C(q) − C(q − Δ·e_k), never negative. Caller must ensure `delta ≤ qs[k]` (and
 * ≤ the seller's own position); shares stay ≥ 0 (no shorting).
 */
export function sellProceeds(qs: readonly bigint[], k: number, delta: bigint, b: bigint): bigint {
	if (delta <= 0n) throw new Error('lmsr: sell delta must be positive')
	if (delta > qs[k]) throw new Error('lmsr: sell delta exceeds outstanding shares')
	const before = costFixed(qs, b)
	const q2 = qs.slice()
	q2[k] -= delta
	const after = costFixed(q2, b)
	const margin = costErrorMargin(b, qs.length)
	const proceeds = floorDiv(before - after - 2n * margin, ONE)
	return proceeds > 0n ? proceeds : 0n
}

/**
 * The market maker's pre-funded reservation for a market — its worst-case loss b·ln(n), rounded UP
 * (plus the error margin) so the reservation always covers the true b·ln n. `n` = outcome count (≥ 2).
 */
export function subsidyPoints(b: bigint, n: number): bigint {
	if (n < 2) throw new Error('lmsr: need at least 2 outcomes')
	const lnN = lnFixed(BigInt(n) * ONE)
	return ceilDiv(b * lnN + costErrorMargin(b, n), ONE)
}

/**
 * Implied probabilities per outcome, in basis points (Σ ≈ 10000). Display-only — never touches money,
 * so the final `Number` cast (a small bps integer) is safe, mirroring the parimutuel `impliedOddsBps`.
 */
export function pricesBps(qs: readonly bigint[], b: bigint): number[] {
	const ratios = qs.map((q) => ceilDiv(q * ONE, b))
	let m = ratios[0]
	for (const r of ratios) if (r > m) m = r
	const exps = ratios.map((r) => expNeg(m - r))
	const s = exps.reduce((acc, e) => acc + e, 0n)
	return exps.map((e) => Number((e * 10000n) / s))
}
