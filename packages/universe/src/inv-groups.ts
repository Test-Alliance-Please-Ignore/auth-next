/**
 * InvGroup represents an inventory group from the EVE Online SDE
 */
export interface InvGroup {
	groupId: string
	categoryId: string
	groupName: string
	iconId: string | null
	useBasePrice: boolean
	anchored: boolean
	anchorable: boolean
	fittableNonSingleton: boolean
	published: boolean
}
