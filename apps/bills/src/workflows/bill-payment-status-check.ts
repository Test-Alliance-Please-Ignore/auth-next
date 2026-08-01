import { WorkflowEntrypoint } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { BillService } from '../services/bill.service'
import { checkPaymentStatus } from './steps/check-payment-status'
import { fetchBillData } from './steps/fetch-bill-data'
import { findPaymentsForBill } from './steps/find-payments/find-payments'
import { updateCheckTimestamp } from './steps/update-check-timestamp'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { BillStatus } from '@repo/bills'
import type { Env } from '../context'
import type { WorkflowContext } from './context'

const DATABASE_QUERY_TIMEOUT_MS = 25_000

const TAX_SYNC_ACTOR = 'system:bills:payment-status-check'
type CorporationTaxSyncStub = {
	syncBillStatus(
		actorUserId: string,
		billState: { id: string; status: BillStatus }
	): Promise<{
		processedBillIds: string[]
		processedAssessmentIds: string[]
		updatedAssessmentIds: string[]
		skippedAssessmentIds: string[]
		corporationIds: string[]
	}>
}

type BillsNotificationStub = {
	enqueueBillNotificationEvent(
		billId: string,
		eventType: 'issued' | 'due_24h' | 'overdue' | 'paid',
		metadata?: Record<string, string | number | boolean | null> | null
	): Promise<{ recipientCount: number }>
}

/**
 * Bill Payment Status Check Workflow
 *
 * Checks the payment status of a bill and updates it if needed.
 *
 * Features:
 * - Fetches bill data from database
 * - Checks payment status (placeholder for future implementation)
 * - Updates payment status if needed (placeholder for future implementation)
 * - Automatic retry with exponential backoff
 * - Error handling and logging
 */

/**
 * Workflow parameters
 */
export interface WorkflowParams {
	billId: string
}

/**
 * Bill Payment Status Check Workflow
 * Checks and updates bill payment status
 *
 * IMPORTANT: Cloudflare Workflows hibernate between steps, discarding all in-memory state.
 * Services (db, BillService) must be recreated inside each step using createContext().
 */
export class BillPaymentStatusCheckWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
	/**
	 * Create workflow context inside each step.
	 * MUST be called inside step.do() callbacks since services don't survive hibernation.
	 */
	private createContext(billId: string, workflowInstanceId: string): WorkflowContext {
		const db = createDb(this.env.DATABASE_URL, { queryTimeoutMs: DATABASE_QUERY_TIMEOUT_MS })
		return {
			env: this.env,
			workflowInstanceId,
			db,
			billId,
			billService: new BillService(db),
		}
	}

	/**
	 * Main workflow entry point
	 */
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		const { billId } = event.payload
		const workflowInstanceId = event.instanceId

		if (!billId) {
			throw new Error('Missing billId in workflow payload')
		}

		// Note: Logger is created outside steps for logging purposes only
		// It doesn't need to survive hibernation as each step can recreate it
		const logContext = { billId, workflowInstanceId }
		logger.log('[Workflow] Starting payment status check', logContext)

		try {
			// Step 1: Fetch bill data and record any new payments in one durable DB step.
			const paymentReconciliationResult = await step.do(
				'reconcile-payment-data',
				{
					retries: {
						limit: 3,
						delay: 1000,
						backoff: 'exponential',
					},
					timeout: '1 minute',
				},
				async () => {
					const ctx = this.createContext(billId, workflowInstanceId)
					const billDataResult = await fetchBillData(ctx)
					const paymentLookupResult = await findPaymentsForBill(ctx, billDataResult.bill)
					return { ...billDataResult, ...paymentLookupResult }
				}
			)

			logger.log('[Workflow] Fetched bill data', {
				...logContext,
				status: paymentReconciliationResult.bill.status,
			})

			// Step 2: Normalize lifecycle state and evaluate payment status. The watermark write is
			// deliberately last so failed finalization leaves the payment window eligible for retry.
			const paymentStatusResult = await step.do(
				'finalize-payment-state',
				{
					retries: {
						limit: 3,
						delay: 1000,
						backoff: 'exponential',
					},
					timeout: '1 minute',
				},
				async () => {
					const ctx = this.createContext(billId, workflowInstanceId)
					const overdueRefreshResult =
						paymentReconciliationResult.newPaymentsRecorded === 0
							? await ctx.billService.refreshBillLifecycleStatus(ctx.billId)
							: {
									overdueMarked: false,
									lateFeeChanged: false,
									billStatus: paymentReconciliationResult.bill.status,
								}
					const paymentStatus = await checkPaymentStatus(ctx)
					// Advance the watermark only after payment reconciliation and lifecycle evaluation
					// both succeed, without adding another workflow step.
					await updateCheckTimestamp(ctx)
					return { ...overdueRefreshResult, ...paymentStatus }
				}
			)

			logger.log('[Workflow] Checked payment status', logContext)

			const shouldSyncTaxAssessment =
				paymentReconciliationResult.bill.externalSourceType === 'corporation_tax_assessment' &&
				(paymentReconciliationResult.newPaymentsRecorded > 0 ||
					paymentStatusResult.markedPaid ||
					paymentStatusResult.overdueMarked)
			const shouldEnqueueNotification =
				paymentStatusResult.overdueMarked || paymentStatusResult.markedPaid
			if (shouldSyncTaxAssessment || shouldEnqueueNotification) {
				await step.do(
					'sync-bill-effects',
					{
						retries: {
							limit: 3,
							delay: 1000,
							backoff: 'exponential',
						},
						timeout: '30 seconds',
					},
					async () => {
						const billsStub = getStub<BillsNotificationStub>(this.env.BILLS, 'default')
						if (paymentStatusResult.overdueMarked) {
							await billsStub.enqueueBillNotificationEvent(billId, 'overdue', {
								source: 'bill_payment_status_workflow',
							})
						}
						if (paymentStatusResult.markedPaid) {
							await billsStub.enqueueBillNotificationEvent(billId, 'paid', {
								source: 'bill_payment_status_workflow',
							})
						}
						if (shouldSyncTaxAssessment) {
							const taxStub = getStub<CorporationTaxSyncStub>(this.env.CORPORATION_TAX, 'default')
							await taxStub.syncBillStatus(TAX_SYNC_ACTOR, {
								id: billId,
								status: paymentStatusResult.statusAfter as BillStatus,
							})
						}
					}
				)
			}

			logger.log('[Workflow] Payment status check completed', logContext)

			return {
				success: true,
				billId,
			}
		} catch (error) {
			logger.error('[Workflow] Payment status check failed', {
				...logContext,
				error: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}
}

/**
 * Workflow Configuration
 *
 * Export the workflow entrypoint for Cloudflare Workers platform.
 * The workflow will be triggered to check bill payment status.
 */
export default BillPaymentStatusCheckWorkflow
