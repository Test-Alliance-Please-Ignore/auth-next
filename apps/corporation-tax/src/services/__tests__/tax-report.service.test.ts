import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TaxReportService } from '../tax-report.service'

const getStubMock = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

function createSelectMock(
	results: Array<Array<{ corporationId: string }> | Array<Record<string, unknown>>>
) {
	return vi.fn(() => {
		const rows = results.shift() ?? []
		const chain: {
			from: ReturnType<typeof vi.fn>
			where: ReturnType<typeof vi.fn>
			groupBy: ReturnType<typeof vi.fn>
			orderBy: ReturnType<typeof vi.fn>
			limit: ReturnType<typeof vi.fn>
			offset: ReturnType<typeof vi.fn>
			then: <TResult1 = unknown, TResult2 = never>(
				onfulfilled?:
					| ((
							value: Array<{ corporationId: string }> | Array<Record<string, unknown>>
					  ) => TResult1 | PromiseLike<TResult1>)
					| null,
				onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
			) => Promise<TResult1 | TResult2>
		} = {
			from: vi.fn(() => chain),
			where: vi.fn(() => chain),
			groupBy: vi.fn(() => chain),
			orderBy: vi.fn(() => chain),
			limit: vi.fn(() => chain),
			offset: vi.fn(() => chain),
			then: (onfulfilled, onrejected) => Promise.resolve(rows).then(onfulfilled, onrejected),
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

	it('returns zeroed summary but still evaluates report datasets for excluded corporation scope', async () => {
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
		expect(mockDb.select).toHaveBeenCalled()
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
			[{ corporationId: '1001' }],
			[{ corporationId: '1001' }],
			[{ corporationId: '1001' }],
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
			[{ count: 1 }],
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

	it('uses SQL-counted totalRows for ESS payouts with the same scoped filters', async () => {
		mockDb.query.taxLedgerEntries.findMany.mockResolvedValue([
			{
				id: 'entry-1',
				corporationId: '1001',
				entryDate: new Date('2026-03-10T00:00:00.000Z'),
				division: 1,
				amount: '25.00',
				essBankType: 'main',
				sourceType: 'corporation_wallet_journal',
				sourcePrimaryId: '100',
				firstPartyId: '90000001',
				secondPartyId: null,
				refType: 'ess_escrow_transfer',
				isEss: true,
			},
		])
		mockDb.select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn().mockResolvedValue([{ count: 7 }]),
			})),
		}))

		const service = new TaxReportService(mockDb, {} as any)
		const report = await service.getEssPayoutReport({
			corporationId: '1001',
			limit: 1,
			offset: 0,
			sortBy: 'entryDate',
			sortDirection: 'desc',
		})

		expect(report.totalRows).toBe(7)
		expect(report.rows).toHaveLength(1)
		expect(report.rows[0]).toEqual(
			expect.objectContaining({
				id: 'entry-1',
				corporationId: '1001',
				amount: '25.00',
			})
		)
		expect(mockDb.query.taxLedgerEntries.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 1,
				offset: 0,
			})
		)
	})
})
