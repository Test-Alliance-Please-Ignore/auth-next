import { describe, expect, it, vi } from 'vitest'

import { TaxLedgerService } from '../tax-ledger.service'

const getStubMock = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

describe('TaxLedgerService ESS quality signals', () => {
	it('reports duplicate and missing ESS source records from an ingestion batch', () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		const result = (service as any).summarizeEssQualitySignals([
			{ isEss: true, sourceKey: 'ess-1', essBankType: 'main' },
			{ isEss: true, sourceKey: 'ess-1', essBankType: 'main' },
			{ isEss: true, sourceKey: 'ess-2', essBankType: null },
			{ isEss: true, sourceKey: 'ess-2', essBankType: null },
			{ isEss: false, sourceKey: 'non-ess-1', essBankType: null },
		])

		expect(result).toEqual({
			duplicateRecordCount: 2,
			duplicateSourceKeys: ['ess-1', 'ess-2'],
			missingRecordCount: 2,
			missingSourceKeys: ['ess-2'],
		})
	})

	it('returns zero signals when ESS rows are clean or absent', () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		const result = (service as any).summarizeEssQualitySignals([
			{ isEss: true, sourceKey: 'ess-clean', essBankType: 'reserve' },
			{ isEss: false, sourceKey: 'non-ess-1', essBankType: null },
		])

		expect(result).toEqual({
			duplicateRecordCount: 0,
			duplicateSourceKeys: [],
			missingRecordCount: 0,
			missingSourceKeys: [],
		})
	})
})

describe('TaxLedgerService unexpected income ref type signals', () => {
	it('captures positive non-allowlisted journal ref types and dedupes by ref type', () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		const result = (service as any).summarizeUnexpectedPositiveRefTypeSignals(
			'98000001',
			[
				{
					division: 1,
					journalId: '1001',
					refType: 'unexpected_new_income',
					amount: '1250000',
					date: new Date('2026-03-20T00:00:00.000Z'),
				},
				{
					division: 1,
					journalId: '1002',
					refType: 'unexpected_new_income',
					amount: '500000',
					date: new Date('2026-03-20T01:00:00.000Z'),
				},
				{
					division: 1,
					journalId: '1003',
					refType: 'unexpected_new_income',
					amount: '-100000',
					date: new Date('2026-03-20T02:00:00.000Z'),
				},
				{
					division: 1,
					journalId: '1004',
					refType: 'market_transaction',
					amount: '250000',
					date: new Date('2026-03-20T03:00:00.000Z'),
				},
			],
			[
				{
					characterId: '9001',
					row: {
						journalId: '2001',
						date: new Date('2026-03-20T04:00:00.000Z'),
						refType: 'brand_new_ref_type',
						amount: '10000',
						balance: '0',
						description: '',
					},
				},
			]
		)

		expect(result).toEqual([
			{
				refType: 'brand_new_ref_type',
				entryCount: 1,
				sampleSourceType: 'character_wallet_journal',
				sampleSourceKey: '98000001:character-journal:9001:2001',
				sampleAmount: '10000',
				sampleEntryDate: new Date('2026-03-20T04:00:00.000Z'),
			},
			{
				refType: 'unexpected_new_income',
				entryCount: 2,
				sampleSourceType: 'corporation_wallet_journal',
				sampleSourceKey: '98000001:journal:1:1001',
				sampleAmount: '1250000',
				sampleEntryDate: new Date('2026-03-20T00:00:00.000Z'),
			},
		])
	})
})
