import type { InventoryDisplayBay, InventoryDisplayItem, InventoryRowLike } from './types'

const BAY_LABELS: Record<string, string> = {
	StructureFuel: 'Structure Fuel Bay',
	SpecializedFuelBay: 'Fuel Bay',
	SpecializedAmmoHold: 'Ammo Hold',
	Cargo: 'Cargo',
	DroneBay: 'Drone Bay',
	FighterBay: 'Fighter Bay',
	CorpSAG: 'Corp Hangar',
	FleetHangar: 'Fleet Hangar',
	ShipHangar: 'Ship Hangar',
	SecondaryStorage: 'Secondary Storage',
	InfrastructureHangar: 'Infrastructure Hangar',
	MoonMaterialBay: 'Moon Material Bay',
	SpecializedOreHold: 'Ore Hold',
	SpecializedGasHold: 'Gas Hold',
	SpecializedMineralHold: 'Mineral Hold',
	SpecializedIceHold: 'Ice Hold',
	SpecializedSalvageHold: 'Salvage Hold',
	SpecializedShipHold: 'Ship Hold',
	SpecializedSmallShipHold: 'Small Ship Hold',
	SpecializedMediumShipHold: 'Medium Ship Hold',
	SpecializedLargeShipHold: 'Large Ship Hold',
	SpecializedIndustrialShipHold: 'Industrial Ship Hold',
	SpecializedCommandCenterHold: 'Command Center Hold',
	SpecializedPlanetaryCommoditiesHold: 'Planetary Commodities Hold',
	SpecializedMaterialBay: 'Material Bay',
}

const BAY_ORDER: string[] = [
	'StructureFuel',
	'SpecializedFuelBay',
	'SpecializedAmmoHold',
	'Cargo',
	'DroneBay',
	'FighterBay',
	'FighterTube',
	'CorpSAG',
	'FleetHangar',
	'ShipHangar',
	'SecondaryStorage',
	'InfrastructureHangar',
	'MoonMaterialBay',
	'SpecializedOreHold',
	'SpecializedGasHold',
	'SpecializedMineralHold',
	'SpecializedIceHold',
	'SpecializedSalvageHold',
	'SpecializedShipHold',
	'SpecializedSmallShipHold',
	'SpecializedMediumShipHold',
	'SpecializedLargeShipHold',
	'SpecializedIndustrialShipHold',
	'SpecializedCommandCenterHold',
	'SpecializedPlanetaryCommoditiesHold',
	'SpecializedMaterialBay',
]

export function isInventoryBayFlag(locationFlag: string): boolean {
	return BAY_ORDER.some((prefix) => locationFlag.startsWith(prefix))
}

export function getInventoryBayLabel(locationFlag: string): string {
	if (locationFlag.startsWith('FighterTube')) {
		const tubeIndex = Number.parseInt(locationFlag.slice('FighterTube'.length), 10)
		if (!Number.isNaN(tubeIndex)) {
			return `Fighter Tube ${tubeIndex + 1}`
		}
		return 'Fighter Tube'
	}

	if (locationFlag.startsWith('CorpSAG')) {
		const divisionIndex = Number.parseInt(locationFlag.slice('CorpSAG'.length), 10)
		if (!Number.isNaN(divisionIndex)) {
			return `Corp Hangar ${divisionIndex}`
		}
		return 'Corp Hangar'
	}

	return BAY_LABELS[locationFlag] ?? locationFlag
}

function getInventoryBayOrder(locationFlag: string): number {
	const index = BAY_ORDER.findIndex((prefix) => locationFlag.startsWith(prefix))
	return index === -1 ? Number.POSITIVE_INFINITY : index
}

function sortInventoryItems(left: InventoryDisplayItem, right: InventoryDisplayItem): number {
	return right.quantity - left.quantity || left.typeId.localeCompare(right.typeId)
}

export function summarizeInventoryRows(rows: InventoryRowLike[]): InventoryDisplayBay[] {
	if (rows.length === 0) {
		return []
	}

	const rowsByLocationFlag = new Map<string, InventoryRowLike[]>()
	for (const row of rows) {
		const bucket = rowsByLocationFlag.get(row.locationFlag)
		if (bucket) {
			bucket.push(row)
		} else {
			rowsByLocationFlag.set(row.locationFlag, [row])
		}
	}

	return Array.from(rowsByLocationFlag.entries())
		.map(([locationFlag, flagRows]) => {
			const itemsByType = new Map<string, InventoryDisplayItem>()

			for (const row of flagRows) {
				const existing = itemsByType.get(row.typeId)
				if (existing) {
					existing.quantity += row.quantity
					existing.stackCount += 1
					if (existing.typeName === undefined && row.typeName !== undefined) {
						existing.typeName = row.typeName
					}
				} else {
					itemsByType.set(row.typeId, {
						typeId: row.typeId,
						typeName: row.typeName ?? undefined,
						quantity: row.quantity,
						stackCount: 1,
					})
				}
			}

			const items = Array.from(itemsByType.values()).sort(sortInventoryItems)
			const totalQuantity = items.reduce((total, item) => total + item.quantity, 0)

			return {
				locationFlag,
				label: getInventoryBayLabel(locationFlag),
				totalQuantity,
				totalStacks: flagRows.length,
				items,
			}
		})
		.sort((left, right) => {
			const orderDiff = getInventoryBayOrder(left.locationFlag) - getInventoryBayOrder(right.locationFlag)
			if (orderDiff !== 0) {
				return orderDiff
			}
			return left.label.localeCompare(right.label)
		})
}
