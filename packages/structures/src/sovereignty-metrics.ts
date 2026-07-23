import {
	SKYHOOK_MAGMATIC_GAS_TYPE_ID,
	SKYHOOK_MAGMATIC_GAS_TYPE_NAME,
	SKYHOOK_SUPERIONIC_ICE_TYPE_ID,
	SKYHOOK_SUPERIONIC_ICE_TYPE_NAME,
} from './skyhook-metrics'

export interface SovereigntyReagentEntry {
	typeId: string
	typeName?: string | null
	amount: number
	burningPerHour: number
	lastCycle: string
}

export interface SovereigntyReagentSummary {
	reagentCount: number
	magmaticGasQuantity: number
	magmaticGasBurningPerHour: number
	magmaticGasEstimatedDepletionAt: string | null
	superionicIceQuantity: number
	superionicIceBurningPerHour: number
	superionicIceEstimatedDepletionAt: string | null
}

export interface SovereigntyReagentBaySnapshot {
	lastUpdated: string
	summary?: SovereigntyReagentSummary
	reagents: SovereigntyReagentEntry[]
}

export type SovereigntyReagentBaySnapshotValue = SovereigntyReagentEntry[] | SovereigntyReagentBaySnapshot

function estimateReagentDepletionAt(
	quantity: number,
	burningPerHour: number,
	referenceTimeMs: number
): string | null {
	if (!Number.isFinite(quantity) || !Number.isFinite(burningPerHour) || burningPerHour <= 0) {
		return null
	}

	return new Date(referenceTimeMs + (quantity / burningPerHour) * 60 * 60 * 1000).toISOString()
}

export function summarizeSovereigntyReagentStats(
	reagents: readonly SovereigntyReagentEntry[],
	match: { typeId: string; typeName: string },
	referenceTimeMs: number
): {
	quantity: number
	burningPerHour: number
	estimatedDepletionAt: string | null
} {
	const totals = reagents.reduce(
		(accumulator, reagent) => {
			const normalizedTypeName = reagent.typeName?.trim().toLowerCase() ?? ''
			const matches =
				reagent.typeId === match.typeId || normalizedTypeName === match.typeName.toLowerCase()

			if (!matches) {
				return accumulator
			}

			accumulator.quantity += reagent.amount
			accumulator.burningPerHour += reagent.burningPerHour
			return accumulator
		},
		{ quantity: 0, burningPerHour: 0 }
	)

	return {
		...totals,
		estimatedDepletionAt: estimateReagentDepletionAt(
			totals.quantity,
			totals.burningPerHour,
			referenceTimeMs
		),
	}
}

export function summarizeSovereigntyReagentBay(
	reagents: readonly SovereigntyReagentEntry[],
	referenceTimeMs = Date.now()
): SovereigntyReagentSummary {
	const magmaticGasStats = summarizeSovereigntyReagentStats(
		reagents,
		{
			typeId: SKYHOOK_MAGMATIC_GAS_TYPE_ID,
			typeName: SKYHOOK_MAGMATIC_GAS_TYPE_NAME,
		},
		referenceTimeMs
	)
	const superionicIceStats = summarizeSovereigntyReagentStats(
		reagents,
		{
			typeId: SKYHOOK_SUPERIONIC_ICE_TYPE_ID,
			typeName: SKYHOOK_SUPERIONIC_ICE_TYPE_NAME,
		},
		referenceTimeMs
	)

	return {
		reagentCount: reagents.length,
		magmaticGasQuantity: magmaticGasStats.quantity,
		magmaticGasBurningPerHour: magmaticGasStats.burningPerHour,
		magmaticGasEstimatedDepletionAt: magmaticGasStats.estimatedDepletionAt,
		superionicIceQuantity: superionicIceStats.quantity,
		superionicIceBurningPerHour: superionicIceStats.burningPerHour,
		superionicIceEstimatedDepletionAt: superionicIceStats.estimatedDepletionAt,
	}
}

export function isSovereigntyReagentBaySnapshot(
	value: SovereigntyReagentBaySnapshotValue
): value is SovereigntyReagentBaySnapshot {
	return !Array.isArray(value)
}

export function getSovereigntyReagentBayReagents(
	value: SovereigntyReagentBaySnapshotValue
): SovereigntyReagentEntry[] {
	return Array.isArray(value) ? value : value.reagents
}

export function getSovereigntyReagentBaySummary(
	value: SovereigntyReagentBaySnapshotValue
): SovereigntyReagentSummary | null {
	if (Array.isArray(value)) {
		return summarizeSovereigntyReagentBay(value)
	}

	return value.summary ?? summarizeSovereigntyReagentBay(value.reagents)
}
