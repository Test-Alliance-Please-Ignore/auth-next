import { getActiveLocale, i18n } from '@/i18n'

/**
 * Format an ISK amount with locale separators, 2 decimal places, and " ISK" suffix.
 * e.g. 1500000 → "1,500,000.00 ISK"
 */
export function formatISK(value: string | number, options?: { showDecimals?: boolean }): string {
	const showDecimals = options?.showDecimals ?? true
	const fractionDigits = showDecimals ? 2 : 0
	const formatter = new Intl.NumberFormat(getActiveLocale(), {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	})
	const raw = typeof value === 'string' ? value.trim() : String(value)
	const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/)
	if (match) {
		const negative = match[1] === '-'
		let whole = BigInt(match[2])
		const fraction = match[3] ?? ''
		if (fractionDigits === 0 && fraction[0] && fraction[0] >= '5') whole++
		// Keep decimal strings exact and preserve the existing truncation/whole-unit
		// rounding behavior. Intl supplies locale separators without a Number coercion.
		const signedWhole = negative ? (whole === 0n ? -0 : -whole) : whole
		const formattedFraction = `${fraction}00`.slice(0, fractionDigits)
		const formatted = formatter
			.formatToParts(signedWhole)
			.map((part) => (part.type === 'fraction' ? formattedFraction : part.value))
			.join('')
		return `${formatted} ISK`
	}

	const num = Number(value)
	return `${formatter.format(Number.isFinite(num) ? num : 0)} ISK`
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
		const amount = BigInt(trimmed)
		const formatted = new Intl.NumberFormat(getActiveLocale(), {
			maximumFractionDigits: 0,
		}).format(amount)
		return i18n.t('currency.points', {
			count: amount === 1n || amount === -1n ? 1 : 2,
			value: formatted,
		})
	}
	const num = Number(trimmed)
	const amount = Number.isFinite(num) ? num : 0
	const formatted = new Intl.NumberFormat(getActiveLocale(), {
		maximumFractionDigits: 0,
	}).format(amount)
	return i18n.t('currency.points', {
		count: Math.abs(amount) === 1 ? 1 : 2,
		value: formatted,
	})
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
		new Intl.NumberFormat(getActiveLocale(), {
			minimumFractionDigits: showDecimals ? 2 : 0,
			maximumFractionDigits: showDecimals ? 2 : 0,
		}).format(amount)

	if (num >= 1_000_000_000_000) return `${formatAmount(num / 1_000_000_000_000)}T ISK`
	if (num >= 1_000_000_000) return `${formatAmount(num / 1_000_000_000)}B ISK`
	if (num >= 1_000_000) return `${formatAmount(num / 1_000_000)}M ISK`
	if (num >= 1_000) return `${formatAmount(num / 1_000)}K ISK`
	return `${formatAmount(num)} ISK`
}
