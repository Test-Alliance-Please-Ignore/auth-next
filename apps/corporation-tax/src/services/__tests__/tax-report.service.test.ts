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
			innerJoin: ReturnType<typeof vi.fn>
			leftJoin: ReturnType<typeof vi.fn>
			orderBy: ReturnType<typeof vi.fn>
			limit: ReturnType<typeof vi.fn>
			offset: ReturnType<typeof vi.fn>
			as: ReturnType<typeof vi.fn>
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
			innerJoin: vi.fn(() => chain),
			leftJoin: vi.fn(() => chain),
			orderBy: vi.fn(() => chain),
			limit: vi.fn(() => chain),
			offset: vi.fn(() => chain),
			as: vi.fn(() => chain),
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

	it('reads assessed monthly income from assessment rollups', async () => {
		mockDb.execute = vi.fn().mockResolvedValue({
			rows: [
				{
					month_start: '2026-07-01T00:00:00.000Z',
					ref_type: 'bounty_prizes',
					entry_count: 12,
					ess_entry_count: 0,
					total_income: '123.45',
				},
			],
		})

		const service = new TaxReportService(mockDb, {} as any)
		const rows = await service.getTopIncomeSourcesMonthlyReport({
			corporationId: '1001',
			incomeMode: 'assessed',
		})

		expect(rows).toEqual([
			expect.objectContaining({
				monthStart: new Date('2026-07-01T00:00:00.000Z'),
				refType: 'bounty_prizes',
				entryCount: 12,
				totalIncome: '123.45',
			}),
		])
		expect(mockDb.execute).toHaveBeenCalledOnce()
	})

	it('aggregates assessed income sources for the non-monthly export shape', async () => {
		mockDb.execute = vi.fn().mockResolvedValue({
			rows: [
				{
					month_start: '2026-07-01T00:00:00.000Z',
					ref_type: 'bounty_prizes',
					entry_count: 3,
					ess_entry_count: 0,
					total_income: '100.00',
				},
				{
					month_start: '2026-08-01T00:00:00.000Z',
					ref_type: 'bounty_prizes',
					entry_count: 2,
					ess_entry_count: 0,
					total_income: '25.50',
				},
				{
					month_start: '2026-08-01T00:00:00.000Z',
					ref_type: 'ess_escrow_transfer',
					entry_count: 1,
					ess_entry_count: 1,
					total_income: '200.00',
				},
			],
		})

		const service = new TaxReportService(mockDb, {} as any)
		const rows = await service.getTopIncomeSourcesReport({
			corporationId: '1001',
			incomeMode: 'assessed',
		})

		expect(rows).toEqual([
			{
				refType: 'ess_escrow_transfer',
				entryCount: 1,
				essEntryCount: 1,
				totalIncome: '200.00',
			},
			{
				refType: 'bounty_prizes',
				entryCount: 5,
				essEntryCount: 0,
				totalIncome: '125.50',
			},
		])
	})

	it('aggregates current character wallet income with positive-only predicates', async () => {
		mockDb.execute = vi.fn().mockResolvedValue({
			rows: [
				{
					month_start: '2026-07-01T00:00:00.000Z',
					ref_type: 'bounty_prizes',
					entry_count: 3,
					ess_entry_count: 0,
					total_income: '450.00',
				},
				{
					month_start: '2026-07-01T00:00:00.000Z',
					ref_type: 'market_transaction',
					entry_count: 1,
					ess_entry_count: 0,
					total_income: '125.00',
				},
			],
		})

		const service = new TaxReportService(mockDb, {} as any)
		const rows = await service.getTopIncomeSourcesMonthlyReport({
			corporationId: '1001',
			walletSource: 'character',
			fromDate: new Date('2026-07-01T00:00:00.000Z'),
			toDate: new Date('2026-07-31T23:59:59.999Z'),
		})

		expect(rows).toEqual([
			expect.objectContaining({ refType: 'bounty_prizes', totalIncome: '450.00' }),
			expect.objectContaining({ refType: 'market_transaction', totalIncome: '125.00' }),
		])
		expect(mockDb.execute).toHaveBeenCalledOnce()
		const query = mockDb.execute.mock.calls[0][0]
		const queryText = JSON.stringify(query.queryChunks)
		expect(queryText).toContain('CAST(cwj.amount AS numeric) > 0')
		expect(queryText).toContain('cmt.is_buy = FALSE')
		expect(queryText).toContain('CAST(cmt.unit_price AS numeric) * cmt.quantity > 0')
		expect(queryText).toContain('mc.is_active = TRUE')
		expect(queryText).toContain('mc.is_member_corporation = TRUE')
	})

	it('aggregates total taxes by corporation from data-backed scope and applies paging', async () => {
		mockDb.select = createSelectMock([
			[{ corporationId: '1001' }],
			[{ corporationId: '1001' }],
			[{ corporationId: '1001' }],
			[],
			[
				{
					corporationId: '1001',
					taxableItemCount: 137,
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
				taxableItemCount: 137,
				assessmentCount: 4,
				taxDue: '500.00',
				taxPaid: '450.00',
				taxDelta: '50.00',
			}),
		])
	})

	it('counts distinct assessment periods in member rollups', async () => {
		const characterId = '2123456789'
		const finalizedRows = [
			{
				rollupDate: new Date('2026-06-30T00:00:00.000Z'),
				characterId,
				refType: 'bounty_prizes',
				periodStart: new Date('2026-06-01T00:00:00.000Z'),
				periodEnd: new Date('2026-06-30T23:59:59.999Z'),
				contributionIncome: '100.00',
				taxableContributionIncome: '100.00',
				sourceRowCount: 1,
				lastAssessmentAt: new Date('2026-07-01T00:00:00.000Z'),
			},
			{
				rollupDate: new Date('2026-06-30T00:00:00.000Z'),
				characterId,
				refType: 'bounty_prizes',
				periodStart: new Date('2026-06-01T00:00:00.000Z'),
				periodEnd: new Date('2026-06-30T23:59:59.999Z'),
				contributionIncome: '50.00',
				taxableContributionIncome: '50.00',
				sourceRowCount: 1,
				lastAssessmentAt: new Date('2026-07-01T00:00:00.000Z'),
			},
			{
				rollupDate: new Date('2026-07-31T00:00:00.000Z'),
				characterId,
				refType: 'bounty_prizes',
				periodStart: new Date('2026-07-01T00:00:00.000Z'),
				periodEnd: new Date('2026-07-31T23:59:59.999Z'),
				contributionIncome: '75.00',
				taxableContributionIncome: '75.00',
				sourceRowCount: 1,
				lastAssessmentAt: new Date('2026-08-01T00:00:00.000Z'),
			},
		]
		mockDb.query.taxMemberContributionFinalizedRollups = {
			findMany: vi.fn().mockResolvedValue(finalizedRows),
		}
		mockDb.query.taxMemberContributionProjectionRollups = {
			findMany: vi.fn().mockResolvedValue([]),
		}

		const service = new TaxReportService(mockDb, {} as any)
		const rows = await (service as any).getMemberSummaryFromRollups({
			corporationId: '1001',
			scopedCharacterIds: [],
			scopedCharacterIdSet: new Set<string>(),
			includeUnattributedRow: false,
			topRefTypesLimit: 5,
		})

		expect(rows).toHaveLength(1)
		expect(rows[0]).toEqual(
			expect.objectContaining({
				characterId,
				assessmentCount: 2,
				contributionIncome: '225.00',
			})
		)
	})

	it('uses SQL-counted totalRows for ESS payouts with the same scoped filters', async () => {
		mockDb.query.taxLedgerEntries.findMany.mockResolvedValue([
			{
				id: 'entry-1',
				corporationId: '1001',
				entryDate: new Date('2026-03-10T00:00:00.000Z'),
				division: 1,
				amount: '25.00',
				sourceType: 'corporation_wallet_journal',
				sourcePrimaryId: '100',
				firstPartyId: '90000001',
				secondPartyId: null,
				refType: 'ess_escrow_transfer',
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

	it('returns assessment-level bill status rows with bill-derived paid totals', async () => {
		mockDb.select = createSelectMock([
			[
				{
					assessmentId: 'assessment-1',
					corporationId: '1001',
					taxPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
					taxPeriodEnd: new Date('2026-03-31T23:59:59.999Z'),
					billId: 'bill-1',
					billStatus: 'issued',
					issueDate: new Date('2026-04-01T00:00:00.000Z'),
					dueDate: new Date('2026-04-14T00:00:00.000Z'),
					taxDue: '500.00',
					taxPaid: '250.00',
					taxDelta: '250.00',
				},
			],
			[{ count: 1 }],
		])

		const service = new TaxReportService(mockDb, {} as any)
		const report = await service.getBillStatusReport({
			corporationId: '1001',
			sortBy: 'dueDate',
			sortDirection: 'asc',
			limit: 25,
			offset: 0,
		})

		expect(report.totalRows).toBe(1)
		expect(report.rows).toEqual([
			expect.objectContaining({
				assessmentId: 'assessment-1',
				corporationId: '1001',
				billId: 'bill-1',
				billStatus: 'issued',
				taxDue: '500.00',
				taxPaid: '250.00',
				taxDelta: '250.00',
			}),
		])
	})

	it('checks ESI coverage only for active, taxable member corporations', async () => {
		mockDb.select = createSelectMock([[{ corporationId: '1001' }, { corporationId: '1002' }]])
		const status = {
			corporationId: '1001',
			isConfigured: true,
			isVerified: true,
			lastVerified: new Date('2026-08-01T00:00:00.000Z'),
			directorCount: 1,
			healthyDirectorCount: 1,
			requiredScopes: ['esi-corporations.read_wallets.v1'],
			missingRequiredScopes: [],
			hasRequiredScopes: true,
			hasCorporationWalletScope: true,
			hasCharacterWalletScope: false,
			hasCorporationMembershipScope: true,
			grantedScopeCount: 2,
		}
		getStubMock.mockImplementation((_namespace: unknown, corporationId: string) => ({
			getCorporationAuthStatus: vi
				.fn()
				.mockResolvedValue(
					corporationId === '1001' ? status : { ...status, corporationId, isConfigured: false }
				),
		}))

		const service = new TaxReportService(mockDb, {} as any)
		const report = await service.getMissingEsiKeysReport()

		expect(report.totalRows).toBe(1)
		expect(report.rows).toEqual([
			expect.objectContaining({
				corporationId: '1002',
				isConfigured: false,
			}),
		])
		expect(getStubMock).toHaveBeenCalledTimes(2)
	})
})
