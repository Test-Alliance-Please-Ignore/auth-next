import { getActiveLocale, i18n } from './instance'

import type { AppLocale } from './locales'

/** Parse canonical date-only values in local time to avoid UTC day shifts. */
function dateFromDisplayInput(value: Date | string): Date | null {
	if (typeof value !== 'string') {
		return Number.isNaN(value.getTime()) ? null : value
	}

	const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
	if (dateOnly) {
		const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
		return Number.isNaN(date.getTime()) ? null : date
	}

	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

function notAvailable(): string {
	return i18n.t('common.notAvailable')
}

export function formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions): string {
	return new Intl.NumberFormat(getActiveLocale(), options).format(value)
}

export function formatDate(
	value: Date | string,
	options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
	const date = dateFromDisplayInput(value)
	return date ? new Intl.DateTimeFormat(getActiveLocale(), options).format(date) : notAvailable()
}

export function formatDateTime(
	value: Date | string,
	options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
): string {
	const date = dateFromDisplayInput(value)
	return date ? new Intl.DateTimeFormat(getActiveLocale(), options).format(date) : notAvailable()
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
