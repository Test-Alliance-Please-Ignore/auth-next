/**
 * Type metadata used by inventory enrichment.
 */
export interface TypeMetadata {
	marketGroupId: string | null
	marketGroupName: string | null
	categoryName: string
}

/** Static dogma attributes that define the fitting slots available on a type. */
export const TYPE_SLOT_DOGMA_ATTRIBUTE_IDS = {
	low: '12',
	mid: '13',
	high: '14',
	rig: '1137',
} as const

export interface TypeSlotCapacities {
	high: number
	mid: number
	low: number
	rig: number
}
