import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

interface Option {
	value: string
	label: string
}

export const DOCTRINE_READ_MOTD_VALUE = '__doctrine_read_motd'
export const DOCTRINE_CUSTOM_VALUE = '__custom'

export interface DoctrineFieldState {
	selection: string
	value: string
}

export function buildDoctrineOptions(doctrines: Array<{ name: string }>): Option[] {
	return [
		{ value: DOCTRINE_READ_MOTD_VALUE, label: 'Read MOTD' },
		{ value: DOCTRINE_CUSTOM_VALUE, label: 'Custom' },
		...doctrines.map((doctrine) => ({ value: doctrine.name, label: doctrine.name })),
	]
}

export function getInitialDoctrineFieldState(): DoctrineFieldState {
	return {
		selection: DOCTRINE_READ_MOTD_VALUE,
		value: 'Read MOTD',
	}
}

export function resolveDoctrineSelectionFromValue(value: string | undefined): DoctrineFieldState {
	const trimmed = (value ?? '').trim()
	if (trimmed === 'Read MOTD') {
		return {
			selection: DOCTRINE_READ_MOTD_VALUE,
			value: 'Read MOTD',
		}
	}
	if (trimmed.length > 0) {
		return {
			selection: DOCTRINE_CUSTOM_VALUE,
			value: trimmed,
		}
	}
	return getInitialDoctrineFieldState()
}

interface SystemDoctrineFieldProps {
	fieldName: string
	fieldLabel: string
	required?: boolean
	selection: string
	value: string | undefined
	doctrines: Array<{ name: string }>
	onSelectionChange: (value: string) => void
	onValueChange: (value: string) => void
}

export function SystemDoctrineField({
	fieldName,
	fieldLabel,
	required,
	selection,
	value,
	doctrines,
	onSelectionChange,
	onValueChange,
}: SystemDoctrineFieldProps) {
	const options = buildDoctrineOptions(doctrines)

	return (
		<div className="w-full space-y-2">
			<Label htmlFor={fieldName}>
				{fieldLabel}
				{required ? ' *' : ''}
			</Label>
			<Select
				inputId={fieldName}
				value={selection}
				onValueChange={(nextSelection) => {
					onSelectionChange(nextSelection)
					if (nextSelection === DOCTRINE_READ_MOTD_VALUE) {
						onValueChange('Read MOTD')
						return
					}
					if (nextSelection === DOCTRINE_CUSTOM_VALUE) {
						onValueChange('')
						return
					}
					onValueChange(nextSelection)
				}}
				options={options}
				searchable
			/>
			{selection === DOCTRINE_CUSTOM_VALUE ? (
				<Input
					id={`${fieldName}-custom`}
					value={value ?? ''}
					onChange={(event) => onValueChange(event.target.value)}
					required={required}
					placeholder="Enter doctrine"
				/>
			) : null}
		</div>
	)
}
