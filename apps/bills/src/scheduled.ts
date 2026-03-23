import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm'

import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { bills } from './db/schema'

import type { Env } from './context'

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
	await refreshBillPayments(env, { scheduledTimeMs: event.scheduledTime })

	const duration = Date.now() - start
	scheduledLogger.info('[Scheduled] Scheduled refresh via workflows complete', {
		durationMs: duration,
	})
}
