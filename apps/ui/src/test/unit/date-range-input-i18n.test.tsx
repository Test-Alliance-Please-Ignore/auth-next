import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DateRangeInput } from '@/components/ui/date-range-input'
import { I18nProvider, setAppLocale } from '@/i18n'

type PickerProps = {
	onChange: (value: [Date | null, Date | null]) => void
	valueFormat: string
	placeholder: string
}

const state = vi.hoisted(() => ({ picker: null as PickerProps | null }))
vi.mock('@mantine/dates', () => ({
	DatePickerInput: (props: PickerProps) => {
		state.picker = props
		return null
	},
}))

describe('localized date range input interactions', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
	})

	it.each([
		['de', 'DD.MM.YYYY', 'Datumsbereich'],
		['ko', 'YYYY. MM. DD.', '날짜 범위'],
	] as const)(
		'retains an incomplete range and emits ISO values in %s',
		async (locale, format, label) => {
			await setAppLocale(locale, { persistLocal: false })
			const onChange = vi.fn()
			renderToStaticMarkup(
				<I18nProvider>
					<DateRangeInput value={{ fromDate: '2026-09-10', toDate: '' }} onChange={onChange} />
				</I18nProvider>
			)
			expect(state.picker?.valueFormat).toBe(format)
			expect(state.picker?.placeholder).toBe(label)
			state.picker?.onChange([null, null])
			expect(onChange).not.toHaveBeenCalled()
			state.picker?.onChange([new Date(2026, 8, 10), new Date(2026, 8, 12)])
			expect(onChange).toHaveBeenCalledWith({ fromDate: '2026-09-10', toDate: '2026-09-12' })
		}
	)

	it('allows a complete range to be cleared', () => {
		const onChange = vi.fn()
		renderToStaticMarkup(
			<DateRangeInput
				value={{ fromDate: '2026-09-10', toDate: '2026-09-12' }}
				onChange={onChange}
			/>
		)
		state.picker?.onChange([null, null])
		expect(onChange).toHaveBeenCalledWith({ fromDate: '', toDate: '' })
	})
})
