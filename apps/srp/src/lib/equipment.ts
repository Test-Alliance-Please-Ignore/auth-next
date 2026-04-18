import { isEquippedSlot } from './slot-flags'

interface KillmailItem {
	flag: number
	item_type_id: number
	quantity_destroyed?: number
	quantity_dropped?: number
}

/**
 * Filter killmail victim items to equipped slots only, then group by typeId
 * summing quantity_destroyed + quantity_dropped for each.
 * Returns an empty map if no equipped items are found.
 */
export function buildEquippedByType(items: KillmailItem[]): Map<string, number> {
	const equipped = new Map<string, number>()
	for (const item of items) {
		if (!item.flag || !item.item_type_id) continue
		if (!isEquippedSlot(item.flag)) continue
		const typeId = String(item.item_type_id)
		const qty = (item.quantity_destroyed ?? 0) + (item.quantity_dropped ?? 0)
		equipped.set(typeId, (equipped.get(typeId) ?? 0) + qty)
	}
	return equipped
}
