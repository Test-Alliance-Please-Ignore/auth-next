/**
 * Format an ISK amount with comma separators, 2 decimal places, and " ISK" suffix.
 * e.g. 1500000 → "1,500,000.00 ISK"
 */
export function formatISK(value: string | number, options?: { showDecimals?: boolean }): string {
	const num = typeof value === 'string' ? parseFloat(value) : value
	const showDecimals = options?.showDecimals ?? true
	const fractionDigits = showDecimals ? 2 : 0
	if (isNaN(num)) return `${(0).toFixed(fractionDigits)} ISK`

	return (
		new Intl.NumberFormat('en-US', {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		}).format(num) + ' ISK'
	)
}

/**
 * Format a points amount (prediction-market currency) with comma separators + " points".
 * Points are integer strings — display-only, never used for arithmetic. Groups the raw
 * digit string so arbitrarily large integers keep full precision (no Number()).
 * e.g. "1500000" → "1,500,000 points"; "-50" → "-50 points"
 */
export function formatPoints(value: string): string {
	const trimmed = value.trim()
	if (/^-?\d+$/.test(trimmed)) {
		const negative = trimmed.startsWith('-')
		const digits = negative ? trimmed.slice(1) : trimmed
		const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
		return `${negative ? '-' : ''}${grouped} points`
	}
	const num = Number(trimmed)
	if (!Number.isFinite(num)) return '0 points'
	return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(num) + ' points'
}

/**
 * Format an ISK amount in abbreviated form with " ISK" suffix.
 * e.g. 1500000000 → "1.50B ISK"
 */
export function formatISKShort(
	value: string | number,
	options?: { showDecimals?: boolean }
): string {
	const num = typeof value === 'string' ? parseFloat(value) : value
	if (isNaN(num)) return '0 ISK'
	const showDecimals = options?.showDecimals ?? true
	const formatAmount = (amount: number) =>
		showDecimals
			? amount.toFixed(2)
			: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount)

	if (num >= 1_000_000_000_000) return `${formatAmount(num / 1_000_000_000_000)}T ISK`
	if (num >= 1_000_000_000) return `${formatAmount(num / 1_000_000_000)}B ISK`
	if (num >= 1_000_000) return `${formatAmount(num / 1_000_000)}M ISK`
	if (num >= 1_000) return `${formatAmount(num / 1_000)}K ISK`
	return `${formatAmount(num)} ISK`
}
