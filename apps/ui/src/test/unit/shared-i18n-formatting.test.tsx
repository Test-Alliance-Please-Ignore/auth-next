import { MantineProvider } from '@mantine/core'
import { DatesProvider } from '@mantine/dates'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DateInput } from '@/components/ui/date-input'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { I18nProvider, setAppLocale } from '@/i18n'
import { formatDate, formatMonthYear, formatRelativeTime } from '@/lib/date-utils'
import { formatISK, formatPoints } from '@/lib/format-utils'

import type { AppLocale } from '@/i18n'

async function renderDateInputs(locale: AppLocale): Promise<string> {
	await setAppLocale(locale, { persistLocal: false })

	return renderToStaticMarkup(
		<I18nProvider>
			<MantineProvider>
				<DatesProvider settings={{ locale }}>
					<DateInput value="" onChange={() => undefined} />
					<DateRangeInput value={{ fromDate: '', toDate: '' }} onChange={() => undefined} />
				</DatesProvider>
			</MantineProvider>
		</I18nProvider>
	)
}

describe('shared localized display helpers', () => {
	afterEach(async () => {
		vi.useRealTimers()
		await setAppLocale('en', { persistLocal: false })
	})

	it('renders culturally appropriate date input formats and translated range labels', async () => {
		const german = await renderDateInputs('de')
		expect(german).toContain('>DD.MM.YYYY</span>')
		expect(german).toContain('>Datumsbereich</span>')

		const korean = await renderDateInputs('ko')
		expect(korean).toContain('>YYYY. MM. DD.</span>')
		expect(korean).toContain('>날짜 범위</span>')
	})

	it('formats dates, ISK, and points with the active locale', async () => {
		await setAppLocale('de', { persistLocal: false })

		expect(formatDate('2026-02-03', { year: 'numeric', month: '2-digit', day: '2-digit' })).toBe(
			'03.02.2026'
		)
		expect(formatMonthYear('2026-01-01')).toBe('Januar 2026')
		expect(formatISK(1234.5)).toBe('1.234,50 ISK')
		expect(formatPoints('1')).toBe('1 Punkt')
		expect(formatPoints('1234')).toBe('1.234 Punkte')

		await setAppLocale('ko', { persistLocal: false })
		expect(formatPoints('1234')).toBe('1,234포인트')
	})

	it.each([
		['en', '9,007,199,254,740,993.12 ISK', '-0.12 ISK', '0.00 ISK'],
		['de', '9.007.199.254.740.993,12 ISK', '-0,12 ISK', '0,00 ISK'],
		['ko', '9,007,199,254,740,993.12 ISK', '-0.12 ISK', '0.00 ISK'],
	] as const)('preserves exact ISK decimals and signs in %s', async (locale, large, negative, zero) => {
		await setAppLocale(locale, { persistLocal: false })
		expect(formatISK('9007199254740993.129')).toBe(large)
		expect(formatISK('-0.129')).toBe(negative)
		expect(formatISK('invalid')).toBe(zero)
		expect(formatISK(Infinity)).toBe(zero)
		expect(formatISK('1.99', { showDecimals: false })).toBe('2 ISK')
		expect(formatISK('-1.99', { showDecimals: false })).toBe('-2 ISK')
	})

	it('formats both past and future relative times', async () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-02-03T12:00:00.000Z'))
		await setAppLocale('de', { persistLocal: false })

		expect(formatRelativeTime('2026-02-03T10:00:00.000Z')).toBe('vor 2 Stunden')
		expect(formatRelativeTime('2026-02-03T14:00:00.000Z')).toBe('in 2 Stunden')
	})
})
