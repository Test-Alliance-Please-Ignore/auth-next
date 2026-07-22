import type {
	StructureListSummary,
	StructureSkyhookListItem,
} from '@repo/structures'

type SkyhookRaidableWindowSelection = {
	structureId: string
	selectionStartMs: number
	countdownTargetMs: number
	planetName: string | null
}

function parseDateMs(value: string | null | undefined): number | null {
	if (!value) {
		return null
	}

	const time = new Date(value).getTime()
	return Number.isFinite(time) ? time : null
}

export function summarizeSkyhooks(
	items: StructureSkyhookListItem[]
): Pick<
	StructureListSummary,
		| 'skyhookHighestFillPercent'
		| 'skyhookNextRaidableAt'
		| 'skyhookNextRaidablePlanetName'
		| 'skyhookCurrentRaidableCount'
> {
	const nowMs = Date.now()
	let skyhookHighestFillPercent: number | null = null
	let nextRaidableWindow: SkyhookRaidableWindowSelection | null = null
	let currentRaidableCount = 0

	for (const item of items) {
		const itemHighestFillPercent = Math.max(item.securedFillPercent, item.unsecuredFillPercent)
		if (Number.isFinite(itemHighestFillPercent)) {
			skyhookHighestFillPercent =
				skyhookHighestFillPercent === null
					? itemHighestFillPercent
					: Math.max(skyhookHighestFillPercent, itemHighestFillPercent)
		}

		const startMs = parseDateMs(item.theftVulnerabilityStart)
		const fallbackStartMs = parseDateMs(item.becomesRaidableAt ?? item.vulnerableAt)
		const endMs = parseDateMs(item.theftVulnerabilityEnd)
		const selectionStartMs = startMs ?? fallbackStartMs
		const isExpiredWindow = endMs !== null && nowMs > endMs
		const isActiveWindow =
			startMs !== null &&
			(endMs === null ? nowMs > startMs : nowMs > startMs && nowMs < endMs)
		const isCurrentlyRaidable = !isExpiredWindow && (item.isRaidable || isActiveWindow)

		if (!isExpiredWindow && selectionStartMs !== null) {
			const candidate: SkyhookRaidableWindowSelection = {
				structureId: item.structureId,
				selectionStartMs,
				countdownTargetMs: isCurrentlyRaidable ? nowMs : selectionStartMs,
				planetName: item.planetName ?? null,
			}
			if (
				nextRaidableWindow === null ||
				candidate.selectionStartMs < nextRaidableWindow.selectionStartMs ||
				(candidate.selectionStartMs === nextRaidableWindow.selectionStartMs &&
					candidate.structureId < nextRaidableWindow.structureId)
			) {
				nextRaidableWindow = candidate
			}
		}

		if (isCurrentlyRaidable) {
			currentRaidableCount += 1
		}
	}

	return {
		skyhookHighestFillPercent,
		skyhookNextRaidableAt:
			nextRaidableWindow !== null ? new Date(nextRaidableWindow.countdownTargetMs).toISOString() : null,
		skyhookNextRaidablePlanetName: nextRaidableWindow?.planetName ?? null,
		skyhookCurrentRaidableCount: currentRaidableCount,
	}
}

export function buildSkyhookStructureSummary(
	items: StructureSkyhookListItem[],
	options: { skyhookTotalWorkforce?: number | null } = {}
): StructureListSummary {
	return {
		total: items.length,
		lowFuel: 0,
		lowPower: 0,
		reinforced: 0,
		estimatedFuelBurnRatePerHour: null,
		fuelBurnRateSampleCount: 0,
		skyhookTotalWorkforce:
			options.skyhookTotalWorkforce ?? items.reduce((total, item) => total + (item.effectiveWorkforce ?? 0), 0),
		...summarizeSkyhooks(items),
	}
}
