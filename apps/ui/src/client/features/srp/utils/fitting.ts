import { SHIP_MAINTENANCE_BAY_FLAG } from '@repo/srp'

import type {
	FittingShipSlotType,
	FittingSlotCapacities,
	FittingSlotHighlightMap,
	FittingSlotSeverity,
	FittingSlotType,
} from '@repo/eve-fitting/flags'

export type SlotType = FittingSlotType
export type SRPSlotHighlightSeverity = FittingSlotSeverity
export type SRPSlotHighlightMap = FittingSlotHighlightMap
export type SRPShipSlotType = FittingShipSlotType
export type SRPSlotCapacityType = FittingShipSlotType | 'implant'
export type SRPShipSlotCapacities = FittingSlotCapacities

export interface SRPFittingItem {
	typeId: string
	typeName: string
	quantity: number
	flag: number
	slotType: SlotType
	slotIndex: number
	unitPrice: string
	lineTotal: string
	isConsumable?: boolean
}

// Flags for equipped slots only (not cargo, drones in bay, etc.)
const EQUIPPED_FLAG_RANGES: Array<{ min: number; max: number; type: SlotType; base: number }> = [
	{ min: 11, max: 18, type: 'low', base: 11 },
	{ min: 19, max: 26, type: 'mid', base: 19 },
	{ min: 27, max: 34, type: 'high', base: 27 },
	{ min: 89, max: 89, type: 'implant', base: 89 },
	{ min: 92, max: 99, type: 'rig', base: 92 },
	{ min: 125, max: 132, type: 'sub', base: 125 },
]

// Rigs are checked first so their flags remain unambiguous if EVE adds adjacent flags.
function flagToSlot(flag: number): { slotType: SlotType; slotIndex: number } | null {
	// Check rigs first so their flags remain unambiguous if EVE adds adjacent flags.
	if (flag >= 92 && flag <= 99) return { slotType: 'rig', slotIndex: flag - 92 }
	for (const range of EQUIPPED_FLAG_RANGES) {
		if (flag >= range.min && flag <= range.max) {
			return { slotType: range.type, slotIndex: flag - range.base }
		}
	}
	return null
}

interface KillmailItem {
	item_type_id: number
	flag: number
	quantity_destroyed?: number
	quantity_dropped?: number
	items?: KillmailItem[]
}

export interface SRPCargoItem {
	typeId: string
	typeName: string
	quantity: number
	flag: number
}

export interface SRPShipMaintenanceBayContent {
	typeId: string
	typeName: string
	quantity: number
	flag: number
	items?: SRPShipMaintenanceBayContent[]
}

export interface SRPShipMaintenanceBayShip {
	typeId: string
	typeName: string
	quantity: number
	contents: SRPShipMaintenanceBayContent[]
}

interface SRPItemPrice {
	typeId: string
	price: string
	isConsumable?: boolean
}

function flattenKillmailItemsForDisplay(
	items: KillmailItem[],
	inheritedFlag?: number,
	includeContainedShips = true
): KillmailItem[] {
	const flattened: KillmailItem[] = []

	for (const item of items) {
		const slot = flagToSlot(item.flag)
		const isContainedShip = item.flag === SHIP_MAINTENANCE_BAY_FLAG
		const displayFlag = isContainedShip ? 5 : slot ? item.flag : (inheritedFlag ?? item.flag)

		if (!isContainedShip || includeContainedShips) {
			flattened.push({
				item_type_id: item.item_type_id,
				flag: displayFlag,
				quantity_destroyed: item.quantity_destroyed,
				quantity_dropped: item.quantity_dropped,
			})
		}

		if (!isContainedShip && item.items?.length) {
			flattened.push(
				...flattenKillmailItemsForDisplay(item.items, displayFlag, includeContainedShips)
			)
		}
	}

	return flattened
}

export function transformKillmailToFittingItems(
	killmailItems: KillmailItem[],
	srpItemPrices: SRPItemPrice[],
	itemNames: Record<string, string> = {}
): SRPFittingItem[] {
	const priceMap = new Map<string, string>()
	const consumableSet = new Set<string>()
	for (const p of srpItemPrices) {
		priceMap.set(p.typeId, p.price)
		if (p.isConsumable) consumableSet.add(p.typeId)
	}

	const result: SRPFittingItem[] = []
	const flattenedItems = flattenKillmailItemsForDisplay(killmailItems)

	for (const item of flattenedItems) {
		const slot = flagToSlot(item.flag)
		if (!slot) continue

		const typeId = String(item.item_type_id)
		const quantity = (item.quantity_destroyed ?? 0) + (item.quantity_dropped ?? 0) || 1
		const unitPrice = priceMap.get(typeId) ?? '0'
		const lineTotal = String(Math.round(parseFloat(unitPrice) * quantity))

		result.push({
			typeId,
			typeName: itemNames[typeId] ?? typeId,
			quantity,
			flag: item.flag,
			slotType: slot.slotType,
			slotIndex: slot.slotIndex,
			unitPrice,
			lineTotal,
			...(consumableSet.has(typeId) ? { isConsumable: true } : {}),
		})
	}

	return result.sort((a, b) => {
		const typeOrder: SlotType[] = ['high', 'mid', 'low', 'rig', 'sub', 'implant']
		const ta = typeOrder.indexOf(a.slotType)
		const tb = typeOrder.indexOf(b.slotType)
		if (ta !== tb) return ta - tb
		return a.slotIndex - b.slotIndex
	})
}

export function transformKillmailToCargoItems(
	killmailItems: KillmailItem[],
	itemNames: Record<string, string> = {}
): SRPCargoItem[] {
	const byType = new Map<string, SRPCargoItem>()
	const flattenedItems = flattenKillmailItemsForDisplay(killmailItems, undefined, false)

	for (const item of flattenedItems) {
		if (item.flag !== 5) continue
		const typeId = String(item.item_type_id)
		const quantity = (item.quantity_destroyed ?? 0) + (item.quantity_dropped ?? 0) || 1
		const existing = byType.get(typeId)
		if (existing) {
			existing.quantity += quantity
			continue
		}
		byType.set(typeId, {
			typeId,
			typeName: itemNames[typeId] ?? typeId,
			quantity,
			flag: item.flag,
		})
	}

	return [...byType.values()].sort((left, right) => left.typeName.localeCompare(right.typeName))
}

function transformMaintenanceBayContents(
	items: KillmailItem[] | undefined,
	itemNames: Record<string, string>
): SRPShipMaintenanceBayContent[] {
	return (items ?? []).map((item) => ({
		typeId: String(item.item_type_id),
		typeName: itemNames[String(item.item_type_id)] ?? String(item.item_type_id),
		quantity: (item.quantity_destroyed ?? 0) + (item.quantity_dropped ?? 0) || 1,
		flag: item.flag,
		items: item.items?.length ? transformMaintenanceBayContents(item.items, itemNames) : undefined,
	}))
}

export function transformKillmailToShipMaintenanceBayShips(
	killmailItems: KillmailItem[],
	itemNames: Record<string, string> = {}
): SRPShipMaintenanceBayShip[] {
	return killmailItems
		.filter((item) => item.flag === SHIP_MAINTENANCE_BAY_FLAG)
		.map((item) => ({
			typeId: String(item.item_type_id),
			typeName: itemNames[String(item.item_type_id)] ?? String(item.item_type_id),
			quantity: (item.quantity_destroyed ?? 0) + (item.quantity_dropped ?? 0) || 1,
			contents: transformMaintenanceBayContents(item.items, itemNames),
		}))
}

export const POD_TYPE_IDS = new Set(['670', '33328'])

export function isPodLoss(shipTypeId: string): boolean {
	return POD_TYPE_IDS.has(shipTypeId)
}
