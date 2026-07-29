import parseDuration from 'parse-duration'

const MAX_DURATION_SECONDS = 365 * 24 * 60 * 60
const MIN_DURATION_SECONDS = 60
const MAX_DURATION_INPUT_LENGTH = 100
const FOREVER_VALUES = new Set(['forever', 'none', 'never', 'permanent'])

// Keep month and year behavior deterministic for TTLs.
const durationUnits = parseDuration.unit as Record<string, number>
durationUnits.month = 30 * 24 * 60 * 60 * 1000
durationUnits.mo = durationUnits.month
durationUnits.year = 365 * 24 * 60 * 60 * 1000
durationUnits.yr = durationUnits.year
durationUnits.y = durationUnits.year

export const MAX_DISCORD_DURATION_SECONDS = MAX_DURATION_SECONDS

/** Parse a bounded natural-language duration. null represents a non-expiring value. */
export function parseDiscordDurationSeconds(value: string | null | undefined): number | null {
	if (value === null || value === undefined) return null
	const normalized = value.trim().toLowerCase()
	if (!normalized) throw new Error('Duration is required or must be forever')
	if (normalized.length > MAX_DURATION_INPUT_LENGTH) throw new Error('Duration is too long')
	if (FOREVER_VALUES.has(normalized)) return null

	const milliseconds = parseDuration(normalized)
	if (milliseconds === null || !Number.isFinite(milliseconds)) throw new Error('Invalid duration')
	const seconds = Math.round(milliseconds / 1000)
	if (seconds < MIN_DURATION_SECONDS || seconds > MAX_DURATION_SECONDS) {
		throw new Error('Duration must be at least one minute and no longer than one year')
	}
	return seconds
}
