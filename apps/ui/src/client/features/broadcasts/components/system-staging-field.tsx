import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

interface Option {
	value: string
	label: string
}

export const STAGING_CUSTOM_VALUE = '__custom'

export interface StagingFieldState {
	selection: string
	value: string
}

export function buildStagingOptions(
	stagingSystems: Array<{ solarSystemName: string }>
): Option[] {
	return [
		{ value: STAGING_CUSTOM_VALUE, label: 'Custom' },
		...stagingSystems.map((stagingSystem) => ({
			value: stagingSystem.solarSystemName,
			label: stagingSystem.solarSystemName,
		})),
	]
}

export function getInitialStagingFieldState(
	stagingSystems: Array<{ solarSystemName: string }>
): StagingFieldState {
	const defaultStaging = stagingSystems[0]?.solarSystemName?.trim() ?? ''
	if (defaultStaging) {
		return {
			selection: defaultStaging,
			value: defaultStaging,
		}
	}
	return {
		selection: STAGING_CUSTOM_VALUE,
		value: '',
	}
}

export function resolveStagingSelectionFromValue(value: string | undefined): StagingFieldState {
	const trimmed = (value ?? '').trim()
	if (trimmed.length > 0) {
		return {
			selection: trimmed,
			value: trimmed,
		}
	}
	return {
		selection: STAGING_CUSTOM_VALUE,
		value: '',
	}
}

interface SystemStagingFieldProps {
	fieldName: string
	fieldLabel: string
	required?: boolean
	selection: string
	value: string | undefined
	stagingSystems: Array<{ solarSystemName: string }>
	onSelectionChange: (value: string) => void
	onValueChange: (value: string) => void
}

export function SystemStagingField({
	fieldName,
	fieldLabel,
	required,
	selection,
	value,
	stagingSystems,
	onSelectionChange,
	onValueChange,
}: SystemStagingFieldProps) {
	const options = buildStagingOptions(stagingSystems)

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
					if (nextSelection === STAGING_CUSTOM_VALUE) {
						onValueChange('')
						return
					}
					onValueChange(nextSelection)
				}}
				options={options}
				searchable
			/>
			{selection === STAGING_CUSTOM_VALUE ? (
				<Input
					id={`${fieldName}-custom`}
					value={value ?? ''}
					onChange={(event) => onValueChange(event.target.value)}
					required={required}
					placeholder="Enter staging system"
				/>
			) : null}
		</div>
	)
}
