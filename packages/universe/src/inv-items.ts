/**
 * InvItem represents an inventory item from the EVE Online SDE
 */
export interface InvItem {
	itemId: string
	typeId: string
	ownerId: string
	locationId: string
	flagId: string
	quantity: string
}
