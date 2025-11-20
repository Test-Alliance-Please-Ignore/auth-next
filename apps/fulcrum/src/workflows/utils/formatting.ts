/**
 * Formatting utilities for workflow data
 * Provides common formatting functions for currency, text, etc.
 */

/**
 * Format a number as currency with 2 decimal places
 * @param value - Number to format (can be undefined)
 * @returns Formatted currency string or undefined if value is invalid
 */
export function formatCurrency(value: number | undefined): string | undefined {
	if (value === undefined || Number.isNaN(value)) {
		return undefined
	}
	return value.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})
}

/**
 * Convert a snake_case or UPPER_CASE string to Title Case
 * @param input - String to convert (e.g., "market_order" or "MARKET_ORDER")
 * @returns Title case string (e.g., "Market Order")
 */
export function toTitleCase(input: string): string {
	return input
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ')
}

