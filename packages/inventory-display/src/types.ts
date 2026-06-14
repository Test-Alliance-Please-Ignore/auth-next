export interface InventoryDisplayItem {
	typeId: string
	typeName?: string | null
	quantity: number
	stackCount: number
}

export interface InventoryDisplayBay {
	locationFlag: string
	label: string
	totalQuantity: number
	totalStacks: number
	items: InventoryDisplayItem[]
}

export interface InventoryRowLike {
	locationFlag: string
	typeId: string
	quantity: number
	typeName?: string | null
}
