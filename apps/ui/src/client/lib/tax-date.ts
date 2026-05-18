import { formatDate, formatDateTime } from './date-utils'

export function formatTaxDateTime(value: string | Date | null | undefined): string {
	const formatted = formatDateTime(value)
	return formatted === 'N/A' ? '-' : formatted
}

export function formatTaxDate(value: string | Date | null | undefined): string {
	const formatted = formatDate(value)
	return formatted === 'N/A' ? '-' : formatted
}

function toDateInputValue(date: Date): string {
	return date.toISOString().slice(0, 10)
}

export function getCurrentMonthDateRange(today = new Date()): { fromDate: string; toDate: string } {
	const year = today.getUTCFullYear()
	const month = today.getUTCMonth()

	return {
		fromDate: toDateInputValue(new Date(Date.UTC(year, month, 1))),
		toDate: toDateInputValue(new Date(Date.UTC(year, month + 1, 0))),
	}
}
