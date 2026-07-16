import { Hono } from 'hono'
import { z } from 'zod'

import { and, asc, desc, eq, isNull, sql } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'
import { createWorkflow } from '@repo/workflow-utils'

import { serviceAccessAuditRows, serviceAccessAuditRuns } from '../db/schema'
import { isMumbleFeatureEnabledStrict } from '../lib/mumble-feature'
import { requireAdmin, requireAuth } from '../middleware/session'

import type { App } from '../context'
import type { ServiceEligibilityReason } from '../lib/service-eligibility'

/**
 * SERVICE ACCESS AUDIT — READ-ONLY API.
 *
 * Every route here reads. There is deliberately NO enforce route, no
 * confirm route and no cancel-enforce route, because enforcement is not built:
 * the point of shipping the scan alone is to learn the real ineligible count
 * before anyone commits to revoking accounts on an estimate. A route that
 * exists is a route that gets called at 04:00.
 *
 * `POST /runs` and `POST /runs/:id/cancel` mutate only this app's own audit
 * tables. Neither issues a single Mumble or Discord RPC.
 */
const app = new Hono<App>()

/** Non-terminal statuses: a run in one of these still holds the active lock. */
const LIVE_STATUSES = ['scanning', 'enforcing'] as const

/**
 * Statuses whose scan actually completed, and are therefore the only ones whose
 * basis is meaningful enough to confirm. Mirrors BASELINE_STATUSES in
 * lib/service-eligibility-basis.ts — a run that cannot inform the baseline must
 * not be acknowledgeable either, or acking it would be a no-op that looks like an
 * action.
 */
const BASELINE_STATUSES = ['completed', 'awaiting_confirmation', 'completed_with_errors'] as const

const ALL_REASONS: ServiceEligibilityReason[] = [
	'member_corp',
	'admin_exempt',
	'no_characters',
	'null_corp',
	'only_deleted_member_char',
	'unmanaged_corp',
	'no_user_row',
]

/** Required so the confirmation is a judgement someone signed, not a click. */
const acknowledgeBasisSchema = z.object({
	reason: z.string().min(10),
})

/** House style: local z.object + safeParse in the handler. There is ZERO
 * zValidator in apps/core/src — do not introduce it here. */
const rowsQuerySchema = z.object({
	reason: z.enum(ALL_REASONS as [ServiceEligibilityReason, ...ServiceEligibilityReason[]]).optional(),
	eligible: z.enum(['true', 'false']).optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

/**
 * Duck-typed unique-violation check. There is no shared helper for this in the
 * repo (the only precedent is a private method on
 * apps/broadcasts/src/durable-object.ts:521).
 *
 * Checks `.cause` as well as the top level: the Neon serverless driver has been
 * observed surfacing the real Postgres error on `error.cause` rather than on the
 * error itself. Duck-typed on the code — never string-matched on the message.
 */
function isUniqueViolation(error: unknown): boolean {
	const hasCode = (value: unknown): boolean =>
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { code?: unknown }).code === 'string' &&
		(value as { code: string }).code === '23505'

	if (hasCode(error)) return true
	if (typeof error === 'object' && error !== null) {
		return hasCode((error as { cause?: unknown }).cause)
	}
	return false
}

/**
 * POST /services-audit/runs
 * Start a READ-ONLY eligibility scan.
 */
app.post('/runs', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	if (!user) return c.json({ error: 'Unauthorized' }, 401)

	// Mint the id BEFORE the insert so the row and the workflow instance share it,
	// which is what makes scanWorkflowInstanceId's unique constraint meaningful.
	const workflowId = `service-access-audit-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36)}`

	let run: { id: string; status: string } | undefined
	try {
		// ONLY the insert is inside this try. A broad try/catch around the whole
		// handler would report an unrelated 23505 as "a run is already live" — a
		// lie told to an operator during an emergency.
		;[run] = await db
			.insert(serviceAccessAuditRuns)
			.values({
				scanWorkflowInstanceId: workflowId,
				initiatedByUserId: user.id,
				status: 'scanning',
				// UNIQUE, NULL when terminal => exactly one live run. A concurrent
				// insert 23505s rather than racing a check-then-insert.
				activeLock: 'live',
			})
			.returning({
				id: serviceAccessAuditRuns.id,
				status: serviceAccessAuditRuns.status,
			})
	} catch (error) {
		if (isUniqueViolation(error)) {
			return c.json(
				{ error: 'A service access audit run is already in progress' },
				409
			)
		}
		logger.error('[ServicesAudit] Failed to create audit run', { error: String(error) })
		return c.json({ error: 'Failed to start audit run' }, 500)
	}

	if (!run) {
		logger.error('[ServicesAudit] Insert returned no run row')
		return c.json({ error: 'Failed to start audit run' }, 500)
	}

	try {
		await createWorkflow(c.env.SERVICE_ACCESS_AUDIT_WORKFLOW, {
			id: workflowId,
			params: { runId: run.id, initiatedByUserId: user.id, phase: 'scan' as const },
		})
	} catch (error) {
		// The row already holds the lock. If the workflow never starts, nothing will
		// ever NULL that lock, and every subsequent POST /runs 409s forever with no
		// way to recover from the UI. Release it here.
		await db
			.update(serviceAccessAuditRuns)
			.set({
				status: 'failed',
				activeLock: null,
				errorMessage: 'The scan workflow failed to start; no scan was performed.',
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(serviceAccessAuditRuns.id, run.id))

		logger.error('[ServicesAudit] Failed to start scan workflow', {
			runId: run.id,
			error: String(error),
		})
		return c.json({ error: 'Failed to start audit workflow' }, 500)
	}

	// 201 is a deliberate departure from the discord-servers precedent (which
	// returns a bare 200) — this creates a resource.
	return c.json({ runId: run.id, workflowInstanceId: workflowId, status: run.status }, 201)
})

/**
 * GET /services-audit/runs
 * List recent runs, newest first.
 */
app.get('/runs', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	try {
		const runs = await db.query.serviceAccessAuditRuns.findMany({
			orderBy: desc(serviceAccessAuditRuns.startedAt),
			limit: 25,
			columns: {
				id: true,
				status: true,
				memberCorpCount: true,
				scanned: true,
				inPopulation: true,
				eligibleCount: true,
				ineligibleCount: true,
				blastRadiusTripped: true,
				// A suspect basis means this run's numbers may be untrustworthy. It
				// must reach the list, not just the detail view — an operator scanning
				// a list of runs has to see which ones not to believe.
				basisSuspect: true,
				// So the picker can distinguish "suspect" from "suspect but confirmed".
				basisAcknowledgedAt: true,
				errorMessage: true,
				startedAt: true,
				completedAt: true,
			},
		})

		return c.json({ items: runs })
	} catch (error) {
		logger.error('[ServicesAudit] Failed to list audit runs', { error: String(error) })
		return c.json({ error: 'Failed to list audit runs' }, 500)
	}
})

/**
 * GET /services-audit/runs/:id
 * Run status, the reason breakdown, and a small sample of affected names.
 */
app.get('/runs/:id', requireAuth(), requireAdmin(), async (c) => {
	const runId = c.req.param('id')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	try {
		const run = await db.query.serviceAccessAuditRuns.findFirst({
			where: eq(serviceAccessAuditRuns.id, runId),
		})
		if (!run) return c.json({ error: 'Audit run not found' }, 404)

		// Breakdown BY SUBCODE, aggregated in SQL. One "ineligible" number is
		// unreviewable; "3,900 null_corp" is a recognisably broken ESI sync.
		const breakdown = await db
			.select({
				reason: serviceAccessAuditRows.reason,
				eligible: serviceAccessAuditRows.eligible,
				count: sql<number>`count(*)::int`,
			})
			.from(serviceAccessAuditRows)
			.where(eq(serviceAccessAuditRows.runId, runId))
			.groupBy(serviceAccessAuditRows.reason, serviceAccessAuditRows.eligible)

		// Names, not counts: someone must be able to recognise a person who
		// obviously should not be on this list.
		const sample = await db.query.serviceAccessAuditRows.findMany({
			where: and(
				eq(serviceAccessAuditRows.runId, runId),
				eq(serviceAccessAuditRows.eligible, false)
			),
			limit: 10,
			columns: {
				userId: true,
				mainCharacterId: true,
				mainCharacterName: true,
				reason: true,
				hasDiscordLink: true,
			},
		})

		// Resolved live rather than snapshotted at scan time: the flag's state NOW
		// is what predicts whether enforcement would no-op, and a scan-time value
		// would already be stale by the time an operator reads this.
		const mumbleFeature = await isMumbleFeatureEnabledStrict(c.env)

		return c.json({
			...run,
			reasonBreakdown: breakdown,
			sample,
			mumbleFeature,
			/**
			 * HONEST DENOMINATOR. `inPopulation` counts Discord-linked users ONLY.
			 * Mumble provisioning state lives exclusively in the Mumble Durable
			 * Object, and determining it would require a service RPC — which this
			 * read-only increment forbids. (`core_user_services` looks like it would
			 * answer this, but it is dead: nothing in the codebase ever writes it.)
			 * So a user with a Mumble account and no Discord link is NOT counted here.
			 * The UI must say so rather than imply the denominator is complete.
			 */
			mumblePopulationKnown: false,
			inPopulationBasis: 'discord_link_only' as const,
		})
	} catch (error) {
		logger.error('[ServicesAudit] Failed to read audit run', { runId, error: String(error) })
		return c.json({ error: 'Failed to read audit run' }, 500)
	}
})

/**
 * GET /services-audit/runs/:id/rows
 * Paginated rows. Filtering and pagination happen IN SQL — the existing discord
 * audit's row read does per-user DO calls and slices in JS, which is fatal under
 * a 5s poll.
 */
app.get('/runs/:id/rows', requireAuth(), requireAdmin(), async (c) => {
	const runId = c.req.param('id')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	const parsed = rowsQuerySchema.safeParse({
		reason: c.req.query('reason'),
		eligible: c.req.query('eligible'),
		page: c.req.query('page') ?? undefined,
		pageSize: c.req.query('pageSize') ?? undefined,
	})
	if (!parsed.success) {
		return c.json({ error: 'Invalid query', details: parsed.error.flatten() }, 400)
	}
	const { reason, eligible, page, pageSize } = parsed.data

	try {
		const conditions = [eq(serviceAccessAuditRows.runId, runId)]
		if (reason) conditions.push(eq(serviceAccessAuditRows.reason, reason))
		if (eligible) conditions.push(eq(serviceAccessAuditRows.eligible, eligible === 'true'))
		const where = and(...conditions)

		const [totalRow] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(serviceAccessAuditRows)
			.where(where)
		const totalCount = totalRow?.count ?? 0

		const rows = await db.query.serviceAccessAuditRows.findMany({
			where,
			// Order by userId, NOT createdAt. Rows are written one INSERT per scan
			// page, so `now()` is the transaction timestamp and all 500 rows of a
			// batch share a byte-identical createdAt. Postgres may return a tie group
			// in any order per query, so OFFSET paging over it silently duplicates
			// some people and omits others — in a review UI whose entire job is
			// showing an operator who is about to lose their account. userId is
			// unique per run and covered by service_access_audit_rows_run_user_unique.
			orderBy: asc(serviceAccessAuditRows.userId),
			limit: pageSize,
			offset: (page - 1) * pageSize,
			columns: {
				id: true,
				userId: true,
				mainCharacterId: true,
				mainCharacterName: true,
				eligible: true,
				reason: true,
				corporationIds: true,
				hasDiscordLink: true,
			},
		})

		return c.json({
			rows,
			pagination: {
				page,
				pageSize,
				totalCount,
				totalPages: Math.max(Math.ceil(totalCount / pageSize), 1),
			},
		})
	} catch (error) {
		logger.error('[ServicesAudit] Failed to read audit rows', { runId, error: String(error) })
		return c.json({ error: 'Failed to read audit rows' }, 500)
	}
})

/**
 * POST /services-audit/runs/:id/acknowledge-basis
 *
 * A human vouches for this run's member-corporation basis: "these corporations
 * really did leave, and this basis is correct."
 *
 * THIS IS THE ONLY THING THAT CAN LOWER THE BAR, and it is the piece the guard is
 * built around. A count cannot distinguish "an operator de-flagged 13 corps" from
 * "the table is half-restored" — only a human reading WHICH corps left can.
 * Acknowledging records that judgement, and the acknowledged run becomes the
 * baseline anchor: later runs are compared against the highest basis seen since
 * it, not against history before it.
 *
 * It also clears an upward-poisoned baseline. A bad migration that flags corps
 * true inflates the basis (200 -> 600); that run is not suspect, so it enters the
 * max, and every later CORRECT run flags against it. Confirming a correct run
 * resets the floor. Without this there would be no way out.
 *
 * Deliberately requires a reason. "13 corps left" is only safe if someone can say
 * which and why it was expected — and the note is what a future operator reads
 * when deciding whether to trust this run.
 */
app.post('/runs/:id/acknowledge-basis', requireAuth(), requireAdmin(), async (c) => {
	const runId = c.req.param('id')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)

	const parsed = acknowledgeBasisSchema.safeParse(await c.req.json().catch(() => ({})))
	if (!parsed.success) {
		return c.json({ error: 'A reason of at least 10 characters is required' }, 400)
	}

	try {
		// Conditional UPDATE, not read-then-write: two admins confirming at once
		// resolve in Postgres, and a blocked run can never be confirmed (its basis
		// is empty by definition — there is nothing to vouch for).
		const acknowledged = await db
			.update(serviceAccessAuditRuns)
			.set({
				basisAcknowledgedAt: new Date(),
				basisAcknowledgedByUserId: user.id,
				basisAcknowledgedReason: parsed.data.reason,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(serviceAccessAuditRuns.id, runId),
					isNull(serviceAccessAuditRuns.basisAcknowledgedAt),
					sql`${serviceAccessAuditRuns.status} IN (${sql.join(
						BASELINE_STATUSES.map((status) => sql`${status}`),
						sql`, `
					)})`
				)
			)
			.returning({
				id: serviceAccessAuditRuns.id,
				memberCorpCount: serviceAccessAuditRuns.memberCorpCount,
			})

		if (acknowledged.length === 0) {
			return c.json(
				{
					error:
						'No un-acknowledged audit run with that id and a completed scan. A blocked or failed run cannot have its basis confirmed.',
				},
				404
			)
		}

		logger.info('[ServicesAudit] Basis acknowledged', {
			runId,
			userId: user.id,
			memberCorpCount: acknowledged[0].memberCorpCount,
		})

		return c.json({
			runId,
			basisAcknowledgedAt: new Date().toISOString(),
			memberCorpCount: acknowledged[0].memberCorpCount,
		})
	} catch (error) {
		logger.error('[ServicesAudit] Failed to acknowledge basis', { runId, error: String(error) })
		return c.json({ error: 'Failed to acknowledge basis' }, 500)
	}
})

/**
 * POST /services-audit/runs/:id/cancel
 * Cancel a live SCAN and release the lock.
 *
 * Cancelling a scan is safe precisely because the scan is read-only — there is
 * nothing half-done to unwind. This is NOT a cancel-enforce, which would be a
 * different and much harder problem.
 *
 * KNOWN LIMITATION: this marks the RUN cancelled and releases the lock, but does
 * not terminate the workflow instance. An in-flight scan keeps paging and its
 * finalize step will overwrite status='cancelled' with its own terminal status.
 * Harmless today — the scan only reads and its finalize also NULLs the lock — but
 * it means "cancelled" is not yet a guarantee that the scan stopped. Before
 * enforcement exists, this must gain a real terminate (or a status re-check
 * inside the workflow), because cancelling an ENFORCE run has to actually stop it.
 */
app.post('/runs/:id/cancel', requireAuth(), requireAdmin(), async (c) => {
	const runId = c.req.param('id')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	try {
		// Conditional on a live status, so this cannot resurrect-then-null the lock
		// of an already-terminal run.
		const cancelled = await db
			.update(serviceAccessAuditRuns)
			.set({
				status: 'cancelled',
				activeLock: null,
				errorMessage: 'Cancelled by an administrator.',
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(serviceAccessAuditRuns.id, runId),
					sql`${serviceAccessAuditRuns.status} IN (${sql.join(
						LIVE_STATUSES.map((status) => sql`${status}`),
						sql`, `
					)})`
				)
			)
			.returning({ id: serviceAccessAuditRuns.id })

		if (cancelled.length === 0) {
			return c.json({ error: 'No live audit run with that id' }, 404)
		}

		return c.json({ runId, status: 'cancelled' })
	} catch (error) {
		logger.error('[ServicesAudit] Failed to cancel audit run', { runId, error: String(error) })
		return c.json({ error: 'Failed to cancel audit run' }, 500)
	}
})

export default app
