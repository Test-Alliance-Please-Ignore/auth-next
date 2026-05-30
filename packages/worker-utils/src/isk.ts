export interface FormatISKOptions {
	showDecimals?: boolean
	minimumFractionDigits?: number
	maximumFractionDigits?: number
}

export function formatISK(value: string | number, options?: FormatISKOptions): string {
	const num = typeof value === 'string' ? Number.parseFloat(value) : value
	const showDecimals = options?.showDecimals ?? true
	const fallbackDigits = showDecimals ? 2 : 0
	const minimumFractionDigits = options?.minimumFractionDigits ?? fallbackDigits
	const maximumFractionDigits = options?.maximumFractionDigits ?? fallbackDigits

	if (!Number.isFinite(num)) {
		return `${(0).toFixed(minimumFractionDigits)} ISK`
	}

	return (
		new Intl.NumberFormat('en-US', {
			minimumFractionDigits,
			maximumFractionDigits,
		}).format(num) + ' ISK'
	)
}
