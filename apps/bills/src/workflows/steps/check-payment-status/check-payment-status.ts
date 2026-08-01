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
	ctx: WorkflowContext
): Promise<{ markedPaid: boolean; statusBefore: string; statusAfter: string }> {
	const logger = getWorkflowLogger(ctx, 'check-payment-status')
	const currentBill = await ctx.billService.getBillIntegrationView(ctx.billId)
	if (!currentBill) {
		throw new Error('Bill not found')
	}

	// TODO: Implement actual payment status checking logic
	logger.info('[Workflow] Checking payment status', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		currentStatus: currentBill.status,
	})

	const isPaid = await ctx.billService.checkBillBalancePaid(ctx.billId)
	if (isPaid) {
		logger.info('[Workflow] Bill is paid', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
		})
		await ctx.billService.markBillAsPaid(ctx.billId)
		const finalBill = await ctx.billService.getBillIntegrationView(ctx.billId)
		const statusAfter = finalBill?.status ?? currentBill.status
		logger.info('[Workflow] Bill marked as paid', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
			statusBefore: currentBill.status,
			statusAfter,
		})
		return {
			markedPaid: currentBill.status !== 'paid' && statusAfter === 'paid',
			statusBefore: currentBill.status,
			statusAfter,
		}
	}

	logger.info('[Workflow] Bill is not paid', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
	})

	return {
		markedPaid: false,
		statusBefore: currentBill.status,
		statusAfter: currentBill.status,
	}
}
