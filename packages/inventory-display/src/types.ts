export interface InventoryDisplayItem {
	typeId: string
	typeName?: string | null
	quantity: number
	stackCount: number
	/** Total volume for the aggregated quantity, in cubic metres. */
	volumeM3?: number | null
	estimatedValue?: number | null
}

export interface InventoryDisplayBay {
	locationFlag: string
	label: string
	totalQuantity: number
	totalStacks: number
	totalEstimatedValue?: number | null
	items: InventoryDisplayItem[]
}

export interface InventoryRowLike {
	locationFlag: string
	typeId: string
	quantity: number
	typeName?: string | null
	/** Unit volume for one item, in cubic metres. */
	unitVolumeM3?: number | null
}
