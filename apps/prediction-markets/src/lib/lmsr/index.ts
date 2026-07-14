/**
 * @module lib/lmsr
 *
 * Pure, deterministic fixed-point BigInt implementation of the LMSR (Logarithmic Market Scoring Rule)
 * cost function. Zero dependencies, zero DB, no float — the foundation the LMSR services build on.
 */

export { ONE, LN2, mulF, divF, floorDiv, ceilDiv } from './fixed'
export type { Fixed } from './fixed'
export { expNeg, expNonPositive, lnFixed } from './exp-ln'
export {
	costFixed,
	buyCost,
	sellProceeds,
	subsidyPoints,
	pricesBps,
	costErrorMargin,
} from './cost'
