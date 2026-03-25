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
