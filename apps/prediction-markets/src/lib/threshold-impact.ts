/**
 * Pure retroactive-impact bucketing for a candidate two-of-N pool threshold. The threshold is read at
 * SETTLE time (requiresTwoOfN), so changing it re-evaluates which EXISTING markets need two-of-N. This
 * module is the DB-free core of that calculation (the DO fetches the market rows and calls in).
 *
 * Key asymmetry: a CLOSED market's pool is frozen, so it crosses a threshold only if pool >= threshold
 * right now; an OPEN market is still taking bets, so its pool can only grow — any positive threshold is
 * reachable. That's why the "stranding" test treats every open size-1-designated market as at-risk
 * under any non-null candidate, while the flip COUNTS use the current-pool snapshot.
 */

import { parseAmount } from './money'

import type { MarketStatus, StrandedMarket, ThresholdImpact } from '@repo/prediction-markets'

export interface ThresholdMarketRow {
	id: string
	question: string
	status: MarketStatus
	totalPool: string
	twoOfN: boolean
	designatedResolvers: string[] | null
}

/** BigInt-aware equality for a nullable numeric threshold (null = disabled). Avoids raw-string `===`. */
export function thresholdEqual(a: string | null, b: string | null): boolean {
	if (a === null || b === null) return a === b
	return parseAmount(a) === parseAmount(b)
}

/**
 * Bucket the retroactive impact of moving the two-of-N threshold from `current` to `candidate`.
 * Callers MUST pass only non-terminal, non-`resolving` markets (open/closed): a `resolving` market is
 * already committed to the two-signer flow, so a threshold change is inert for it and it must not be
 * counted here. Markets with `twoOfN === true` already require two-of-N unconditionally and never flip.
 */
export function bucketThresholdImpact(
	markets: readonly ThresholdMarketRow[],
	current: string | null,
	candidate: string | null
): ThresholdImpact {
	// Flip counts: snapshot at the CURRENT pool (closed pools are final; open pools are a lower bound).
	const requiresNow = (pool: string, t: string | null) =>
		t !== null && parseAmount(pool) >= parseAmount(t)
	// Stranding risk: closed = frozen pool must already cross; open = any positive threshold is reachable.
	const atRisk = (m: ThresholdMarketRow, t: string | null) => {
		if (t === null) return false
		return m.status === 'open' ? true : parseAmount(m.totalPool) >= parseAmount(t)
	}

	let newlyRequiringCount = 0
	let noLongerRequiringCount = 0
	const strandedCandidates: StrandedMarket[] = []
	for (const m of markets) {
		if (m.twoOfN) continue // already two-of-N regardless of threshold
		const curReq = requiresNow(m.totalPool, current)
		const candReq = requiresNow(m.totalPool, candidate)
		if (!curReq && candReq) newlyRequiringCount++
		if (curReq && !candReq) noLongerRequiringCount++
		// A market with exactly ONE designated resolver can't reach two-of-N (no distinct second signer);
		// count it as newly stranded only if the change moves it from not-at-risk to at-risk.
		if ((m.designatedResolvers?.length ?? 0) === 1 && !atRisk(m, current) && atRisk(m, candidate)) {
			strandedCandidates.push({
				marketId: m.id,
				question: m.question,
				totalPool: m.totalPool,
				status: m.status,
				designatedResolverIds: m.designatedResolvers,
			})
		}
	}
	return { newlyRequiringCount, noLongerRequiringCount, strandedCandidates }
}
