import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { billNotificationEvents, bills, billSchedules } from './db/schema'

import type { Env } from './context'
import type { Bills } from '@repo/bills'

/**
 * Refreshes bill payment status by scheduling workflows for all open bills
 *
 * Features:
 * - Queries all bills with status 'issued' and no paidAt timestamp
 * - Creates workflow instances in batches using createBatch (up to 100 per batch)
 * - Handles errors gracefully (continues with other batches on failure)
 * - Logs statistics about created/failed workflows
 *
 * Uses Cloudflare Workflows createBatch API for efficient bulk creation.
 * createBatch is limited to 100 instances per call or 1MiB RPC limit.
 */
async function refreshBillPayments(env: Env, options: { scheduledTimeMs: number }): Promise<void> {
	const startTime = Date.now()
	const refreshLogger = logger.withTags({ component: 'bills-payment-refresh' })
	const recheckBefore = new Date(options.scheduledTimeMs - 25 * 60 * 1000)

	refreshLogger.info('[Bills] Starting bill payment status refresh batch')

	try {
		const db = createDb(env.DATABASE_URL)

		const openBills = await db.query.bills.findMany({
			where: and(
				inArray(bills.status, ['issued', 'overdue']),
				isNull(bills.paidAt),
				or(isNull(bills.paymentLastCheckedAt), lte(bills.paymentLastCheckedAt, recheckBefore))
			),
		})
		const selectedStatusCounts = openBills.reduce<Record<string, number>>((acc, bill) => {
			acc[bill.status] = (acc[bill.status] ?? 0) + 1
			return acc
		}, {})

		if (openBills.length === 0) {
			refreshLogger.info('[Bills] No unpaid issued/overdue bills need payment refresh', {
				recheckBefore: recheckBefore.toISOString(),
				selectedStatusCounts,
			})
			return
		}
		refreshLogger.info('[Bills] Found unpaid issued/overdue bills needing payment refresh', {
			count: openBills.length,
			recheckBefore: recheckBefore.toISOString(),
			selectedStatusCounts,
			billIds: openBills.map((bill) => bill.id),
		})

		// Prepare workflow creation options for all bills
		// Use a run-scoped workflow id so recurring cron checks can re-run for the same bill.
		const workflowOptions = openBills.map((bill) => ({
			id: `bill-payment-check-${bill.id}-${options.scheduledTimeMs}`,
			params: { billId: bill.id } as { billId: string },
		}))

		// createBatch is limited to 100 instances per call
		const BATCH_SIZE = 100
		const batches: Array<typeof workflowOptions> = []

		for (let i = 0; i < workflowOptions.length; i += BATCH_SIZE) {
			batches.push(workflowOptions.slice(i, i + BATCH_SIZE))
		}

		refreshLogger.info('[Bills] Creating workflows in batches', {
			totalBills: openBills.length,
			batchCount: batches.length,
			batchSize: BATCH_SIZE,
		})

		// Create workflows in batches
		const batchResults = await Promise.allSettled(
			batches.map(async (batch, batchIndex) => {
				try {
					const instances = await env.BILL_PAYMENT_STATUS_CHECK.createBatch(batch)

					refreshLogger.info('[Bills] Created workflow batch', {
						batchIndex: batchIndex + 1,
						totalBatches: batches.length,
						instancesCreated: instances.length,
					})

					return {
						success: true,
						instancesCreated: instances.length,
						batchIndex,
						batchSize: batch.length,
					}
				} catch (error) {
					refreshLogger.error('[Bills] Failed to create workflow batch', {
						batchIndex: batchIndex + 1,
						totalBatches: batches.length,
						batchSize: batch.length,
						errorMessage: error instanceof Error ? error.message : String(error),
						errorStack: error instanceof Error ? error.stack : undefined,
					})

					return {
						success: false,
						instancesCreated: 0,
						batchIndex,
						batchSize: batch.length,
						error: error instanceof Error ? error.message : String(error),
					}
				}
			})
		)

		// Count created and failed workflows
		const stats = {
			total: openBills.length,
			created: 0,
			failed: 0,
			batchesSucceeded: 0,
			batchesFailed: 0,
		}

		batchResults.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				if (result.value.success) {
					stats.created += result.value.instancesCreated
					stats.batchesSucceeded++
				} else {
					stats.failed += result.value.batchSize
					stats.batchesFailed++
				}
			} else {
				// For rejected promises, estimate failed count based on batch size
				const batchSize = batches[index]?.length ?? 0
				stats.failed += batchSize
				stats.batchesFailed++
			}
		})

		const duration = Date.now() - startTime

		refreshLogger.info('[Bills] Bill payment status refresh batch complete', {
			totalBills: stats.total,
			workflowsCreated: stats.created,
			failed: stats.failed,
			batchesSucceeded: stats.batchesSucceeded,
			batchesFailed: stats.batchesFailed,
			totalBatches: batches.length,
			durationMs: duration,
		})
	} catch (error) {
		const duration = Date.now() - startTime
		refreshLogger.error('[Bills] Unexpected error during payment status refresh', {
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			durationMs: duration,
		})
		throw error
	}
}

/**
 * Enqueue execution workflows for all active schedules whose next generation time is due.
 */
async function enqueueDueSchedules(env: Env, options: { scheduledTimeMs: number }): Promise<void> {
	const startTime = Date.now()
	const scheduleLogger = logger.withTags({ component: 'bills-schedule-refresh' })

	scheduleLogger.info('[Bills] Starting due schedule refresh batch')

	try {
		const db = createDb(env.DATABASE_URL)
		const dueAt = new Date(options.scheduledTimeMs)
		const dueSchedules = await db.query.billSchedules.findMany({
			where: and(eq(billSchedules.isActive, true), lte(billSchedules.nextGenerationTime, dueAt)),
		})

		if (dueSchedules.length === 0) {
			scheduleLogger.info('[Bills] No due active schedules found', {
				dueAt: dueAt.toISOString(),
			})
			return
		}

		scheduleLogger.info('[Bills] Found due active schedules', {
			count: dueSchedules.length,
			dueAt: dueAt.toISOString(),
			scheduleIds: dueSchedules.map((schedule) => schedule.id),
		})

		const workflowOptions = dueSchedules.map((schedule) => ({
			id: `bill-schedule-exec-${schedule.id}-${options.scheduledTimeMs}`,
			params: { scheduleId: schedule.id } as { scheduleId: string },
		}))

		const BATCH_SIZE = 100
		const batches: Array<typeof workflowOptions> = []
		for (let i = 0; i < workflowOptions.length; i += BATCH_SIZE) {
			batches.push(workflowOptions.slice(i, i + BATCH_SIZE))
		}

		const batchResults = await Promise.allSettled(
			batches.map(async (batch, batchIndex) => {
				try {
					const instances = await env.BILLS_SCHEDULE_EXECUTOR.createBatch(batch)
					scheduleLogger.info('[Bills] Created schedule workflow batch', {
						batchIndex: batchIndex + 1,
						totalBatches: batches.length,
						instancesCreated: instances.length,
					})
					return {
						success: true,
						instancesCreated: instances.length,
						batchSize: batch.length,
					}
				} catch (error) {
					scheduleLogger.error('[Bills] Failed to create schedule workflow batch', {
						batchIndex: batchIndex + 1,
						totalBatches: batches.length,
						batchSize: batch.length,
						errorMessage: error instanceof Error ? error.message : String(error),
						errorStack: error instanceof Error ? error.stack : undefined,
					})
					return {
						success: false,
						instancesCreated: 0,
						batchSize: batch.length,
					}
				}
			})
		)

		let created = 0
		let failed = 0
		batchResults.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				if (result.value.success) {
					created += result.value.instancesCreated
				} else {
					failed += result.value.batchSize
				}
			} else {
				// Unexpected batch-level rejection. Conservative failed count fallback.
				failed += batches[index]?.length ?? 0
			}
		})

		scheduleLogger.info('[Bills] Due schedule refresh batch complete', {
			totalDue: dueSchedules.length,
			workflowsCreated: created,
			failed,
			durationMs: Date.now() - startTime,
		})
	} catch (error) {
		scheduleLogger.error('[Bills] Unexpected error during due schedule refresh', {
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			durationMs: Date.now() - startTime,
		})
		throw error
	}
}

async function enqueueDueSoonNotifications(
	env: Env,
	options: { scheduledTimeMs: number }
): Promise<void> {
	const startTime = Date.now()
	const notificationLogger = logger.withTags({ component: 'bills-due-soon-notifications' })
	const now = new Date(options.scheduledTimeMs)
	const dueWithin24h = new Date(options.scheduledTimeMs + 24 * 60 * 60 * 1000)

	notificationLogger.info('[Bills] Starting due-soon notification enqueue sweep', {
		now: now.toISOString(),
		dueWithin24h: dueWithin24h.toISOString(),
	})

	try {
		const db = createDb(env.DATABASE_URL)
		const candidateBills = await db.query.bills.findMany({
			where: and(
				eq(bills.status, 'issued'),
				isNull(bills.paidAt),
				lte(bills.dueDate, dueWithin24h)
			),
			columns: {
				id: true,
				dueDate: true,
			},
		})
		const dueSoonBillIds = candidateBills
			.filter((bill) => bill.dueDate > now)
			.map((bill) => bill.id)

		if (dueSoonBillIds.length === 0) {
			notificationLogger.info('[Bills] No due-soon bills eligible for reminder enqueue', {
				candidates: candidateBills.length,
			})
			return
		}

		const billsStub = getStub<Bills>(env.BILLS, 'default')
		const results = await Promise.allSettled(
			dueSoonBillIds.map((billId) =>
				billsStub.enqueueBillNotificationEvent(billId, 'due_24h', {
					source: 'scheduled_due_soon_sweep',
				})
			)
		)
		const succeeded = results.filter((r) => r.status === 'fulfilled').length
		const failed = results.length - succeeded

		notificationLogger.info('[Bills] Due-soon reminder enqueue sweep complete', {
			billsConsidered: candidateBills.length,
			enqueueAttempted: dueSoonBillIds.length,
			succeeded,
			failed,
			durationMs: Date.now() - startTime,
		})
	} catch (error) {
		notificationLogger.error('[Bills] Due-soon reminder enqueue sweep failed', {
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			durationMs: Date.now() - startTime,
		})
		throw error
	}
}

async function dispatchPendingNotificationWorkflows(
	env: Env,
	options: { scheduledTimeMs: number }
): Promise<void> {
	const startTime = Date.now()
	const notifyLogger = logger.withTags({ component: 'bills-notification-dispatch' })
	const now = new Date(options.scheduledTimeMs)

	try {
		const db = createDb(env.DATABASE_URL)
		const pending = await db.query.billNotificationEvents.findMany({
			where: and(
				inArray(billNotificationEvents.status, ['pending', 'failed']),
				lte(billNotificationEvents.firstEligibleAt, now)
			),
			columns: { id: true },
			limit: 200,
		})
		if (pending.length === 0) {
			notifyLogger.info('[Bills] No pending bill notifications to dispatch', {
				now: now.toISOString(),
			})
			return
		}

		const workflowOptions = pending.map((row) => ({
			id: `bill-notify-${row.id}-${options.scheduledTimeMs}`,
			params: { notificationEventId: row.id } as { notificationEventId: string },
		}))
		const BATCH_SIZE = 100
		let created = 0
		for (let i = 0; i < workflowOptions.length; i += BATCH_SIZE) {
			const batch = workflowOptions.slice(i, i + BATCH_SIZE)
			const instances = await env.BILL_DISCORD_NOTIFY.createBatch(batch)
			created += instances.length
		}

		notifyLogger.info('[Bills] Dispatched bill notification workflows', {
			pendingCount: pending.length,
			workflowsCreated: created,
			durationMs: Date.now() - startTime,
		})
	} catch (error) {
		notifyLogger.error('[Bills] Failed dispatching bill notification workflows', {
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			durationMs: Date.now() - startTime,
		})
		throw error
	}
}

export async function scheduledHandler(
	event: ScheduledEvent,
	env: Env,
	_ctx: ExecutionContext
): Promise<void> {
	const start = Date.now()
	const scheduledLogger = logger.withTags({ component: 'bills-cron-handler' })
	scheduledLogger.info('[Scheduled] Starting scheduled refresh via workflows', {
		scheduledTime: new Date(event.scheduledTime).toISOString(),
		cron: event.cron,
	})
	await enqueueDueSchedules(env, { scheduledTimeMs: event.scheduledTime })
	await enqueueDueSoonNotifications(env, { scheduledTimeMs: event.scheduledTime })
	await refreshBillPayments(env, { scheduledTimeMs: event.scheduledTime })
	await dispatchPendingNotificationWorkflows(env, { scheduledTimeMs: event.scheduledTime })

	const duration = Date.now() - start
	scheduledLogger.info('[Scheduled] Scheduled refresh via workflows complete', {
		durationMs: duration,
	})
}
