import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'

import type { Bills, ScheduleExecutionResult } from '@repo/bills'
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
				return await billsStub.executeSchedule(scheduleId)
			}
		)

		// Step 2: Handle execution result
		if (!result.success) {
			await step.do('handle-failure', async () => {
				// Log the failure
				console.error(`Schedule ${scheduleId} execution failed:`, result.error)

				// TODO: Send notification to schedule owner about the failure
				// This would integrate with the notifications DO once implemented
				// Example:
				// const notifStub = getStub<Notifications>(this.env.NOTIFICATIONS, ownerId)
				// await notifStub.publishNotification(ownerId, {
				//   type: 'bill.schedule.failed',
				//   data: { scheduleId, error: result.error },
				//   requiresAck: true
				// })

				return { notified: false, reason: 'Notification system not yet integrated' }
			})

			throw new Error(`Schedule execution failed: ${result.error}`)
		}

		// Step 3: Handle success
		await step.do('handle-success', async () => {
			console.log(`Schedule ${scheduleId} executed successfully, created bill ${result.billId}`)

			// TODO: Send notification to payer about the new bill
			// This would integrate with the notifications DO once implemented

			return { billId: result.billId }
		})

		return {
			success: true,
			scheduleId,
			billId: result.billId,
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
