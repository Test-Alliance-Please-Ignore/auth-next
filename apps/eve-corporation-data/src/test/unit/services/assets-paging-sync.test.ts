import { describe, expect, it, vi } from 'vitest'

import { syncAssetsPaged } from '../../../services/assets-paging-sync'

describe('syncAssetsPaged', () => {
	it('stores assets incrementally page-by-page and returns total count', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({
				data: [
					{
						item_id: 1,
						is_singleton: false,
						location_flag: 'Hangar',
						location_id: 6001,
						location_type: 'station',
						quantity: 10,
						type_id: 34,
					},
				],
				pages: 3,
			})
			.mockResolvedValueOnce({
				data: [
					{
						item_id: 2,
						is_singleton: false,
						location_flag: 'Hangar',
						location_id: 6001,
						location_type: 'station',
						quantity: 20,
						type_id: 35,
					},
				],
				pages: 3,
			})
			.mockResolvedValueOnce({
				data: [
					{
						item_id: 3,
						is_singleton: true,
						location_flag: 'CorpSAG1',
						location_id: 6002,
						location_type: 'station',
						quantity: 1,
						type_id: 36,
					},
				],
				pages: 3,
			})
		const storeAssets = vi.fn().mockResolvedValue(undefined)

		const result = await syncAssetsPaged({
			fetchPage,
			storeAssets,
		})

		expect(fetchPage).toHaveBeenCalledTimes(3)
		expect(fetchPage).toHaveBeenNthCalledWith(1, 1)
		expect(fetchPage).toHaveBeenNthCalledWith(2, 2)
		expect(fetchPage).toHaveBeenNthCalledWith(3, 3)
		expect(storeAssets).toHaveBeenCalledTimes(3)
		expect(result).toEqual({ assetsCount: 3 })
	})

	it('handles single-page responses', async () => {
		const fetchPage = vi.fn().mockResolvedValue({
			data: [
				{
					item_id: 11,
					is_singleton: false,
					location_flag: 'Hangar',
					location_id: 6001,
					location_type: 'station',
					quantity: 5,
					type_id: 34,
				},
				{
					item_id: 12,
					is_singleton: false,
					location_flag: 'Hangar',
					location_id: 6001,
					location_type: 'station',
					quantity: 7,
					type_id: 35,
				},
			],
			pages: 1,
		})
		const storeAssets = vi.fn().mockResolvedValue(undefined)
		const onProgress = vi.fn()

		const result = await syncAssetsPaged({
			fetchPage,
			storeAssets,
			onProgress,
		})

		expect(fetchPage).toHaveBeenCalledTimes(1)
		expect(storeAssets).toHaveBeenCalledTimes(1)
		expect(onProgress).toHaveBeenCalledWith({ page: 1, totalPages: 1, totalAssets: 2 })
		expect(result).toEqual({ assetsCount: 2 })
	})
})
