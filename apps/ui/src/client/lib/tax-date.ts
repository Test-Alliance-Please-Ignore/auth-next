export function formatTaxDateTime(value: string | Date | null | undefined): string {
	if (!value) {
		return '-'
	}
	return new Date(value).toLocaleString()
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
