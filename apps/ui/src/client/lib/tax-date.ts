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

export type TaxReportQuickRange =
	| 'current-month'
	| 'previous-month'
	| 'last-3-months'
	| 'last-6-months'
	| 'last-year'

export function shiftMonthRange(
	fromDate: string,
	monthOffset: number
): { fromDate: string; toDate: string } {
	const anchor = fromDate ? new Date(`${fromDate}T00:00:00.000Z`) : new Date()
	const year = anchor.getUTCFullYear()
	const month = anchor.getUTCMonth() + monthOffset
	return {
		fromDate: toDateInputValue(new Date(Date.UTC(year, month, 1))),
		toDate: toDateInputValue(new Date(Date.UTC(year, month + 1, 0))),
	}
}

export function getCurrentMonthDateRange(today = new Date()): { fromDate: string; toDate: string } {
	const year = today.getUTCFullYear()
	const month = today.getUTCMonth()

	return {
		fromDate: toDateInputValue(new Date(Date.UTC(year, month, 1))),
		toDate: toDateInputValue(new Date(Date.UTC(year, month + 1, 0))),
	}
}

export function getMonthDateRange(monthValue: string): { fromDate: string; toDate: string } {
	const match = /^(\d{4})-(\d{2})$/.exec(monthValue)
	if (!match) return getCurrentMonthDateRange()

	const year = Number(match[1])
	const month = Number(match[2]) - 1
	if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
		return getCurrentMonthDateRange()
	}

	return {
		fromDate: toDateInputValue(new Date(Date.UTC(year, month, 1))),
		toDate: toDateInputValue(new Date(Date.UTC(year, month + 1, 0))),
	}
}

export function getMonthPeriodOptions(
	monthCount = 24,
	today = new Date()
): Array<{ value: string; label: string }> {
	const count = Math.max(1, Math.trunc(monthCount))
	const currentMonth = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
	return Array.from({ length: count }, (_, index) => {
		const date = new Date(currentMonth)
		date.setUTCMonth(date.getUTCMonth() - index)
		const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
		return {
			value,
			label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
		}
	})
}

export function getPreviousCompletedMonthRange(
	monthCount: number,
	today = new Date()
): { fromDate: string; toDate: string } {
	const count = Math.max(1, Math.trunc(monthCount))
	const year = today.getUTCFullYear()
	const month = today.getUTCMonth()

	return {
		fromDate: toDateInputValue(new Date(Date.UTC(year, month - count, 1))),
		toDate: toDateInputValue(new Date(Date.UTC(year, month, 0))),
	}
}

export function getCurrentMonthWindowRange(
	monthCount: number,
	today = new Date()
): { fromDate: string; toDate: string } {
	const count = Math.max(1, Math.trunc(monthCount))
	const year = today.getUTCFullYear()
	const month = today.getUTCMonth()

	return {
		fromDate: toDateInputValue(new Date(Date.UTC(year, month - count + 1, 1))),
		toDate: toDateInputValue(new Date(Date.UTC(year, month + 1, 0))),
	}
}
