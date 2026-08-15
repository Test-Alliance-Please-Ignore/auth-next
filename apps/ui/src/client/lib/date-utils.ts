/**
 * Date utility functions for formatting dates consistently across the application
 */
type DateInput = string | Date | null | undefined

function parseDate(value: DateInput): Date | null {
	if (!value) return null
	const date = typeof value === 'string' ? new Date(value) : value
	return Number.isNaN(date.getTime()) ? null : date
}

function formatWithOptions(
	value: DateInput,
	options: Intl.DateTimeFormatOptions,
	fallback: string
): string {
	const date = parseDate(value)
	if (!date) return fallback
	return new Intl.DateTimeFormat('en-US', options).format(date)
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
	return formatWithOptions(dateString, defaultOptions, 'N/A')
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
		'N/A'
	)
}

/**
 * Format a date string to a relative time string (e.g., "2 hours ago")
 * @param dateString - ISO date string or Date object
 * @returns Relative time string
 */
export function formatRelativeTime(dateString: DateInput): string {
	const date = parseDate(dateString)
	if (!date) return 'N/A'

	const now = new Date()
	const diffMs = now.getTime() - date.getTime()
	const diffSeconds = Math.floor(diffMs / 1000)
	const diffMinutes = Math.floor(diffSeconds / 60)
	const diffHours = Math.floor(diffMinutes / 60)
	const diffDays = Math.floor(diffHours / 24)

	if (diffSeconds < 60) {
		return 'just now'
	} else if (diffMinutes < 60) {
		return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`
	} else if (diffHours < 24) {
		return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
	} else if (diffDays < 7) {
		return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
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
		'N/A'
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
		'N/A'
	)
}

export function formatMonthDay(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			month: 'short',
			day: 'numeric',
		},
		'N/A'
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
		'N/A'
	)
}

export function formatTime(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			hour: '2-digit',
			minute: '2-digit',
		},
		'N/A'
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
		'N/A'
	)
}

export function formatDateTimeLong(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			dateStyle: 'long',
			timeStyle: 'short',
		},
		'N/A'
	)
}

export function formatDateTimeFull(dateString: DateInput): string {
	return formatWithOptions(
		dateString,
		{
			dateStyle: 'full',
			timeStyle: 'long',
		},
		'N/A'
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
		'N/A'
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
		'N/A'
	)
}
