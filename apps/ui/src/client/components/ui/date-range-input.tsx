import { DatePickerInput as MantineDatePickerInput } from '@mantine/dates'

import { getDateInputFormat, useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

interface DateRangeInputProps {
	value: {
		fromDate: string
		toDate: string
	}
	onChange: (value: { fromDate: string; toDate: string }) => void
	placeholder?: string
	disabled?: boolean
	className?: string
}

function parseDateValue(value: string): Date | null {
	if (!value) {
		return null
	}

	const [year, month, day] = value.split('-').map(Number)
	if (!year || !month || !day) {
		return null
	}

	return new Date(year, month - 1, day)
}

function formatDateValue(value: Date | null): string {
	if (!value) {
		return ''
	}

	const year = value.getFullYear()
	const month = String(value.getMonth() + 1).padStart(2, '0')
	const day = String(value.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

export function DateRangeInput({
	value,
	onChange,
	placeholder,
	disabled = false,
	className,
}: DateRangeInputProps) {
	const { locale, t } = useAppTranslation()
	const dateFormat = getDateInputFormat(locale)
	const handleChange = (nextValue: [Date | null, Date | null]) => {
		// Mantine clears an incomplete range when the popover closes. A single date is
		// a valid filter for this control, so preserve it until the user selects an end date.
		if (!nextValue[0] && !nextValue[1] && value.fromDate && !value.toDate) {
			return
		}

		onChange({
			fromDate: formatDateValue(nextValue[0]),
			toDate: formatDateValue(nextValue[1]),
		})
	}

	return (
		<MantineDatePickerInput
			type="range"
			value={[parseDateValue(value.fromDate), parseDateValue(value.toDate)]}
			onChange={handleChange}
			valueFormat={dateFormat}
			placeholder={placeholder ?? t('common.dateRange')}
			disabled={disabled}
			allowSingleDateInRange
			dropdownType="popover"
			popoverProps={{
				position: 'bottom-start',
				offset: 6,
				withArrow: false,
				classNames: {
					dropdown: 'themed-date-picker__dropdown dropdown-surface',
				},
			}}
			className={cn('w-full', className)}
			classNames={{
				input: 'themed-date-picker__input themed-date-picker__range-input',
				placeholder: 'themed-date-picker__placeholder',
				section: 'themed-date-picker__section',
				day: 'themed-date-picker__day',
				weekday: 'themed-date-picker__weekday',
				calendarHeader: 'themed-date-picker__calendar-header',
				calendarHeaderControl: 'themed-date-picker__calendar-header-control',
				calendarHeaderLevel: 'themed-date-picker__calendar-header-level',
				monthCell: 'themed-date-picker__month-cell',
			}}
		/>
	)
}
