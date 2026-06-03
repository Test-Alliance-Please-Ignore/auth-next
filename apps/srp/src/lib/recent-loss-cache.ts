import type { CharacterKillmailBasic } from '@repo/esi'
import type { CharacterLossData } from '@repo/eve-character-data'

export interface RecentLossCacheRecord {
	losses: CharacterLossData[]
	refreshedAtMs: number
	complete: boolean
	maxLossAgeDays: number
}

export interface RecentLossCacheStorageRecord {
	losses: Array<Omit<CharacterLossData, 'killmailTime'> & { killmailTime: string }>
	refreshedAtMs: number
	complete: boolean
	maxLossAgeDays: number
}

export interface RecentKillmailSelection {
	killmails: CharacterKillmailBasic[]
	reachedKnownKillmail: boolean
}

export function doesRecentLossCacheCoverCutoff(
	record: RecentLossCacheRecord | null,
	cutoffMs: number,
	currentMaxLossAgeDays: number
): boolean {
	if (!record || record.complete !== true || record.losses.length === 0) {
		return false
	}

	if (!Number.isFinite(record.maxLossAgeDays) || record.maxLossAgeDays < currentMaxLossAgeDays) {
		return false
	}

	const oldestLossTimeMs = record.losses.reduce((oldest, loss) => {
		const lossTime = new Date(loss.killmailTime).getTime()
		if (!Number.isFinite(lossTime)) return oldest
		return Math.min(oldest, lossTime)
	}, Number.POSITIVE_INFINITY)

	return Number.isFinite(oldestLossTimeMs) && oldestLossTimeMs <= cutoffMs
}

export function shouldInvalidateRecentLossCache(
	record: RecentLossCacheRecord | null,
	currentMaxLossAgeDays: number
): boolean {
	if (!record) return false
	if (!Number.isFinite(record.maxLossAgeDays)) return true
	return record.maxLossAgeDays < currentMaxLossAgeDays
}

export function selectRecentKillmailsUntilKnown(
	killmails: CharacterKillmailBasic[],
	knownKillmailIds: ReadonlySet<string>
): RecentKillmailSelection {
	if (knownKillmailIds.size === 0) {
		return {
			killmails: killmails.slice(),
			reachedKnownKillmail: false,
		}
	}

	const selected: CharacterKillmailBasic[] = []
	for (const killmail of killmails) {
		if (knownKillmailIds.has(String(killmail.killmail_id))) {
			return {
				killmails: selected,
				reachedKnownKillmail: true,
			}
		}
		selected.push(killmail)
	}

	return {
		killmails: selected,
		reachedKnownKillmail: false,
	}
}

export function mergeRecentLosses(
	existingLosses: CharacterLossData[],
	newLosses: CharacterLossData[],
	cutoffMs: number
): CharacterLossData[] {
	const lossesById = new Map<string, CharacterLossData>()
	for (const loss of [...existingLosses, ...newLosses]) {
		const lossTime = new Date(loss.killmailTime).getTime()
		if (!Number.isFinite(lossTime) || lossTime < cutoffMs) continue
		lossesById.set(String(loss.killmailId), loss)
	}

	return [...lossesById.values()].sort(
		(a, b) => new Date(b.killmailTime).getTime() - new Date(a.killmailTime).getTime()
	)
}
