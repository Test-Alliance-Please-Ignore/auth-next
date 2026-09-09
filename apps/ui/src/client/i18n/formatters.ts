import { getActiveLocale } from './instance'

import type { AppLocale } from './locales'

/** Parse canonical date-only values in local time to avoid UTC day shifts. */
function dateFromDisplayInput(value: Date | string): Date {
	if (typeof value !== 'string') {
		return value
	}

	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
	if (dateOnly) {
		return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
	}

	return new Date(value)
}

export function formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions): string {
	return new Intl.NumberFormat(getActiveLocale(), options).format(value)
}

export function formatDate(
	value: Date | string,
	options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
	return new Intl.DateTimeFormat(getActiveLocale(), options).format(dateFromDisplayInput(value))
}

export function formatDateTime(
	value: Date | string,
	options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
	return new Intl.DateTimeFormat(getActiveLocale(), options).format(dateFromDisplayInput(value))
}

export function formatRelativeTime(
	value: number,
	unit: Intl.RelativeTimeFormatUnit,
	options: Intl.RelativeTimeFormatOptions = { numeric: 'auto' }
): string {
	return new Intl.RelativeTimeFormat(getActiveLocale(), options).format(value, unit)
}

export function formatList(values: readonly string[], options?: Intl.ListFormatOptions): string {
	return new Intl.ListFormat(getActiveLocale(), options).format(values)
}

export function compareLocaleStrings(
	left: string,
	right: string,
	options?: Intl.CollatorOptions
): number {
	return new Intl.Collator(getActiveLocale(), options).compare(left, right)
}

export function getDateInputFormat(locale: AppLocale = getActiveLocale()): string {
	switch (locale) {
		case 'de':
			return 'DD.MM.YYYY'
		case 'ko':
			return 'YYYY. MM. DD.'
		default:
			return 'MM/DD/YYYY'
	}
}
