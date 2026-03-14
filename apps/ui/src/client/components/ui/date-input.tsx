import { DatePickerInput as MantineDatePickerInput } from '@mantine/dates'

interface DateInputProps {
	value: string
	onChange: (value: string) => void
	placeholder?: string
	clearable?: boolean
	disabled?: boolean
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

function formatDateValue(value: Date | string | null): string {
	if (!value) {
		return ''
	}

	if (typeof value === 'string') {
		return value
	}

	const year = value.getFullYear()
	const month = String(value.getMonth() + 1).padStart(2, '0')
	const day = String(value.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

export function DateInput({
	value,
	onChange,
	placeholder = 'MM/DD/YYYY',
	clearable = true,
	disabled = false,
}: DateInputProps) {
	return (
		<MantineDatePickerInput
			type="default"
			value={parseDateValue(value)}
			onChange={(nextValue) => onChange(formatDateValue(nextValue))}
			valueFormat="MM/DD/YYYY"
			placeholder={placeholder}
			clearable={clearable}
			disabled={disabled}
			dropdownType="popover"
			popoverProps={{
				position: 'bottom-start',
				offset: 6,
				withArrow: false,
				classNames: {
					dropdown: 'themed-date-picker__dropdown dropdown-surface',
				},
			}}
			clearButtonProps={{
				className: 'themed-date-picker__clear-button',
				'aria-label': 'Clear date',
			}}
			classNames={{
				input: 'themed-date-picker__input',
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
