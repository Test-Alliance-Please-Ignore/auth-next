import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyAssetCustomNames } from '../../workflows/steps/assets/apply-asset-custom-names'

import type { ProcessedAsset } from '../../workflows/processors/helpers/assets'
import type { FittedShip } from '../../workflows/processors/helpers/ships'
import type * as StorageUtils from '../../workflows/utils/storage'

const retrieveData = vi.fn()
const storeInR2 = vi.fn()

vi.mock('../../workflows/utils/storage', async () => {
	const actual = await vi.importActual<typeof StorageUtils>('../../workflows/utils/storage')
	return {
		...actual,
		retrieveData: (...args: unknown[]) => retrieveData(...args),
		storeInR2: (...args: unknown[]) => storeInR2(...args),
	}
})

function makeStepResult(): StorageUtils.StepResult {
	return {
		success: true,
		source: 'r2',
		r2Bucket: 'bucket',
		r2Key: 'key',
	} as StorageUtils.StepResult
}

describe('applyAssetCustomNames', () => {
	beforeEach(() => {
		retrieveData.mockReset()
		storeInR2.mockReset()
	})

	it('applies custom names recursively to contained ships', async () => {
		const topShip: FittedShip = {
			itemId: '100',
			shipName: 'Rifter',
			shipTypeId: '587',
			locationId: '200',
			locationName: 'Amarr',
			locationFlag: 'Cargo',
			locationType: 'station',
			highs: [],
			meds: [],
			lows: [],
			rigs: [],
			subsystems: [],
			drones: [],
			cargo: [],
			fuel: [],
			fighters: [],
			fighterBay: [],
			shipsInSmb: [],
			fleetHangar: [],
			specializedBays: [],
			containedShips: [
				{
					itemId: '101',
					shipName: 'Executioner',
					shipTypeId: '588',
					locationId: '100',
					locationName: 'Rifter',
					locationFlag: 'ShipHangar',
					locationType: 'item',
					highs: [],
					meds: [],
					lows: [],
					rigs: [],
					subsystems: [],
					drones: [],
					cargo: [],
					fuel: [],
					fighters: [],
					fighterBay: [],
					shipsInSmb: [],
					fleetHangar: [],
					specializedBays: [],
				},
			],
		}

		const assets = [
			{
				item_id: '200',
				type_id: '200',
				location_id: '200',
				location_type: 'station',
				location_flag: 'Hangar',
				is_singleton: true,
				quantity: 1,
			},
		] as ProcessedAsset[]

		retrieveData
			.mockResolvedValueOnce({
				'100': 'My Top Ship',
				'101': 'My Nested Ship',
			})
			.mockResolvedValueOnce(assets)
			.mockResolvedValueOnce([topShip])

		const getBucket = (() => ({}) as R2Bucket) as (name: string) => R2Bucket

		const result = await applyAssetCustomNames(
			getBucket,
			{} as R2Bucket,
			makeStepResult(),
			makeStepResult(),
			makeStepResult()
		)

		expect(result.applied).toBe(2)
		expect((assets[0] as ProcessedAsset).customName).toBeUndefined()
		expect(topShip.customName).toBe('My Top Ship')
		expect(topShip.containedShips?.[0]?.customName).toBe('My Nested Ship')
		expect(storeInR2).toHaveBeenCalledTimes(2)
	})
})
