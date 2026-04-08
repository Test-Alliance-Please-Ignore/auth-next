import { getStub } from '@repo/do-utils'

import { shipTypeIds } from './ship-types'

import type { CharacterAsset, EsiTypeResolver } from '@repo/esi'

export interface FittedShipItem {
	slot: string
	typeId: string
	typeName: string
	quantity: number
}

export interface FittedShipBay {
	bayName: string
	items: FittedShipItem[]
}

export interface FittedShip {
	itemId: string
	shipName: string
	shipTypeId: string
	customName?: string
	locationId: string
	locationName: string
	locationFlag: string
	locationType: 'station' | 'solar_system' | 'item' | 'other'
	estimatedValue?: number
	rigs: FittedShipItem[]
	highs: FittedShipItem[]
	meds: FittedShipItem[]
	lows: FittedShipItem[]
	shipsInSmb: FittedShipItem[]
	fleetHangar: FittedShipItem[]
	drones: FittedShipItem[]
	cargo: FittedShipItem[]
	fuel: FittedShipItem[]
	fighters: FittedShipItem[]
	fighterBay: FittedShipItem[]
	subsystems: FittedShipItem[]
	specializedBays: FittedShipBay[]
}

export async function findFittedShips(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	assets: CharacterAsset[],
	characterId: string
): Promise<FittedShip[]> {
	const ships = assets.filter(
		(asset) => asset.is_singleton === true && shipTypeIds.has(asset.type_id)
	)
	return Promise.all(
		ships.map(async (ship) => {
			return await findShipItems(env, ship, assets, characterId)
		})
	)
}

const findItemsBySlot = (itemId: string, assets: CharacterAsset[], slot: string) => {
	return assets.filter(
		(asset) => asset.location_id === itemId && asset.location_flag.startsWith(slot)
	)
}

export async function findShipItems(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	ship: CharacterAsset,
	assets: CharacterAsset[],
	characterId: string
): Promise<FittedShip> {
	const stub = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')

	const shipItems = assets.filter((asset) => asset.location_id === ship.item_id)

	const rigs = findItemsBySlot(ship.item_id, shipItems, 'RigSlot')
	const highs = findItemsBySlot(ship.item_id, shipItems, 'HiSlot')
	const meds = findItemsBySlot(ship.item_id, shipItems, 'MedSlot')
	const lows = findItemsBySlot(ship.item_id, shipItems, 'LowSlot')
	const drones = findItemsBySlot(ship.item_id, shipItems, 'DroneBay')
	const cargo = findItemsBySlot(ship.item_id, shipItems, 'Cargo')
	const fuel = findItemsBySlot(ship.item_id, shipItems, 'SpecializedFuelBay')
	const fighters = findItemsBySlot(ship.item_id, shipItems, 'FighterTube')
	const fighterBay = findItemsBySlot(ship.item_id, shipItems, 'FighterBay')
	const shipsInSmb = findItemsBySlot(ship.item_id, shipItems, 'ShipHangar')
	const fleetHangar = findItemsBySlot(ship.item_id, shipItems, 'FleetHangar')
	const subsystems = findItemsBySlot(ship.item_id, shipItems, 'SubSystemSlot')

	// Collect specialized holds (ore, gas, mineral, ice, ammo, etc.)
	const knownPrefixes = [
		'RigSlot', 'HiSlot', 'MedSlot', 'LowSlot', 'DroneBay', 'Cargo',
		'SpecializedFuelBay', 'FighterTube', 'FighterBay', 'ShipHangar',
		'FleetHangar', 'SubSystemSlot',
	]
	const specializedPrefixes: [string, string][] = [
		['SpecializedOreHold', 'Ore Hold'],
		['SpecializedGasHold', 'Gas Hold'],
		['SpecializedMineralHold', 'Mineral Hold'],
		['SpecializedSalvageHold', 'Salvage Hold'],
		['SpecializedShipHold', 'Ship Hold'],
		['SpecializedSmallShipHold', 'Small Ship Hold'],
		['SpecializedMediumShipHold', 'Medium Ship Hold'],
		['SpecializedLargeShipHold', 'Large Ship Hold'],
		['SpecializedIndustrialShipHold', 'Industrial Ship Hold'],
		['SpecializedAmmoHold', 'Ammo Hold'],
		['SpecializedCommandCenterHold', 'Command Center Hold'],
		['SpecializedPlanetaryCommoditiesHold', 'Planetary Commodities Hold'],
		['SpecializedMaterialBay', 'Material Bay'],
		['SpecializedIceHold', 'Ice Hold'],
		['CorpseBay', 'Corpse Bay'],
	]
	const specializedBaysRaw: { bayName: string; items: CharacterAsset[] }[] = []
	for (const [prefix, label] of specializedPrefixes) {
		const items = findItemsBySlot(ship.item_id, shipItems, prefix)
		if (items.length > 0) {
			specializedBaysRaw.push({ bayName: label, items })
		}
	}

	// Catch any remaining uncategorized items
	const allKnownPrefixes = [...knownPrefixes, ...specializedPrefixes.map(([p]) => p)]
	const uncategorized = shipItems.filter(
		(asset) => !allKnownPrefixes.some((prefix) => asset.location_flag.startsWith(prefix))
	)
	if (uncategorized.length > 0) {
		specializedBaysRaw.push({ bayName: 'Other', items: uncategorized })
	}

	const allTypeIds = [
		...rigs.map((rig) => rig.type_id),
		...highs.map((high) => high.type_id),
		...meds.map((med) => med.type_id),
		...lows.map((low) => low.type_id),
		...drones.map((drone) => drone.type_id),
		...cargo.map((cargo) => cargo.type_id),
		...fuel.map((fuel) => fuel.type_id),
		...fighters.map((fighter) => fighter.type_id),
		...fighterBay.map((fighterBay) => fighterBay.type_id),
		...shipsInSmb.map((shipsInSmb) => shipsInSmb.type_id),
		...fleetHangar.map((fleetHangar) => fleetHangar.type_id),
		...subsystems.map((subsystem) => subsystem.type_id),
		...specializedBaysRaw.flatMap((bay) => bay.items.map((item) => item.type_id)),
		ship.type_id, // Include ship type ID for name resolution
	]
	// Deduplicate type IDs to avoid unnecessary API calls
	const locationIds = [ship.location_id]
	const idsToResolve = Array.from(new Set([...allTypeIds, ...locationIds]))
	const nameMap = await stub.resolveIds(idsToResolve, characterId)
	// Ensure shipName is always a string - fallback to typeId if resolution failed
	const shipName = nameMap[ship.type_id] || ship.type_id
	const locationName = nameMap[ship.location_id] || ship.location_id

	if (!nameMap[ship.type_id]) {
		console.warn('[findShipItems] Ship type ID not resolved:', {
			shipTypeId: ship.type_id,
			resolvedIds: Object.keys(nameMap).length,
			hasShipTypeInMap: ship.type_id in nameMap,
		})
	}

	const resolveItems = (items: CharacterAsset[]): FittedShipItem[] => {
		return items.map((item) => {
			return {
				// Ensure typeName is always a string - fallback to typeId if resolution failed
				typeName: nameMap[item.type_id] || item.type_id,
				slot: item.location_flag,
				typeId: item.type_id,
				quantity: item.quantity,
			}
		})
	}
	const resolvedRigs = resolveItems(rigs)
	const resolvedHighs = resolveItems(highs)
	const resolvedMeds = resolveItems(meds)
	const resolvedLows = resolveItems(lows)
	const resolvedDrones = resolveItems(drones)
	const resolvedCargo = resolveItems(cargo)
	const resolvedFuel = resolveItems(fuel)
	const resolvedFighters = resolveItems(fighters)
	const resolvedFighterBay = resolveItems(fighterBay)
	const resolvedShipsInSmb = resolveItems(shipsInSmb)
	const resolvedFleetHangar = resolveItems(fleetHangar)
	const resolvedSubsystems = resolveItems(subsystems)
	const resolvedSpecializedBays: FittedShipBay[] = specializedBaysRaw.map((bay) => ({
		bayName: bay.bayName,
		items: resolveItems(bay.items),
	}))

	return {
		itemId: ship.item_id,
		shipName,
		shipTypeId: ship.type_id,
		locationId: ship.location_id,
		locationName,
		locationFlag: ship.location_flag,
		locationType: ship.location_type,
		rigs: resolvedRigs,
		highs: resolvedHighs,
		meds: resolvedMeds,
		lows: resolvedLows,
		drones: resolvedDrones,
		cargo: resolvedCargo,
		fuel: resolvedFuel,
		fighters: resolvedFighters,
		fighterBay: resolvedFighterBay,
		shipsInSmb: resolvedShipsInSmb,
		fleetHangar: resolvedFleetHangar,
		subsystems: resolvedSubsystems,
		specializedBays: resolvedSpecializedBays,
	}
}
