/**
 * Fixed-point BigInt arithmetic for the LMSR cost function.
 *
 * The LMSR cost function C(q) = b·ln(Σ exp(q_i/b)) needs exp/ln over reals, which collides with the
 * app's hard "money is integer BigInt, never float" invariant (see lib/money.ts, lib/payout.ts). We
 * resolve this by computing C in DETERMINISTIC fixed-point BigInt — every value is a `bigint` scaled
 * by ONE = 10^18 (i.e. the bigint `x` represents the real number `x / 1e18`) — and quantizing a trade
 * cost to whole integer points only at the wallet boundary (see cost.ts). No float ever exists here.
 *
 * Rounding is round-half-up via the `+ divisor/2` idiom. The tiny per-op rounding error is bounded and
 * absorbed by an OUTWARD safety margin applied once at the point-cost boundary (see `costErrorMargin`
 * in cost.ts), so a buy is always charged AT LEAST the true real cost and the maker is never short.
 *
 * All helpers here assume NON-NEGATIVE operands (the LMSR pipeline works in magnitudes); the signed
 * `floorDiv`/`ceilDiv` are the exception and handle a negative numerator correctly (BigInt `/`
 * truncates toward zero, not toward −∞).
 */

/** The fixed-point scale: a `Fixed` value `x` represents the real number `x / ONE`. 18 decimals. */
export const ONE = 10n ** 18n

/** A real number in Q18 format: a bigint scaled by {@link ONE}. Always finite — no NaN/Infinity. */
export type Fixed = bigint

/** ln(2) as Fixed (round-to-nearest of 0.6931471805599453094… · 1e18). Used for range reduction. */
export const LN2: Fixed = 693147180559945309n

/** Fixed-point multiply: round((a·b) / ONE). Operands assumed ≥ 0. */
export function mulF(a: Fixed, b: Fixed): Fixed {
	return (a * b + ONE / 2n) / ONE
}

/** Fixed-point divide: round((a / b)) as Fixed. Assumes a ≥ 0, b > 0. */
export function divF(a: Fixed, b: Fixed): Fixed {
	return (a * ONE + b / 2n) / b
}

/** floor(a / b) for b > 0, correct when `a` is negative (BigInt `/` truncates toward zero). */
export function floorDiv(a: bigint, b: bigint): bigint {
	const q = a / b
	return a % b !== 0n && a < 0n ? q - 1n : q
}

/** ceil(a / b) for b > 0, correct when `a` is negative. */
export function ceilDiv(a: bigint, b: bigint): bigint {
	const q = a / b
	return a % b !== 0n && a > 0n ? q + 1n : q
}
