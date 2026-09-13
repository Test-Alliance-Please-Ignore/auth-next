import { afterEach, describe, expect, it } from 'vitest'

import { setAppLocale } from '@/i18n'
import {
	formatDateNumeric,
	formatMonthYear,
	formatUtcDateTime,
} from '@/lib/date-utils'

describe('date utilities', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
	})

	it('keeps EVE UTC and compact formatting semantics while localizing output', async () => {
		const value = '2026-02-03T04:05:06.000Z'
		await setAppLocale('de', { persistLocal: false })

		expect(formatUtcDateTime(value)).toBe(
			new Intl.DateTimeFormat('de', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
				timeZone: 'UTC',
			}).format(new Date(value))
		)
		expect(formatUtcDateTime(value, true)).toBe(
			new Intl.DateTimeFormat('de', {
				year: '2-digit',
				month: 'short',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
				timeZone: 'UTC',
			}).format(new Date(value))
		)
	})

	it('keeps UTC month-year and locale numeric date behavior', async () => {
		const value = '2026-02-03T23:05:06.000Z'
		await setAppLocale('ko', { persistLocal: false })

		expect(formatMonthYear(value)).toBe(
			new Intl.DateTimeFormat('ko', {
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC',
			}).format(new Date(value))
		)
		expect(formatDateNumeric(value)).toBe(
			new Intl.DateTimeFormat('ko', {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
			}).format(new Date(value))
		)
	})

	it('returns the localized not-available label for invalid dates', async () => {
		await setAppLocale('de', { persistLocal: false })

		expect(formatUtcDateTime('not-a-date')).toBe('k. A.')
		expect(formatDateNumeric(new Date(Number.NaN))).toBe('k. A.')
	})
})
