import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { createDb } from '../db'
import { BillService } from '../services/bill.service'
import { getWorkflowLogger } from './context'
import { checkPaymentStatus } from './steps/check-payment-status'
import { fetchBillData } from './steps/fetch-bill-data'
import { findPaymentsForBill } from './steps/find-payments/find-payments'
import { updateCheckTimestamp } from './steps/update-check-timestamp'
import { updatePaymentStatus } from './steps/update-payment-status'

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
 */
export class BillPaymentStatusCheckWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
	/**
	 * Main workflow entry point
	 */
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		const { billId } = event.payload
		const workflowInstanceId = event.instanceId

		if (!billId) {
			throw new Error('Missing billId in workflow payload')
		}

		const db = createDb(this.env.DATABASE_URL)
		const workflowContext: WorkflowContext = {
			env: this.env,
			workflowInstanceId,
			db,
			billId,
			billService: new BillService(db),
		}

		const logger = getWorkflowLogger(workflowContext)
		logger.info('[Workflow] Starting payment status check', {
			billId,
			workflowInstanceId,
		})

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
			() => fetchBillData(workflowContext)
		)

		logger.info('[Workflow] Fetched bill data', {
			billId,
			workflowInstanceId,
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
			() => findPaymentsForBill(workflowContext, fetchBillDataResult.bill)
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
			() => checkPaymentStatus(workflowContext, fetchBillDataResult.bill)
		)

		logger.info('[Workflow] Checked payment status', {
			billId,
			workflowInstanceId,
		})

		// Step 3: Update payment status if needed

		// Update last checked timestamp even if no status change
		await step.do('update-check-timestamp', () => updateCheckTimestamp(workflowContext))

		logger.info('[Workflow] Updated payment check timestamp', {
			billId,
			workflowInstanceId,
		})

		logger.info('[Workflow] Payment status check completed', {
			billId,
			workflowInstanceId,
		})

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
