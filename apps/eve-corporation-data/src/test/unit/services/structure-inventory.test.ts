import { describe, expect, it } from 'vitest'

import {
	filterStructureInventoryAssets,
	isStructureInventoryLocationFlag,
	projectStructureInventoryFromStoredAssets,
} from '../../../services/structure-inventory'

describe('structure inventory filtering', () => {
	it('recognizes structure inventory bay and hold flags', () => {
		expect(isStructureInventoryLocationFlag('SpecializedAmmoHold')).toBe(true)
		expect(isStructureInventoryLocationFlag('FighterTube3')).toBe(true)
		expect(isStructureInventoryLocationFlag('MoonMaterialBay')).toBe(true)
		expect(isStructureInventoryLocationFlag('ServiceSlot0')).toBe(false)
		expect(isStructureInventoryLocationFlag('RigSlot0')).toBe(false)
	})

	it('filters assets to owned structures and inventory bays', () => {
		const inventory = filterStructureInventoryAssets(
			'98000001',
			new Set(['1001', '1002']),
			[
				{
					item_id: '1',
					is_singleton: false,
					location_flag: 'SpecializedFuelBay',
					location_id: '1001',
					location_type: 'item',
					quantity: 400,
					type_id: '4247',
				},
				{
					item_id: '2',
					is_singleton: false,
					location_flag: 'RigSlot0',
					location_id: '1001',
					location_type: 'item',
					quantity: 1,
					type_id: '1234',
				},
				{
					item_id: '3',
					is_singleton: false,
					location_flag: 'SpecializedAmmoHold',
					location_id: '9999',
					location_type: 'item',
					quantity: 1000,
					type_id: '574',
				},
				{
					item_id: '4',
					is_singleton: false,
					location_flag: 'FighterTube0',
					location_id: '1002',
					location_type: 'item',
					quantity: 12,
					type_id: '404',
				},
				{
					item_id: '5',
					is_singleton: false,
					location_flag: 'MoonMaterialBay',
					location_id: '1002',
					location_type: 'item',
					quantity: 99,
					type_id: '12345',
				},
				{
					item_id: '6',
					is_singleton: false,
					location_flag: 'CorpSAG1',
					location_id: '1002',
					location_type: 'station',
					quantity: 6,
					type_id: '35',
				},
			]
		)

		expect(inventory).toEqual([
			{
				corporationId: '98000001',
				structureId: '1001',
				itemId: '1',
				isSingleton: false,
				locationFlag: 'SpecializedFuelBay',
				locationType: 'item',
				quantity: 400,
				typeId: '4247',
			},
			{
				corporationId: '98000001',
				structureId: '1002',
				itemId: '4',
				isSingleton: false,
				locationFlag: 'FighterTube0',
				locationType: 'item',
				quantity: 12,
				typeId: '404',
			},
			{
				corporationId: '98000001',
				structureId: '1002',
				itemId: '5',
				isSingleton: false,
				locationFlag: 'MoonMaterialBay',
				locationType: 'item',
				quantity: 99,
				typeId: '12345',
			},
		])
	})

	it('projects stored raw assets into structure inventory rows', () => {
		const inventory = projectStructureInventoryFromStoredAssets(
			'98000001',
			new Set(['1001']),
			[
				{
					itemId: '100',
					isSingleton: false,
					locationFlag: 'Cargo',
					locationId: '1001',
					locationType: 'item',
					quantity: 12,
					typeId: '37843',
				},
				{
					itemId: '101',
					isSingleton: false,
					locationFlag: 'ServiceSlot0',
					locationId: '1001',
					locationType: 'item',
					quantity: 1,
					typeId: '35894',
				},
				{
					itemId: '102',
					isSingleton: false,
					locationFlag: 'Cargo',
					locationId: '9999',
					locationType: 'item',
					quantity: 1,
					typeId: '37844',
				},
			]
		)

		expect(inventory).toEqual([
			{
				corporationId: '98000001',
				structureId: '1001',
				itemId: '100',
				isSingleton: false,
				locationFlag: 'Cargo',
				locationType: 'item',
				quantity: 12,
				typeId: '37843',
			},
		])
	})
})
