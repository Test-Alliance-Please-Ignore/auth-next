/**
 * Format a duration in milliseconds as a short human-readable string.
 * Examples: "12s", "4m 30s", "1h 23m", "2d 4h".
 */
export function formatDuration(ms: number): string {
	if (ms < 0) ms = 0
	const totalSeconds = Math.floor(ms / 1000)
	const days = Math.floor(totalSeconds / 86_400)
	const hours = Math.floor((totalSeconds % 86_400) / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60

	if (days > 0) return `${days}d ${hours}h`
	if (hours > 0) return `${hours}h ${minutes}m`
	if (minutes > 0) return `${minutes}m ${seconds}s`
	return `${seconds}s`
}

/**
 * Format a duration between two ISO timestamps; uses "now" if endIso is null.
 */
export function formatDurationBetween(startIso: string, endIso: string | null): string {
	const start = new Date(startIso).getTime()
	const end = endIso ? new Date(endIso).getTime() : Date.now()
	return formatDuration(end - start)
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
