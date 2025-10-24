/**
 * Date utility functions for formatting dates consistently across the application
 */

/**
 * Format a date string to a human-readable format
 * @param dateString - ISO date string or Date object
 * @param options - Intl.DateTimeFormatOptions for customization
 * @returns Formatted date string
 */
export function formatDate(
	dateString: string | Date | null | undefined,
	options?: Intl.DateTimeFormatOptions
): string {
	if (!dateString) return 'N/A'

	const date = typeof dateString === 'string' ? new Date(dateString) : dateString

	if (isNaN(date.getTime())) return 'Invalid date'

	const defaultOptions: Intl.DateTimeFormatOptions = {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		...options,
	}

	return new Intl.DateTimeFormat('en-US', defaultOptions).format(date)
}

/**
 * Format a date string to include time
 * @param dateString - ISO date string or Date object
 * @returns Formatted date and time string
 */
export function formatDateTime(dateString: string | Date | null | undefined): string {
	if (!dateString) return 'N/A'

	const date = typeof dateString === 'string' ? new Date(dateString) : dateString

	if (isNaN(date.getTime())) return 'Invalid date'

	return new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

/**
 * Format a date string to a relative time string (e.g., "2 hours ago")
 * @param dateString - ISO date string or Date object
 * @returns Relative time string
 */
export function formatRelativeTime(dateString: string | Date | null | undefined): string {
	if (!dateString) return 'N/A'

	const date = typeof dateString === 'string' ? new Date(dateString) : dateString

	if (isNaN(date.getTime())) return 'Invalid date'

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
	if (!dateString) return 'N/A'

	const date = typeof dateString === 'string' ? new Date(dateString) : dateString

	if (isNaN(date.getTime())) return 'Invalid date'

	return new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}
