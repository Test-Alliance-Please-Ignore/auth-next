import { beforeEach, describe, expect, it, vi } from 'vitest'

import { processAssets } from '../../workflows/steps/assets/process-assets'

import type { CharacterAsset } from '@repo/esi'
import type * as StorageUtils from '../../workflows/utils/storage'

const retrieveData = vi.fn()
const storeOrReturn = vi.fn()
const enrichAssets = vi.fn()

vi.mock('../../workflows/utils/storage', async () => {
	const actual = await vi.importActual<typeof StorageUtils>('../../workflows/utils/storage')
	return {
		...actual,
		retrieveData: (...args: unknown[]) => retrieveData(...args),
		storeOrReturn: (...args: unknown[]) => storeOrReturn(...args),
	}
})

vi.mock('../../workflows/processors/helpers/assets', () => ({
	enrichAssets: (...args: unknown[]) => enrichAssets(...args),
}))

function makeStepResult(): StorageUtils.StepResult {
	return {
		success: true,
		source: 'r2',
		r2Bucket: 'bucket',
		r2Key: 'key',
	} as StorageUtils.StepResult
}

function makeAsset(
	asset: Partial<CharacterAsset> &
		Pick<CharacterAsset, 'item_id' | 'location_id' | 'location_type' | 'type_id'>
): CharacterAsset {
	return {
		quantity: 1,
		is_singleton: false,
		location_flag: 'Cargo',
		...asset,
	} as CharacterAsset
}

describe('processAssets', () => {
	beforeEach(() => {
		retrieveData.mockReset()
		storeOrReturn.mockReset()
		enrichAssets.mockReset()
	})

	it('preserves structure-held rows and structure-contained items', async () => {
		const structureId = '1036374164878'
		const containerId = '1036374164879'
		const containedItemId = '1036374164880'
		const shipId = '1036374164881'
		const shipModuleId = '1036374164882'

		const rawAssets = [
			makeAsset({
				item_id: structureId,
				location_id: structureId,
				location_type: 'item',
				location_flag: 'Cargo',
				type_id: '35834',
				is_singleton: true,
			}),
			makeAsset({
				item_id: containerId,
				location_id: structureId,
				location_type: 'item',
				location_flag: 'Hangar',
				type_id: '3465',
				is_singleton: true,
			}),
			makeAsset({
				item_id: shipId,
				location_id: structureId,
				location_type: 'item',
				location_flag: 'Hangar',
				type_id: '582',
				is_singleton: true,
			}),
			makeAsset({
				item_id: shipModuleId,
				location_id: shipId,
				location_type: 'item',
				location_flag: 'Cargo',
				type_id: '34',
			}),
			makeAsset({
				item_id: containedItemId,
				location_id: containerId,
				location_type: 'item',
				location_flag: 'Cargo',
				type_id: '34',
			}),
		]

		retrieveData.mockResolvedValue(rawAssets)
		enrichAssets.mockImplementation(async (_env, assets) => assets)
		storeOrReturn.mockResolvedValue(makeStepResult())

		const result = await processAssets(
			{
				ESI_TYPE_RESOLVER: {} as DurableObjectNamespace,
				ESI: {} as DurableObjectNamespace,
				UNIVERSE: {} as DurableObjectNamespace,
			},
			(() => ({}) as R2Bucket) as unknown as (name: string) => R2Bucket,
			{} as R2Bucket,
			'bucket',
			makeStepResult(),
			'workflow-1',
			'123'
		)

		expect(result.success).toBe(true)
		expect(enrichAssets).toHaveBeenCalledTimes(1)

		const [, filteredAssets] = enrichAssets.mock.calls[0] as [unknown, CharacterAsset[], string]

		expect(filteredAssets.map((asset) => asset.item_id)).toEqual([
			structureId,
			containerId,
			containedItemId,
		])
		expect(filteredAssets.some((asset) => asset.item_id === shipId)).toBe(false)
		expect(filteredAssets.some((asset) => asset.item_id === shipModuleId)).toBe(false)
		expect(filteredAssets.find((asset) => asset.item_id === containedItemId)?.location_id).toBe(
			structureId
		)
		expect(filteredAssets.find((asset) => asset.item_id === structureId)?.location_id).toBe(
			structureId
		)
	})
})
