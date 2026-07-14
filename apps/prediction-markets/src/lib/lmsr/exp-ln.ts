/**
 * Deterministic fixed-point exp/ln for the LMSR cost function (pure BigInt, no float).
 *
 * Only two shapes are ever needed by the cost function (see cost.ts):
 *  - exp of a NON-POSITIVE argument (the log-sum-exp trick keeps every exp argument ≤ 0), and
 *  - ln of a value in [1, n]  (the shifted sum S = Σ exp(q_i/b − max) lives in [1, n]).
 * Restricting to these domains keeps both series fast-converging and overflow-free.
 */

import { LN2, mulF, ONE } from './fixed'

import type { Fixed } from './fixed'

/**
 * exp(−t) for t ≥ 0, as Fixed in (0, ONE].
 *
 * Range reduction t = k·ln2 + r (integer k ≥ 0, r ∈ [0, ln2)) gives
 *   exp(−t) = exp(−r) · 2^−k = (1 / exp(r)) · 2^−k,
 * and exp(r) for the small r is a fast all-positive-term Taylor series.
 *
 * Clamp: for t ≥ 48·ONE, exp(−t) < e^−48 ≈ 1.4e−21 — below one fixed-point ULP (1e−18) — so we return
 * 0. This bounds k and costs < 0.0015 ULP of accuracy (negligible; folded into the cost margin).
 */
export function expNeg(t: Fixed): Fixed {
	if (t <= 0n) return ONE // exp(0) = 1 exactly; t is never < 0 by construction
	if (t >= 48n * ONE) return 0n

	const k = t / LN2 // floor(t / ln2) — the integer number of halvings
	const r = t - k * LN2 // r ∈ [0, ln2)
	const expR = taylorExp(r) // ∈ [ONE, 2·ONE)

	// exp(−t) = ONE·ONE / (exp(r) · 2^k), round-to-nearest. denom stays exact BigInt.
	const denom = expR << k
	return (ONE * ONE + denom / 2n) / denom
}

/** exp(x) for x ≤ 0, as Fixed in (0, ONE]. Thin wrapper over {@link expNeg}. */
export function expNonPositive(x: Fixed): Fixed {
	return expNeg(-x)
}

/** Σ_{n≥0} r^n/n! for r ∈ [0, ln2), as Fixed in [ONE, 2·ONE). ~20 terms reach full 1e18 precision. */
function taylorExp(r: Fixed): Fixed {
	let sum = ONE // n = 0 term
	let term = ONE
	for (let n = 1n; n <= 30n; n++) {
		term = mulF(term, r) / n // term_n = term_{n−1} · r / n
		if (term === 0n) break
		sum += term
	}
	return sum
}

/**
 * ln(s) for s ≥ ONE, as Fixed ≥ 0.
 *
 * Range reduction by powers of two: s = m · 2^k with m ∈ [ONE, 2·ONE), so ln(s) = k·ln2 + ln(m).
 * ln(m) for m ∈ [1, 2) via the atanh series ln(m) = 2·(y + y³/3 + y⁵/5 + …), y = (m−1)/(m+1) ∈ [0, 1/3),
 * which converges quickly since y ≤ 1/3.
 */
export function lnFixed(s: Fixed): Fixed {
	if (s <= ONE) return 0n // ln(1) = 0; s ≥ ONE by construction (S = Σ exp ≥ 1)

	let k = 0n
	let m = s
	while (m >= 2n * ONE) {
		m >>= 1n
		k++
	}
	// m ∈ [ONE, 2·ONE). y = (m−1)/(m+1) ∈ [0, 1/3).
	const y = ((m - ONE) * ONE + (m + ONE) / 2n) / (m + ONE)
	const y2 = mulF(y, y)
	let termPow = y // y^(2j+1), starting at y^1
	let acc = y
	for (let j = 1n; j <= 40n; j++) {
		termPow = mulF(termPow, y2)
		const add = termPow / (2n * j + 1n)
		if (add === 0n) break
		acc += add
	}
	return k * LN2 + 2n * acc
}
