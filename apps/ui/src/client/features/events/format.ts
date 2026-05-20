/**
 * Time formatting for events.
 *
 * Discord returns event times as absolute ISO-8601 instants. We show the
 * viewer's local time alongside an EVE-time (UTC) hint, since EVE runs on
 * UTC and fleet pings are typically written in EVE time.
 */

/** Format an ISO timestamp in the viewer's local timezone. */
export function formatLocal(
	iso: string,
	options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
	return new Intl.DateTimeFormat(undefined, options).format(new Date(iso))
}

/** Format the EVE (UTC) time of an ISO timestamp, e.g. "20:00 EVE". */
export function formatEveTime(iso: string): string {
	const time = new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
		hour12: false,
	}).format(new Date(iso))
	return `${time} EVE`
}

/**
 * Full local date/time plus the EVE-time hint, e.g.
 * "Sat, 8 Mar 2026, 20:00 (19:00 EVE)".
 */
export function formatLocalWithEve(
	iso: string,
	options?: Intl.DateTimeFormatOptions
): string {
	return `${formatLocal(iso, options)} (${formatEveTime(iso)})`
}

/** Human-readable relative time, e.g. "in 3 hours", "in 2 days". */
export function formatRelative(iso: string): string {
	const diffMs = new Date(iso).getTime() - Date.now()
	if (diffMs <= 0) return 'in progress or started'

	const minutes = Math.round(diffMs / 60000)
	if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
	const hours = Math.round(minutes / 60)
	if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`
	const days = Math.round(hours / 24)
	return `in ${days} day${days === 1 ? '' : 's'}`
}

/** Human-readable duration between two ISO timestamps, e.g. "2h 30m". */
export function formatDuration(startIso: string, endIso: string): string | null {
	const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
	if (ms <= 0) return null
	const minutes = Math.round(ms / 60000)
	if (minutes < 60) return `${minutes} min`
	const hours = Math.floor(minutes / 60)
	const rem = minutes % 60
	return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
}
