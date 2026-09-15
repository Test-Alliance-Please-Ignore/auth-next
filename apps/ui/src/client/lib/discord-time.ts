import { getActiveLocale, i18n } from '@/i18n'

import {
	formatDateTimeFull,
	formatDateTimeLong,
	formatDateTimeWithSeconds,
	formatRelativeTime,
} from './date-utils'

export function formatDateTimeLocal(date: string | null): string {
	if (!date) return '-'
	return formatDateTimeLong(date)
}

function formatDateWithTime(date: Date, dateStyle: 'long' | 'full'): string {
	const datePart = new Intl.DateTimeFormat(getActiveLocale(), { dateStyle }).format(date)
	const timePart = new Intl.DateTimeFormat(getActiveLocale(), {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(date)
	return `${datePart} ${timePart}`
}

export function formatDiscordTimestamp(date: Date, style?: string): string {
	if (Number.isNaN(date.getTime())) return i18n.t('common.notAvailable')
	switch (style) {
		case 't':
			return new Intl.DateTimeFormat(getActiveLocale(), {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			}).format(date)
		case 'T':
			return new Intl.DateTimeFormat(getActiveLocale(), {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: false,
			}).format(date)
		case 'd':
			return new Intl.DateTimeFormat(getActiveLocale(), {
				month: '2-digit',
				day: '2-digit',
				year: 'numeric',
			}).format(date)
		case 'D':
			return new Intl.DateTimeFormat(getActiveLocale(), { dateStyle: 'long' }).format(date)
		case 'F':
			return formatDateWithTime(date, 'full')
		case 'R':
			return formatRelativeTime(date)
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
