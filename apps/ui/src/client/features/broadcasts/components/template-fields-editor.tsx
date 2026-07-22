import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import {
	SystemDoctrineField,
} from '@/features/broadcasts/components/system-doctrine-field'
import {
	FLEET_COMMANDER_CUSTOM_VALUE,
	SystemFleetCommanderField,
} from '@/features/broadcasts/components/system-fleet-commander-field'
import { SystemFleetTrackingField } from '@/features/broadcasts/components/system-fleet-tracking-field'
import { SystemFrogsirenField } from '@/features/broadcasts/components/system-frogsiren-field'
import { SystemSrpField } from '@/features/broadcasts/components/system-srp-field'
import {
	SystemStagingField,
} from '@/features/broadcasts/components/system-staging-field'
import {
	autoResizeTextarea,
	parseBooleanField,
	resolveFleetCommanderSelectionFromFields,
} from '@/features/broadcasts/utils'

type TemplateField = {
	name: string
	label: string
	required?: boolean
	type: string
	options?: string[]
}

type DoctrineOption = {
	id: string
	name: string
}

type StagingOption = {
	solarSystemId: string
	solarSystemName: string
}

type UserCharacter = {
	characterId: string
	characterName: string
	hasValidToken: boolean
}

interface TemplateFieldsEditorProps {
	fields: TemplateField[]
	templateFields: Record<string, string>
	templateFieldSelections: Record<string, string>
	doctrines: DoctrineOption[]
	stagingSystems: StagingOption[]
	userCharacters: UserCharacter[]
	mainCharacterId?: string | null
	canCreateFleetTracking: boolean
	messageParts: { prefix: string; suffix: string }
	onMessagePartsChange: (next: { prefix: string; suffix: string }) => void
	onUpdateTemplateField: (fieldName: string, value: string) => void
	onUpdateTemplateFieldSelection: (fieldName: string, value: string) => void
}

export function TemplateFieldsEditor({
	fields,
	templateFields,
	templateFieldSelections,
	doctrines,
	stagingSystems,
	userCharacters,
	mainCharacterId,
	canCreateFleetTracking,
	messageParts,
	onMessagePartsChange,
	onUpdateTemplateField,
	onUpdateTemplateFieldSelection,
}: TemplateFieldsEditorProps) {
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const nonSystemFields = fields.filter((field) => {
		return field.type !== 'system_frogsiren' && field.type !== 'system_fleet_tracking'
	})
	const hasFleetTrackingField = fields.some((field) => field.type === 'system_fleet_tracking')
	const fleetCommanderField = fields.find((field) => field.type === 'system_fleet_commander')
	const fleetCommanderState = fleetCommanderField
		? resolveFleetCommanderSelectionFromFields({
				characters: userCharacters,
				mainCharacterId,
				value: templateFields[fleetCommanderField.name] ?? '',
				characterId: templateFields.__fleetTrackingCharacterId ?? '',
			})
		: {
				selection: FLEET_COMMANDER_CUSTOM_VALUE,
				value: '',
				trackingCharacterId: '',
				trackingCharacterName: '',
			}
	const fleetTrackingDisabled =
		fleetCommanderState.selection === FLEET_COMMANDER_CUSTOM_VALUE ||
		fleetCommanderState.trackingCharacterId.trim().length === 0

	return (
		<div className="space-y-4">
			<div className="max-w-xl space-y-2">
				<Label htmlFor="template-prefix-text">Text before (optional)</Label>
				<Textarea
					id="template-prefix-text"
					value={messageParts.prefix}
					onChange={(e) => {
						autoResizeTextarea(e.currentTarget)
						onMessagePartsChange({ ...messageParts, prefix: e.target.value })
					}}
					onBlur={(e) => autoResizeTextarea(e.currentTarget, { forceShrink: true })}
					rows={1}
					placeholder="Optional text prepended before the template message"
					className="resize-none overflow-hidden"
					style={{ minHeight: '2.5rem' }}
				/>
			</div>

			<Label className="text-sm font-medium">Template Fields</Label>
			<div className="grid gap-4 md:grid-cols-2">
				{nonSystemFields.map((field) => (
					<div key={field.name} className="space-y-2 min-w-0">
						{field.type === 'system_srp' ? (
							<SystemSrpField
								fieldName={field.name}
								value={templateFields[field.name]}
								token={templateFields.__srpToken}
								onChange={({ mode, token }) => {
									onUpdateTemplateField(field.name, mode)
									onUpdateTemplateField('__srpToken', token)
								}}
							/>
						) : field.type === 'system_doctrine' ? (
							<SystemDoctrineField
								fieldName={field.name}
								fieldLabel={field.label}
								required={field.required}
								selection={templateFieldSelections[field.name] ?? ''}
								value={templateFields[field.name]}
								doctrines={doctrines}
								onChange={({ selection, value, doctrineId }) => {
									onUpdateTemplateFieldSelection(field.name, selection)
									onUpdateTemplateField(field.name, value)
									onUpdateTemplateField('__doctrineId', doctrineId)
								}}
							/>
						) : field.type === 'system_staging' ? (
							<SystemStagingField
								fieldName={field.name}
								fieldLabel={field.label}
								required={field.required}
								selection={templateFieldSelections[field.name] ?? ''}
								value={templateFields[field.name]}
								stagingSystems={stagingSystems}
								onChange={({ selection, value }) => {
									onUpdateTemplateFieldSelection(field.name, selection)
									onUpdateTemplateField(field.name, value)
								}}
							/>
						) : field.type === 'system_fleet_commander' ? (
							<SystemFleetCommanderField
								fieldName={field.name}
								fieldLabel={field.label}
								required={field.required}
								selection={templateFieldSelections[field.name] ?? FLEET_COMMANDER_CUSTOM_VALUE}
								value={templateFields[field.name] ?? ''}
								characters={userCharacters
									.filter((character) => character.hasValidToken)
									.map((character) => ({
										characterId: character.characterId,
										characterName: character.characterName,
									}))}
								onChange={({
									selection,
									value,
									trackingCharacterId,
									trackingCharacterName,
								}) => {
									onUpdateTemplateFieldSelection(field.name, selection)
									onUpdateTemplateField(field.name, value)
									onUpdateTemplateField('__fleetTrackingCharacterId', trackingCharacterId)
									onUpdateTemplateField('__fleetTrackingCharacterName', trackingCharacterName)
									if (selection === FLEET_COMMANDER_CUSTOM_VALUE) {
										onUpdateTemplateField('__fleetTrackingEnabled', 'false')
									}
								}}
							/>
						) : (
							<>
								<Label htmlFor={field.name}>
									{field.label}
									{field.required && ' *'}
								</Label>
								{field.type === 'select' ? (
									<div className="w-full">
										<Select
											inputId={field.name}
											value={templateFieldSelections[field.name] ?? templateFields[field.name] ?? ''}
											onValueChange={(value) => {
												onUpdateTemplateFieldSelection(field.name, value)
												onUpdateTemplateField(field.name, value)
											}}
											options={(field.options ?? []).map((option) => ({
												value: option,
												label: option,
											}))}
											searchable
										/>
									</div>
								) : field.type === 'textarea' ? (
									<Textarea
										id={field.name}
										value={templateFields[field.name] || ''}
										onChange={(e) => {
											autoResizeTextarea(e.currentTarget)
											onUpdateTemplateField(field.name, e.target.value)
										}}
										onBlur={(e) => autoResizeTextarea(e.currentTarget, { forceShrink: true })}
										rows={1}
										required={field.required}
										className="resize-none overflow-hidden"
										style={{ minHeight: '2.5rem' }}
									/>
								) : (
									<Input
										id={field.name}
										value={templateFields[field.name] || ''}
										onChange={(e) => onUpdateTemplateField(field.name, e.target.value)}
										required={field.required}
									/>
								)}
							</>
						)}
					</div>
				))}
			</div>

			<div className="max-w-xl space-y-2">
				<Label htmlFor="template-default-text">Text after (optional)</Label>
				<Textarea
					id="template-default-text"
					value={messageParts.suffix}
					onChange={(e) => {
						autoResizeTextarea(e.currentTarget)
						onMessagePartsChange({ ...messageParts, suffix: e.target.value })
					}}
					onBlur={(e) => autoResizeTextarea(e.currentTarget, { forceShrink: true })}
					rows={1}
					placeholder="Optional text appended after the template message"
					className="resize-none overflow-hidden"
					style={{ minHeight: '2.5rem' }}
				/>
			</div>

			{canCreateFleetTracking && hasFleetTrackingField && (
				<SystemFleetTrackingField
					enabled={parseBooleanField(templateFields.__fleetTrackingEnabled, false)}
					disabled={fleetTrackingDisabled}
					disabledReason={
						fleetTrackingDisabled
							? 'Select a valid Fleet Commander character to enable fleet tracking.'
							: undefined
					}
					onEnabledChange={(next) => {
						if (fleetTrackingDisabled && next) return
						onUpdateTemplateField('__fleetTrackingEnabled', next ? 'true' : 'false')
					}}
				/>
			)}

			{fields
				.filter((field) => field.type === 'system_frogsiren')
				.map((field) => (
					<SystemFrogsirenField
						key={field.name}
						fieldName={field.name}
						checked={parseBooleanField(templateFields[field.name], false)}
						onDisable={() => onUpdateTemplateField(field.name, 'false')}
						onConfirmEnable={() => {
							requestConfirmation({
								title: 'Sound the Frogsiren?',
								description:
									'Are you really fucking sure you want to sound the frogsiren? Is the happening status: its? Is it UALX all over again?',
								confirmLabel: 'Sound It',
								intent: 'destructive',
								confirmButtonVariant: 'danger',
								confirmDelaySeconds: 3,
								onConfirm: () => {
									onUpdateTemplateField(field.name, 'true')
								},
							})
						}}
					/>
				))}

			{confirmationDialog}
		</div>
	)
}
