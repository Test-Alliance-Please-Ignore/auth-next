import { formatDurationBetween as formatDurationBetweenShared, formatDurationMs } from '@/lib/duration-utils'

/**
 * Format a duration in milliseconds as a short human-readable string.
 * Examples: "12s", "4m 30s", "1h 23m", "2d 4h".
 */
export function formatDuration(ms: number): string {
	return formatDurationMs(ms, { maxUnits: 2, style: 'short' })
}

/**
 * Format a duration between two ISO timestamps; uses "now" if endIso is null.
 */
export function formatDurationBetween(startIso: string, endIso: string | null): string {
	return formatDurationBetweenShared(startIso, endIso, { maxUnits: 2, style: 'short' })
}

/**
 * Pretty-print an end reason for display.
 */
export function formatEndReason(reason: string | null): string {
	if (!reason) return 'Unknown'
	switch (reason) {
		case 'user_stopped':
			return 'Stopped by user'
		case 'admin_stopped':
			return 'Stopped by admin'
		case 'fleet_disbanded':
			return 'Fleet disbanded'
		case 'character_left_fleet':
			return 'Character left fleet'
		case 'not_fleet_boss':
			return 'Character no longer fleet boss'
		case 'esi_error':
			return 'ESI error'
		case 'token_expired':
			return 'Token expired'
		default:
			return reason
	}
}
