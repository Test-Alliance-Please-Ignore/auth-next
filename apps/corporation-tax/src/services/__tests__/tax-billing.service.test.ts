import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TaxBillingService } from '../tax-billing.service'

const getStubMock = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

function makeAssessment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'assessment-1',
		corporationId: '98000001',
		taxPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
		taxPeriodEnd: new Date('2026-03-31T23:59:59.999Z'),
		assessmentScope: 'corporation',
		scopeId: '98000001',
		taxableIncome: '1000',
		nonTaxableIncome: '0',
		taxDue: '100',
		taxPaid: '0',
		taxDelta: '100',
		status: 'underpaid',
		inGameTaxRateBps: null,
		portalTaxRateBps: 1000,
		billId: null,
		billStatus: null,
		billStatusLastSyncedAt: null,
		approvedBy: null,
		approvedAt: null,
		createdAt: new Date('2026-03-31T23:59:59.999Z'),
		updatedAt: new Date('2026-03-31T23:59:59.999Z'),
		...overrides,
	}
}

function makeBillingConfig(overrides: Record<string, unknown> = {}) {
	return {
		id: 'billing-config-1',
		corporationId: '98000001',
		isDefault: true,
		billingEnabled: true,
		billingIssuerUserId: '',
		billingPayeeId: '90000001',
		billingPayeeType: 'corporation',
		billingDueDays: 14,
		createdAt: new Date('2026-03-31T23:59:59.999Z'),
		updatedAt: new Date('2026-03-31T23:59:59.999Z'),
		...overrides,
	}
}

describe('TaxBillingService scope guardrails', () => {
	let mockDb: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockDb = {
			query: {
				taxAssessments: {
					findFirst: vi.fn(),
					findMany: vi.fn(),
				},
				taxCorporationBillingConfigs: {
					findFirst: vi.fn(),
				},
			},
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(() => ({
						returning: vi.fn(() => Promise.resolve([makeAssessment()])),
					})),
				})),
			})),
			insert: vi.fn(() => ({
				values: vi.fn(() => Promise.resolve()),
			})),
		}
	})

	it('rejects bill creation for non-corporation assessment scope', async () => {
		mockDb.query.taxAssessments.findFirst.mockResolvedValue(
			makeAssessment({
				assessmentScope: 'character',
				scopeId: '7001',
			})
		)

		const service = new TaxBillingService(mockDb, {} as DurableObjectNamespace)

		await expect(
			service.createBillsForAssessment('actor-1', '98000001', 'assessment-1')
		).rejects.toThrow('Only corporation-scope assessments can be billed')
		expect(getStubMock).not.toHaveBeenCalled()
	})

	it('rejects bill sync for non-corporation assessment scope', async () => {
		mockDb.query.taxAssessments.findFirst.mockResolvedValue(
			makeAssessment({
				assessmentScope: 'division',
				scopeId: '1',
				billId: 'bill-1',
				billStatus: 'issued',
			})
		)

		const service = new TaxBillingService(mockDb, {} as DurableObjectNamespace)

		await expect(
			service.syncAssessmentBillStatus('actor-1', '98000001', 'assessment-1')
		).rejects.toThrow('Only corporation-scope assessments can be billed')
		expect(getStubMock).not.toHaveBeenCalled()
	})

	it('rejects bill retraction for non-corporation assessment scope', async () => {
		mockDb.query.taxAssessments.findFirst.mockResolvedValue(
			makeAssessment({
				assessmentScope: 'division',
				scopeId: '1',
				billId: 'bill-1',
				billStatus: 'issued',
			})
		)

		const service = new TaxBillingService(mockDb, {} as DurableObjectNamespace)

		await expect(
			service.retractAssessmentBill('actor-1', '98000001', 'assessment-1')
		).rejects.toThrow('Only corporation-scope assessments can be billed')
		expect(getStubMock).not.toHaveBeenCalled()
	})

	it('ignores non-corporation rows when building corporation bill history', async () => {
		mockDb.query.taxAssessments.findMany.mockResolvedValue([
			makeAssessment({
				id: 'assessment-corp',
				billId: 'bill-corp',
				billStatus: 'issued',
			}),
			makeAssessment({
				id: 'assessment-char',
				assessmentScope: 'character',
				scopeId: '7001',
				billId: 'bill-char',
				billStatus: 'issued',
			}),
		])

		const billsStub = {
			getBillTimeline: vi.fn().mockResolvedValue([
				{
					id: 'event-1',
					billId: 'bill-corp',
					eventType: 'issued',
					fromStatus: 'draft',
					toStatus: 'issued',
					actorUserId: 'actor-1',
					metadata: null,
					createdAt: new Date('2026-04-01T00:00:00.000Z'),
				},
			]),
		}
		getStubMock.mockReturnValue(billsStub)

		const service = new TaxBillingService(mockDb, {} as DurableObjectNamespace)
		const result = await service.getCorporationBillStatusHistory('98000001')

		expect(result).toHaveLength(1)
		expect(result[0]?.assessment.id).toBe('assessment-corp')
		expect(billsStub.getBillTimeline).toHaveBeenCalledTimes(1)
		expect(billsStub.getBillTimeline).toHaveBeenCalledWith('bill-corp')
	})

	it('skips non-corporation rows during bulk status sync', async () => {
		mockDb.query.taxAssessments.findMany.mockResolvedValue([
			makeAssessment({
				id: 'assessment-char',
				assessmentScope: 'character',
				scopeId: '7001',
				billId: 'bill-char',
				billStatus: 'issued',
			}),
			makeAssessment({
				id: 'assessment-corp',
				billId: 'bill-corp',
				billStatus: 'issued',
			}),
		])

		const billsStub = {
			getBillIntegrationView: vi.fn().mockResolvedValue({
				id: 'bill-corp',
				status: 'paid',
				paidAt: new Date('2026-04-02T00:00:00.000Z'),
			}),
		}
		getStubMock.mockReturnValue(billsStub)

		const service = new TaxBillingService(mockDb, {} as DurableObjectNamespace)
		const result = await service.syncCorporationBillStatuses('actor-1', '98000001')

		expect(result.processedAssessmentIds).toEqual(['assessment-char', 'assessment-corp'])
		expect(result.updatedAssessmentIds).toEqual(['assessment-corp'])
		expect(result.skippedAssessmentIds).toEqual(['assessment-char'])
		expect(billsStub.getBillIntegrationView).toHaveBeenCalledTimes(1)
		expect(billsStub.getBillIntegrationView).toHaveBeenCalledWith('bill-corp')
	})

	it('retracts linked bill and records sync event', async () => {
		const current = makeAssessment({
			billId: 'bill-1',
			billStatus: 'issued',
		})
		const updated = makeAssessment({
			billId: 'bill-1',
			billStatus: 'cancelled',
		})

		mockDb.query.taxAssessments.findFirst.mockResolvedValue(current)
		mockDb.query.taxCorporationBillingConfigs.findFirst.mockResolvedValue(makeBillingConfig())
		mockDb.update.mockReturnValue({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(() => Promise.resolve([updated])),
				})),
			})),
		})

		const billsStub = {
			cancelBill: vi.fn().mockResolvedValue({
				id: 'bill-1',
				status: 'cancelled',
			}),
		}
		getStubMock.mockReturnValue(billsStub)

		const service = new TaxBillingService(mockDb, {} as DurableObjectNamespace)
		const result = await service.retractAssessmentBill('actor-1', '98000001', 'assessment-1')

		expect(billsStub.cancelBill).toHaveBeenCalledWith('actor-1', 'bill-1')
		expect(result.billStatus).toBe('cancelled')
		expect(mockDb.insert).toHaveBeenCalledTimes(1)
	})

	it('fails bill creation when default billing config is missing', async () => {
		mockDb.query.taxAssessments.findFirst.mockResolvedValue(makeAssessment())
		mockDb.query.taxCorporationBillingConfigs.findFirst.mockResolvedValue(null)

		const service = new TaxBillingService(mockDb, {} as DurableObjectNamespace)

		await expect(
			service.createBillsForAssessment('actor-1', '98000001', 'assessment-1')
		).rejects.toThrow('Default billing configuration not found for this corporation')
	})

	it('fails bill creation when default billing config is disabled', async () => {
		mockDb.query.taxAssessments.findFirst.mockResolvedValue(makeAssessment())
		mockDb.query.taxCorporationBillingConfigs.findFirst.mockResolvedValue(
			makeBillingConfig({ billingEnabled: false })
		)

		const service = new TaxBillingService(mockDb, {} as DurableObjectNamespace)

		await expect(
			service.createBillsForAssessment('actor-1', '98000001', 'assessment-1')
		).rejects.toThrow('Default billing configuration is disabled for this corporation')
	})

	it('fails bill creation when default billing config payee is incomplete', async () => {
		mockDb.query.taxAssessments.findFirst.mockResolvedValue(makeAssessment())
		mockDb.query.taxCorporationBillingConfigs.findFirst.mockResolvedValue(
			makeBillingConfig({
				billingPayeeId: '',
				billingPayeeType: '',
			})
		)

		const service = new TaxBillingService(mockDb, {} as DurableObjectNamespace)

		await expect(
			service.createBillsForAssessment('actor-1', '98000001', 'assessment-1')
		).rejects.toThrow('Billing payee configuration is incomplete')
	})
})
