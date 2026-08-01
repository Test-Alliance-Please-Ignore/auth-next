import { and, desc, eq } from '@repo/db-utils'

import { bills, billStatusEvents } from '../../../db/schema'
import { getWorkflowLogger } from '../../context'

import type { BillStatus, EntityType } from '@repo/bills'
import type { WorkflowContext } from '../../context'

export interface BillPaymentCheckData {
	id: string
	status: BillStatus
	payeeId: string | null
	payeeType: EntityType | null
	payerType: EntityType
	paymentToken: string
	paymentStartAt: string
	paymentLastCheckedAt: string | null
	externalSourceType: string | null
}

export interface FetchBillDataResult {
	bill: BillPaymentCheckData
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

	const issuedEvent = await ctx.db.query.billStatusEvents.findFirst({
		where: and(eq(billStatusEvents.billId, bill.id), eq(billStatusEvents.eventType, 'issued')),
		orderBy: desc(billStatusEvents.createdAt),
		columns: { createdAt: true },
	})

	logger.info('[Workflow] Fetched bill data', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		status: bill.status,
	})

	return {
		bill: {
			id: bill.id,
			status: bill.status,
			payeeId: bill.payeeId,
			payeeType: bill.payeeType,
			payerType: bill.payerType,
			paymentToken: bill.paymentToken,
			paymentStartAt: (issuedEvent?.createdAt ?? bill.createdAt).toISOString(),
			paymentLastCheckedAt: bill.paymentLastCheckedAt?.toISOString() ?? null,
			externalSourceType: bill.externalSourceType,
		},
	}
}
