import { describe, expect, it, vi } from 'vitest'

import { evaluateBasis, evaluateBlastRadius, getBasisBaseline } from '../service-eligibility-basis'

import type { BasisBaseline } from '../service-eligibility-basis'

/**
 * THE BASIS GUARD'S TESTS.
 *
 * `evaluateBasis` is pure precisely so it can be pinned exhaustively without a
 * Postgres fixture. This is the logic whose failure is silent and catastrophic in
 * BOTH directions:
 *
 *  - Too lax on a collapsed basis: the scan reports that nearly every non-admin
 *    should lose their account, the admins reading it are exempt and see nothing
 *    wrong with their own access, and the number looks exactly like what a real
 *    incident would produce.
 *  - Too strict on a shrinking basis: the tool refuses to run during the exact
 *    emergency it exists for. An earlier version did this, unoverridably.
 */

const NO_BASELINE: BasisBaseline = { memberCorpCount: null, corporationIds: [] }

function corps(n: number): string[] {
	return Array.from({ length: n }, (_, i) => `corp-${i + 1}`)
}

function baselineOf(count: number, ids?: string[]): BasisBaseline {
	return { memberCorpCount: count, corporationIds: ids ?? corps(count) }
}

describe('evaluateBasis', () => {
	describe('THE ONLY HARD BLOCK: an empty basis', () => {
		it('blocks when zero corporations are flagged as member corporations', () => {
			const verdict = evaluateBasis({
				corporationIds: [],
				memberCorpCount: 0,
				baseline: baselineOf(50),
			})
			expect(verdict.blocked).toBe(true)
			if (!verdict.blocked) throw new Error('unreachable')
			// The message is the product here — it is what an operator reads at 04:00.
			expect(verdict.errorMessage).toMatch(/cannot be overridden/i)
			expect(verdict.errorMessage).toMatch(/managed_corporations/)
		})

		it('blocks on an empty basis even with no baseline to compare against', () => {
			const verdict = evaluateBasis({
				corporationIds: [],
				memberCorpCount: 0,
				baseline: NO_BASELINE,
			})
			expect(verdict.blocked).toBe(true)
		})

		it('allows the smallest legitimate basis: exactly one member corporation', () => {
			const verdict = evaluateBasis({
				corporationIds: ['corp-1'],
				memberCorpCount: 1,
				baseline: NO_BASELINE,
			})
			expect(verdict.blocked).toBe(false)
		})
	})

	describe('THE REGRESSION THIS MODULE EXISTS FOR: a shrinking basis must not block', () => {
		// An earlier design hard-blocked any >20% shrink, reasoning that "corps
		// leaving does not shrink the basis". That is FALSE: de-flagging a corp IS
		// how a corp leaves (routes/corporations/index.ts sets is_member_corporation
		// = false and fires 'corp-member-flag-disabled'), and it shrinks the basis by
		// construction. The block therefore refused the tool's primary use case, and
		// was unoverridable while doing it. These tests exist so nobody re-adds it.

		it('does NOT block the emergency workflow: corps de-flagged, basis shrinks, scan proceeds', () => {
			// 13 of 50 corps de-flagged => 37 remain => 74% retained, below the old
			// 80% floor. This MUST run: it is the exact scenario the tool is for.
			const verdict = evaluateBasis({
				corporationIds: corps(50).slice(0, 37),
				memberCorpCount: 37,
				baseline: baselineOf(50),
			})
			expect(verdict.blocked).toBe(false)
			if (verdict.blocked) throw new Error('unreachable')
			expect(verdict.basisSuspect).toBe(true)
			// And it must NAME the corps — that is how a human tells "I did that"
			// from "something is broken". A count ratio cannot.
			expect(verdict.removedCorporationIds).toHaveLength(13)
			expect(verdict.removedCorporationIds).toContain('corp-38')
			expect(verdict.basisNote).toMatch(/13 corporation\(s\) left the basis/)
		})

		it('does not block even a catastrophic shrink — it flags it', () => {
			// 200 -> 1 is almost certainly a broken restore. The scan still runs,
			// because a read-only scan is exactly how you diagnose that; blocking it
			// removes the diagnosis. Enforcement is what must refuse.
			const verdict = evaluateBasis({
				corporationIds: ['corp-1'],
				memberCorpCount: 1,
				baseline: baselineOf(200),
			})
			expect(verdict.blocked).toBe(false)
			if (verdict.blocked) throw new Error('unreachable')
			expect(verdict.basisSuspect).toBe(true)
			expect(verdict.removedCorporationIds).toHaveLength(199)
			expect(verdict.basisNote).toMatch(/NOT TRUSTWORTHY/)
			expect(verdict.basisNote).toMatch(/Enforcement will refuse/)
		})
	})

	describe('the suspect threshold', () => {
		it('is not suspect exactly at the 80% floor', () => {
			const verdict = evaluateBasis({
				corporationIds: corps(40),
				memberCorpCount: 40,
				baseline: baselineOf(50),
			})
			expect(verdict.blocked).toBe(false)
			if (verdict.blocked) throw new Error('unreachable')
			expect(verdict.basisSuspect).toBe(false)
			expect(verdict.basisNote).toBeNull()
		})

		it('is suspect just below the floor', () => {
			const verdict = evaluateBasis({
				corporationIds: corps(39),
				memberCorpCount: 39,
				baseline: baselineOf(50),
			})
			expect(verdict.blocked).toBe(false)
			if (verdict.blocked) throw new Error('unreachable')
			expect(verdict.basisSuspect).toBe(true)
		})

		it('is not suspect when the basis grows', () => {
			const verdict = evaluateBasis({
				corporationIds: corps(60),
				memberCorpCount: 60,
				baseline: baselineOf(50),
			})
			expect(verdict.blocked).toBe(false)
			if (verdict.blocked) throw new Error('unreachable')
			expect(verdict.basisSuspect).toBe(false)
			expect(verdict.removedCorporationIds).toHaveLength(0)
		})

		it('reports the compared-against count so the verdict is auditable', () => {
			const verdict = evaluateBasis({
				corporationIds: corps(30),
				memberCorpCount: 30,
				baseline: baselineOf(50),
			})
			expect(verdict.comparedToMemberCorpCount).toBe(50)
		})
	})

	describe('bootstrap', () => {
		it('flags a run with no baseline, and cannot be suspect', () => {
			const verdict = evaluateBasis({
				corporationIds: corps(3),
				memberCorpCount: 3,
				baseline: NO_BASELINE,
			})
			expect(verdict.blocked).toBe(false)
			if (verdict.blocked) throw new Error('unreachable')
			expect(verdict.bootstrap).toBe(true)
			// Nothing to compare against, so "suspect" would be a guess. The UI's job
			// is to show the corp count prominently instead.
			expect(verdict.basisSuspect).toBe(false)
			expect(verdict.comparedToMemberCorpCount).toBeNull()
		})
	})
})

describe('getBasisBaseline', () => {
	function dbWithRuns(runs: Array<{ memberCorpCount: number; memberCorporationIds: string[] }>) {
		return {
			query: {
				serviceAccessAuditRuns: {
					findMany: vi.fn().mockResolvedValue(runs),
				},
			},
		} as never
	}

	it('returns the MAXIMUM count, not the most recent', async () => {
		// THE RATCHET: baselining against the PREVIOUS run lets a sequence of
		// individually-legal drops (50 -> 41 -> 34 -> 28, each >80% of the last) walk
		// the floor to nothing and never trip. Against a maximum it cannot be walked.
		const baseline = await getBasisBaseline(
			dbWithRuns([
				{ memberCorpCount: 50, memberCorporationIds: corps(50) },
				{ memberCorpCount: 41, memberCorporationIds: corps(41) },
				{ memberCorpCount: 34, memberCorporationIds: corps(34) },
				{ memberCorpCount: 28, memberCorporationIds: corps(28) },
			])
		)
		expect(baseline.memberCorpCount).toBe(50)
	})

	it('cannot be poisoned by a corrupt run, because corruption only ever shrinks', async () => {
		// A bootstrap or corrupt run must never become the trusted reference. It
		// structurally cannot: a small value never raises a maximum. That property
		// is the whole reason this is MAX rather than "most recent".
		const baseline = await getBasisBaseline(
			dbWithRuns([
				{ memberCorpCount: 200, memberCorporationIds: corps(200) },
				{ memberCorpCount: 1, memberCorporationIds: ['corp-1'] },
			])
		)
		expect(baseline.memberCorpCount).toBe(200)
	})

	it('carries the winning run’s corporation ids, for the set difference', async () => {
		const baseline = await getBasisBaseline(
			dbWithRuns([
				{ memberCorpCount: 2, memberCorporationIds: ['corp-1', 'corp-2'] },
				{ memberCorpCount: 3, memberCorporationIds: ['corp-1', 'corp-2', 'corp-3'] },
			])
		)
		expect(baseline.corporationIds).toEqual(['corp-1', 'corp-2', 'corp-3'])
	})

	it('returns a null baseline when no good run exists (bootstrap)', async () => {
		const baseline = await getBasisBaseline(dbWithRuns([]))
		expect(baseline.memberCorpCount).toBeNull()
		expect(baseline.corporationIds).toEqual([])
	})

	it('end to end: a walked-down sequence still trips against the max', async () => {
		const baseline = await getBasisBaseline(
			dbWithRuns([
				{ memberCorpCount: 50, memberCorporationIds: corps(50) },
				{ memberCorpCount: 41, memberCorporationIds: corps(41) },
				{ memberCorpCount: 34, memberCorporationIds: corps(34) },
			])
		)
		// 28 is >80% of 34 (the most recent), so a "most recent" baseline would wave
		// it through. Against the max of 50 it is 56% and gets flagged.
		const verdict = evaluateBasis({ corporationIds: corps(28), memberCorpCount: 28, baseline })
		expect(verdict.blocked).toBe(false)
		if (verdict.blocked) throw new Error('unreachable')
		expect(verdict.basisSuspect).toBe(true)
		expect(verdict.comparedToMemberCorpCount).toBe(50)
	})
})

describe('evaluateBlastRadius (soft heuristic)', () => {
	it('trips above 20% ineligible once past the absolute floor', () => {
		expect(evaluateBlastRadius({ scanned: 1000, ineligibleCount: 300 })).toBe(true)
	})

	it('does not trip at exactly 20%', () => {
		expect(evaluateBlastRadius({ scanned: 1000, ineligibleCount: 200 })).toBe(false)
	})

	it('does not trip below the absolute floor of 25, however bad the ratio looks', () => {
		// A 3-user dev database is 100% ineligible and that means nothing.
		expect(evaluateBlastRadius({ scanned: 3, ineligibleCount: 3 })).toBe(false)
		expect(evaluateBlastRadius({ scanned: 30, ineligibleCount: 24 })).toBe(false)
	})

	it('trips at the floor when the ratio is also exceeded', () => {
		expect(evaluateBlastRadius({ scanned: 100, ineligibleCount: 25 })).toBe(true)
	})

	it('does not divide by zero on an empty scan', () => {
		expect(evaluateBlastRadius({ scanned: 0, ineligibleCount: 0 })).toBe(false)
	})
})
