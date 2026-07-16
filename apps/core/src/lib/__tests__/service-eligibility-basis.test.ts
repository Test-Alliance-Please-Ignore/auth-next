import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const NO_BASELINE: BasisBaseline = { memberCorpCount: null, corporationIds: [], acknowledgedAt: null }

function corps(n: number): string[] {
	return Array.from({ length: n }, (_, i) => `corp-${i + 1}`)
}

function baselineOf(count: number, ids?: string[]): BasisBaseline {
	return { memberCorpCount: count, corporationIds: ids ?? corps(count), acknowledgedAt: null }
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

/**
 * Render the shape of a drizzle query fragment: its literal SQL text plus the
 * columns it directly references.
 *
 * JSON.stringify cannot be used — drizzle's SQL and Column objects are circular.
 * A naive deep walk is also useless: it descends into a Column's `table` and
 * reports EVERY column of that table, so `not.toContain('started_at')` would
 * always fail. This walks `queryChunks` only, and takes a Column's own name
 * without following it back to its table.
 */
function sqlShape(value: unknown): string {
	const parts: string[] = []
	const walk = (node: unknown): void => {
		if (node === null || typeof node !== 'object') return
		const record = node as Record<string, unknown>

		// StringChunk: the literal SQL text, e.g. ' >= ' or ' in '.
		if (Array.isArray(record.value) && record.value.every((v) => typeof v === 'string')) {
			parts.push((record.value as string[]).join(''))
			return
		}
		// Column: take its own name; do NOT recurse into `.table`.
		if (typeof record.name === 'string' && 'table' in record) {
			parts.push(record.name)
			return
		}
		if (Array.isArray(record.queryChunks)) {
			for (const chunk of record.queryChunks) walk(chunk)
			return
		}
		if (Array.isArray(node)) {
			for (const item of node) walk(item)
		}
	}
	walk(value)
	return parts.join(' ')
}

describe('getBasisBaseline', () => {
	/**
	 * The max is now computed by Postgres (`ORDER BY member_corp_count DESC LIMIT
	 * 1`), not by a JS reduce, so a mocked db cannot test it — and a mock that
	 * ignores its argument would prove nothing anyway. That was the flaw in the
	 * previous suite: its "cannot be poisoned by a corrupt run" test was really
	 * `Math.max(200, 1) === 200` and would have passed with the status filter, the
	 * suspect filter AND the window all deleted.
	 *
	 * So these test the two things that ARE ours: the JS wiring (anchor -> search
	 * boundary, null handling, passthrough), and the SHAPE of what we ask the
	 * database for.
	 */
	function makeDb(options: {
		anchor?: { startedAt: Date; basisAcknowledgedAt: Date }
		best?: { memberCorpCount: number; memberCorporationIds: string[] | null }
	}) {
		const calls: Array<Record<string, unknown>> = []
		let call = 0
		return {
			calls,
			db: {
				query: {
					serviceAccessAuditRuns: {
						findFirst: vi.fn(async (opts: Record<string, unknown>) => {
							calls.push(opts)
							// Call 1 is the acknowledgement anchor, call 2 the high-water run.
							return call++ === 0 ? options.anchor : options.best
						}),
					},
				},
			} as never,
		}
	}

	it('returns a null baseline ONLY when no scan has ever completed', async () => {
		const { db } = makeDb({ anchor: undefined, best: undefined })
		const baseline = await getBasisBaseline(db)
		expect(baseline.memberCorpCount).toBeNull()
		expect(baseline.corporationIds).toEqual([])
		expect(baseline.acknowledgedAt).toBeNull()
	})

	it('REGRESSION: a history of nothing but suspect runs still yields a baseline', async () => {
		// THE DARK-GUARD BUG. The previous design excluded suspect runs from the
		// candidate set and bounded it to a 30-day window. After 30 days of
		// corruption every candidate was suspect => excluded => the set emptied =>
		// baseline null => "bootstrap" => basisSuspect FALSE. The corrupt basis was
		// reported as fine, which is precisely the flag enforcement is told to trust.
		//
		// There is no suspect filter now, so a suspect run is still a candidate and
		// a baseline still exists. Exclusion never bought anything: a shrink-corrupted
		// run's count is below the mark by construction and cannot win a max.
		const { db } = makeDb({
			anchor: undefined,
			best: { memberCorpCount: 5, memberCorporationIds: corps(5) },
		})
		const baseline = await getBasisBaseline(db)
		expect(baseline.memberCorpCount).toBe(5)

		const verdict = evaluateBasis({ corporationIds: corps(5), memberCorpCount: 5, baseline })
		expect(verdict.blocked).toBe(false)
		if (verdict.blocked) throw new Error('unreachable')
		// The point: NOT silently blessed as a fresh bootstrap.
		expect(verdict.bootstrap).toBe(false)
	})

	it('asks Postgres for the MAXIMUM, not the latest', async () => {
		// The ratchet defence lives in this ORDER BY. Baselining against the
		// PREVIOUS run lets 50 -> 41 -> 34 -> 28 (each >80% of the last) walk the
		// floor to nothing; against a max it cannot be walked.
		const { db, calls } = makeDb({
			anchor: undefined,
			best: { memberCorpCount: 50, memberCorporationIds: corps(50) },
		})
		await getBasisBaseline(db)

		const bestQuery = calls[1]
		expect(bestQuery.orderBy).toBeDefined()
		// Ordering by startedAt would silently make this "most recent" again.
		expect(sqlShape(bestQuery.orderBy)).toContain('member_corp_count')
	})

	it('bounds the search at the last acknowledged run', async () => {
		const ackedAt = new Date('2026-07-01T00:00:00Z')
		const startedAt = new Date('2026-06-30T00:00:00Z')
		const { db, calls } = makeDb({
			anchor: { startedAt, basisAcknowledgedAt: ackedAt },
			best: { memberCorpCount: 37, memberCorporationIds: corps(37) },
		})

		const baseline = await getBasisBaseline(db)

		expect(baseline.memberCorpCount).toBe(37)
		// Carried so the UI can say whether anyone has ever vouched for a basis.
		expect(baseline.acknowledgedAt).toEqual(ackedAt)
		// Two queries: the anchor, then the high-water run since it.
		expect(calls).toHaveLength(2)
		expect(sqlShape(calls[1].where)).toContain('started_at')
	})

	it('searches all history when nothing has ever been acknowledged', async () => {
		const { db, calls } = makeDb({
			anchor: undefined,
			best: { memberCorpCount: 50, memberCorporationIds: corps(50) },
		})
		const baseline = await getBasisBaseline(db)

		expect(baseline.acknowledgedAt).toBeNull()
		// No anchor => no startedAt lower bound => the whole history informs the max.
		expect(sqlShape(calls[1].where)).not.toContain('started_at')
	})

	it('tolerates a run whose corporation ids are null', async () => {
		const { db } = makeDb({
			anchor: undefined,
			best: { memberCorpCount: 3, memberCorporationIds: null },
		})
		const baseline = await getBasisBaseline(db)
		expect(baseline.corporationIds).toEqual([])
	})
})

describe('the basis guard’s deliberate absences (regression guards)', () => {
	// The window and the suspect-exclusion, TOGETHER, produced the dark-guard bug.
	// Neither may come back.
	const source = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '..', 'service-eligibility-basis.ts'),
		'utf8'
	)

	/**
	 * getBasisBaseline's body, comments stripped.
	 *
	 * Scoped to the function rather than the file because `basisSuspect` appears
	 * legitimately elsewhere (evaluateBasis returns it) — a file-wide check would
	 * be a false positive. And matched on the IDENTIFIER, not on guessed syntax: an
	 * earlier version of this guard tested /basisSuspect\s*=\s*false/, which the
	 * real code (sql`${runs.basisSuspect} = false`) does not match because of the
	 * closing brace. It would have sailed straight past a reintroduction.
	 */
	const baselineBody = (() => {
		const start = source.indexOf('export async function getBasisBaseline')
		const end = source.indexOf('export interface BasisVerdictOk')
		return source
			.slice(start, end)
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/\/\/.*$/gm, '')
	})()

	it('has no trailing window on the baseline', () => {
		// A window makes the guard forget on a timer, which is how it went dark:
		// after 30 days of corruption the only good run aged out and the corrupt
		// basis was reported as a fresh bootstrap. Time is not evidence that a basis
		// is correct; a human acknowledging it is.
		//
		// Asserted as "constructs no dates AT ALL" rather than by guessing at the
		// syntax of a window. The real function reads its only timestamp from the
		// anchor row, so any date arithmetic appearing here is a window being
		// reintroduced. An earlier version of this guard only matched getTime() and
		// sailed straight past a Date.now() window.
		expect(source).not.toMatch(/WINDOW_DAYS/)
		expect(baselineBody).not.toMatch(/new Date\(|Date\.now\(|getTime\(/)
	})

	it('does not filter the baseline on basisSuspect', () => {
		// Excluding suspect runs is what let the candidate set empty out and report a
		// corrupt basis as a fresh bootstrap.
		expect(baselineBody).not.toMatch(/basisSuspect/)
	})

	it('anchors the baseline on acknowledgement instead', () => {
		expect(baselineBody).toMatch(/basisAcknowledgedAt/)
		expect(baselineBody).toMatch(/isNotNull/)
	})

	it('orders by member corp count, never by recency', () => {
		expect(baselineBody).toMatch(/desc\(serviceAccessAuditRuns\.memberCorpCount\)/)
	})
})
