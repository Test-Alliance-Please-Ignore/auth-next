import type { EsiCorporationAsset } from '@repo/eve-corporation-data'

export const FUEL_BLOCK_TYPE_IDS = new Set(['4051', '4246', '4247', '4312'])

const STRUCTURE_INVENTORY_LOCATION_FLAG_PREFIXES = [
	'StructureFuel',
	'SpecializedFuelBay',
	'SpecializedAmmoHold',
	'DroneBay',
	'FighterBay',
	'FighterTube',
] as const

export interface StructureInventoryRowInput {
	corporationId: string
	structureId: string
	itemId: string
	isSingleton: boolean
	locationFlag: string
	locationType: string
	quantity: number
	typeId: string
}

export function isStructureInventoryLocationFlag(locationFlag: string): boolean {
	return STRUCTURE_INVENTORY_LOCATION_FLAG_PREFIXES.some((prefix) =>
		locationFlag.startsWith(prefix)
	)
}

export function filterStructureInventoryAssets(
	corporationId: string,
	ownedStructureIds: ReadonlySet<string>,
	assets: EsiCorporationAsset[]
): StructureInventoryRowInput[] {
	if (ownedStructureIds.size === 0 || assets.length === 0) {
		return []
	}

	return assets.flatMap((asset) => {
		if (asset.location_type !== 'item') {
			return []
		}

		if (!ownedStructureIds.has(String(asset.location_id))) {
			return []
		}

		if (!isStructureInventoryLocationFlag(asset.location_flag)) {
			return []
		}

		return [
			{
				corporationId: String(corporationId),
				structureId: String(asset.location_id),
				itemId: String(asset.item_id),
				isSingleton: asset.is_singleton,
				locationFlag: asset.location_flag,
				locationType: asset.location_type,
				quantity: asset.quantity,
				typeId: String(asset.type_id),
			},
		]
	})
}

export function summarizeFuelBlockUnitsByStructure(
	ownedStructureIds: ReadonlySet<string>,
	inventory: ReadonlyArray<StructureInventoryRowInput>
): Map<string, number> {
	const fuelBlockUnitsByStructure = new Map<string, number>()

	for (const structureId of ownedStructureIds) {
		fuelBlockUnitsByStructure.set(structureId, 0)
	}

	for (const row of inventory) {
		if (!ownedStructureIds.has(row.structureId)) {
			continue
		}

		if (!FUEL_BLOCK_TYPE_IDS.has(row.typeId)) {
			continue
		}

		fuelBlockUnitsByStructure.set(
			row.structureId,
			(fuelBlockUnitsByStructure.get(row.structureId) ?? 0) + row.quantity
		)
	}

	return fuelBlockUnitsByStructure
}
