/**
 * Corp Hopper Alert
 *
 * Flags characters who frequently change player corporations.
 * Looks at up to the last 5 non-NPC corporations and triggers if ANY
 * of them had a stay shorter than 30 days (excluding the current corp).
 *
 * Requires at least 2 player corps in history.
 *
 * Severity: low
 */

import type { ProcessedCorpHistoryEntry } from '../helpers/corp-history'
import type { ReportAlert } from './types'

/** NPC corporation IDs are in the 1000000–1999999 range */
function isNpcCorp(corporationId: string): boolean {
	const id = Number(corporationId)
	return id >= 1_000_000 && id <= 1_999_999
}

const MAX_CORPS_TO_CHECK = 5
const MIN_PLAYER_CORPS = 2

interface CorpStay {
	corporationId: string
	corporationName: string
	startDate: string
	endDate: string | null
	durationDays: number
	isCurrent: boolean
}

/**
 * Check for corp-hopping behaviour.
 *
 * @param corpHistory - Processed corporation history (newest-first from ESI)
 */
export function checkCorpHopper(
	corpHistory: ProcessedCorpHistoryEntry[],
): ReportAlert | null {
	if (!corpHistory || corpHistory.length === 0) return null

	// ESI returns corporation history newest-first, sorted by start_date descending.
	// Build a list of player-corp stays with computed durations.
	const sorted = [...corpHistory].sort(
		(a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime(),
	)

	const playerCorpStays: CorpStay[] = []

	for (let i = 0; i < sorted.length; i++) {
		const entry = sorted[i]
		if (isNpcCorp(entry.corporation_id)) continue

		// End date is the start_date of the next-newer entry, or now for the current corp
		const isCurrent = i === 0
		const endDate = isCurrent ? null : sorted[i - 1].start_date
		const start = new Date(entry.start_date).getTime()
		const end = endDate ? new Date(endDate).getTime() : Date.now()
		const durationDays = Math.floor((end - start) / (1000 * 60 * 60 * 24))

		playerCorpStays.push({
			corporationId: entry.corporation_id,
			corporationName: entry.corporationName ?? entry.corporation_id,
			startDate: entry.start_date,
			endDate,
			durationDays,
			isCurrent,
		})
	}

	// Need at least 2 player corps to evaluate
	if (playerCorpStays.length < MIN_PLAYER_CORPS) return null

	// Take up to the last 5 most recent player corps
	const recentCorps = playerCorpStays.slice(0, MAX_CORPS_TO_CHECK)

	// Only check past corps (exclude current corp — they haven't left yet)
	const pastCorps = recentCorps.filter((s) => !s.isCurrent)
	if (pastCorps.length === 0) return null

	// Check if ANY past corp had a stay under 30 days
	const shortStays = pastCorps.filter((s) => s.durationDays < 30)
	if (shortStays.length === 0) return null

	const avgDays = Math.round(
		pastCorps.reduce((sum, s) => sum + s.durationDays, 0) / pastCorps.length,
	)

	return {
		id: `corp-hopper-${Date.now()}`,
		type: 'corp-hopper',
		severity: 'low',
		title: 'Corp Hopper',
		description: `${shortStays.length} of ${pastCorps.length} recent player corps had stays under 30 days (avg ${avgDays} days)`,
		details: {
			shortStays: shortStays.map((s) => ({
				corporationName: s.corporationName,
				durationDays: s.durationDays,
			})),
			recentCorps: recentCorps.map((s) => ({
				corporationName: s.corporationName,
				durationDays: s.durationDays,
				isCurrent: s.isCurrent,
			})),
			averageDays: avgDays,
		},
	}
}
