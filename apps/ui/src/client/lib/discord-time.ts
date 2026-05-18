import { formatDistanceToNow } from 'date-fns'
import { formatDateTimeFull, formatDateTimeLong, formatDateTimeWithSeconds } from './date-utils'

export function formatDateTimeLocal(date: string | null): string {
	if (!date) return '-'
	const formatted = formatDateTimeLong(date)
	return formatted === 'N/A' ? '-' : formatted
}

function formatDateWithTime(date: Date, dateStyle: 'long' | 'full'): string {
	const datePart = new Intl.DateTimeFormat('en-US', { dateStyle }).format(date)
	const timePart = new Intl.DateTimeFormat('en-US', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(date)
	return `${datePart} ${timePart}`
}

export function formatDiscordTimestamp(date: Date, style?: string): string {
	switch (style) {
		case 't':
			return new Intl.DateTimeFormat('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			}).format(date)
		case 'T':
			return new Intl.DateTimeFormat('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: false,
			}).format(date)
		case 'd':
			return new Intl.DateTimeFormat('en-US', {
				month: '2-digit',
				day: '2-digit',
				year: 'numeric',
			}).format(date)
		case 'D':
			return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(date)
		case 'F':
			return formatDateWithTime(date, 'full')
		case 'R':
			return formatDistanceToNow(date, { addSuffix: true })
		case 'f':
		default:
			return formatDateWithTime(date, 'long')
	}
}

export function formatIsoTimestamp(date: Date): string {
	return formatDateTimeWithSeconds(date)
}

export function formatFullTimestampTooltip(date: Date): string {
	return formatDateTimeFull(date)
}
