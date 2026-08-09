import { describe, expect, it, vi } from 'vitest'

import { syncAssets } from '../../../workflows/steps/assets'

const getCorporationDataStubMock = vi.fn()

vi.mock('../../../workflows/utils/services', () => ({
	getCorporationDataStub: (...args: unknown[]) => getCorporationDataStubMock(...args),
}))

describe('assets workflow step', () => {
	it('delegates asset sync to corporation DO method and returns count', async () => {
		const syncAssetsWithDirector = vi.fn().mockResolvedValue({
			assetsCount: 4321,
			snapshotUpdated: true,
			skipReason: null,
			ownedStructureCount: 82,
			fetchedAssetCount: 4321,
			inventoryRowCount: 4321,
		})
		getCorporationDataStubMock.mockReturnValue({
			syncAssetsWithDirector,
		})

		const env = {} as any
		const result = await syncAssets(env, '98000001', '90000001')

		expect(syncAssetsWithDirector).toHaveBeenCalledWith('98000001', '90000001')
		expect(result).toEqual({
			assetsCount: 4321,
			snapshotUpdated: true,
			skipReason: null,
			ownedStructureCount: 82,
			fetchedAssetCount: 4321,
			inventoryRowCount: 4321,
		})
	})

	it('preserves an explicit cooldown skip without treating it as a successful sync', async () => {
		const syncAssetsWithDirector = vi.fn().mockResolvedValue({
			assetsCount: 0,
			snapshotUpdated: false,
			skipReason: 'cooldown',
			ownedStructureCount: null,
			fetchedAssetCount: 0,
			inventoryRowCount: 0,
		})
		getCorporationDataStubMock.mockReturnValue({
			syncAssetsWithDirector,
		})

		const result = await syncAssets({} as any, '98000001', '90000001')

		expect(result.snapshotUpdated).toBe(false)
		expect(result.skipReason).toBe('cooldown')
	})
})
