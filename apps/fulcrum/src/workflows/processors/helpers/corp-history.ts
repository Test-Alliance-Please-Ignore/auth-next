/**
 * Data enrichment functions for character corporation history
 * Resolves corporation IDs to human-readable names using ESI Type Resolver
 */

import { getStub } from '@repo/do-utils'

import type { CorporationHistoryEntry, EsiTypeResolver } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

/**
 * Enriched corporation history entry with resolved names
 */
export interface ProcessedCorpHistoryEntry extends CorporationHistoryEntry {
	corporationName?: string
	duration?: string
	processedAt: string
}

export type ProcessedCorpHistory = ProcessedCorpHistoryEntry[]

/**
 * Calculate duration between two dates as a human-readable string
 */
function formatDuration(startDate: string, endDate?: string): string {
	const start = new Date(startDate)
	const end = endDate ? new Date(endDate) : new Date()
	const diffMs = end.getTime() - start.getTime()
	const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))

	if (days < 1) return 'Less than a day'
	if (days < 30) return `${days} day${days !== 1 ? 's' : ''}`

	const months = Math.floor(days / 30)
	if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`

	const years = Math.floor(months / 12)
	const remainingMonths = months % 12
	if (remainingMonths === 0) return `${years} year${years !== 1 ? 's' : ''}`
	return `${years} year${years !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`
}

/**
 * Enrich corporation history by resolving IDs to names
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER binding
 * @param history - Corporation history entries from ESI
 * @param characterId - Character ID (for logging)
 * @returns Enriched history with resolved corporation names and durations
 */
export async function enrichCorpHistory(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	history: CorporationHistoryEntry[],
	characterId: string,
): Promise<ProcessedCorpHistory> {
	if (history.length === 0) {
		return []
	}

	// Collect all corporation IDs that need resolution
	const corpIds = [...new Set(history.map((entry) => entry.corporation_id).filter(Boolean))]

	// Batch resolve all corporation IDs at once
	const nameMap: Record<string, string> = {}
	if (corpIds.length > 0) {
		try {
			const resolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
			const resolved = await resolver.resolveIds(corpIds)
			Object.assign(nameMap, resolved)
		} catch (error) {
			logger.error('[enrichCorpHistory] Failed to resolve corporation IDs:', {
				error: error instanceof Error ? error.message : String(error),
				idCount: corpIds.length,
			})
		}
	}

	// Sort by start_date descending (most recent first)
	const sorted = [...history].sort(
		(a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
	)

	// Build enriched entries with durations
	const processedAt = new Date().toISOString()
	return sorted.map((entry, index) => {
		// End date is the start date of the next (more recent) entry, or now for the current corp
		const endDate = index === 0 ? undefined : sorted[index - 1].start_date
		const duration = formatDuration(entry.start_date, endDate)

		return {
			...entry,
			corporationName: nameMap[entry.corporation_id],
			duration,
			processedAt,
		}
	})
}
