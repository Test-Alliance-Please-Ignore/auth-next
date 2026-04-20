import { and, eq } from 'drizzle-orm'

import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { srpRequests } from './db/schema'

import type { Env } from './context'

async function refreshPendingPaymentChecks(
	env: Env,
	options: { scheduledTimeMs: number }
): Promise<void> {
	const startTime = Date.now()
	const refreshLogger = logger.withTags({ component: 'srp-payment-refresh' })

	refreshLogger.info('[SRP] Starting payment status refresh batch')

	try {
		const db = createDb(env.DATABASE_URL)
		const pendingRequests = await db.query.srpRequests.findMany({
			where: and(eq(srpRequests.requestStatus, 'payment_pending')),
			columns: { id: true },
		})

		if (pendingRequests.length === 0) {
			refreshLogger.info('[SRP] No payment-pending requests found')
			return
		}

		const workflowOptions = pendingRequests.map((request) => ({
			id: `srp-payment-check-${request.id}-${options.scheduledTimeMs}`,
			params: { requestId: request.id } as { requestId: string },
		}))

		const BATCH_SIZE = 100
		const batches: Array<typeof workflowOptions> = []
		for (let i = 0; i < workflowOptions.length; i += BATCH_SIZE) {
			batches.push(workflowOptions.slice(i, i + BATCH_SIZE))
		}

		const batchResults = await Promise.allSettled(
			batches.map(async (batch, batchIndex) => {
				try {
					const instances = await env.SRP_PAYMENT_STATUS_CHECK.createBatch(batch)
					refreshLogger.info('[SRP] Created payment-check workflow batch', {
						batchIndex: batchIndex + 1,
						totalBatches: batches.length,
						instancesCreated: instances.length,
					})
					return { success: true, instancesCreated: instances.length, batchSize: batch.length }
				} catch (error) {
					refreshLogger.error('[SRP] Failed to create payment-check workflow batch', {
						batchIndex: batchIndex + 1,
						totalBatches: batches.length,
						batchSize: batch.length,
						errorMessage: error instanceof Error ? error.message : String(error),
					})
					return { success: false, instancesCreated: 0, batchSize: batch.length }
				}
			})
		)

		let workflowsCreated = 0
		let workflowsFailed = 0
		let batchesSucceeded = 0
		let batchesFailed = 0
		for (const [index, result] of batchResults.entries()) {
			if (result.status === 'fulfilled') {
				if (result.value.success) {
					workflowsCreated += result.value.instancesCreated
					batchesSucceeded += 1
				} else {
					workflowsFailed += result.value.batchSize
					batchesFailed += 1
				}
				continue
			}
			workflowsFailed += batches[index]?.length ?? 0
			batchesFailed += 1
		}

		refreshLogger.info('[SRP] Payment status refresh batch complete', {
			totalRequests: pendingRequests.length,
			workflowsCreated,
			workflowsFailed,
			batchesSucceeded,
			batchesFailed,
			durationMs: Date.now() - startTime,
		})
	} catch (error) {
		refreshLogger.error('[SRP] Unexpected error during payment status refresh', {
			errorMessage: error instanceof Error ? error.message : String(error),
			durationMs: Date.now() - startTime,
		})
		throw error
	}
}

export async function scheduledHandler(
	_event: ScheduledEvent,
	env: Env,
	_ctx: ExecutionContext
): Promise<void> {
	await refreshPendingPaymentChecks(env, { scheduledTimeMs: Date.now() })
}

