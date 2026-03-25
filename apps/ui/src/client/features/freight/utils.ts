/**
 * Format a number string with commas
 */
export function formatNumber(value: string | number): string {
	const num = typeof value === 'string' ? parseFloat(value) : value
	if (isNaN(num)) return '0'

	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	}).format(num)
}

/**
 * Format a number in EVE ISK style: always 2 decimals with comma separators
 * e.g. 1,500,000.00
 */
export function formatIsk(value: string | number): string {
	const num = typeof value === 'string' ? parseFloat(value) : value
	if (isNaN(num)) return '0.00'

	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(num)
}

/**
 * Parse a formatted number string (with commas) back to a raw number string
 */
export function parseFormattedNumber(value: string): string {
	return value.replace(/,/g, '')
}

/**
 * Format a raw number string with comma separators for display in inputs (no decimals)
 */
export function formatInputNumber(value: string): string {
	const raw = value.replace(/,/g, '')
	if (raw === '' || raw === '-') return raw
	const num = parseFloat(raw)
	if (isNaN(num)) return ''
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	}).format(num)
}
