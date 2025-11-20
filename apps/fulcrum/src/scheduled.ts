/**
 * Scheduled handler for Fulcrum worker
 * Handles auto-expiration of character reports
 */

import { logger } from '@repo/hono-helpers'
import { createDb } from './db'
import * as queries from './db/queries'
import type { Env } from './context'

/**
 * Auto-expire character reports
 *
 * This handler runs on a scheduled cron trigger (daily at midnight UTC) and:
 * 1. Queries database for reports with expires_at < now
 * 2. Deletes HTML files from R2 storage
 * 3. Updates report status to "expired"
 * 4. Preserves metadata for audit trail
 */
export async function scheduledHandler(
	event: ScheduledEvent,
	env: Env,
	_ctx: ExecutionContext,
): Promise<void> {
	const start = Date.now()
	const scheduledLogger = logger.withTags({ component: 'auto-expiration' })

	scheduledLogger.info('Starting auto-expiration of character reports', {
		scheduledTime: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	})

	try {
		const db = createDb(env.DATABASE_URL)

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
			expiredReports.map((report) => expireReport(env, db, report)),
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
					result.status === 'rejected'
						? { ...expiredReports[index], error: result.reason }
						: null,
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
	} catch (error) {
		scheduledLogger.error('Unexpected error during auto-expiration', {
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		})
		throw error
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
	},
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
