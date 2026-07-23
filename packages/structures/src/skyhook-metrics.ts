export const SKYHOOK_SECURED_BAY_CAPACITY_M3 = 70080
export const SKYHOOK_SURPLUS_BAY_CAPACITY_M3 = 70080
export const SKYHOOK_MAGMATIC_GAS_TYPE_ID = '81143'
export const SKYHOOK_SUPERIONIC_ICE_TYPE_ID = '81144'
export const SKYHOOK_MAGMATIC_GAS_TYPE_NAME = 'Magmatic Gas'
export const SKYHOOK_SUPERIONIC_ICE_TYPE_NAME = 'Superionic Ice'

export interface SkyhookReagentEntry {
	typeId: string
	securedStock: number
	unsecuredStock: number
	lastCycle: string
}

export interface SkyhookReagentSummary {
	totalReagents: number
	totalSecuredStock: number
	totalUnsecuredStock: number
	totalSecuredVolumeM3: number
	totalUnsecuredVolumeM3: number
	securedFillPercent: number
	unsecuredFillPercent: number
}

export interface SkyhookReagentSnapshot {
	lastUpdated: string
	summary?: SkyhookReagentSummary
	reagents: SkyhookReagentEntry[]
}

export type SkyhookReagentSnapshotValue = SkyhookReagentEntry[] | SkyhookReagentSnapshot

export function getSkyhookReagentUnitVolumeM3(typeId: string): number {
	switch (typeId) {
		case SKYHOOK_MAGMATIC_GAS_TYPE_ID:
			return 0.01
		case SKYHOOK_SUPERIONIC_ICE_TYPE_ID:
			return 1.5
		default:
			return 0
	}
}

export function getSkyhookReagentTypeName(typeId: string): string | null {
	switch (typeId) {
		case SKYHOOK_MAGMATIC_GAS_TYPE_ID:
			return SKYHOOK_MAGMATIC_GAS_TYPE_NAME
		case SKYHOOK_SUPERIONIC_ICE_TYPE_ID:
			return SKYHOOK_SUPERIONIC_ICE_TYPE_NAME
		default:
			return null
	}
}

export function getSkyhookFullness(volumeM3: number, capacityM3: number): number {
	if (!Number.isFinite(volumeM3) || !Number.isFinite(capacityM3) || capacityM3 <= 0) {
		return 0
	}

	return Math.max(0, Math.min(100, (volumeM3 / capacityM3) * 100))
}

export function summarizeSkyhookReagents(reagents: readonly SkyhookReagentEntry[]): SkyhookReagentSummary {
	const totals = reagents.reduce(
		(accumulator, reagent) => {
			const unitVolumeM3 = getSkyhookReagentUnitVolumeM3(reagent.typeId)
			accumulator.totalReagents += 1
			accumulator.totalSecuredStock += reagent.securedStock
			accumulator.totalUnsecuredStock += reagent.unsecuredStock
			accumulator.totalSecuredVolumeM3 += reagent.securedStock * unitVolumeM3
			accumulator.totalUnsecuredVolumeM3 += reagent.unsecuredStock * unitVolumeM3
			return accumulator
		},
		{
			totalReagents: 0,
			totalSecuredStock: 0,
			totalUnsecuredStock: 0,
			totalSecuredVolumeM3: 0,
			totalUnsecuredVolumeM3: 0,
		}
	)

	return {
		...totals,
		securedFillPercent: getSkyhookFullness(
			totals.totalSecuredVolumeM3,
			SKYHOOK_SECURED_BAY_CAPACITY_M3
		),
		unsecuredFillPercent: getSkyhookFullness(
			totals.totalUnsecuredVolumeM3,
			SKYHOOK_SURPLUS_BAY_CAPACITY_M3
		),
	}
}

export function isSkyhookReagentSnapshot(
	value: SkyhookReagentSnapshotValue
): value is SkyhookReagentSnapshot {
	return !Array.isArray(value)
}

export function getSkyhookReagentEntries(value: SkyhookReagentSnapshotValue): SkyhookReagentEntry[] {
	return Array.isArray(value) ? value : value.reagents
}

export function getSkyhookReagentSummary(value: SkyhookReagentSnapshotValue): SkyhookReagentSummary | null {
	if (Array.isArray(value)) {
		return summarizeSkyhookReagents(value)
	}

	return value.summary ?? summarizeSkyhookReagents(value.reagents)
}
