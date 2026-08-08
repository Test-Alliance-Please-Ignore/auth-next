import { WorkflowEntrypoint } from 'cloudflare:workers'

import { getStub, withRpcResult } from '@repo/do-utils'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Bills } from '@repo/bills'
import type { Env } from '../context'

/**
 * Bill Schedule Executor Workflow
 *
 * Executes scheduled bill generation with retry logic and failure handling.
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Failure tracking (auto-pause after 3 consecutive failures)
 * - Integration with notification system for alerts
 * - Idempotent execution via schedule logs
 */
export class BillScheduleExecutorWorkflow extends WorkflowEntrypoint<Env, { scheduleId: string }> {
	/**
	 * Main workflow entry point
	 */
	async run(event: WorkflowEvent<{ scheduleId: string }>, step: WorkflowStep) {
		const { scheduleId } = event.payload

		if (!scheduleId) {
			throw new Error('Missing scheduleId in workflow payload')
		}

		// Step 1: Execute the schedule with retry logic
		const result = await step.do(
			'execute-schedule',
			{
				retries: {
					limit: 3,
					delay: 1000,
					backoff: 'exponential',
				},
			},
			async () => {
				const billsStub = getStub<Bills>(this.env.BILLS, 'default')
				return await withRpcResult(billsStub.executeSchedule(scheduleId), (result) => ({
					...result,
				}))
			}
		)

		if (!result.success) {
			throw new Error(`Schedule execution failed: ${result.error}`)
		}

		return {
			success: true,
			scheduleId,
			billId: result.billId,
			groupBillId: result.groupBillId,
			billCount: result.billCount,
		}
	}
}

/**
 * Workflow Configuration
 *
 * Export the workflow entrypoint for Cloudflare Workers platform.
 * The workflow will be triggered by schedule management operations.
 */
export default BillScheduleExecutorWorkflow
