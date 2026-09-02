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
	/** Query-time projection; omitted from the persisted ESI snapshot. */
	estimatedAmount?: number
	estimatedDepletionAt?: string | null
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

export type SovereigntyReagentBaySnapshotValue =
	| SovereigntyReagentEntry[]
	| SovereigntyReagentBaySnapshot

function parseTimestampMs(value: string | null | undefined): number | null {
	if (!value) {
		return null
	}

	const timestampMs = Date.parse(value)
	return Number.isFinite(timestampMs) ? timestampMs : null
}

function estimateReagentDepletionAt(
	quantity: number,
	burningPerHour: number,
	referenceTimeMs: number
): string | null {
	if (
		quantity <= 0 ||
		!Number.isFinite(quantity) ||
		!Number.isFinite(burningPerHour) ||
		burningPerHour <= 0
	) {
		return null
	}

	return new Date(referenceTimeMs + (quantity / burningPerHour) * 60 * 60 * 1000).toISOString()
}

/**
 * ESI's reagent amount is a point-in-time baseline, not a live counter.
 * Project it forward using the reported burn rate while never allowing a
 * future or malformed timestamp to increase the reported amount.
 */
export function estimateSovereigntyReagentAmount(
	reagent: Pick<SovereigntyReagentEntry, 'amount' | 'burningPerHour'>,
	lastUpdated: string | null | undefined,
	referenceTimeMs = Date.now()
): number {
	const amount = Number.isFinite(reagent.amount) ? Math.floor(Math.max(0, reagent.amount)) : 0
	const burningPerHour = reagent.burningPerHour
	const snapshotTimeMs = parseTimestampMs(lastUpdated)

	if (snapshotTimeMs === null || !Number.isFinite(burningPerHour) || burningPerHour <= 0) {
		return amount
	}

	const elapsedHours = Math.max(0, referenceTimeMs - snapshotTimeMs) / (60 * 60 * 1000)
	return Math.floor(Math.max(0, amount - elapsedHours * burningPerHour))
}

export function getEstimatedSovereigntyReagent(
	reagent: SovereigntyReagentEntry,
	lastUpdated: string | null | undefined,
	referenceTimeMs = Date.now()
): SovereigntyReagentEntry {
	const estimatedAmount = estimateSovereigntyReagentAmount(reagent, lastUpdated, referenceTimeMs)

	return {
		...reagent,
		estimatedAmount,
		estimatedDepletionAt: estimateReagentDepletionAt(
			estimatedAmount,
			reagent.burningPerHour,
			referenceTimeMs
		),
	}
}

export function summarizeSovereigntyReagentStats(
	reagents: readonly SovereigntyReagentEntry[],
	match: { typeId: string; typeName: string },
	referenceTimeMs: number,
	lastUpdated?: string | null
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

			accumulator.quantity += estimateSovereigntyReagentAmount(
				reagent,
				lastUpdated,
				referenceTimeMs
			)
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
	referenceTimeMs = Date.now(),
	lastUpdated?: string | null
): SovereigntyReagentSummary {
	const magmaticGasStats = summarizeSovereigntyReagentStats(
		reagents,
		{
			typeId: SKYHOOK_MAGMATIC_GAS_TYPE_ID,
			typeName: SKYHOOK_MAGMATIC_GAS_TYPE_NAME,
		},
		referenceTimeMs,
		lastUpdated
	)
	const superionicIceStats = summarizeSovereigntyReagentStats(
		reagents,
		{
			typeId: SKYHOOK_SUPERIONIC_ICE_TYPE_ID,
			typeName: SKYHOOK_SUPERIONIC_ICE_TYPE_NAME,
		},
		referenceTimeMs,
		lastUpdated
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
	value: SovereigntyReagentBaySnapshotValue,
	referenceTimeMs = Date.now()
): SovereigntyReagentSummary | null {
	if (Array.isArray(value)) {
		return summarizeSovereigntyReagentBay(value, referenceTimeMs)
	}

	// Do not reuse the persisted summary: it was calculated when the snapshot
	// was ingested and cannot account for elapsed reagent burn.
	return summarizeSovereigntyReagentBay(value.reagents, referenceTimeMs, value.lastUpdated)
}
