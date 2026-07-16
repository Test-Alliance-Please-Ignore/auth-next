import { gte, inArray, sql } from '@repo/db-utils'

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
 * A SCAN IS READ-ONLY AND CANNOT HURT ANYONE. Blocking it is pure downside: it
 * prevents the legitimate workflow AND prevents diagnosis, since a scan's output
 * is precisely what reveals a broken basis. The catastrophe this guard exists to
 * prevent is MASS REVOCATION on a corrupt basis, and revocation happens at
 * ENFORCE, not at scan.
 *
 * Therefore:
 *   - count < 1        -> BLOCK the scan. Genuinely unambiguous; see below.
 *   - basis shrank     -> DO NOT BLOCK. Record `basisSuspect` + the removed corp
 *                         ids, and surface them loudly.
 *   - ineligible ratio -> DO NOT BLOCK. Record `blastRadiusTripped`.
 *
 * >>> ENFORCEMENT (increment 7, NOT YET BUILT) MUST HARD-REFUSE to act on a run
 * >>> whose `basisSuspect` is true and unacknowledged. That refusal is the real
 * >>> circuit breaker. This module only ever informs. <<<
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
 * A basis retaining less than this fraction of the recent high-water mark is
 * flagged `basisSuspect` — reported, never blocked.
 */
const BASIS_SHRINK_SUSPECT_RATIO = 0.8

/** Trailing window for the high-water baseline. Wide enough that a corrupt run
 * cannot outlive the good runs around it; narrow enough that a LEGITIMATE
 * permanent shrink stops being flagged once it has settled, instead of crying
 * wolf forever. */
const BASIS_BASELINE_WINDOW_DAYS = 30

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
	/** High-water member-corp count across recent good runs; null on bootstrap. */
	memberCorpCount: number | null
	/** The basis snapshot of the run that set the high-water mark, for the set
	 * difference. Empty when there is no baseline. */
	corporationIds: string[]
}

/**
 * The baseline is the MAXIMUM member-corp count over recent good runs — NOT the
 * most recent one.
 *
 * This single choice kills two bugs at once, and both are worth stating because
 * "most recent" is the intuitive implementation:
 *
 *  1. THE RATCHET. If each run baselines against its predecessor, a sequence of
 *     individually-legal drops (50 -> 41 -> 34 -> 28 -> 23, each >80% of the last)
 *     walks the floor to nothing and never trips. Against a maximum, the floor
 *     cannot be walked down.
 *  2. BASELINE POISONING. A bootstrap or corrupt run must never become the
 *     trusted reference. It cannot: corruption SHRINKS the basis, and a small
 *     value can never raise a maximum. The guard is monotonic against precisely
 *     the failure mode it fears.
 *
 * The trailing window is what lets a legitimate, permanent shrink stop being
 * flagged once it ages out — without it, de-flagging 13 corps would flag every
 * scan forever.
 */
export async function getBasisBaseline(
	db: DbClient<typeof schema>,
	options?: { now?: Date }
): Promise<BasisBaseline> {
	const now = options?.now ?? new Date()
	const windowStart = new Date(now.getTime() - BASIS_BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000)

	const candidates = await db.query.serviceAccessAuditRuns.findMany({
		where: (runs, { and }) =>
			and(
				inArray(runs.status, [...BASELINE_STATUSES]),
				gte(runs.startedAt, windowStart),
				// A run that was itself flagged suspect is a poor reference: its basis
				// is the one nobody has vouched for. Excluding it costs nothing,
				// because a suspect run's count is by definition BELOW the high-water
				// mark it was compared against, so it could not have won the max anyway.
				sql`${runs.basisSuspect} = false`
			),
		columns: { memberCorpCount: true, memberCorporationIds: true },
	})

	if (candidates.length === 0) {
		return { memberCorpCount: null, corporationIds: [] }
	}

	const best = candidates.reduce((winner, candidate) =>
		candidate.memberCorpCount > winner.memberCorpCount ? candidate : winner
	)

	return { memberCorpCount: best.memberCorpCount, corporationIds: best.memberCorporationIds ?? [] }
}

export interface BasisVerdictOk {
	blocked: false
	/** True when no baseline exists. The UI must surface the corp count
	 * prominently — on this path nothing has validated it. */
	bootstrap: boolean
	/** The basis shrank against the recent high-water mark. INFORMATIONAL for a
	 * scan; enforcement must refuse on it. */
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
				`(${((memberCorpCount / (baselineCount || 1)) * 100).toFixed(1)}% retained) versus the highest basis seen in the last ` +
				`${BASIS_BASELINE_WINDOW_DAYS} days. ${removedCorporationIds.length} corporation(s) left the basis. ` +
				`If you de-flagged them, this is expected and the scan below is correct. If you do not recognise them, ` +
				`managed_corporations may be half-restored or mid-sync and THIS SCAN'S RESULTS ARE NOT TRUSTWORTHY. ` +
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
