import { describe, expect, it, vi } from 'vitest'

import { EveCorporationDataDO } from '../../durable-object'

describe('EveCorporationDataDO asset refresh', () => {
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
})
