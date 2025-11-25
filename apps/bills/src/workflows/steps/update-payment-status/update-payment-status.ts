import { eq } from '@repo/db-utils'

import { bills } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { WorkflowContext } from '../../context'

export interface UpdatePaymentStatusResult {
	updated: boolean
}

/**
 * Update payment status
 *
 * @param ctx - Workflow context
 * @returns Update result
 */
export async function updatePaymentStatus(
	ctx: WorkflowContext
): Promise<UpdatePaymentStatusResult> {
	const logger = getWorkflowLogger(ctx, 'update-payment-status')

	// TODO: Implement actual payment status update logic
	logger.info('[Workflow] Updating payment status', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
	})

	await ctx.db
		.update(bills)
		.set({
			paymentLastCheckedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(bills.id, ctx.billId))

	logger.info('[Workflow] Updated payment status', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
	})

	return {
		updated: true,
	}
}

