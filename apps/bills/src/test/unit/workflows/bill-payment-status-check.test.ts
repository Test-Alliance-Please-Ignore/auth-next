import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BillPaymentStatusCheckWorkflow } from '../../../workflows/bill-payment-status-check'

import type { WorkflowStep } from 'cloudflare:workers'

const fetchBillDataMock = vi.fn()
const findPaymentsForBillMock = vi.fn()
const checkPaymentStatusMock = vi.fn()
const updateCheckTimestampMock = vi.fn()
const getStubMock = vi.fn()

vi.mock('cloudflare:workers', () => {
	class WorkflowEntrypoint<Env = unknown> {
		protected readonly ctx: unknown
		protected readonly env: Env

		constructor(ctx: unknown, env: Env) {
			this.ctx = ctx
			this.env = env
		}
	}

	return {
		WorkflowEntrypoint,
		WorkflowEvent: class WorkflowEvent {},
		WorkflowStep: class WorkflowStep {},
	}
})

vi.mock('../../../workflows/steps/fetch-bill-data', () => ({
	fetchBillData: (...args: unknown[]) => fetchBillDataMock(...args),
}))

vi.mock('../../../workflows/steps/find-payments/find-payments', () => ({
	findPaymentsForBill: (...args: unknown[]) => findPaymentsForBillMock(...args),
}))

vi.mock('../../../workflows/steps/check-payment-status', () => ({
	checkPaymentStatus: (...args: unknown[]) => checkPaymentStatusMock(...args),
}))

vi.mock('../../../workflows/steps/update-check-timestamp', () => ({
	updateCheckTimestamp: (...args: unknown[]) => updateCheckTimestampMock(...args),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

type MockContext = {
	billId: string
	workflowInstanceId: string
	billService: {
		refreshBillLifecycleStatus: ReturnType<typeof vi.fn>
	}
}

function createStep(retryStepNames: string[] = []) {
	const executedStepNames: string[] = []
	const retrySteps = new Set(retryStepNames)
	const doMock = vi.fn(
		async (name: string, optionsOrHandler: unknown, maybeHandler?: () => unknown) => {
			executedStepNames.push(name)
			const handler =
				typeof optionsOrHandler === 'function'
					? (optionsOrHandler as () => unknown)
					: (maybeHandler as () => unknown)
			try {
				return await handler()
			} catch (error) {
				if (!retrySteps.has(name)) throw error
				return await handler()
			}
		}
	)

	return {
		executedStepNames,
		step: { do: doMock } as unknown as WorkflowStep,
		doMock,
	}
}

function createWorkflowAndContext() {
	const refreshBillLifecycleStatus = vi.fn().mockResolvedValue({
		overdueMarked: false,
		lateFeeChanged: false,
		billStatus: 'issued',
	})
	const ctx: MockContext = {
		billId: 'bill-1',
		workflowInstanceId: 'wf-1',
		billService: {
			refreshBillLifecycleStatus,
		},
	}

	const taxSyncMock = vi.fn().mockResolvedValue({
		processedBillIds: ['bill-1'],
		processedAssessmentIds: [],
		updatedAssessmentIds: [],
		skippedAssessmentIds: [],
		corporationIds: [],
	})
	const enqueueBillNotificationEventMock = vi.fn().mockResolvedValue({ recipientCount: 1 })
	const corporationTaxNamespace = { __ns: 'CORPORATION_TAX' } as unknown as DurableObjectNamespace
	const billsNamespace = { __ns: 'BILLS' } as unknown as DurableObjectNamespace

	getStubMock.mockImplementation((namespace: unknown) => {
		if (namespace === corporationTaxNamespace) {
			return {
				syncBillStatus: taxSyncMock,
			}
		}
		if (namespace === billsNamespace) {
			return {
				enqueueBillNotificationEvent: enqueueBillNotificationEventMock,
			}
		}
		return {}
	})

	const workflow = new BillPaymentStatusCheckWorkflow(
		{} as ExecutionContext<unknown>,
		{
			DATABASE_URL: 'postgresql://test',
			CORPORATION_TAX: corporationTaxNamespace,
			BILLS: billsNamespace,
		} as never
	)
	vi.spyOn(
		workflow as unknown as { createContext: () => unknown },
		'createContext'
	).mockReturnValue(ctx)

	return {
		workflow,
		ctx,
		refreshBillLifecycleStatus,
		taxSyncMock,
		enqueueBillNotificationEventMock,
	}
}

describe('BillPaymentStatusCheckWorkflow', () => {
	beforeEach(() => {
		vi.clearAllMocks()

		fetchBillDataMock.mockResolvedValue({
			bill: {
				id: 'bill-1',
				status: 'issued',
				externalSourceType: 'corporation_tax_assessment',
			},
		})
		findPaymentsForBillMock.mockResolvedValue({ newPaymentsRecorded: 0 })
		checkPaymentStatusMock.mockResolvedValue({
			markedPaid: false,
			statusBefore: 'issued',
			statusAfter: 'issued',
		})
		updateCheckTimestampMock.mockResolvedValue({ updated: true })
	})

	it('syncs tax status when payment is newly recorded', async () => {
		findPaymentsForBillMock.mockResolvedValueOnce({ newPaymentsRecorded: 1 })
		const { workflow, taxSyncMock } = createWorkflowAndContext()
		const { step, executedStepNames } = createStep()

		await workflow.run({ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never, step)

		expect(executedStepNames).toEqual([
			'reconcile-payment-data',
			'finalize-payment-state',
			'update-check-timestamp',
			'sync-bill-effects',
		])
		expect(taxSyncMock).toHaveBeenCalledWith('system:bills:payment-status-check', {
			id: 'bill-1',
			status: 'issued',
		})
	})

	it('refreshes overdue only when no new payment was recorded', async () => {
		const { workflow, refreshBillLifecycleStatus } = createWorkflowAndContext()
		const noPaymentStep = createStep()

		await workflow.run(
			{ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never,
			noPaymentStep.step
		)
		expect(refreshBillLifecycleStatus).toHaveBeenCalledTimes(1)
		expect(noPaymentStep.executedStepNames).toEqual([
			'reconcile-payment-data',
			'finalize-payment-state',
			'update-check-timestamp',
		])

		vi.clearAllMocks()
		fetchBillDataMock.mockResolvedValue({
			bill: {
				id: 'bill-1',
				status: 'issued',
				externalSourceType: 'corporation_tax_assessment',
			},
		})
		findPaymentsForBillMock.mockResolvedValue({ newPaymentsRecorded: 2 })
		checkPaymentStatusMock.mockResolvedValue({
			markedPaid: false,
			statusBefore: 'issued',
			statusAfter: 'issued',
		})
		updateCheckTimestampMock.mockResolvedValue({ updated: true })

		const withPayment = createWorkflowAndContext()
		const withPaymentStep = createStep()
		await withPayment.workflow.run(
			{ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never,
			withPaymentStep.step
		)
		expect(withPayment.refreshBillLifecycleStatus).not.toHaveBeenCalled()
		expect(withPaymentStep.executedStepNames).toEqual([
			'reconcile-payment-data',
			'finalize-payment-state',
			'update-check-timestamp',
			'sync-bill-effects',
		])
	})

	it('syncs tax status when payment status transition marks bill as paid', async () => {
		checkPaymentStatusMock.mockResolvedValueOnce({
			markedPaid: true,
			statusBefore: 'issued',
			statusAfter: 'paid',
		})

		const { workflow, taxSyncMock, enqueueBillNotificationEventMock } = createWorkflowAndContext()
		const { step, doMock } = createStep()

		await workflow.run({ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never, step)

		expect(doMock).toHaveBeenCalledTimes(4)
		expect(taxSyncMock).toHaveBeenCalledWith('system:bills:payment-status-check', {
			id: 'bill-1',
			status: 'paid',
		})
		expect(enqueueBillNotificationEventMock).toHaveBeenCalledWith('bill-1', 'paid', {
			source: 'bill_payment_status_workflow',
		})
	})

	it('syncs tax status when overdue status was marked and no payment was found', async () => {
		const { workflow, refreshBillLifecycleStatus, taxSyncMock, enqueueBillNotificationEventMock } =
			createWorkflowAndContext()
		refreshBillLifecycleStatus.mockResolvedValueOnce({
			overdueMarked: true,
			lateFeeChanged: false,
			billStatus: 'overdue',
		})
		const { step } = createStep()

		await workflow.run({ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never, step)

		expect(taxSyncMock).toHaveBeenCalledTimes(1)
		expect(enqueueBillNotificationEventMock).toHaveBeenCalledWith('bill-1', 'overdue', {
			source: 'bill_payment_status_workflow',
		})
	})

	it('does not sync tax status when no state changed or source is not corporation-tax', async () => {
		const first = createWorkflowAndContext()
		const firstStep = createStep()

		await first.workflow.run(
			{ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never,
			firstStep.step
		)
		expect(first.taxSyncMock).not.toHaveBeenCalled()

		vi.clearAllMocks()
		fetchBillDataMock.mockResolvedValue({
			bill: {
				id: 'bill-1',
				status: 'issued',
				externalSourceType: 'manual',
			},
		})
		findPaymentsForBillMock.mockResolvedValue({ newPaymentsRecorded: 2 })
		checkPaymentStatusMock.mockResolvedValue({
			markedPaid: false,
			statusBefore: 'issued',
			statusAfter: 'issued',
		})
		updateCheckTimestampMock.mockResolvedValue({ updated: true })

		const second = createWorkflowAndContext()
		const secondStep = createStep()
		await second.workflow.run(
			{ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never,
			secondStep.step
		)
		expect(second.taxSyncMock).not.toHaveBeenCalled()
		expect(second.enqueueBillNotificationEventMock).not.toHaveBeenCalled()
		expect(secondStep.executedStepNames).toEqual([
			'reconcile-payment-data',
			'finalize-payment-state',
			'update-check-timestamp',
		])
	})

	it('does not recompute transition flags when the timestamp step retries', async () => {
		checkPaymentStatusMock.mockResolvedValueOnce({
			markedPaid: true,
			statusBefore: 'issued',
			statusAfter: 'paid',
		})
		updateCheckTimestampMock
			.mockRejectedValueOnce(new Error('temporary timestamp failure'))
			.mockResolvedValueOnce({ updated: true })

		const { workflow } = createWorkflowAndContext()
		const { step } = createStep(['update-check-timestamp'])

		await workflow.run({ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never, step)

		expect(checkPaymentStatusMock).toHaveBeenCalledTimes(1)
		expect(updateCheckTimestampMock).toHaveBeenCalledTimes(2)
	})
})
