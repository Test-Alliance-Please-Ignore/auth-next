import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { CorporationTax } from '@repo/corporation-tax'
import type { Env } from './context'

const SYSTEM_SCHEDULER_ACTOR = 'system:corporation-tax:scheduler'
const EXPORT_SCHEDULE_BATCH_LIMIT = 25
const ALERT_RETRY_BATCH_LIMIT = 100

async function publishScheduledFailureAlert(
	taxStub: CorporationTax,
	cron: string,
	runAt: Date,
	error: unknown
): Promise<void> {
	const errorMessage = error instanceof Error ? error.message : String(error)

	try {
		await taxStub.triggerAlert(SYSTEM_SCHEDULER_ACTOR, {
			corporationId: null,
			alertType: 'scheduled_operations_failed',
			severity: 'critical',
			dedupeKey: `scheduled-operations-failed:${cron || 'unknown'}`,
			payload: {
				cron,
				scheduledTime: runAt.toISOString(),
				operation: 'runScheduledOperations',
				error: errorMessage,
			},
		})
	} catch (alertError) {
		logger.error('[CorporationTax] Failed to emit scheduled operation failure alert', {
			cron,
			scheduledTime: runAt.toISOString(),
			error: alertError instanceof Error ? alertError.message : String(alertError),
		})
	}
}

export async function scheduledHandler(
	event: ScheduledEvent,
	env: Env,
	_ctx: ExecutionContext
): Promise<void> {
	const startedAt = Date.now()
	const runAt = new Date(event.scheduledTime)
	const taxStub = getStub<CorporationTax>(env.CORPORATION_TAX, 'default')

	logger.info('[CorporationTax] Scheduled operations starting', {
		cron: event.cron,
		scheduledTime: runAt.toISOString(),
	})

	try {
		const result = await taxStub.runScheduledOperations(
			SYSTEM_SCHEDULER_ACTOR,
			runAt,
			EXPORT_SCHEDULE_BATCH_LIMIT,
			ALERT_RETRY_BATCH_LIMIT
		)

		logger.info('[CorporationTax] Scheduled operations completed', {
			cron: event.cron,
			asOf: result.asOf.toISOString(),
			includedCorporationCount: result.includedCorporationCount,
			dailyIngestCorporationsProcessed: result.dailyIngestCorporationsProcessed,
			dailyIngestFailures: result.dailyIngestFailures,
			monthlyAssessmentCorporationsProcessed: result.monthlyAssessmentCorporationsProcessed,
			monthlyAssessmentFailures: result.monthlyAssessmentFailures,
			ledgerRetentionCorporationsProcessed: result.ledgerRetentionCorporationsProcessed,
			ledgerRetentionFailures: result.ledgerRetentionFailures,
			ledgerRetentionEntriesDeleted: result.ledgerRetentionEntriesDeleted,
			dueExportSchedulesProcessed: result.dueExportSchedulesProcessed,
			failedAlertDeliveriesRetried: result.failedAlertDeliveriesRetried,
			durationMs: Date.now() - startedAt,
		})
	} catch (error) {
		logger.error('[CorporationTax] Scheduled operations failed', {
			cron: event.cron,
			scheduledTime: runAt.toISOString(),
			durationMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		})
		await publishScheduledFailureAlert(taxStub, event.cron, runAt, error)
	}
}
