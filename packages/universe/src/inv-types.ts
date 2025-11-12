/**
 * InvType represents an inventory type from the EVE Online SDE
 */
export interface InvType {
	typeId: string
	groupId: string
	typeName: string
	description: string
	mass: string
	volume: string
	capacity: string
	portionSize: number
	raceId: string | null
	basePrice: string | null
	published: boolean
	marketGroupId: string | null
	iconId: string | null
	soundId: string | null
	graphicId: string
}
