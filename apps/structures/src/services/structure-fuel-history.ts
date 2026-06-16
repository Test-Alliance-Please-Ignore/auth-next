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

export interface StructureFuelUsagePoint {
	observedAt: Date
	fuelBlockUnits: number | null
	fuelBurnRatePerHour: number | null
}

export interface StructureFuelUsageHistory {
	points: StructureFuelUsagePoint[]
	fuelBurnRatePerHour: number | null
	lastRefilledAt: Date | null
	sampleCount: number
}

function sortSamplesDescending(left: StructureFuelHistorySample, right: StructureFuelHistorySample): number {
	const observedDiff = right.observedAt.getTime() - left.observedAt.getTime()
	if (observedDiff !== 0) {
		return observedDiff
	}
	return right.updatedAt.getTime() - left.updatedAt.getTime()
}

function sortSamplesAscending(left: StructureFuelHistorySample, right: StructureFuelHistorySample): number {
	const observedDiff = left.observedAt.getTime() - right.observedAt.getTime()
	if (observedDiff !== 0) {
		return observedDiff
	}
	return left.updatedAt.getTime() - right.updatedAt.getTime()
}

function floorToHour(value: Date): Date {
	const floored = new Date(value)
	floored.setMinutes(0, 0, 0)
	return floored
}

function addHours(value: Date, hours: number): Date {
	return new Date(value.getTime() + hours * 60 * 60 * 1000)
}

function deriveStructureFuelHistoryMetricsFromOrderedSamples(
	samples: readonly StructureFuelHistorySample[]
): StructureFuelHistoryMetrics {
	if (samples.length < 2) {
		return {
			fuelBurnRatePerHour: null,
			lastRefilledAt: null,
			sampleCount: samples.length,
		}
	}

	let lastRefilledAt: Date | null = null

	for (let index = samples.length - 1; index > 0; index -= 1) {
		const newer = samples[index]
		const older = samples[index - 1]

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
			sampleCount: samples.length,
		}
	}

	return {
		fuelBurnRatePerHour: null,
		lastRefilledAt,
		sampleCount: samples.length,
	}
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

export function buildStructureFuelUsageHistory(
	samples: readonly StructureFuelHistorySample[],
	options?: { now?: Date; windowHours?: number }
): StructureFuelUsageHistory {
	const now = options?.now ?? new Date()
	const windowHours = options?.windowHours ?? 7 * 24
	const ordered = [...samples].sort(sortSamplesAscending)
	const windowEnd = floorToHour(now)
	const windowStart = addHours(windowEnd, -(windowHours - 1))
	const points: StructureFuelUsagePoint[] = []
	const prefixSamples: StructureFuelHistorySample[] = []
	let cursor = 0
	let latestSample: StructureFuelHistorySample | null = null

	while (cursor < ordered.length && ordered[cursor]!.observedAt < windowStart) {
		prefixSamples.push(ordered[cursor]!)
		latestSample = ordered[cursor]!
		cursor += 1
	}

	for (
		let pointAt = new Date(windowStart);
		pointAt.getTime() <= windowEnd.getTime();
		pointAt = addHours(pointAt, 1)
	) {
		while (cursor < ordered.length && ordered[cursor]!.observedAt <= pointAt) {
			prefixSamples.push(ordered[cursor]!)
			latestSample = ordered[cursor]!
			cursor += 1
		}

		const metrics = deriveStructureFuelHistoryMetricsFromOrderedSamples(prefixSamples)
		points.push({
			observedAt: new Date(pointAt),
			fuelBlockUnits: latestSample?.fuelBlockUnits ?? null,
			fuelBurnRatePerHour: metrics.fuelBurnRatePerHour,
		})
	}

	const summaryMetrics = deriveStructureFuelHistoryMetricsFromOrderedSamples(ordered)
	const samplesInWindow = ordered.filter(
		(sample) => sample.observedAt >= windowStart && sample.observedAt <= windowEnd
	)

	return {
		points,
		fuelBurnRatePerHour: summaryMetrics.fuelBurnRatePerHour,
		lastRefilledAt: summaryMetrics.lastRefilledAt,
		sampleCount: samplesInWindow.length,
	}
}

export function aggregateFuelBurnRatePerHour(samplesByStructure: Map<string, StructureFuelHistorySample[]>): {
	estimatedFuelBurnRatePerHour: string | null
	fuelBurnRateSampleCount: number
} {
	let totalBurnRate = 0
	let sampleCount = 0

	for (const samples of samplesByStructure.values()) {
		const metrics = deriveStructureFuelHistoryMetrics(samples)
		if (metrics.fuelBurnRatePerHour === null) {
			continue
		}

		totalBurnRate += metrics.fuelBurnRatePerHour
		sampleCount += 1
	}

	return {
		estimatedFuelBurnRatePerHour: sampleCount > 0 ? totalBurnRate.toFixed(4) : null,
		fuelBurnRateSampleCount: sampleCount,
	}
}
