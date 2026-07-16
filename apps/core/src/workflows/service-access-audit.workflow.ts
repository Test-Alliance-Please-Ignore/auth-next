import { WorkflowEntrypoint } from 'cloudflare:workers'

import { eq, sql } from '@repo/db-utils'
import { captureException, logger } from '@repo/hono-helpers'
import { defaultStepConfig, strictStepConfig } from '@repo/workflow-utils'

import { createDb } from '../db'
import { serviceAccessAuditRows, serviceAccessAuditRuns } from '../db/schema'
import { isMumbleFeatureEnabledStrict } from '../lib/mumble-feature'
import {
	evaluateBasis,
	evaluateBlastRadius,
	getBasisBaseline,
} from '../lib/service-eligibility-basis'
import { getMemberCorporationBasis, scanUserEligibilityPage } from '../lib/service-eligibility'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { DbClient, schema } from '../db'
import type { Env } from '../context'

/**
 * SERVICE ACCESS AUDIT — SCAN PHASE. 100% READ-ONLY.
 *
 * This workflow issues ZERO service RPCs. It never touches the Mumble DO and
 * never touches Discord. It reads Postgres and writes Postgres rows describing
 * what enforcement *would* do. That is the entire point of shipping the scan
 * before the enforcement: the real ineligible count has never been measured, and
 * nobody should commit to revoking accounts on an estimate.
 *
 * The tests pin this by mocking `@repo/do-utils` and `@repo/discord` and
 * asserting neither stub factory is ever called.
 */
export interface ServiceAccessAuditWorkflowParams {
	runId: string
	initiatedByUserId: string | null
	/** Only 'scan' exists today. Present so the enforcement phase can be added as
	 * a discriminated branch rather than as a second workflow that duplicates the
	 * basis assertions — a second copy of the breaker is a second thing to get
	 * wrong. */
	phase?: 'scan'
}

/** Keyset page size. One SQL statement per page (see scanUserEligibilityPage). */
const SCAN_PAGE_SIZE = 500

/**
 * Guards against an unbounded loop if the keyset cursor ever fails to advance.
 * 500 pages x 500 = 250k users, comfortably above the real population.
 */
const MAX_SCAN_PAGES = 500

type AuditRowInsert = typeof serviceAccessAuditRows.$inferInsert

interface UserEnrichment {
	mainCharacterId: string | null
	mainCharacterName: string | null
	corporationIds: string[]
}

/**
 * Set-based enrichment for one page of users: main character identity + every
 * corporation held at scan time.
 *
 * SET-BASED, one statement per page — NOT a per-user lookup. A per-user lookup
 * here would reintroduce exactly the subrequest blowup that
 * `scanUserEligibilityPage` exists to avoid.
 *
 * Names, not just counts: an operator reviewing 400 pending revocations needs to
 * recognise people. "400 ineligible" is unreviewable; a list of names is
 * reviewable, and someone spotting a name that obviously should not be there is
 * the last line of defence before enforcement.
 *
 * NOTE `uc.deleted` — the Drizzle property is `isDeleted` but the COLUMN is
 * `deleted` (db/schema.ts:178). Hand-written SQL must use the column name.
 */
async function fetchUserEnrichment(
	db: DbClient<typeof schema>,
	userIds: string[]
): Promise<Map<string, UserEnrichment>> {
	if (userIds.length === 0) return new Map()

	const idList = sql.join(
		userIds.map((id) => sql`${id}::uuid`),
		sql`, `
	)

	const result = await db.execute<{
		id: string
		main_character_id: string | null
		main_character_name: string | null
		corporation_ids: string[] | null
	}>(sql`
		SELECT
			u.id,
			u.main_character_id,
			(
				SELECT uc.character_name
				FROM user_characters uc
				WHERE uc.user_id = u.id AND uc.character_id = u.main_character_id
				LIMIT 1
			) AS main_character_name,
			COALESCE(
				array_agg(DISTINCT uc2.corporation_id)
					FILTER (WHERE uc2.corporation_id IS NOT NULL AND uc2.deleted = false),
				'{}'
			) AS corporation_ids
		FROM users u
		LEFT JOIN user_characters uc2 ON uc2.user_id = u.id
		WHERE u.id IN (${idList})
		GROUP BY u.id, u.main_character_id
	`)

	return new Map(
		result.rows.map((row) => [
			row.id,
			{
				mainCharacterId: row.main_character_id,
				mainCharacterName: row.main_character_name,
				corporationIds: row.corporation_ids ?? [],
			},
		])
	)
}

export class ServiceAccessAuditWorkflow extends WorkflowEntrypoint<
	Env,
	ServiceAccessAuditWorkflowParams
> {
	async run(
		event: WorkflowEvent<ServiceAccessAuditWorkflowParams>,
		step: WorkflowStep
	): Promise<void> {
		const { runId } = event.payload
		const db = createDb(this.env.DATABASE_URL)

		try {
			// ── 1. PREFLIGHT: THE BASIS GUARD ──
			// strictStepConfig (1 retry), NOT defaultStepConfig: an empty
			// managed_corporations is not a transient fault. Retrying it three times
			// with exponential backoff only delays an abort that is already certain.
			//
			// Only an EMPTY basis blocks. A shrunken basis is recorded as suspect and
			// the scan proceeds: a scan is read-only, and de-flagging corps is both
			// the legitimate way a corp leaves AND a guaranteed way to shrink the
			// basis, so blocking on shrink would refuse the primary use case. See
			// lib/service-eligibility-basis.ts.
			const basis = await step.do('preflight-basis', strictStepConfig, async () => {
				const { corporationIds, count: memberCorpCount } = await getMemberCorporationBasis(db)
				const baseline = await getBasisBaseline(db)

				const verdict = evaluateBasis({ corporationIds, memberCorpCount, baseline })

				if (verdict.blocked) {
					// A blocked run is a correct TERMINAL OUTCOME, not an exception.
					// Throwing here would trip the catch, which would overwrite
					// status='blocked' with status='failed' and destroy the
					// operator-actionable errorMessage — the one thing that tells them
					// what to fix. So: write the terminal state, then return.
					logger.warn('[ServicesAudit] Basis assertion tripped; aborting scan', {
						runId,
						memberCorpCount: verdict.memberCorpCount,
						comparedToMemberCorpCount: verdict.comparedToMemberCorpCount,
					})
					await db
						.update(serviceAccessAuditRuns)
						.set({
							status: 'blocked',
							// Terminal => release the one-live-run lock.
							activeLock: null,
							memberCorporationIds: verdict.corporationIds,
							memberCorpCount: verdict.memberCorpCount,
							errorMessage: verdict.errorMessage,
							completedAt: new Date(),
							updatedAt: new Date(),
						})
						.where(eq(serviceAccessAuditRuns.id, runId))

					return { blocked: true as const }
				}

				if (verdict.basisSuspect) {
					// Not fatal, but the operator must not read this run's numbers
					// without seeing which corporations left.
					logger.warn('[ServicesAudit] Basis shrank versus the recent high-water mark', {
						runId,
						memberCorpCount: verdict.memberCorpCount,
						comparedToMemberCorpCount: verdict.comparedToMemberCorpCount,
						removedCorporationCount: verdict.removedCorporationIds.length,
					})
				}

				// Snapshot the basis onto the run BEFORE scanning, so a run that dies
				// mid-scan still records the basis it was about to act on.
				await db
					.update(serviceAccessAuditRuns)
					.set({
						memberCorporationIds: verdict.corporationIds,
						memberCorpCount: verdict.memberCorpCount,
						basisSuspect: verdict.basisSuspect,
						basisComparedToCount: verdict.comparedToMemberCorpCount,
						basisRemovedCorporationIds: verdict.removedCorporationIds,
						basisNote: verdict.basisNote,
						updatedAt: new Date(),
					})
					.where(eq(serviceAccessAuditRuns.id, runId))

				return {
					blocked: false as const,
					memberCorpCount: verdict.memberCorpCount,
					bootstrap: verdict.bootstrap,
					basisSuspect: verdict.basisSuspect,
				}
			})

			if (basis.blocked) {
				// No rows written. Do not scan. Do not pass go.
				return
			}

			if (basis.bootstrap) {
				logger.warn('[ServicesAudit] No prior good run; basis is unvalidated', {
					runId,
					memberCorpCount: basis.memberCorpCount,
				})
			}

			// ── 2. REPORT (never gate) the Mumble feature state ──
			// Read-only: this predicts that enforcement would silently no-op. It must
			// not stop the scan — a scan that refuses to run tells the operator
			// nothing, whereas a scan that runs and reports "flag off" tells them
			// their eventual enforcement would do nothing.
			const mumbleFeature = await step.do('report-mumble-feature-state', strictStepConfig, () =>
				isMumbleFeatureEnabledStrict(this.env)
			)
			if (!mumbleFeature.enabled) {
				logger.warn('[ServicesAudit] Mumble feature is not enabled', {
					runId,
					state: mumbleFeature.state,
					detail: mumbleFeature.message,
				})
			}

			// ── 3. PAGED SCAN ──
			// Each page's READ and its INSERTS happen inside ONE step.do, so a
			// transient Neon error retries just that page instead of unwinding the
			// whole run. (The discord-member-audit precedent does its inserts outside
			// step.do; that is exactly the bug this avoids.)
			let afterUserId: string | undefined
			let page = 0

			while (page < MAX_SCAN_PAGES) {
				page++
				// Step names must be deterministic across replays: driven by a counter,
				// never by a timestamp or a user id.
				const lastUserId: string | null = await step.do(
					`scan-page-${page}`,
					defaultStepConfig,
					async () => {
						const scanRows = await scanUserEligibilityPage(db, {
							afterUserId,
							limit: SCAN_PAGE_SIZE,
						})
						if (scanRows.length === 0) return null

						const enrichment = await fetchUserEnrichment(
							db,
							scanRows.map((row) => row.userId)
						)

						const inserts: AuditRowInsert[] = scanRows.map((row) => {
							const extra = enrichment.get(row.userId)
							return {
								runId,
								userId: row.userId,
								mainCharacterId: extra?.mainCharacterId ?? null,
								mainCharacterName: extra?.mainCharacterName ?? null,
								eligible: row.eligible,
								reason: row.reason,
								corporationIds: extra?.corporationIds ?? [],
								hasDiscordLink: row.hasDiscordLink,
							}
						})

						// Idempotent on unique(runId, userId): a step retry re-inserts the
						// same page and is a no-op rather than a duplicate-key failure.
						await db.insert(serviceAccessAuditRows).values(inserts).onConflictDoNothing()

						return scanRows[scanRows.length - 1]?.userId ?? null
					}
				)

				if (lastUserId === null) break
				afterUserId = lastUserId
			}

			if (page >= MAX_SCAN_PAGES) {
				logger.error('[ServicesAudit] Scan hit the page ceiling; results may be truncated', {
					runId,
					maxScanPages: MAX_SCAN_PAGES,
				})
			}

			// ── 4. FINALIZE ──
			// Counters come from a SQL AGGREGATE over the rows that were actually
			// written. NEVER from an accumulator in the workflow body: with inserts
			// inside step.do, a step retry re-runs the closure and an accumulator
			// would double-count. The rows are the single source of truth.
			await step.do('finalize', defaultStepConfig, async () => {
				const aggregate = await db.execute<{
					scanned: number
					eligible_count: number
					ineligible_count: number
					in_population: number
				}>(sql`
					SELECT
						count(*)::int AS scanned,
						count(*) FILTER (WHERE eligible)::int AS eligible_count,
						count(*) FILTER (WHERE NOT eligible)::int AS ineligible_count,
						count(*) FILTER (WHERE has_discord_link)::int AS in_population
					FROM service_access_audit_rows
					WHERE run_id = ${runId}::uuid
				`)

				const row = aggregate.rows[0]
				const scanned = row?.scanned ?? 0
				const eligibleCount = row?.eligible_count ?? 0
				const ineligibleCount = row?.ineligible_count ?? 0
				const inPopulation = row?.in_population ?? 0

				const blastRadiusTripped = evaluateBlastRadius({ scanned, ineligibleCount })

				await db
					.update(serviceAccessAuditRuns)
					.set({
						// Ineligible users found => a human must look. Zero => nothing to
						// confirm, so the run is simply done.
						status: ineligibleCount > 0 ? 'awaiting_confirmation' : 'completed',
						// Terminal => release the one-live-run lock.
						activeLock: null,
						scanned,
						inPopulation,
						eligibleCount,
						ineligibleCount,
						blastRadiusTripped,
						completedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(serviceAccessAuditRuns.id, runId))

				logger.info('[ServicesAudit] Scan complete', {
					runId,
					scanned,
					eligibleCount,
					ineligibleCount,
					blastRadiusTripped,
				})
			})
		} catch (error) {
			captureException(error as Error, {
				tags: { workflow: 'ServiceAccessAuditWorkflow', runId },
			})
			// logger.error alongside captureException: this workflow class is exported
			// outside the withSentry wrapper (index.ts), so Sentry delivery from here
			// is unverified. The log line is the thing known to reach somewhere.
			logger.error('[ServicesAudit] Scan failed', { runId, error: String(error) })

			await step.do('mark-failed', strictStepConfig, async () => {
				await db
					.update(serviceAccessAuditRuns)
					.set({
						status: 'failed',
						// Terminal => release the one-live-run lock. MISSING THIS BRICKS THE
						// TOOL: the lock's unique index would 409 every subsequent POST /runs
						// forever, with no way to clear it from the UI.
						activeLock: null,
						errorMessage: error instanceof Error ? error.message : String(error),
						completedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(serviceAccessAuditRuns.id, runId))
			})

			// RE-THROW. Returning here (as the discord-member-audit precedent does)
			// makes the Workflows engine record the instance as SUCCESSFUL: the
			// dashboard goes green, errorRetention never applies, and the per-step
			// failure attribution is destroyed.
			throw error
		}
	}
}
