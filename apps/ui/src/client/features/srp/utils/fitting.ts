export type SlotType = 'high' | 'mid' | 'low' | 'rig' | 'sub' | 'implant'

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
	{ min: 89, max: 98, type: 'implant', base: 89 },
	{ min: 92, max: 99, type: 'rig', base: 92 },
	{ min: 125, max: 132, type: 'sub', base: 125 },
]

// Rigs overlap with implants in flag range — rigs take priority (92-99 over implants 89-98)
function flagToSlot(flag: number): { slotType: SlotType; slotIndex: number } | null {
	// Check rigs first (92-99) before implants (89-98) due to overlap
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
}

interface SRPItemPrice {
	typeId: string
	price: string
	isConsumable?: boolean
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

	for (const item of killmailItems) {
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

export const POD_TYPE_IDS = new Set(['670', '33328'])

export function isPodLoss(shipTypeId: string): boolean {
	return POD_TYPE_IDS.has(shipTypeId)
}
