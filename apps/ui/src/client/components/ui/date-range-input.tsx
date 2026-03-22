import { DatePickerInput as MantineDatePickerInput } from '@mantine/dates'

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
	placeholder = 'Date range',
	disabled = false,
	className,
}: DateRangeInputProps) {
	return (
		<MantineDatePickerInput
			type="range"
			value={[parseDateValue(value.fromDate), parseDateValue(value.toDate)]}
			onChange={(nextValue) =>
				onChange({
					fromDate: formatDateValue(nextValue[0]),
					toDate: formatDateValue(nextValue[1]),
				})
			}
			valueFormat="MM/DD/YYYY"
			placeholder={placeholder}
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
