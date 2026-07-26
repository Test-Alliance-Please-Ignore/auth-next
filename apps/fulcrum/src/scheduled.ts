/**
 * Scheduled handler for Fulcrum worker
 * Handles stalled-job reconciliation and auto-expiration of character reports
 */

import { logger, withWorkerLogContext } from '@repo/hono-helpers'

import { createDb } from './db'
import * as queries from './db/queries'

import type { Env } from './context'

const DAILY_EXPIRATION_CRON = '0 0 * * *'
const STALLED_SWEEP_THRESHOLD_MINUTES = 45
const STALLED_SWEEP_BATCH_LIMIT = 200

/**
 * Reconcile stalled reports and auto-expire completed reports.
 *
 * Sweep behavior:
 * - Runs every scheduled invocation (intended cron: every 15 minutes)
 * - Finds in-progress reports older than STALLED_SWEEP_THRESHOLD_MINUTES
 * - Checks Cloudflare Workflow status (if workflowInstanceId exists)
 * - Marks truly-stalled reports as failed to unblock dedupe/new scans
 *
 * Expiration behavior:
 * - Runs on DAILY_EXPIRATION_CRON only
 */
export async function scheduledHandler(
	event: ScheduledEvent,
	env: Env,
	_ctx: ExecutionContext
): Promise<void> {
	await withWorkerLogContext('fulcrum-scheduled', env, async () => {
		const start = Date.now()
		const scheduledLogger = logger.withTags({ component: 'scheduled-maintenance' })

		scheduledLogger.info('Starting scheduled maintenance', {
			scheduledTime: new Date(event.scheduledTime).toISOString(),
			cron: event.cron,
		})

		try {
			const db = createDb(env.DATABASE_URL)
			await reconcileStalledReports(env, db)

			// Keep report expiration as a daily task.
			if (event.cron !== DAILY_EXPIRATION_CRON) {
				scheduledLogger.info('Skipping expiration for this cron invocation', {
					cron: event.cron,
					expectedCron: DAILY_EXPIRATION_CRON,
				})
				return
			}

			await expireReports(env, db, start)
		} catch (error) {
			scheduledLogger.error('Unexpected error during scheduled maintenance', {
				error: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	})
}

async function reconcileStalledReports(env: Env, db: ReturnType<typeof createDb>): Promise<void> {
	const sweepLogger = logger.withTags({ component: 'stalled-sweep' })
	const cutoff = new Date(Date.now() - STALLED_SWEEP_THRESHOLD_MINUTES * 60 * 1000)
	const candidates = await queries.getStaleInProgressReports(db, cutoff, STALLED_SWEEP_BATCH_LIMIT)

	sweepLogger.info('Loaded stale in-progress candidates', {
		count: candidates.length,
		cutoff: cutoff.toISOString(),
	})

	if (candidates.length === 0) return

	for (const report of candidates) {
		const reportLogger = logger.withTags({
			component: 'stalled-sweep',
			reportId: report.id,
			characterId: report.characterId,
		})

		if (!report.workflowInstanceId) {
			await queries.updateReportStatus(db, report.id, 'failed', {
				errorMessage: 'Stalled report recovery: missing workflow instance id',
			})
			reportLogger.warn('Marked stale report failed (missing workflow instance id)')
			continue
		}

		try {
			const workflowInstance = await env.CHARACTER_REPORT_WORKFLOW.get(report.workflowInstanceId)
			const workflowStatus = await workflowInstance.status()

			if (
				workflowStatus.status === 'queued' ||
				workflowStatus.status === 'running' ||
				workflowStatus.status === 'waiting' ||
				workflowStatus.status === 'waitingForPause' ||
				workflowStatus.status === 'paused'
			) {
				reportLogger.info('Workflow still active; leaving report in progress', {
					workflowStatus: workflowStatus.status,
				})
				continue
			}

			const reason =
				workflowStatus.error ??
				`Stalled report recovery: workflow status is ${workflowStatus.status}`
			const errorMessage = typeof reason === 'string' ? reason : `${reason.name}: ${reason.message}`

			await queries.updateReportStatus(db, report.id, 'failed', {
				errorMessage: errorMessage.slice(0, 500),
			})
			reportLogger.warn('Marked stale report failed after workflow status check', {
				workflowStatus: workflowStatus.status,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			await queries.updateReportStatus(db, report.id, 'failed', {
				errorMessage: `Stalled report recovery: workflow lookup failed - ${errorMessage}`.slice(
					0,
					500
				),
			})
			reportLogger.warn('Marked stale report failed after workflow lookup error', {
				error: errorMessage,
			})
		}
	}
}

async function expireReports(
	env: Env,
	db: ReturnType<typeof createDb>,
	start: number
): Promise<void> {
	const scheduledLogger = logger.withTags({ component: 'auto-expiration' })

	// Find all expired reports
	const expiredReports = await queries.getExpiredReports(db)

	scheduledLogger.info('Found expired reports', {
		count: expiredReports.length,
	})

	if (expiredReports.length === 0) {
		scheduledLogger.info('No expired reports to process, exiting')
		return
	}

	// Process each expired report
	const results = await Promise.allSettled(
		expiredReports.map((report) => expireReport(env, db, report))
	)

	// Count successes and failures
	const succeeded = results.filter((r) => r.status === 'fulfilled').length
	const failed = results.filter((r) => r.status === 'rejected').length

	const duration = Date.now() - start

	scheduledLogger.info('Auto-expiration completed', {
		totalReports: expiredReports.length,
		succeeded,
		failed,
		durationMs: duration,
	})

	// Log failed reports for debugging
	if (failed > 0) {
		const failedReports = results
			.map((result, index) =>
				result.status === 'rejected' ? { ...expiredReports[index], error: result.reason } : null
			)
			.filter((r) => r !== null)

		scheduledLogger.error('Some reports failed to expire', {
			failed,
			errors: failedReports.map((r) => ({
				reportId: r.id,
				characterId: r.characterId,
				error: r.error instanceof Error ? r.error.message : String(r.error),
			})),
		})
	}
}

/**
 * Expire a single report
 * Deletes R2 object and updates database status
 */
async function expireReport(
	env: Env,
	db: ReturnType<typeof createDb>,
	report: {
		id: string
		characterId: string
		r2Bucket: string | null
		r2Key: string | null
	}
): Promise<void> {
	const expireLogger = logger.withTags({
		component: 'auto-expiration',
		reportId: report.id,
	})

	try {
		expireLogger.info('Expiring report', {
			characterId: report.characterId,
		})

		// Delete R2 object if it exists
		if (report.r2Key) {
			try {
				await env.CHARACTER_REPORTS.delete(report.r2Key)
				expireLogger.info('Deleted R2 object', {
					r2Key: report.r2Key,
				})
			} catch (error) {
				// Log but don't fail - R2 object might already be deleted
				expireLogger.warn('Failed to delete R2 object', {
					r2Key: report.r2Key,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		// Update database status to expired
		await queries.updateReportStatus(db, report.id, 'expired')

		expireLogger.info('Report expired successfully', {
			characterId: report.characterId,
		})
	} catch (error) {
		expireLogger.error('Failed to expire report', {
			characterId: report.characterId,
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		})
		throw error
	}
}
