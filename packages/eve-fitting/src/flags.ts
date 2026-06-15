export type FittingShipSlotType = 'high' | 'mid' | 'low' | 'rig' | 'sub'
export type FittingPodSlotType = 'implant'
export type FittingSlotType = FittingShipSlotType | FittingPodSlotType
export type FittingSlotCapacityType = FittingSlotType
export type FittingSlotSeverity = 'destructive' | 'warning' | 'secondary'
export type FittingSlotHighlightMap = Record<string, FittingSlotSeverity>
export type FittingSlotCapacities = Partial<Record<FittingSlotCapacityType, number>>

export interface FittingDisplayItem {
	typeId: string
	typeName: string
	quantity: number
	slotType: FittingSlotType
	slotIndex: number
	isConsumable?: boolean
}

export type FittingSlotFlagName = 'High Slot' | 'Mid Slot' | 'Low Slot' | 'Rig Slot' | 'Subsystem Slot'

export interface ParsedFittingSlotFlag {
	flagName: FittingSlotFlagName
	slotIndex: number
}

const FITTING_SLOT_FLAGS: Array<{
	flagName: FittingSlotFlagName
	esiPrefix: string
}> = [
	{ flagName: 'High Slot', esiPrefix: 'HiSlot' },
	{ flagName: 'Mid Slot', esiPrefix: 'MedSlot' },
	{ flagName: 'Low Slot', esiPrefix: 'LoSlot' },
	{ flagName: 'Rig Slot', esiPrefix: 'RigSlot' },
	{ flagName: 'Subsystem Slot', esiPrefix: 'SubSystemSlot' },
]

export function parseFittingSlotFlag(locationFlag: string): ParsedFittingSlotFlag | null {
	for (const flag of FITTING_SLOT_FLAGS) {
		if (!locationFlag.startsWith(flag.esiPrefix)) {
			continue
		}

		const suffix = locationFlag.slice(flag.esiPrefix.length)
		const slotIndex = Number.parseInt(suffix, 10)
		return {
			flagName: flag.flagName,
			slotIndex: Number.isNaN(slotIndex) ? 0 : slotIndex,
		}
	}

	return null
}
