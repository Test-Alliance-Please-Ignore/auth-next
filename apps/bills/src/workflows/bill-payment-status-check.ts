import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'

import { createDb } from '../db'
import { BillService } from '../services/bill.service'
import { checkPaymentStatus } from './steps/check-payment-status'
import { fetchBillData } from './steps/fetch-bill-data'
import { findPaymentsForBill } from './steps/find-payments/find-payments'
import { updateCheckTimestamp } from './steps/update-check-timestamp'

import type { BillStatus } from '@repo/bills'
import type { Env } from '../context'
import type { WorkflowContext } from './context'

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
		const db = createDb(this.env.DATABASE_URL)
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
		console.log('[Workflow] Starting payment status check', logContext)

		try {
			// Step 1: Fetch bill data
			const fetchBillDataResult = await step.do(
				'fetch-bill-data',
				{
					retries: {
						limit: 3,
						delay: 1000,
						backoff: 'exponential',
					},
					timeout: '30 seconds',
				},
				() => {
					const ctx = this.createContext(billId, workflowInstanceId)
					return fetchBillData(ctx)
				}
			)

			console.log('[Workflow] Fetched bill data', {
				...logContext,
				status: fetchBillDataResult.bill.status,
			})

			// Step 2: Find payments
			const paymentLookupResult = await step.do(
				'find-and-post-payments',
				{
					retries: {
						limit: 3,
						delay: 1000,
						backoff: 'exponential',
					},
					timeout: '1 minute',
				},
				() => {
					const ctx = this.createContext(billId, workflowInstanceId)
					return findPaymentsForBill(ctx, fetchBillDataResult.bill)
				}
			)

			// Step 3: If no new payment was recorded in this run, explicitly normalize overdue state.
			const overdueRefreshResult =
				paymentLookupResult.newPaymentsRecorded === 0
					? await step.do(
							'refresh-overdue-status',
							{
								retries: {
									limit: 3,
									delay: 1000,
									backoff: 'exponential',
								},
								timeout: '30 seconds',
							},
							() => {
								const ctx = this.createContext(billId, workflowInstanceId)
								return ctx.billService.refreshBillLifecycleStatus(ctx.billId)
							}
						)
					: {
							overdueMarked: false,
							lateFeeChanged: false,
							billStatus: fetchBillDataResult.bill.status,
						}

			if (overdueRefreshResult.overdueMarked) {
				await step.do(
					'enqueue-overdue-notification',
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
						return billsStub.enqueueBillNotificationEvent(billId, 'overdue', {
							source: 'bill_payment_status_workflow',
						})
					}
				)
			}

			// Step 4: Check payment status
			const paymentStatusResult = await step.do(
				'check-payment-status',
				{
					retries: {
						limit: 3,
						delay: 1000,
						backoff: 'exponential',
					},
					timeout: '1 minute',
				},
				() => {
					const ctx = this.createContext(billId, workflowInstanceId)
					return checkPaymentStatus(ctx)
				}
			)

			console.log('[Workflow] Checked payment status', logContext)

			if (paymentStatusResult.markedPaid) {
				await step.do(
					'enqueue-paid-notification',
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
						return billsStub.enqueueBillNotificationEvent(billId, 'paid', {
							source: 'bill_payment_status_workflow',
						})
					}
				)
			}

			// Step 3.5: Sync tax assessment bill status if this run changed payment data/status.
			const shouldSyncTaxAssessment =
				fetchBillDataResult.bill.externalSourceType === 'corporation_tax_assessment' &&
				(paymentLookupResult.newPaymentsRecorded > 0 ||
					paymentStatusResult.markedPaid ||
					overdueRefreshResult.overdueMarked)
			if (shouldSyncTaxAssessment) {
				await step.do(
					'sync-tax-assessment-bill-status',
					{
						retries: {
							limit: 3,
							delay: 1000,
							backoff: 'exponential',
						},
						timeout: '30 seconds',
					},
					async () => {
						const taxStub = getStub<CorporationTaxSyncStub>(this.env.CORPORATION_TAX, 'default')
						return taxStub.syncBillStatus(TAX_SYNC_ACTOR, {
							id: billId,
							status: paymentStatusResult.statusAfter as BillStatus,
						})
					}
				)
			}

			// Step 4: Update last checked timestamp even if no status change
			await step.do('update-check-timestamp', () => {
				const ctx = this.createContext(billId, workflowInstanceId)
				return updateCheckTimestamp(ctx)
			})

			console.log('[Workflow] Payment status check completed', logContext)

			return {
				success: true,
				billId,
			}
		} catch (error) {
			console.error('[Workflow] Payment status check failed', {
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
