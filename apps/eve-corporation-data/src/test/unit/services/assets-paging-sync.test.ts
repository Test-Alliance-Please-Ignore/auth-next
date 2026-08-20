import { describe, expect, it, vi } from 'vitest'

import { syncAssetsPaged } from '../../../services/assets-paging-sync'

const meta = (pages: number, page: number | null = null) => ({
	status: 200,
	etag: null,
	expiresAt: null,
	lastModified: null,
	pages,
	page,
	cached: false,
	revalidated: false,
})

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
				meta: meta(3, 1),
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
				meta: meta(3, 2),
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
				meta: meta(3, 3),
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
			meta: meta(1, 1),
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

	it('deduplicates duplicate asset rows within a page by item id before storing', async () => {
		const fetchPage = vi.fn().mockResolvedValue({
			data: [
				{
					item_id: 42,
					is_singleton: false,
					location_flag: 'Hangar',
					location_id: 6001,
					location_type: 'station',
					quantity: 1,
					type_id: 34,
				},
				{
					item_id: 42,
					is_singleton: true,
					location_flag: 'CorpSAG2',
					location_id: 6002,
					location_type: 'station',
					quantity: 7,
					type_id: 35,
				},
			],
			meta: meta(1, 1),
		})
		const storeAssets = vi.fn().mockResolvedValue(undefined)

		const result = await syncAssetsPaged({
			fetchPage,
			storeAssets,
		})

		expect(storeAssets).toHaveBeenCalledTimes(1)
		expect(storeAssets).toHaveBeenCalledWith([
			{
				item_id: '42',
				is_singleton: true,
				location_flag: 'CorpSAG2',
				location_id: '6002',
				location_type: 'station',
				quantity: 7,
				type_id: '35',
				is_blueprint_copy: undefined,
			},
		])
		expect(result).toEqual({ assetsCount: 1 })
	})

	it('rejects an inconsistent page count instead of marking the asset sync complete', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({ data: [], meta: meta(2, 1) })
			.mockResolvedValueOnce({ data: [], meta: meta(3, 2) })
		const storeAssets = vi.fn().mockResolvedValue(undefined)

		await expect(syncAssetsPaged({ fetchPage, storeAssets })).rejects.toThrow(
			'changed page count while fetching'
		)
		expect(storeAssets).toHaveBeenCalledTimes(1)
	})

	it('rejects a response for the wrong requested page', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({ data: [], meta: meta(2, 1) })
			.mockResolvedValueOnce({ data: [], meta: meta(2, 3) })

		await expect(syncAssetsPaged({ fetchPage, storeAssets: vi.fn() })).rejects.toThrow(
			'returned page 3 when page 2 was requested'
		)
	})
})
