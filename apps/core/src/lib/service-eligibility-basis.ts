import { and, desc, gte, inArray, isNotNull } from '@repo/db-utils'

import { serviceAccessAuditRuns } from '../db/schema'

import type { DbClient, schema } from '../db'

/**
 * THE BASIS GUARD.
 *
 * `managed_corporations.is_member_corporation` is `.default(false).notNull()`
 * (db/schema.ts). THE BASIS DEFAULTS TO THE REVOKING VALUE. An empty or
 * half-restored `managed_corporations` therefore does not *degrade* the
 * eligibility rule, it INVERTS it: every non-admin becomes a revocation target.
 *
 * And admins are exempt (`admin_exempt`), so THE OPERATORS RUNNING THIS TOOL ARE
 * STRUCTURALLY THE LAST PEOPLE TO NOTICE. Their own access is intact; the tool
 * reports a large, confident, entirely wrong number; and at 04:00 during an
 * incident a large number is exactly what they are braced to see.
 *
 * ── WHY A SHRINKING BASIS IS *NOT* BLOCKED (this was got wrong once) ──
 *
 * An earlier design hard-blocked any scan whose basis shrank >20%, on the stated
 * grounds that "corps leaving changes who is ineligible without shrinking the
 * basis". THAT IS FALSE, and it inverted the tool's purpose.
 *
 * De-flagging a corporation IS how a corp stops being a member corp: there is an
 * admin route that sets `is_member_corporation = false` and fires a
 * `corp-member-flag-disabled` Discord refresh (routes/corporations/index.ts).
 * So the primary emergency workflow — corps defect, an admin de-flags them, the
 * audit sweeps their members — SHRINKS THE BASIS BY CONSTRUCTION. A hard block on
 * shrink would refuse to run in exactly the incident it was built for, and would
 * be unoverridable while doing it.
 *
 * A count ratio cannot tell "an operator de-flagged 13 corps" from "the table got
 * truncated". A SET DIFFERENCE can be read by a human in two seconds: the
 * operator who just de-flagged 13 corps recognises their names instantly, and 199
 * vanished corps are self-evidently a fault. So we snapshot the basis IDs and
 * report exactly which corporations left.
 *
 * ── WHERE THE TEETH ACTUALLY BELONG ──
 *
 * A scan does not WRITE to any service, so blocking it is mostly downside: it
 * prevents the legitimate workflow AND prevents diagnosis, since a scan's output
 * is precisely what reveals a broken basis. The catastrophe this guard exists to
 * prevent is MASS REVOCATION on a corrupt basis, and revocation happens at
 * ENFORCE.
 *
 * But do not mistake that for "a scan cannot hurt anyone" — an earlier version of
 * this comment said exactly that, and it conflates the write with the ARTIFACT. A
 * scan's output IS the revocation list: it terminates in
 * `status: 'awaiting_confirmation'`, and every row carries `mumbleStatus` /
 * `discordStatus` columns that exist for no reason except for enforcement to
 * mutate. A scan is harmless; a scan's CONCLUSION is not. That is why a suspect
 * basis must be carried on the run and honoured downstream rather than merely
 * logged.
 *
 * Therefore:
 *   - count < 1        -> BLOCK the scan. Genuinely unambiguous; see below.
 *   - basis shrank     -> DO NOT BLOCK. Record `basisSuspect` + the removed corp
 *                         ids, and surface them loudly.
 *   - ineligible ratio -> DO NOT BLOCK. Record `blastRadiusTripped`.
 *
 * >>> ENFORCEMENT (increment 7, NOT YET BUILT) MUST HARD-REFUSE to act on a run
 * >>> whose `basisSuspect` is true and whose `basisAcknowledgedAt` is null.
 * >>> That refusal is the real circuit breaker. This module only ever informs.
 * >>> The acknowledgement column and route exist as of this change — when that
 * >>> promise was first written, they did not, which made it a lie. <<<
 */

/**
 * Below this the basis is not "small", it is broken.
 *
 * This is the one genuinely unambiguous case, and the only one that blocks. With
 * zero member corps the rule degenerates to "revoke every non-admin", which is
 * never the correct output of a scan — an alliance with zero member corporations
 * has nobody to audit. A brand-new deployment with no corps configured also lands
 * here, and blocking is the right answer there too.
 */
const MIN_MEMBER_CORP_COUNT = 1

/**
 * A basis retaining less than this fraction of the high-water mark is flagged
 * `basisSuspect` — reported, never blocked.
 */
const BASIS_SHRINK_SUSPECT_RATIO = 0.8

/** Blast-radius heuristic. Soft: flags, never blocks. */
const BLAST_RADIUS_RATIO = 0.2

/** Below this absolute count the ratio is meaningless — a 3-user dev database is
 * 100% ineligible and that tells you nothing. */
const BLAST_RADIUS_ABSOLUTE_FLOOR = 25

/**
 * Statuses whose basis reading is trustworthy enough to inform the baseline.
 * `awaiting_confirmation` counts: its scan succeeded and merely found work.
 * `blocked`/`failed`/`cancelled` do not — their basis is either the broken one or
 * was never fully read.
 */
const BASELINE_STATUSES = ['completed', 'awaiting_confirmation', 'completed_with_errors'] as const

export interface BasisBaseline {
	/** High-water member-corp count since the last acknowledged run; null only
	 * when no scan has ever completed. */
	memberCorpCount: number | null
	/** The basis snapshot of the run that set the high-water mark, for the set
	 * difference. Empty when there is no baseline. */
	corporationIds: string[]
	/** When an operator last vouched for a basis. null = never; the guard is
	 * comparing against unvouched history. */
	acknowledgedAt: Date | null
}

/**
 * The baseline is the HIGHEST member-corp count seen since the last
 * ACKNOWLEDGED run — never the most recent run, and never bounded by a timer.
 *
 * ── WHY MAX, NOT "MOST RECENT" ──
 *
 * THE RATCHET. If each run baselines against its predecessor, a sequence of
 * individually-legal drops (50 -> 41 -> 34 -> 28 -> 23, each >80% of the last)
 * walks the floor to nothing and never trips. Against a maximum it cannot.
 *
 * ── WHY AN ACK, NOT A TRAILING WINDOW ──
 *
 * A previous version took the max over a trailing 30-day window and excluded
 * suspect runs from the candidate set. Both were wrong, and together they made
 * the guard SILENTLY GO DARK on exactly the corruption it exists to catch:
 *
 *   Day 0:    200 corps, good run.                        baseline = 200
 *   Day 1-30: basis corrupted to 5. Every run flags suspect
 *             — and every suspect run is excluded.
 *   Day 31:   the day-0 run ages out of the window. Every
 *             remaining candidate is suspect => excluded =>
 *             candidate set EMPTY => baseline null =>
 *             "bootstrap" => basisSuspect: FALSE.
 *
 * The corrupt basis is then reported as fine. The old comment claimed excluding
 * suspect runs "costs nothing, because a suspect run could not have won the max
 * anyway" — that is true of the MAX and false of the guard: exclusion did not
 * cost the maximum, it cost the EXISTENCE of a baseline. The same failure fires
 * immediately, not in 30 days, wherever scans are less frequent than the window.
 *
 * The window existed only to stop a LEGITIMATE permanent shrink (an operator
 * de-flags 13 corps) from crying wolf forever. An acknowledgement does that job
 * correctly: it is a human saying "this basis is right", which is the one signal
 * a count can never contain. Time is not evidence. A human is.
 *
 * ── WHY SUSPECT RUNS ARE NO LONGER EXCLUDED ──
 *
 * They never needed to be. A shrink-corrupted run's count is BELOW the mark by
 * construction, so it cannot win a max — the exclusion was belt-and-braces that
 * bought nothing and cost the dark-guard bug above.
 *
 * ── THE CASE THIS DOES NOT CATCH ALONE ──
 *
 * "Corruption only ever shrinks" is FALSE, and an earlier version of this file
 * asserted it. A bad restore or migration that sets is_member_corporation = true
 * broadly INFLATES the basis (200 -> 600). That run grows, so it is not suspect,
 * so it enters the max and poisons the baseline upward — and every later correct
 * run then flags against it. The ack is what clears that too: an operator
 * confirms the correct 200-corp run and the floor resets. Without an ack there
 * would be no way out, which is the strongest argument for having one.
 */
export async function getBasisBaseline(db: DbClient<typeof schema>): Promise<BasisBaseline> {
	// The anchor: the most recently acknowledged run. Everything before it is
	// history a human has already superseded.
	const anchor = await db.query.serviceAccessAuditRuns.findFirst({
		where: isNotNull(serviceAccessAuditRuns.basisAcknowledgedAt),
		orderBy: desc(serviceAccessAuditRuns.basisAcknowledgedAt),
		columns: { startedAt: true, basisAcknowledgedAt: true },
	})

	// ORDER BY member_corp_count DESC LIMIT 1 *is* the max, computed by Postgres
	// over one row rather than by dragging every run's corporation_ids array
	// through the driver to reduce() in JS.
	const best = await db.query.serviceAccessAuditRuns.findFirst({
		where: anchor
			? and(
					inArray(serviceAccessAuditRuns.status, [...BASELINE_STATUSES]),
					gte(serviceAccessAuditRuns.startedAt, anchor.startedAt)
				)
			: inArray(serviceAccessAuditRuns.status, [...BASELINE_STATUSES]),
		orderBy: desc(serviceAccessAuditRuns.memberCorpCount),
		columns: { memberCorpCount: true, memberCorporationIds: true },
	})

	if (!best) {
		// No scan has ever completed. Genuinely nothing to compare against — the
		// only path to a null baseline, and it cannot be reached by corruption.
		return { memberCorpCount: null, corporationIds: [], acknowledgedAt: null }
	}

	return {
		memberCorpCount: best.memberCorpCount,
		corporationIds: best.memberCorporationIds ?? [],
		acknowledgedAt: anchor?.basisAcknowledgedAt ?? null,
	}
}

export interface BasisVerdictOk {
	blocked: false
	/**
	 * No scan has ever completed, so there is nothing to compare against. The UI
	 * must surface the corp count prominently — on this path nothing has validated
	 * it.
	 *
	 * Reachable ONLY on a genuinely empty history. It is deliberately NOT
	 * reachable by corruption: the previous design could arrive here by aging its
	 * only good run out of a trailing window, which silently reported a corrupt
	 * basis as `basisSuspect: false`.
	 */
	bootstrap: boolean
	/** The basis shrank against the high-water mark since the last acknowledged
	 * run. INFORMATIONAL for a scan; ENFORCEMENT MUST REFUSE on it unless
	 * acknowledged. */
	basisSuspect: boolean
	corporationIds: string[]
	memberCorpCount: number
	comparedToMemberCorpCount: number | null
	/** Exactly which corporations left the basis. The whole point: a human reads
	 * this and knows in seconds whether it was them or a fault. */
	removedCorporationIds: string[]
	/** Non-null when basisSuspect. Explains the diff; does not scold. */
	basisNote: string | null
}

export interface BasisVerdictBlocked {
	blocked: true
	corporationIds: string[]
	memberCorpCount: number
	comparedToMemberCorpCount: number | null
	/** Operator-actionable. Says what broke, what the numbers were, and what to do
	 * — a bare "assertion failed" at 04:00 is not a message, it is a riddle. */
	errorMessage: string
}

export type BasisVerdict = BasisVerdictOk | BasisVerdictBlocked

/**
 * Evaluate the basis. PURE — takes the numbers, returns a verdict, touches no
 * database. Deliberate: this is the logic whose failure is silent and
 * catastrophic, so it must be exhaustively testable with no Postgres fixture.
 */
export function evaluateBasis(options: {
	corporationIds: string[]
	memberCorpCount: number
	baseline: BasisBaseline
}): BasisVerdict {
	const { corporationIds, memberCorpCount, baseline } = options
	const baselineCount = baseline.memberCorpCount

	// ── THE ONLY HARD BLOCK: the basis is empty. ──
	// Unoverridable. With zero member corps the rule says "revoke everyone except
	// admins". There is no state of the world where that is a scan's correct
	// output rather than the signature of a broken managed_corporations.
	if (memberCorpCount < MIN_MEMBER_CORP_COUNT) {
		return {
			blocked: true,
			corporationIds,
			memberCorpCount,
			comparedToMemberCorpCount: baselineCount,
			errorMessage:
				`BLOCKED: no corporations are flagged as member corporations (member_corp_count=${memberCorpCount}). ` +
				`The eligibility rule would mark every non-admin user ineligible, so this scan was aborted before writing any rows. ` +
				`This almost always means managed_corporations is empty, half-restored, or mid-sync — not that the alliance has no members. ` +
				`Fix managed_corporations (verify is_member_corporation is set on the expected corps), then start a new scan. ` +
				`This check cannot be overridden.`,
		}
	}

	const removedCorporationIds =
		baseline.corporationIds.length > 0
			? baseline.corporationIds.filter((id) => !corporationIds.includes(id))
			: []

	// ── SOFT: the basis shrank against the recent high-water mark. ──
	// Reported, not blocked. See the module docblock: de-flagging corps is the
	// legitimate mechanism AND it shrinks the basis, so a block here would refuse
	// the tool's primary use case.
	const suspect =
		baselineCount !== null &&
		baselineCount > 0 &&
		memberCorpCount < BASIS_SHRINK_SUSPECT_RATIO * baselineCount

	return {
		blocked: false,
		bootstrap: baselineCount === null,
		basisSuspect: suspect,
		corporationIds,
		memberCorpCount,
		comparedToMemberCorpCount: baselineCount,
		removedCorporationIds,
		basisNote: suspect
			? `The member-corporation basis shrank from ${baselineCount} to ${memberCorpCount} ` +
				`(${((memberCorpCount / (baselineCount || 1)) * 100).toFixed(1)}% retained) versus the highest basis seen since the last ` +
				`confirmed basis${baseline.acknowledgedAt ? '' : ' (none has ever been confirmed)'}. ` +
				`${removedCorporationIds.length} corporation(s) left the basis. ` +
				`If you de-flagged them, this is expected: confirm the basis and this run becomes the new reference. ` +
				`If you do not recognise them, managed_corporations may be half-restored or mid-sync and ` +
				`THIS SCAN'S RESULTS ARE NOT TRUSTWORTHY — fix the data and re-scan rather than confirming. ` +
				`Enforcement will refuse to act on this run until the basis is confirmed.`
			: null,
	}
}

/**
 * The blast-radius heuristic, evaluated on the scan's OUTCOME at finalize.
 * Never blocks: it flags. The operator sees the flag next to the actual row list
 * and decides. Gated on an absolute floor so small populations don't cry wolf.
 */
export function evaluateBlastRadius(options: {
	scanned: number
	ineligibleCount: number
}): boolean {
	const { scanned, ineligibleCount } = options
	if (scanned <= 0) return false
	if (ineligibleCount < BLAST_RADIUS_ABSOLUTE_FLOOR) return false
	return ineligibleCount / scanned > BLAST_RADIUS_RATIO
}
