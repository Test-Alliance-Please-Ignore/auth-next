import { eq } from '@repo/db-utils'

import { bills } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { WorkflowContext } from '../../context'

export interface FetchBillDataResult {
	bill: typeof bills.$inferSelect
}

/**
 * Fetch bill data from database
 *
 * @param ctx - Workflow context
 * @returns Bill data
 */
export async function fetchBillData(ctx: WorkflowContext): Promise<FetchBillDataResult> {
	const logger = getWorkflowLogger(ctx, 'fetch-bill-data')

	const bill = await ctx.db.query.bills.findFirst({
		where: eq(bills.id, ctx.billId),
	})

	if (!bill) {
		throw new Error(`Bill not found: ${ctx.billId}`)
	}

	logger.info('[Workflow] Fetched bill data', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		status: bill.status,
	})

	return {
		bill,
	}
}
