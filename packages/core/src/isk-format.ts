export function formatISK(value: string | number, options?: { showDecimals?: boolean }): string {
	const num = typeof value === 'string' ? Number.parseFloat(value) : value
	const showDecimals = options?.showDecimals ?? true
	const fractionDigits = showDecimals ? 2 : 0

	if (!Number.isFinite(num)) {
		return `${(0).toFixed(fractionDigits)} ISK`
	}

	return (
		new Intl.NumberFormat('en-US', {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		}).format(num) + ' ISK'
	)
}

export function formatISKShort(value: string | number): string {
	const num = typeof value === 'string' ? Number.parseFloat(value) : value
	if (!Number.isFinite(num)) return '0 ISK'

	if (num >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2)}T ISK`
	if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B ISK`
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M ISK`
	if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K ISK`
	return `${num.toFixed(2)} ISK`
}
