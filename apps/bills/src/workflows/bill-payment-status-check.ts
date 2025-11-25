import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { createDb } from '../db'
import { BillService } from '../services/bill.service'
import { checkPaymentStatus } from './steps/check-payment-status'
import { fetchBillData } from './steps/fetch-bill-data'
import { findPaymentsForBill } from './steps/find-payments/find-payments'
import { updateCheckTimestamp } from './steps/update-check-timestamp'

import type { Env } from '../context'
import type { WorkflowContext } from './context'

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
		await step.do(
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

		// Step 3: Check payment status
		await step.do(
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
				return checkPaymentStatus(ctx, fetchBillDataResult.bill)
			}
		)

		console.log('[Workflow] Checked payment status', logContext)

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
	}
}

/**
 * Workflow Configuration
 *
 * Export the workflow entrypoint for Cloudflare Workers platform.
 * The workflow will be triggered to check bill payment status.
 */
export default BillPaymentStatusCheckWorkflow
