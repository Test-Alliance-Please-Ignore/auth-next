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
	doctrines: Array<{ id: string; name: string }>
	onChange: (next: { selection: string; value: string; doctrineId: string }) => void
}

export function SystemDoctrineField({
	fieldName,
	fieldLabel,
	required,
	selection,
	value,
	doctrines,
	onChange,
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
					if (nextSelection === DOCTRINE_READ_MOTD_VALUE) {
						onChange({ selection: nextSelection, value: 'Read MOTD', doctrineId: '' })
						return
					}
					if (nextSelection === DOCTRINE_CUSTOM_VALUE) {
						onChange({ selection: nextSelection, value: '', doctrineId: '' })
						return
					}
					const matchedDoctrine = doctrines.find((doctrine) => doctrine.name === nextSelection)
					onChange({
						selection: nextSelection,
						value: nextSelection,
						doctrineId: matchedDoctrine?.id ?? '',
					})
				}}
				options={options}
				searchable
			/>
			{selection === DOCTRINE_CUSTOM_VALUE ? (
				<Input
					id={`${fieldName}-custom`}
					value={value ?? ''}
					onChange={(event) =>
						onChange({
							selection,
							value: event.target.value,
							doctrineId: '',
						})
					}
					required={required}
					placeholder="Enter doctrine"
				/>
			) : null}
		</div>
	)
}
