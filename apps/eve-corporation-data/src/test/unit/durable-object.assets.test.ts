import { describe, expect, it, vi } from 'vitest'

import { EveCorporationDataDO } from '../../durable-object'

describe('EveCorporationDataDO asset refresh', () => {
	it('returns SQL-backed counts for every data summary above row materialization limits', async () => {
		const countRows = [
			[{ count: 42 }],
			[{ count: 7 }],
			[{ count: 2 }],
			[{ count: 10001 }],
			[{ count: 40002 }],
			[{ count: 15001 }],
			[{ count: 82 }],
			[{ count: 1 }],
			[{ count: 3 }],
			[{ count: 4 }],
			[{ count: 5 }],
			[{ count: 60001 }],
		]
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => Promise.resolve(countRows.shift() ?? [{ count: 0 }])),
			})),
		}))
		const instance = new EveCorporationDataDO(
			{} as DurableObjectState,
			{
				DATABASE_URL: 'postgres://example',
				UNIVERSE: {} as never,
				EVE_TOKEN_STORE: {} as never,
			} as never
		)
		;(instance as any).getDb = () => ({
			query: {
				corporationStructureInventorySnapshots: {
					findFirst: vi.fn().mockResolvedValue({ id: 'snapshot-1' }),
				},
			},
			select,
		})

		expect(await instance.getDataSummaryCounts('98000001')).toEqual({
			coreData: { memberCount: 42, trackingCount: 7 },
			financialData: { walletCount: 2, journalCount: 10001, transactionCount: 40002 },
			assetsData: { assetCount: 15001, structureCount: 82 },
			marketData: { orderCount: 3, contractCount: 4, industryJobCount: 5 },
			killmailCount: 60001,
		})
		expect(select).toHaveBeenCalledTimes(12)
	})

	it('propagates structure inventory refresh failures instead of swallowing them', async () => {
		const instance = new EveCorporationDataDO(
			{} as DurableObjectState,
			{
				DATABASE_URL: 'postgres://example',
				UNIVERSE: {} as never,
				EVE_TOKEN_STORE: {} as never,
			} as never
		)

		const fetchAndStoreStructures = vi.fn().mockResolvedValue(undefined)
		const fetchAndStoreStructureInventory = vi
			.fn()
			.mockRejectedValue(new Error('inventory refresh failed'))

		;(instance as any).fetchAndStoreStructures = fetchAndStoreStructures
		;(instance as any).fetchAndStoreStructureInventory = fetchAndStoreStructureInventory

		await expect(instance.fetchAssetsData('98000001', true)).rejects.toThrow(
			'inventory refresh failed'
		)
		expect(fetchAndStoreStructures).toHaveBeenCalledWith('98000001', true)
		expect(fetchAndStoreStructureInventory).toHaveBeenCalledWith('98000001', true)
	})

	it('claims POS enrichment attempts with an atomic conflict predicate', async () => {
		const returning = vi.fn().mockResolvedValue([{ structureId: 'pos-1' }])
		const onConflictDoUpdate = vi.fn(() => ({ returning }))
		const insertSelect = vi.fn(() => ({ onConflictDoUpdate }))
		const insert = vi.fn(() => ({ select: insertSelect }))
		const where = vi.fn().mockReturnValue({})
		const leftJoin = vi.fn().mockReturnValue({ where })
		const from = vi.fn().mockReturnValue({ leftJoin })
		const select = vi.fn().mockReturnValue({ from })
		const instance = new EveCorporationDataDO(
			{} as DurableObjectState,
			{
				DATABASE_URL: 'postgres://example',
				UNIVERSE: {} as never,
				EVE_TOKEN_STORE: {} as never,
			} as never
		)
		;(instance as any).getDb = () => ({ insert, select })

		await expect(
			(instance as any).claimStructureSyncAttempts({
				corporationId: 'corp-1',
				targetTable: 'poses',
				structureIds: ['pos-1'],
			})
		).resolves.toEqual(['pos-1'])

		expect(insertSelect).toHaveBeenCalledOnce()
		expect(Object.keys(select.mock.calls[0]?.[0] ?? {})).toEqual([
			'structureId',
			'corporationId',
			'lastAttemptedSyncAt',
			'lastSyncedAt',
			'syncFailureReason',
		])
		expect(onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				target: expect.anything(),
				setWhere: expect.anything(),
			})
		)
	})
})
