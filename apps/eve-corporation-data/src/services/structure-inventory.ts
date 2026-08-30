import type { EsiCorporationAsset } from '@repo/eve-corporation-data'

export const FUEL_BLOCK_TYPE_IDS = new Set(['4051', '4246', '4247', '4312'])

const STRUCTURE_INVENTORY_LOCATION_FLAG_PREFIXES = [
	'StructureFuel',
	'SpecializedFuelBay',
	'SpecializedAmmoHold',
	'Cargo',
	'DroneBay',
	'FighterBay',
	'FighterTube',
	'MoonMaterialBay',
] as const

const POS_INVENTORY_LOCATION_FLAGS = new Set(['AutoFit', 'SecondaryStorage'])

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

export interface StructureInventoryAssetSource {
	itemId: string
	isSingleton: boolean
	locationFlag: string
	locationId: string
	locationType: string
	quantity: number
	typeId: string
}

export function isStructureInventoryLocationFlag(locationFlag: string): boolean {
	return STRUCTURE_INVENTORY_LOCATION_FLAG_PREFIXES.some((prefix) =>
		locationFlag.startsWith(prefix)
	)
}

function projectStructureInventoryAssetRows(
	corporationId: string,
	ownedStructureIds: ReadonlySet<string>,
	assets: readonly StructureInventoryAssetSource[],
	posStructureIds: ReadonlySet<string> = new Set()
): StructureInventoryRowInput[] {
	if (ownedStructureIds.size === 0 || assets.length === 0) {
		return []
	}

	return assets.flatMap((asset) => {
		if (asset.locationType !== 'item') {
			return []
		}

		if (!ownedStructureIds.has(String(asset.locationId))) {
			return []
		}

		const isPosInventoryAsset =
			posStructureIds.has(String(asset.locationId)) &&
			POS_INVENTORY_LOCATION_FLAGS.has(asset.locationFlag)
		if (!isStructureInventoryLocationFlag(asset.locationFlag) && !isPosInventoryAsset) {
			return []
		}

		return [
			{
				corporationId: String(corporationId),
				structureId: String(asset.locationId),
				itemId: String(asset.itemId),
				isSingleton: asset.isSingleton,
				locationFlag: asset.locationFlag,
				locationType: asset.locationType,
				quantity: asset.quantity,
				typeId: String(asset.typeId),
			},
		]
	})
}

export function filterStructureInventoryAssets(
	corporationId: string,
	ownedStructureIds: ReadonlySet<string>,
	assets: EsiCorporationAsset[],
	posStructureIds?: ReadonlySet<string>
): StructureInventoryRowInput[] {
	return projectStructureInventoryAssetRows(
		corporationId,
		ownedStructureIds,
		assets.map((asset) => ({
			itemId: String(asset.item_id),
			isSingleton: asset.is_singleton,
			locationFlag: asset.location_flag,
			locationId: String(asset.location_id),
			locationType: asset.location_type,
			quantity: asset.quantity,
			typeId: String(asset.type_id),
		})),
		posStructureIds
	)
}

export function projectStructureInventoryFromStoredAssets(
	corporationId: string,
	ownedStructureIds: ReadonlySet<string>,
	assets: readonly StructureInventoryAssetSource[],
	posStructureIds?: ReadonlySet<string>
): StructureInventoryRowInput[] {
	return projectStructureInventoryAssetRows(
		corporationId,
		ownedStructureIds,
		assets,
		posStructureIds
	)
}

export function summarizeFuelBlockUnitsByStructure(
	ownedStructureIds: ReadonlySet<string>,
	inventory: readonly StructureInventoryRowInput[]
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

export function findRefilledStructureIds(
	previousFuelBlockUnitsByStructure: ReadonlyMap<string, number>,
	currentFuelBlockUnitsByStructure: ReadonlyMap<string, number>
): string[] {
	return [...currentFuelBlockUnitsByStructure.entries()]
		.filter(([structureId, fuelBlockUnits]) => {
			const previousFuelBlockUnits = previousFuelBlockUnitsByStructure.get(structureId)
			return previousFuelBlockUnits !== undefined && fuelBlockUnits > previousFuelBlockUnits
		})
		.map(([structureId]) => structureId)
}
