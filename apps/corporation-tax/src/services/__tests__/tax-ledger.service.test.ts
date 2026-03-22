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
			{ refType: 'ess_escrow_transfer', sourceKey: 'ess-1' },
			{ refType: 'ess_escrow_transfer', sourceKey: 'ess-1' },
			{ refType: 'ess_escrow_transfer', sourceKey: 'ess-2' },
			{ refType: 'ess_escrow_transfer', sourceKey: 'ess-2' },
			{ refType: 'bounty_prizes', sourceKey: 'non-ess-1' },
		])

		expect(result).toEqual({
			duplicateRecordCount: 2,
			duplicateSourceKeys: ['ess-1', 'ess-2'],
			missingRecordCount: 0,
			missingSourceKeys: [],
		})
	})

	it('returns zero signals when ESS rows are clean or absent', () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		const result = (service as any).summarizeEssQualitySignals([
			{ refType: 'ess_escrow_transfer', sourceKey: 'ess-clean' },
			{ refType: 'bounty_prizes', sourceKey: 'non-ess-1' },
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

describe('TaxLedgerService transaction amount arithmetic', () => {
	it('converts market transaction amounts with exact cent math', () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		const sellAmount = (service as any).toSignedTransactionAmount('0.10', 3, false)
		const buyAmount = (service as any).toSignedTransactionAmount('123456.78', 2, true)

		expect(sellAmount).toBe('0.30')
		expect(buyAmount).toBe('-246913.56')
	})

	it('returns neutral zero for invalid price/quantity transaction inputs', () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		expect((service as any).toSignedTransactionAmount('', 10, false)).toBe('0')
		expect((service as any).toSignedTransactionAmount('1500.00', Number.NaN, false)).toBe('0')
		expect((service as any).toSignedTransactionAmount('1500.00', -3, false)).toBe('0')
	})
})

describe('TaxLedgerService window paging', () => {
	it('iterates all pages when no explicit limit/offset is provided', async () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		const page0 = Array.from({ length: 1000 }, (_value, index) => ({ id: index }))
		const page1 = Array.from({ length: 1000 }, (_value, index) => ({ id: index + 1000 }))
		const page2 = Array.from({ length: 200 }, (_value, index) => ({ id: index + 2000 }))
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce(page0)
			.mockResolvedValueOnce(page1)
			.mockResolvedValueOnce(page2)

		const rows = await (service as any).fetchWindowPages({}, fetchPage)

		expect(rows).toHaveLength(2200)
		expect(fetchPage).toHaveBeenNthCalledWith(1, { limit: 1000, offset: 0 })
		expect(fetchPage).toHaveBeenNthCalledWith(2, { limit: 1000, offset: 1000 })
		expect(fetchPage).toHaveBeenNthCalledWith(3, { limit: 1000, offset: 2000 })
	})

	it('uses a single fetch when explicit limit/offset is provided', async () => {
		const service = new TaxLedgerService(
			{} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)

		const fetchPage = vi.fn().mockResolvedValue([{ id: 1 }])

		const rows = await (service as any).fetchWindowPages({ limit: 25, offset: 50 }, fetchPage)

		expect(rows).toEqual([{ id: 1 }])
		expect(fetchPage).toHaveBeenCalledTimes(1)
		expect(fetchPage).toHaveBeenCalledWith({ limit: 25, offset: 50 })
	})
})

describe('TaxLedgerService checkpoint preservation', () => {
	it('does not overwrite cursor/lastSeenAt with null values on conflict update', async () => {
		let conflictSet: Record<string, unknown> | undefined
		const onConflictDoUpdate = vi.fn((args: { set: Record<string, unknown> }) => {
			conflictSet = args.set
			return Promise.resolve()
		})
		const values = vi.fn(() => ({
			onConflictDoUpdate,
		}))
		const insert = vi.fn(() => ({
			values,
		}))
		const service = new TaxLedgerService(
			{ insert } as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)
		const syncAt = new Date('2026-03-21T00:00:00.000Z')

		await (service as any).upsertCheckpoint('98000001', 'corporation_wallet_journal', {
			cursor: null,
			lastSeenAt: null,
			lastSuccessfulSyncAt: syncAt,
			lastError: null,
		})

		expect(insert).toHaveBeenCalledTimes(1)
		expect(values).toHaveBeenCalledTimes(1)
		expect(onConflictDoUpdate).toHaveBeenCalledTimes(1)
		expect(conflictSet).toBeDefined()
		expect(conflictSet).toMatchObject({
			lastSuccessfulSyncAt: syncAt,
			lastError: null,
		})
		expect(conflictSet).not.toHaveProperty('cursor')
		expect(conflictSet).not.toHaveProperty('lastSeenAt')
	})

	it('updates cursor/lastSeenAt when non-null values are provided', async () => {
		let conflictSet: Record<string, unknown> | undefined
		const onConflictDoUpdate = vi.fn((args: { set: Record<string, unknown> }) => {
			conflictSet = args.set
			return Promise.resolve()
		})
		const service = new TaxLedgerService(
			{
				insert: vi.fn(() => ({
					values: vi.fn(() => ({
						onConflictDoUpdate,
					})),
				})),
			} as any,
			{} as DurableObjectNamespace,
			{} as DurableObjectNamespace
		)
		const lastSeenAt = new Date('2026-03-21T01:00:00.000Z')

		await (service as any).upsertCheckpoint('98000001', 'character_wallet_transaction', {
			cursor: '123456',
			lastSeenAt,
		})

		expect(conflictSet).toMatchObject({
			cursor: '123456',
			lastSeenAt,
		})
	})
})
