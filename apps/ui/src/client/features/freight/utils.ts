import { formatList, formatNumber as formatLocaleNumber } from '@/i18n'

import type { AppLocale, AppTranslator } from '@/i18n'

/** Format API number strings for display without changing their canonical values. */
export function formatNumber(value: string | number, options?: Intl.NumberFormatOptions): string {
	const num = typeof value === 'string' ? parseFloat(value) : value
	return formatLocaleNumber(Number.isNaN(num) ? 0 : num, {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
		...options,
	})
}

export function getNumberInputSeparators(locale: AppLocale) {
	const parts = new Intl.NumberFormat(locale).formatToParts(1234.5)
	return {
		thousandSeparator: parts.find((part) => part.type === 'group')?.value ?? '',
		decimalSeparator: parts.find((part) => part.type === 'decimal')?.value ?? '.',
	}
}

export function getExpirationOptions(t: AppTranslator) {
	return [1, 3, 7, 14, 28].map((days) => ({
		value: String(days),
		label: t(days < 7 ? 'duration.units.day' : 'duration.units.week', {
			count: days < 7 ? days : days / 7,
		}),
	}))
}

export function formatTimeRemaining(dateExpired: string, t: AppTranslator): string {
	const diff = new Date(dateExpired).getTime() - Date.now()
	if (!Number.isFinite(diff)) return t('common.notAvailable')
	if (diff <= 0) return t('duration.expired')

	const days = Math.floor(diff / (1000 * 60 * 60 * 24))
	const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
	const hourLabel = t('duration.units.hour', { count: hours })
	return days > 0
		? formatList([t('duration.units.day', { count: days }), hourLabel], {
				type: 'unit',
				style: 'short',
			})
		: hourLabel
}

export { formatISK, formatISKShort } from '@/lib/format-utils'
