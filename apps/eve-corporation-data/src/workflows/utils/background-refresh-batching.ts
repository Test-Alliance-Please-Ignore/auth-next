import { parseDateOrNull } from '@repo/worker-utils'

import type { CoreWorker } from '../../context'

/**
 * Scheduler tuning knobs.
 *
 * Keep these centralized so the refresh cadence and bucket split can be tuned
 * without hunting through the scheduler, workflow, and test code.
 */
export const STRUCTURE_ASSET_PRIORITY_WINDOW_MS = 60 * 60 * 1000
export const BACKSTOP_FRESHNESS_MS = 2 * 60 * 60 * 1000
export const GENERAL_REFRESH_FRESHNESS_MS = 30 * 60 * 1000

/**
 * Soft bucket targets once the hard-priority tiers have been drained.
 * The remaining slots are intended to skew toward member corps first,
 * with alt/special corps next and other corps taking the spillover.
 */
export const BACKSTOP_BATCH_SHARE = 0.25
export const MEMBER_BATCH_SHARE = 0.5
export const ALT_SPECIAL_BATCH_SHARE = 0.25

export type BackgroundRefreshCorporation = Awaited<
	ReturnType<CoreWorker['getCorporationsForBackgroundRefresh']>
>[number]

export type RefreshBucket = 'structure-asset' | 'backstop' | 'member' | 'alt-special' | 'other'

export type QueueEntry = {
	corporationId: string
	name: string
	nextAttemptAtMs: number
	attempt: number
}

export type EnrichedQueueEntry = QueueEntry & {
	bucket: RefreshBucket
	lastSyncMs: number | null
	freshnessThresholdMs: number
	staleMs: number
}

/**
 * Structure-asset corps are only elevated into the asset-priority bucket once
 * they are stale enough to warrant the dedicated asset refresh. Otherwise they
 * fall through to the regular corp bucket for scheduling purposes.
 */
export function getRefreshBucket(corporation: BackgroundRefreshCorporation, staleMs: number): RefreshBucket {
	if (corporation.includeInStructureAssetSync && staleMs >= STRUCTURE_ASSET_PRIORITY_WINDOW_MS) {
		return 'structure-asset'
	}
	if (staleMs >= BACKSTOP_FRESHNESS_MS) return 'backstop'
	if (corporation.isMemberCorporation) return 'member'
	if (corporation.isAltCorp) return 'alt-special'
	if (corporation.isSpecialPurpose) return 'alt-special'
	return 'other'
}

export function getFreshnessThresholdMs(_corporation: BackgroundRefreshCorporation): number {
	// The scheduler tracks the general corp refresh cadence here.
	// Structure-asset opt-in only changes which workflow step runs inside the corp workflow,
	// not whether the corp should be eligible for the next background refresh.
	return GENERAL_REFRESH_FRESHNESS_MS
}

export function computeNextAttemptAtMs(
	corporation: BackgroundRefreshCorporation,
	now: number,
	existingNextAttemptAtMs?: number
): number {
	const lastSyncMs = parseDateOrNull(corporation.lastSync)?.getTime() ?? null
	const freshnessThresholdMs = getFreshnessThresholdMs(corporation)
	const freshnessDueAtMs = lastSyncMs === null ? now : lastSyncMs + freshnessThresholdMs
	return Math.max(existingNextAttemptAtMs ?? 0, freshnessDueAtMs)
}

export function enrichQueueEntry(
	entry: QueueEntry,
	corporation: BackgroundRefreshCorporation,
	now: number
): EnrichedQueueEntry {
	const lastSyncMs = parseDateOrNull(corporation.lastSync)?.getTime() ?? null
	const freshnessThresholdMs = getFreshnessThresholdMs(corporation)
	const staleMs = lastSyncMs === null ? Number.POSITIVE_INFINITY : Math.max(0, now - lastSyncMs)
	return {
		...entry,
		bucket: getRefreshBucket(corporation, staleMs),
		lastSyncMs,
		freshnessThresholdMs,
		staleMs,
	}
}

export function compareDueEntries(a: EnrichedQueueEntry, b: EnrichedQueueEntry): number {
	const bucketOrder: Record<RefreshBucket, number> = {
		'structure-asset': 0,
		backstop: 1,
		member: 2,
		'alt-special': 3,
		other: 4,
	}

	const bucketDelta = bucketOrder[a.bucket] - bucketOrder[b.bucket]
	if (bucketDelta !== 0) return bucketDelta

	if (a.staleMs !== b.staleMs) return b.staleMs - a.staleMs
	if (a.nextAttemptAtMs !== b.nextAttemptAtMs) return a.nextAttemptAtMs - b.nextAttemptAtMs
	return a.corporationId.localeCompare(b.corporationId)
}

/**
 * Bucket selection and prioritization model.
 *
 * The scheduler drains a single batch in this order:
 * 1. Structure-asset corps that are opted into asset sync and stale past the
 *    dedicated asset-priority window.
 * 2. Backstop corps that are stale past the two-hour safety window.
 * 3. The soft buckets: member, alt/special, and other.
 *
 * Within a batch, the split is intentionally weighted:
 * - structure-asset corps are taken first
 * - backstop corps are capped to a quarter of the batch when other work exists
 * - the remaining slots are divided roughly 50% member, 25% alt/special,
 *   and 25% other, with spillover used to fill any leftover capacity
 */
export function selectPriorityDrain(
	due: EnrichedQueueEntry[],
	limit: number
): { draining: EnrichedQueueEntry[]; remainingDue: EnrichedQueueEntry[] } {
	if (limit <= 0 || due.length === 0) {
		return { draining: [], remainingDue: due }
	}

	const sortedDue = [...due].sort(compareDueEntries)
	const structureAssetDue = sortedDue.filter((entry) => entry.bucket === 'structure-asset')
	const backstopDue = sortedDue.filter((entry) => entry.bucket === 'backstop')
	const softDue = sortedDue.filter(
		(entry) =>
			entry.bucket === 'member' || entry.bucket === 'alt-special' || entry.bucket === 'other'
	)
	const draining: EnrichedQueueEntry[] = []

	for (const entry of structureAssetDue.slice(0, limit)) {
		draining.push(entry)
	}

	const remainingSlots = limit - draining.length
	if (remainingSlots > 0) {
		const backstopCap = Math.max(0, Math.floor(limit * BACKSTOP_BATCH_SHARE))
		const backstopTakeCount = Math.min(remainingSlots, backstopCap, backstopDue.length)
		for (let index = 0; index < backstopTakeCount; index++) {
			const entry = backstopDue[index]!
			draining.push(entry)
		}

		const slotsAfterBackstop = limit - draining.length
		if (slotsAfterBackstop <= 0) {
			const drainingIds = new Set(draining.map((entry) => entry.corporationId))
			return {
				draining,
				remainingDue: sortedDue.filter((entry) => !drainingIds.has(entry.corporationId)),
			}
		}

		const softByBucket = new Map<RefreshBucket, EnrichedQueueEntry[]>()
		for (const bucket of ['member', 'alt-special', 'other'] as const) {
			softByBucket.set(bucket, [])
		}
		for (const entry of softDue) {
			softByBucket.get(entry.bucket)!.push(entry)
		}

		const targetMember = Math.floor(slotsAfterBackstop * MEMBER_BATCH_SHARE)
		const targetAltSpecial = Math.floor(slotsAfterBackstop * ALT_SPECIAL_BATCH_SHARE)
		const targetOther = Math.max(0, slotsAfterBackstop - targetMember - targetAltSpecial)
		const bucketPlan: Array<{ bucket: RefreshBucket; target: number }> = [
			{ bucket: 'member', target: targetMember },
			{ bucket: 'alt-special', target: targetAltSpecial },
			{ bucket: 'other', target: targetOther },
		]

		const takeFromBucket = (bucket: RefreshBucket, target: number) => {
			const bucketEntries = softByBucket.get(bucket) ?? []
			const takeCount = Math.min(target, bucketEntries.length, limit - draining.length)
			for (let index = 0; index < takeCount; index++) {
				const entry = bucketEntries[index]!
				draining.push(entry)
			}
			softByBucket.set(bucket, bucketEntries.slice(takeCount))
		}

		for (const plan of bucketPlan) {
			takeFromBucket(plan.bucket, plan.target)
		}

		for (const plan of bucketPlan) {
			if (draining.length >= limit) break
			takeFromBucket(plan.bucket, limit - draining.length)
		}
	}

	const drainingIds = new Set(draining.map((entry) => entry.corporationId))
	return {
		draining,
		remainingDue: sortedDue.filter((entry) => !drainingIds.has(entry.corporationId)),
	}
}
