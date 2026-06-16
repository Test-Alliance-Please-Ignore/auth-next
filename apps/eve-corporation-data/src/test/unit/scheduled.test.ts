import { describe, expect, it } from 'vitest'

import {
	computeNextAttemptAtMs,
	enrichQueueEntry,
	getFreshnessThresholdMs,
	getRefreshBucket,
	selectPriorityDrain,
} from '../../workflows/utils/background-refresh-batching'

import type {
	BackgroundRefreshCorporation,
	EnrichedQueueEntry,
} from '../../workflows/utils/background-refresh-batching'

function makeCorporation(overrides: Partial<BackgroundRefreshCorporation> = {}): BackgroundRefreshCorporation {
	return {
		corporationId: '1',
		name: 'Test Corp',
		lastSync: null,
		includeInStructureAssetSync: false,
		isMemberCorporation: false,
		isAltCorp: false,
		isSpecialPurpose: false,
		...overrides,
	}
}

function makeDueEntry(
	corporationId: string,
	bucket: EnrichedQueueEntry['bucket'],
	staleMs: number,
	nextAttemptAtMs = 0
): EnrichedQueueEntry {
	return {
		corporationId,
		name: corporationId,
		nextAttemptAtMs,
		attempt: 0,
		bucket,
		lastSyncMs: Date.now() - staleMs,
		freshnessThresholdMs: bucket === 'structure-asset' ? 60 * 60 * 1000 : 30 * 60 * 1000,
		staleMs,
	}
}

function buildRefreshSimulationCorporations(now: number): BackgroundRefreshCorporation[] {
	const freshSync = new Date(now).toISOString()

	return [
		...Array.from({ length: 5 }, (_, index) =>
			makeCorporation({
				corporationId: `structure-${index}`,
				name: `Structure ${index}`,
				includeInStructureAssetSync: true,
				lastSync: freshSync,
			})
		),
		...Array.from({ length: 40 }, (_, index) =>
			makeCorporation({
				corporationId: `member-${index}`,
				name: `Member ${index}`,
				isMemberCorporation: true,
				lastSync: freshSync,
			})
		),
		...Array.from({ length: 5 }, (_, index) =>
			makeCorporation({
				corporationId: `special-${index}`,
				name: `Special ${index}`,
				isSpecialPurpose: true,
				lastSync: freshSync,
			})
		),
		...Array.from({ length: 50 }, (_, index) =>
			makeCorporation({
				corporationId: `alt-${index}`,
				name: `Alt ${index}`,
				isAltCorp: true,
				lastSync: freshSync,
			})
		),
		...Array.from({ length: 10 }, (_, index) =>
			makeCorporation({
				corporationId: `other-${index}`,
				name: `Other ${index}`,
				lastSync: freshSync,
			})
		),
	]
}

function getStaticBucket(corporation: BackgroundRefreshCorporation): 'structure-asset' | 'member' | 'alt-special' | 'other' {
	if (corporation.includeInStructureAssetSync) return 'structure-asset'
	if (corporation.isMemberCorporation) return 'member'
	if (corporation.isAltCorp || corporation.isSpecialPurpose) return 'alt-special'
	return 'other'
}

function summarizeNumbers(values: number[]) {
	const sorted = [...values].sort((a, b) => a - b)
	const total = sorted.reduce((sum, value) => sum + value, 0)
	const average = sorted.length > 0 ? total / sorted.length : 0
	const median =
		sorted.length === 0
			? 0
			: sorted.length % 2 === 1
				? sorted[Math.floor(sorted.length / 2)]!
				: (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2

	return {
		smallest: sorted[0] ?? 0,
		medium: median,
		most: sorted[sorted.length - 1] ?? 0,
		average,
	}
}

function formatDurationMs(ms: number): string {
	const totalSeconds = Math.round(ms / 1000)
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	return [
		hours > 0 ? `${hours}h` : null,
		minutes > 0 || hours > 0 ? `${minutes}m` : null,
		`${seconds}s`,
	].filter((part): part is string => part !== null).join(' ')
}

function simulateRefreshRuns(
	corporations: BackgroundRefreshCorporation[],
	startMs: number,
	runCount: number,
	intervalMs: number,
	batchSize: number
): {
	selectedByRun: EnrichedQueueEntry[][]
	refreshCounts: Map<string, number>
	refreshTimelineByCorp: Map<string, number[]>
} {
	const corpStateById = new Map(corporations.map((corp) => [corp.corporationId, { ...corp }] as const))
	let queueByCorpId = new Map<string, { corporationId: string; name: string; nextAttemptAtMs: number; attempt: number }>()

	for (const corporation of corporations) {
		queueByCorpId.set(corporation.corporationId, {
			corporationId: corporation.corporationId,
			name: corporation.name,
			nextAttemptAtMs: computeNextAttemptAtMs(corporation, startMs),
			attempt: 0,
		})
	}

	const selectedByRun: EnrichedQueueEntry[][] = []
	const refreshCounts = new Map<string, number>()
	const refreshTimelineByCorp = new Map<string, number[]>()

	for (let run = 0; run < runCount; run++) {
		const runAt = startMs + run * intervalMs
		const queueEntries = [...queueByCorpId.values()].map((entry) => {
			const corporation = corpStateById.get(entry.corporationId)
			if (!corporation) {
				return entry
			}
			return {
				...entry,
				nextAttemptAtMs: computeNextAttemptAtMs(corporation, runAt, entry.nextAttemptAtMs),
			}
		})
		queueByCorpId = new Map(queueEntries.map((entry) => [entry.corporationId, entry] as const))

		const due = queueEntries
			.filter((entry) => entry.nextAttemptAtMs <= runAt)
			.map((entry) => {
				const corporation = corpStateById.get(entry.corporationId)
				if (!corporation) return null
				return enrichQueueEntry(entry, corporation, runAt)
			})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null)

		let { draining } = selectPriorityDrain(due, batchSize)
		if (draining.length < batchSize) {
			const deferred = queueEntries
				.filter((entry) => entry.nextAttemptAtMs > runAt)
				.map((entry) => {
					const corporation = corpStateById.get(entry.corporationId)
					if (!corporation) return null
					return enrichQueueEntry(entry, corporation, runAt)
				})
				.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
			const fallback = selectPriorityDrain(deferred, batchSize - draining.length)
			draining = [...draining, ...fallback.draining]
		}
		selectedByRun.push(draining)

		for (const entry of draining) {
			refreshCounts.set(entry.corporationId, (refreshCounts.get(entry.corporationId) ?? 0) + 1)
			const timeline = refreshTimelineByCorp.get(entry.corporationId) ?? []
			timeline.push(runAt)
			refreshTimelineByCorp.set(entry.corporationId, timeline)
			const corporation = corpStateById.get(entry.corporationId)
			if (corporation) {
				corpStateById.set(entry.corporationId, {
					...corporation,
					lastSync: new Date(runAt).toISOString(),
				})
			}
		}
	}

	return {
		selectedByRun,
		refreshCounts,
		refreshTimelineByCorp,
	}
}

function summarizeSimulationMetrics(
	corporations: BackgroundRefreshCorporation[],
	refreshTimelineByCorp: Map<string, number[]>
) {
	const intervalsByCorp = new Map<string, number[]>()
	for (const [corporationId, timeline] of refreshTimelineByCorp) {
		const intervals: number[] = []
		for (let index = 1; index < timeline.length; index++) {
			intervals.push(timeline[index]! - timeline[index - 1]!)
		}
		intervalsByCorp.set(corporationId, intervals)
	}

	const allIntervals = [...intervalsByCorp.values()].flat()
	const bucketCounts = new Map<'structure-asset' | 'member' | 'alt-special' | 'other', number[]>()
	for (const bucket of ['structure-asset', 'member', 'alt-special', 'other'] as const) {
		bucketCounts.set(bucket, [])
	}
	for (const corp of corporations) {
		const bucket = getStaticBucket(corp)
		const count = refreshTimelineByCorp.get(corp.corporationId)?.length ?? 0
		bucketCounts.get(bucket)!.push(count)
	}

	return {
		longestWaitMs: allIntervals.length > 0 ? Math.max(...allIntervals) : 0,
		averageWaitMs:
			allIntervals.length > 0
				? allIntervals.reduce((sum, value) => sum + value, 0) / allIntervals.length
				: 0,
		refreshesPerBucket: {
			'structure-asset': summarizeNumbers(bucketCounts.get('structure-asset') ?? []),
			member: summarizeNumbers(bucketCounts.get('member') ?? []),
			'alt-special': summarizeNumbers(bucketCounts.get('alt-special') ?? []),
			other: summarizeNumbers(bucketCounts.get('other') ?? []),
		},
	}
}

describe('scheduled background refresh selection', () => {
	it('applies the expected freshness thresholds by bucket', () => {
		const now = Date.UTC(2026, 5, 15, 20, 0, 0)
		const lastSync = new Date(now - 20 * 60 * 1000).toISOString()

		const structureCorp = makeCorporation({
			includeInStructureAssetSync: true,
			lastSync,
		})
		const optedInMemberCorp = makeCorporation({
			includeInStructureAssetSync: true,
			isMemberCorporation: true,
			lastSync,
		})
		const regularCorp = makeCorporation({
			lastSync,
		})

		expect(getRefreshBucket(structureCorp, 2 * 60 * 60 * 1000)).toBe('structure-asset')
		expect(getRefreshBucket(optedInMemberCorp, 20 * 60 * 1000)).toBe('member')
		expect(getRefreshBucket(regularCorp, 2 * 60 * 60 * 1000)).toBe('backstop')
		expect(getRefreshBucket(regularCorp, 20 * 60 * 1000)).toBe('other')
		expect(getFreshnessThresholdMs(structureCorp)).toBe(30 * 60 * 1000)
		expect(getFreshnessThresholdMs(regularCorp)).toBe(30 * 60 * 1000)

		expect(computeNextAttemptAtMs(structureCorp, now)).toBe(now + 10 * 60 * 1000)
		expect(computeNextAttemptAtMs(regularCorp, now)).toBe(now + 10 * 60 * 1000)
	})

	it('drains structure assets first, then backstop corps, then fills the remaining batch by bucket targets', () => {
		const draining = selectPriorityDrain(
			[
				makeDueEntry('structure-old', 'structure-asset', 2 * 60 * 60 * 1000),
				makeDueEntry('backstop-old', 'backstop', 2 * 60 * 60 * 1000),
				makeDueEntry('member-old', 'member', 90 * 60 * 1000),
				makeDueEntry('member-mid-1', 'member', 50 * 60 * 1000),
				makeDueEntry('member-mid-2', 'member', 49 * 60 * 1000),
				makeDueEntry('member-mid-3', 'member', 48 * 60 * 1000),
				makeDueEntry('alt-mid-1', 'alt-special', 47 * 60 * 1000),
				makeDueEntry('alt-mid-2', 'alt-special', 46 * 60 * 1000),
				makeDueEntry('other-mid-1', 'other', 45 * 60 * 1000),
				makeDueEntry('other-mid-2', 'other', 44 * 60 * 1000),
			],
			8
		)

		expect(draining.draining.map((entry) => entry.corporationId)).toEqual([
			'structure-old',
			'backstop-old',
			'member-old',
			'member-mid-1',
			'member-mid-2',
			'alt-mid-1',
			'other-mid-1',
			'other-mid-2',
		])
		expect(draining.remainingDue.map((entry) => entry.corporationId)).toEqual([
			'member-mid-3',
			'alt-mid-2',
		])
	})

	it('caps backstop corps at roughly a quarter of the batch when other work is available', () => {
		const now = Date.UTC(2026, 5, 15, 20, 0, 0)
		const due = [
			...Array.from({ length: 4 }, (_, index) =>
				enrichQueueEntry(
					{
						corporationId: `backstop-${index}`,
						name: `Backstop ${index}`,
						nextAttemptAtMs: 0,
						attempt: 0,
					},
					makeCorporation({ lastSync: new Date(now - 2.5 * 60 * 60 * 1000).toISOString() }),
					now
				)
			),
			...Array.from({ length: 4 }, (_, index) =>
				enrichQueueEntry(
					{
						corporationId: `member-${index}`,
						name: `Member ${index}`,
						nextAttemptAtMs: 0,
						attempt: 0,
					},
					makeCorporation({ isMemberCorporation: true, lastSync: new Date(now - 45 * 60 * 1000).toISOString() }),
					now
				)
			),
		]

		const selected = selectPriorityDrain(due, 8)
		const selectedBackstopCount = selected.draining.filter((entry) => entry.bucket === 'backstop').length
		expect(selectedBackstopCount).toBe(2)
		expect(selected.draining.map((entry) => entry.corporationId)).toEqual([
			'backstop-0',
			'backstop-1',
			'member-0',
			'member-1',
			'member-2',
			'member-3',
		])
	})

	it('refreshes a mixed 110-corp background batch within an artificial two-hour window', () => {
		const startMs = Date.UTC(2026, 5, 15, 20, 0, 0)
		const corporations = buildRefreshSimulationCorporations(startMs)
		const { selectedByRun, refreshCounts, refreshTimelineByCorp } = simulateRefreshRuns(
			corporations,
			startMs,
			24,
			5 * 60 * 1000,
			20
		)
		const metrics = summarizeSimulationMetrics(corporations, refreshTimelineByCorp)

		console.info(
			'[scheduled background refresh metrics]',
			JSON.stringify(
				{
					longestWait: formatDurationMs(metrics.longestWaitMs),
					averageWait: formatDurationMs(metrics.averageWaitMs),
					raw: metrics,
				},
				null,
				2
			)
		)

		expect(selectedByRun[0]?.length).toBeLessThanOrEqual(20)
		expect(new Set(selectedByRun.flat().map((entry) => entry.corporationId)).size).toBe(110)
		expect(refreshCounts.size).toBe(110)
		expect([...refreshCounts.values()].every((count) => count >= 1)).toBe(true)
		expect(corporations.every((corp) => refreshCounts.has(corp.corporationId))).toBe(true)
	})
})
