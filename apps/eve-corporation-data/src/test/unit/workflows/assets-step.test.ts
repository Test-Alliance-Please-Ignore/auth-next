import { describe, expect, it, vi } from 'vitest'

import { syncAssets } from '../../../workflows/steps/assets'

const getCorporationDataStubMock = vi.fn()

vi.mock('../../../workflows/utils/services', () => ({
	getCorporationDataStub: (...args: unknown[]) => getCorporationDataStubMock(...args),
}))

describe('assets workflow step', () => {
	it('delegates asset sync to corporation DO method and returns count', async () => {
		const syncAssetsWithDirector = vi.fn().mockResolvedValue({ assetsCount: 4321 })
		getCorporationDataStubMock.mockReturnValue({
			syncAssetsWithDirector,
		})

		const env = {} as any
		const result = await syncAssets(env, '98000001', '90000001')

		expect(syncAssetsWithDirector).toHaveBeenCalledWith('98000001', '90000001')
		expect(result).toEqual({ assetsCount: 4321 })
	})

	it('forwards preloaded owned structure ids when provided', async () => {
		const syncAssetsWithDirector = vi.fn().mockResolvedValue({ assetsCount: 7 })
		getCorporationDataStubMock.mockReturnValue({
			syncAssetsWithDirector,
		})

		const env = {} as any
		const result = await syncAssets(env, '98000001', '90000001', ['1001', '1002'])

		expect(syncAssetsWithDirector).toHaveBeenCalledWith('98000001', '90000001', ['1001', '1002'])
		expect(result).toEqual({ assetsCount: 7 })
	})
})
