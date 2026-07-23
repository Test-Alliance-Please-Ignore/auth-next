export interface StructureFuelHistorySample {
	structureId: string
	fuelBlockUnits: number
	observedAt: Date
	updatedAt: Date
}

export interface StructureFuelHistoryMetrics {
	fuelBurnRatePerHour: number | null
	lastRefilledAt: Date | null
	sampleCount: number
}

function sortSamplesDescending(
	left: StructureFuelHistorySample,
	right: StructureFuelHistorySample
): number {
	const observedDiff = right.observedAt.getTime() - left.observedAt.getTime()
	if (observedDiff !== 0) {
		return observedDiff
	}
	return right.updatedAt.getTime() - left.updatedAt.getTime()
}

export function deriveStructureFuelHistoryMetrics(
	samples: readonly StructureFuelHistorySample[]
): StructureFuelHistoryMetrics {
	if (samples.length < 2) {
		return {
			fuelBurnRatePerHour: null,
			lastRefilledAt: null,
			sampleCount: samples.length,
		}
	}

	const ordered = [...samples].sort(sortSamplesDescending)
	let lastRefilledAt: Date | null = null

	for (let index = 0; index < ordered.length - 1; index += 1) {
		const newer = ordered[index]
		const older = ordered[index + 1]

		if (lastRefilledAt === null && newer.fuelBlockUnits > older.fuelBlockUnits) {
			lastRefilledAt = newer.observedAt
		}

		if (newer.fuelBlockUnits >= older.fuelBlockUnits) {
			continue
		}

		const elapsedHours = (newer.observedAt.getTime() - older.observedAt.getTime()) / (60 * 60 * 1000)
		if (elapsedHours <= 0) {
			continue
		}

		return {
			fuelBurnRatePerHour: (older.fuelBlockUnits - newer.fuelBlockUnits) / elapsedHours,
			lastRefilledAt,
			sampleCount: ordered.length,
		}
	}

	return {
		fuelBurnRatePerHour: null,
		lastRefilledAt,
		sampleCount: ordered.length,
	}
}
