/**
 * Date utility functions for formatting dates consistently across the application
 */
import { formatRelativeTime as formatRelativeTimeValue, getActiveLocale, i18n } from '@/i18n'

type DateInput = string | Date | null | undefined

function parseDate(value: DateInput, dateOnlyTimeZone: 'local' | 'UTC' = 'local'): Date | null {
	if (!value) return null
	const dateOnly = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
	const date = dateOnly
		? dateOnlyTimeZone === 'UTC'
			? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
			: new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
		: typeof value === 'string'
			? new Date(value)
			: value
	return Number.isNaN(date.getTime()) ? null : date
}

function notAvailable(): string {
	return i18n.t('common.notAvailable')
}

function formatWithOptions(
	value: DateInput,
	options: Intl.DateTimeFormatOptions,
	fallback: string
): string {
	const date = parseDate(value, options.timeZone === 'UTC' ? 'UTC' : 'local')
	if (!date) return fallback
	return new Intl.DateTimeFormat(getActiveLocale(), options).format(date)
}

/**
 * Format a date string to a human-readable format
 * @param dateString - ISO date string or Date object
 * @param options - Intl.DateTimeFormatOptions for customization
 * @returns Formatted date string
 */
export function formatDate(dateString: DateInput, options?: Intl.DateTimeFormatOptions): string {
	const defaultOptions: Intl.DateTimeFormatOptions = {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		...options,
	}
	return formatWithOptions(dateString, defaultOptions, notAvailable())
}

/**
 * Format a date string to include time
 * @param dateString - ISO date string or Date object
 * @returns Formatted date and time string
 */
export function formatDateTime(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		},
		notAvailable()
	)
}

/**
 * Format a date string to a relative time string (e.g., "2 hours ago")
 * @param dateString - ISO date string or Date object
 * @returns Relative time string
 */
export function formatRelativeTime(dateString: DateInput): string {
	const date = parseDate(dateString)
	if (!date) return notAvailable()

	const diffMs = date.getTime() - Date.now()
	const direction = diffMs < 0 ? -1 : 1
	const absoluteDiffMs = Math.abs(diffMs)
	const diffSeconds = Math.floor(absoluteDiffMs / 1000)
	const diffMinutes = Math.floor(diffSeconds / 60)
	const diffHours = Math.floor(diffMinutes / 60)
	const diffDays = Math.floor(diffHours / 24)

	if (diffSeconds < 60) {
		return formatRelativeTimeValue(0, 'second')
	} else if (diffMinutes < 60) {
		return formatRelativeTimeValue(direction * diffMinutes, 'minute')
	} else if (diffHours < 24) {
		return formatRelativeTimeValue(direction * diffHours, 'hour')
	} else if (diffDays < 7) {
		return formatRelativeTimeValue(direction * diffDays, 'day')
	} else {
		return formatDate(date)
	}
}

/**
 * Format a date string to a short format (e.g., "Jan 1, 2023")
 * @param dateString - ISO date string or Date object
 * @returns Short formatted date string
 */
export function formatDateShort(dateString: string | Date | null | undefined): string {
	return formatDate(dateString, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})
}

/**
 * Format a date string to a long format (e.g., "January 1, 2023 at 12:00 PM")
 * @param dateString - ISO date string or Date object
 * @returns Long formatted date string
 */
export function formatDateLong(dateString: string | Date | null | undefined): string {
	return formatWithOptions(
		dateString,
		{
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		},
		notAvailable()
	)
}

export function formatDateNumeric(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		},
		notAvailable()
	)
}

export function formatMonthDay(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			month: 'short',
			day: 'numeric',
		},
		notAvailable()
	)
}

export function formatMonthYear(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC',
		},
		notAvailable()
	)
}

export function formatTime(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			hour: '2-digit',
			minute: '2-digit',
		},
		notAvailable()
	)
}

export function formatDateTimeWithSeconds(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		},
		notAvailable()
	)
}

export function formatDateTimeLong(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			dateStyle: 'long',
			timeStyle: 'short',
		},
		notAvailable()
	)
}

export function formatDateTimeFull(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			dateStyle: 'full',
			timeStyle: 'long',
		},
		notAvailable()
	)
}

export function formatDateTimeWithZone(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZoneName: 'short',
		},
		notAvailable()
	)
}

export function formatUtcDateTime(dateString: DateInput, compact = false): string {
	return formatWithOptions(
		dateString,
		compact
			? {
					year: '2-digit',
					month: 'short',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					hour12: false,
					timeZone: 'UTC',
				}
			: {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit',
					hour12: false,
					timeZone: 'UTC',
				},
		notAvailable()
	)
}
