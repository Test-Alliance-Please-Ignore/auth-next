import { describe, expect, it } from 'vitest'

import { buildAssetMap, isInsideShip, isShipAsset, resolveTopLevelLocation } from '../../workflows/processors/helpers/location'
import { shipTypeIds } from '../../workflows/processors/helpers/ship-types'

import type { CharacterAsset } from '@repo/esi'

function makeAsset(asset: Partial<CharacterAsset> & Pick<CharacterAsset, 'item_id' | 'location_id' | 'location_type' | 'type_id'>): CharacterAsset {
	return {
		quantity: 1,
		is_singleton: false,
		...asset,
	} as CharacterAsset
}

describe('asset location helpers', () => {
	it('resolves a ship inside another ship to the top-level structure', () => {
		const structureId = '103'
		const hostShipId = '102'
		const nestedShipId = '101'
		const moduleId = '100'

		const assets = [
			makeAsset({
				item_id: structureId,
				location_id: structureId,
				location_type: 'other',
				type_id: '35834',
				is_singleton: true,
			}),
			makeAsset({
				item_id: hostShipId,
				location_id: structureId,
				location_type: 'other',
				type_id: '582',
				is_singleton: true,
			}),
			makeAsset({
				item_id: nestedShipId,
				location_id: hostShipId,
				location_type: 'item',
				type_id: '584',
				is_singleton: true,
			}),
			makeAsset({
				item_id: moduleId,
				location_id: nestedShipId,
				location_type: 'item',
				type_id: '34',
			}),
		]

		const assetMap = buildAssetMap(assets)

		expect(isShipAsset(assets[2]!)).toBe(true)
		expect(isInsideShip(assets[2]!, assetMap)).toBe(true)
		expect(isInsideShip(assets[3]!, assetMap)).toBe(true)

		const resolvedShipLocation = resolveTopLevelLocation(assets[2]!, assetMap)
		expect(resolvedShipLocation).toEqual({
			locationId: structureId,
			locationType: 'other',
			containerItemId: undefined,
		})

		const resolvedModuleLocation = resolveTopLevelLocation(assets[3]!, assetMap)
		expect(resolvedModuleLocation).toEqual({
			locationId: structureId,
			locationType: 'other',
			containerItemId: undefined,
		})
	})

	it('resolves items inside structure-held containers to the structure', () => {
		const structureId = '203'
		const containerId = '202'
		const itemId = '201'

		const assets = [
			makeAsset({
				item_id: structureId,
				location_id: structureId,
				location_type: 'other',
				type_id: '35834',
				is_singleton: true,
			}),
			makeAsset({
				item_id: containerId,
				location_id: structureId,
				location_type: 'item',
				type_id: '3465',
				is_singleton: true,
			}),
			makeAsset({
				item_id: itemId,
				location_id: containerId,
				location_type: 'item',
				type_id: '34',
			}),
		]

		const assetMap = buildAssetMap(assets)
		const resolvedLocation = resolveTopLevelLocation(assets[2]!, assetMap)

		expect(resolvedLocation).toEqual({
			locationId: structureId,
			locationType: 'other',
			containerItemId: containerId,
		})
	})

	it('resolves items inside structure-held containers even when the structure row is absent', () => {
		const structureId = '303'
		const containerId = '302'
		const itemId = '301'

		const assets = [
			makeAsset({
				item_id: containerId,
				location_id: structureId,
				location_type: 'item',
				type_id: '3465',
				is_singleton: true,
			}),
			makeAsset({
				item_id: itemId,
				location_id: containerId,
				location_type: 'item',
				type_id: '34',
			}),
		]

		const assetMap = buildAssetMap(assets)
		const resolvedLocation = resolveTopLevelLocation(assets[1]!, assetMap)

		expect(resolvedLocation).toEqual({
			locationId: structureId,
			locationType: 'other',
			containerItemId: containerId,
		})
	})

	it('treats singleton ships as ship assets for report inclusion', () => {
		expect(shipTypeIds.has('582')).toBe(true)
		expect(isShipAsset(makeAsset({
			item_id: '1',
			location_id: '2',
			location_type: 'item',
			type_id: '582',
			is_singleton: true,
		}))).toBe(true)
	})
})
