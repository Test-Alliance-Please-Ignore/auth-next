import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

export const FLEET_COMMANDER_CUSTOM_VALUE = '__custom__'

interface FleetCommanderOption {
	characterId: string
	characterName: string
}

interface SystemFleetCommanderFieldProps {
	fieldName: string
	fieldLabel: string
	required?: boolean
	selection: string
	value: string
	characters: FleetCommanderOption[]
	onSelectionChange: (value: string) => void
	onValueChange: (value: string) => void
}

export function SystemFleetCommanderField({
	fieldName,
	fieldLabel,
	required,
	selection,
	value,
	characters,
	onSelectionChange,
	onValueChange,
}: SystemFleetCommanderFieldProps) {
	const options = [
		{
			value: FLEET_COMMANDER_CUSTOM_VALUE,
			label: 'Custom',
		},
		...characters.map((character) => ({
			value: character.characterId,
			label: character.characterName,
		})),
	]

	return (
		<div className="space-y-1.5">
			<Label htmlFor={fieldName}>
				{fieldLabel}
				{required && ' *'}
			</Label>
			<Select
				inputId={fieldName}
				value={selection}
				onValueChange={onSelectionChange}
				options={options}
				placeholder="Select fleet commander"
				searchable
			/>
			{selection === FLEET_COMMANDER_CUSTOM_VALUE && (
				<Input
					value={value}
					onChange={(event) => onValueChange(event.target.value)}
					placeholder="Custom fleet commander text"
					required={required}
				/>
			)}
		</div>
	)
}
