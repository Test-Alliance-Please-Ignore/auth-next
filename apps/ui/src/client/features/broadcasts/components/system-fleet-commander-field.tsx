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
	onChange: (next: {
		selection: string
		value: string
		trackingCharacterId: string
		trackingCharacterName: string
	}) => void
}

export function SystemFleetCommanderField({
	fieldName,
	fieldLabel,
	required,
	selection,
	value,
	characters,
	onChange,
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
				onValueChange={(nextSelection) => {
					if (nextSelection === FLEET_COMMANDER_CUSTOM_VALUE) {
						onChange({
							selection: nextSelection,
							value: '',
							trackingCharacterId: '',
							trackingCharacterName: '',
						})
						return
					}
					const selectedCharacter = characters.find(
						(character) => character.characterId === nextSelection
					)
					onChange({
						selection: nextSelection,
						value: selectedCharacter?.characterName ?? '',
						trackingCharacterId: selectedCharacter?.characterId ?? '',
						trackingCharacterName: selectedCharacter?.characterName ?? '',
					})
				}}
				options={options}
				placeholder="Select fleet commander"
				searchable
			/>
			{selection === FLEET_COMMANDER_CUSTOM_VALUE && (
				<Input
					value={value}
					onChange={(event) =>
						onChange({
							selection,
							value: event.target.value,
							trackingCharacterId: '',
							trackingCharacterName: '',
						})
					}
					placeholder="Custom fleet commander text"
					required={required}
				/>
			)}
		</div>
	)
}
