import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TaxReportService } from '../tax-report.service'

const getStubMock = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

function createSelectMock(results: Array<Array<{ corporationId: string }> | Array<Record<string, unknown>>>) {
	return vi.fn(() => {
		const rows = results.shift() ?? []
		const chain: {
			from: ReturnType<typeof vi.fn>
			where: ReturnType<typeof vi.fn>
			groupBy: ReturnType<typeof vi.fn>
		} = {
			from: vi.fn(() => chain),
			where: vi.fn(() => chain),
			groupBy: vi.fn().mockResolvedValue(rows),
		}
		return chain
	})
}

describe('TaxReportService report scoping', () => {
	let mockDb: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockDb = {
			select: createSelectMock([[], [], []]),
			query: {
				taxCorporationExclusions: {
					findFirst: vi.fn().mockResolvedValue(null),
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxAssessments: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxDiscrepancies: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxLedgerEntries: {
					findMany: vi.fn().mockResolvedValue([]),
				},
				taxDailyRollups: {
					findMany: vi.fn().mockResolvedValue([]),
				},
			},
		}
	})

	it('returns zeroed summary and skips dataset queries for excluded corporation scope', async () => {
		mockDb.query.taxCorporationExclusions.findFirst.mockResolvedValue({
			corporationId: '3002',
		})
		mockDb.query.taxCorporationExclusions.findMany.mockResolvedValue([
			{ corporationId: '3002', reason: 'maintenance' },
		])

		const service = new TaxReportService(mockDb, {} as any)
		const result = await service.getSummaryReport({ corporationId: '3002' })

		expect(result).toEqual({
			corporationId: '3002',
			fromDate: null,
			toDate: null,
			assessmentCount: 0,
			discrepancyOpenCount: 0,
			includedCorporationCount: 0,
			excludedCorporationCount: 1,
			billedAssessmentCount: 0,
			taxableIncome: '0.00',
			taxDue: '0.00',
			taxPaid: '0.00',
			taxDelta: '0.00',
			essIncome: '0.00',
			essTransferCount: 0,
		})
		expect(mockDb.query.taxAssessments.findMany).not.toHaveBeenCalled()
		expect(mockDb.query.taxDiscrepancies.findMany).not.toHaveBeenCalled()
		expect(mockDb.query.taxLedgerEntries.findMany).not.toHaveBeenCalled()
	})

	it('returns empty top-income report when there is no data-backed corporation scope', async () => {
		mockDb.select = createSelectMock([[], [], []])
		mockDb.query.taxCorporationExclusions.findMany.mockResolvedValue([])

		const service = new TaxReportService(mockDb, {} as any)
		const rows = await service.getTopIncomeSourcesReport()

		expect(rows).toEqual([])
		expect(mockDb.query.taxLedgerEntries.findMany).not.toHaveBeenCalled()
	})

	it('aggregates total taxes by corporation from data-backed scope and applies paging', async () => {
		mockDb.select = createSelectMock([
			[],
			[{ corporationId: '1001' }],
			[],
			[
				{
					corporationId: '1001',
					assessmentCount: 4,
					billedAssessmentCount: 2,
					underpaidCount: 1,
					paidCount: 2,
					overpaidCount: 1,
					draftCount: 0,
					excludedCount: 0,
					taxableIncome: '1000.00',
					taxDue: '500.00',
					taxPaid: '450.00',
					taxDelta: '50.00',
					lastAssessmentAt: new Date('2026-03-10T00:00:00.000Z'),
				},
			],
		])
		mockDb.query.taxCorporationExclusions.findMany.mockResolvedValue([])

		const service = new TaxReportService(mockDb, {} as any)
		const report = await service.getTotalTaxesByCorporationReport({
			sortBy: 'taxDue',
			sortDirection: 'desc',
			limit: 25,
			offset: 0,
		})

		expect(report.totalRows).toBe(1)
		expect(report.rows).toEqual([
			expect.objectContaining({
				corporationId: '1001',
				assessmentCount: 4,
				taxDue: '500.00',
				taxPaid: '450.00',
				taxDelta: '50.00',
			}),
		])
	})
})
