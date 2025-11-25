import { eq } from 'drizzle-orm'

import { bills } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { WorkflowContext } from '../../context'

/**
 * Check payment status
 *
 * @param ctx - Workflow context
 * @param billData - Bill data from database
 * @returns Payment status check result
 */
export async function checkPaymentStatus(
	ctx: WorkflowContext,
	billData: typeof bills.$inferSelect
): Promise<void> {
	const logger = getWorkflowLogger(ctx, 'check-payment-status')

	// TODO: Implement actual payment status checking logic
	logger.info('[Workflow] Checking payment status', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		currentStatus: billData.status,
	})

	const isPaid = await ctx.billService.checkBillBalancePaid(ctx.billId)
	if (isPaid) {
		logger.info('[Workflow] Bill is paid', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
		})
		await ctx.billService.markBillAsPaid(ctx.billId)
		logger.info('[Workflow] Bill marked as paid', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
		})
	} else {
		logger.info('[Workflow] Bill is not paid', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
		})
	}
}
