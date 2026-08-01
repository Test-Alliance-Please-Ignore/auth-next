import { eq } from '@repo/db-utils'

import { bills } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { WorkflowContext } from '../../context'

export interface UpdateCheckTimestampResult {
	updated: boolean
}

/**
 * Update payment check timestamp
 *
 * @param ctx - Workflow context
 * @returns Update result
 */
export async function updateCheckTimestamp(
	ctx: WorkflowContext
): Promise<UpdateCheckTimestampResult> {
	const logger = getWorkflowLogger(ctx, 'update-check-timestamp')

	await ctx.db
		.update(bills)
		.set({
			paymentLastCheckedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(bills.id, ctx.billId))

	logger.info('[Workflow] Updated payment check timestamp', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
	})

	return {
		updated: true,
	}
}
