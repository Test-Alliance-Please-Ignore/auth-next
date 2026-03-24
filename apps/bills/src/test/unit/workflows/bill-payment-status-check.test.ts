import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BillPaymentStatusCheckWorkflow } from '../../../workflows/bill-payment-status-check'

import type { WorkflowStep } from 'cloudflare:workers'

const fetchBillDataMock = vi.fn()
const findPaymentsForBillMock = vi.fn()
const checkPaymentStatusMock = vi.fn()
const updateCheckTimestampMock = vi.fn()
const getStubMock = vi.fn()

vi.mock('cloudflare:workers', () => {
	class WorkflowEntrypoint<Env = unknown, Params = unknown> {
		protected readonly ctx: unknown
		protected readonly env: Env

		constructor(ctx: unknown, env: Env) {
			this.ctx = ctx
			this.env = env
		}

		// eslint-disable-next-line @typescript-eslint/require-await
		async run(_event: unknown, _step: unknown): Promise<Params> {
			throw new Error('WorkflowEntrypoint.run is not implemented in unit-test shim')
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

function createStep() {
	const executedStepNames: string[] = []
	const doMock = vi.fn(
		async (name: string, optionsOrHandler: unknown, maybeHandler?: () => unknown) => {
			executedStepNames.push(name)
			const handler =
				typeof optionsOrHandler === 'function'
					? (optionsOrHandler as () => unknown)
					: (maybeHandler as () => unknown)
			return await handler()
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

	getStubMock.mockReturnValue({
		syncBillStatus: taxSyncMock,
	})

	const workflow = new BillPaymentStatusCheckWorkflow(
		{} as ExecutionContext<unknown>,
		{
			DATABASE_URL: 'postgresql://test',
			CORPORATION_TAX: {} as DurableObjectNamespace,
		} as never
	)
	vi.spyOn(workflow as never, 'createContext').mockReturnValue(ctx as never)

	return {
		workflow,
		ctx,
		refreshBillLifecycleStatus,
		taxSyncMock,
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
			'fetch-bill-data',
			'find-and-post-payments',
			'check-payment-status',
			'sync-tax-assessment-bill-status',
			'update-check-timestamp',
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
		expect(noPaymentStep.executedStepNames).toContain('refresh-overdue-status')

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
		expect(withPaymentStep.executedStepNames).not.toContain('refresh-overdue-status')
	})

	it('syncs tax status when payment status transition marks bill as paid', async () => {
		checkPaymentStatusMock.mockResolvedValueOnce({
			markedPaid: true,
			statusBefore: 'issued',
			statusAfter: 'paid',
		})

		const { workflow, taxSyncMock } = createWorkflowAndContext()
		const { step } = createStep()

		await workflow.run({ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never, step)

		expect(taxSyncMock).toHaveBeenCalledWith('system:bills:payment-status-check', {
			id: 'bill-1',
			status: 'paid',
		})
	})

	it('syncs tax status when overdue status was marked and no payment was found', async () => {
		const { workflow, refreshBillLifecycleStatus, taxSyncMock } = createWorkflowAndContext()
		refreshBillLifecycleStatus.mockResolvedValueOnce({
			overdueMarked: true,
			lateFeeChanged: false,
			billStatus: 'overdue',
		})
		const { step } = createStep()

		await workflow.run({ payload: { billId: 'bill-1' }, instanceId: 'wf-1' } as never, step)

		expect(taxSyncMock).toHaveBeenCalledTimes(1)
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
	})
})
