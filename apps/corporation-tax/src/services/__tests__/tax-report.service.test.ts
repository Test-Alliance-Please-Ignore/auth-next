import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TaxReportService } from '../tax-report.service'

describe('TaxReportService inclusion scoping', () => {
	let mockDb: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockDb = {
			select: vi.fn(),
			query: {
				taxCorporationSettings: {
					findFirst: vi.fn(),
					findMany: vi.fn(),
				},
				taxAssessments: {
					findMany: vi.fn(),
				},
				taxAssessmentLines: {
					findMany: vi.fn(),
				},
				taxDiscrepancies: {
					findMany: vi.fn(),
				},
				taxLedgerEntries: {
					findMany: vi.fn(),
				},
				taxDailyRollups: {
					findMany: vi.fn(),
				},
			},
		}
	})

	it('returns zeroed summary and skips dataset queries for excluded corporation scope', async () => {
		mockDb.query.taxCorporationSettings.findFirst.mockResolvedValue({
			corporationId: '3002',
			included: false,
		})
		mockDb.query.taxCorporationSettings.findMany.mockResolvedValue([
			{
				corporationId: '3002',
				included: false,
			},
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

	it('returns empty top-income report when there are no included corporations', async () => {
		mockDb.query.taxCorporationSettings.findMany.mockResolvedValue([])
		const service = new TaxReportService(mockDb, {} as any)

		const rows = await service.getTopIncomeSourcesReport()

		expect(rows).toEqual([])
		expect(mockDb.query.taxLedgerEntries.findMany).not.toHaveBeenCalled()
	})

	it('applies amount thresholds for top-income aggregation', async () => {
		mockDb.query.taxCorporationSettings.findFirst.mockResolvedValue({
			corporationId: '3001',
			included: true,
		})
		mockDb.query.taxLedgerEntries.findMany.mockResolvedValue([
			{ refType: 'bounty_prizes', amount: '5.00', isEss: false },
			{ refType: 'bounty_prizes', amount: '15.00', isEss: false },
			{ refType: 'ess_escrow_transfer', amount: '17.50', isEss: true },
			{ refType: 'bounty_prizes', amount: '25.00', isEss: false },
		])

		const service = new TaxReportService(mockDb, {} as any)
		const rows = await service.getTopIncomeSourcesReport({
			corporationId: '3001',
			minAmount: '10.00',
			maxAmount: '20.00',
		})

		expect(rows).toEqual([
			{
				refType: 'ess_escrow_transfer',
				entryCount: 1,
				essEntryCount: 1,
				totalIncome: '17.50',
			},
			{
				refType: 'bounty_prizes',
				entryCount: 1,
				essEntryCount: 0,
				totalIncome: '15.00',
			},
		])
	})

	it('sorts ESS payout report by amount after applying amount thresholds', async () => {
		mockDb.query.taxCorporationSettings.findFirst.mockResolvedValue({
			corporationId: '3001',
			included: true,
		})
		mockDb.query.taxLedgerEntries.findMany.mockResolvedValue([
			{
				id: 'ess-1',
				corporationId: '3001',
				entryDate: new Date('2026-03-10T00:00:00.000Z'),
				division: 1,
				amount: '100.00',
				essBankType: 'main',
				sourceType: 'corporation_wallet_journal',
				sourcePrimaryId: 'jp-1',
				firstPartyId: '9001',
				secondPartyId: '9002',
			},
			{
				id: 'ess-2',
				corporationId: '3001',
				entryDate: new Date('2026-03-11T00:00:00.000Z'),
				division: 1,
				amount: '40.00',
				essBankType: 'reserve',
				sourceType: 'corporation_wallet_journal',
				sourcePrimaryId: 'jp-2',
				firstPartyId: '9001',
				secondPartyId: '9002',
			},
			{
				id: 'ess-3',
				corporationId: '3001',
				entryDate: new Date('2026-03-12T00:00:00.000Z'),
				division: 1,
				amount: '200.00',
				essBankType: 'main',
				sourceType: 'corporation_wallet_journal',
				sourcePrimaryId: 'jp-3',
				firstPartyId: '9001',
				secondPartyId: '9002',
			},
		])

		const service = new TaxReportService(mockDb, {} as any)
		const rows = await service.getEssPayoutReport({
			corporationId: '3001',
			sortBy: 'amount',
			sortDirection: 'asc',
			minAmount: '50.00',
			maxAmount: '150.00',
		})

		expect(rows).toEqual([
			expect.objectContaining({
				id: 'ess-1',
				amount: '100.00',
			}),
		])
	})

	it('applies pagination after SQL aggregation for total-taxes report', async () => {
		mockDb.query.taxCorporationSettings.findMany.mockResolvedValue([
			{ corporationId: '1001', included: true },
			{ corporationId: '1002', included: true },
		])

		const groupBy = vi.fn().mockResolvedValue([
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
				taxDue: '200.00',
				taxPaid: '180.00',
				taxDelta: '20.00',
				lastAssessmentAt: new Date('2026-03-10T00:00:00.000Z'),
			},
			{
				corporationId: '1002',
				assessmentCount: 3,
				billedAssessmentCount: 1,
				underpaidCount: 1,
				paidCount: 1,
				overpaidCount: 1,
				draftCount: 0,
				excludedCount: 0,
				taxableIncome: '2000.00',
				taxDue: '500.00',
				taxPaid: '450.00',
				taxDelta: '50.00',
				lastAssessmentAt: new Date('2026-03-11T00:00:00.000Z'),
			},
		])
		const where = vi.fn().mockReturnValue({ groupBy })
		const from = vi.fn().mockReturnValue({ where })
		mockDb.select.mockReturnValue({ from })

		const service = new TaxReportService(mockDb, {} as any)
		const rows = await service.getTotalTaxesByCorporationReport({
			sortBy: 'taxDue',
			sortDirection: 'desc',
			limit: 1,
			offset: 1,
		})

		expect(rows).toEqual([
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
				taxDue: '200.00',
				taxPaid: '180.00',
				taxDelta: '20.00',
				lastAssessmentAt: new Date('2026-03-10T00:00:00.000Z'),
			},
		])
	})

	it('aggregates member summary from corporation-wallet attributed contributions', async () => {
		mockDb.query.taxCorporationSettings.findFirst.mockResolvedValue({
			corporationId: '3001',
			included: true,
		})
		mockDb.query.taxAssessments.findMany.mockResolvedValue([
			{
				id: 'assessment-1',
				corporationId: '3001',
				assessmentScope: 'corporation',
				taxPeriodEnd: new Date('2026-03-15T00:00:00.000Z'),
				createdAt: new Date('2026-03-15T00:00:00.000Z'),
			},
		])
		mockDb.query.taxAssessmentLines.findMany.mockResolvedValue([
			{
				assessmentId: 'assessment-1',
				ledgerEntryId: 'ledger-1',
				taxableAmount: '70.00',
				taxAmount: '7.00',
			},
			{
				assessmentId: 'assessment-1',
				ledgerEntryId: 'ledger-2',
				taxableAmount: '50.00',
				taxAmount: '5.00',
			},
		])
		mockDb.query.taxLedgerEntries.findMany.mockResolvedValue([
			{
				id: 'ledger-1',
				sourceType: 'corporation_wallet_journal',
				refType: 'bounty_prizes',
				firstPartyId: '9001',
				secondPartyId: '7000',
				amount: '100.00',
			},
			{
				id: 'ledger-2',
				sourceType: 'corporation_wallet_transaction',
				refType: 'market_transaction',
				firstPartyId: null,
				secondPartyId: '9999',
				amount: '50.00',
			},
		])

		const settingsService = {
			getCorporationMemberIds: vi.fn().mockResolvedValue(['9001']),
		}
		const service = new TaxReportService(mockDb, settingsService as any)

		const rows = await service.getMemberSummaryReport({
			corporationId: '3001',
		})

		expect(rows).toEqual([
			expect.objectContaining({
				characterId: '__unattributed__',
				contributionIncome: '50.00',
				taxableContributionIncome: '50.00',
				assessmentCount: 1,
			}),
			expect.objectContaining({
				characterId: '9001',
				contributionIncome: '100.00',
				taxableContributionIncome: '70.00',
				assessmentCount: 1,
			}),
		])
	})

	it('returns only requested member rows when character filter is provided', async () => {
		mockDb.query.taxCorporationSettings.findFirst.mockResolvedValue({
			corporationId: '3001',
			included: true,
		})
		mockDb.query.taxAssessments.findMany.mockResolvedValue([
			{
				id: 'assessment-1',
				corporationId: '3001',
				assessmentScope: 'corporation',
				taxPeriodEnd: new Date('2026-03-15T00:00:00.000Z'),
				createdAt: new Date('2026-03-15T00:00:00.000Z'),
			},
		])
		mockDb.query.taxAssessmentLines.findMany.mockResolvedValue([
			{
				assessmentId: 'assessment-1',
				ledgerEntryId: 'ledger-1',
				taxableAmount: '10.00',
				taxAmount: '1.00',
			},
			{
				assessmentId: 'assessment-1',
				ledgerEntryId: 'ledger-2',
				taxableAmount: '20.00',
				taxAmount: '2.00',
			},
		])
		mockDb.query.taxLedgerEntries.findMany.mockResolvedValue([
			{
				id: 'ledger-1',
				sourceType: 'corporation_wallet_journal',
				refType: 'bounty_prizes',
				firstPartyId: '9001',
				secondPartyId: null,
				amount: '10.00',
			},
			{
				id: 'ledger-2',
				sourceType: 'corporation_wallet_journal',
				refType: 'bounty_prizes',
				firstPartyId: '9002',
				secondPartyId: null,
				amount: '20.00',
			},
		])

		const settingsService = {
			getCorporationMemberIds: vi.fn().mockResolvedValue(['9001', '9002']),
		}
		const service = new TaxReportService(mockDb, settingsService as any)

		const rows = await service.getMemberSummaryReport({
			corporationId: '3001',
			characterIds: ['9002'],
		})

		expect(rows).toEqual([
			expect.objectContaining({
				characterId: '9002',
				contributionIncome: '20.00',
				taxableContributionIncome: '20.00',
			}),
		])
	})
})
