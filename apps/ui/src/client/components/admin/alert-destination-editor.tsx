import { Save, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import type { SelectOption } from '@/components/ui/select'
import type { ButtonVariant } from '@/components/ui/button'
import type { CorporationAlertDestination, CorporationAlertDestinationType } from '@/lib/api'

export type AlertDestinationEditorRow = {
	id: string
	alertType: string
	destinationType: CorporationAlertDestinationType | string
	discordServerId: string
	channelId: string
	coreUserId: string
	groupId: string
	webhookUrl: string
	isEnabled: boolean
	sendToAdmins: boolean
	sendToOwners: boolean
	sendToMembers: boolean
}

export function createAlertDestinationEditorRow(alertType: string): AlertDestinationEditorRow {
	return {
		id: crypto.randomUUID(),
		alertType,
		destinationType: 'discord_channel',
		discordServerId: '',
		channelId: '',
		coreUserId: '',
		groupId: '',
		webhookUrl: '',
		isEnabled: true,
		sendToAdmins: true,
		sendToOwners: true,
		sendToMembers: true,
	}
}

export function alertDestinationEditorRowFromDestination(
	destination: CorporationAlertDestination
): AlertDestinationEditorRow {
	const config = destination.destinationConfig ?? {}
	return {
		id: destination.id,
		alertType: destination.alertType,
		destinationType: destination.destinationType,
		discordServerId: destination.discordServerId ?? '',
		channelId: destination.channelId ?? '',
		coreUserId: destination.coreUserId ?? '',
		groupId: destination.groupId ?? '',
		webhookUrl: typeof config.webhookUrl === 'string' ? config.webhookUrl : '',
		isEnabled: destination.isEnabled,
		sendToAdmins: Boolean(config.sendToAdmins),
		sendToOwners: Boolean(config.sendToOwners),
		sendToMembers: Boolean(config.sendToMembers),
	}
}

export function AlertDestinationEditor({
	row,
	alertTypeOptions,
	destinationTypeOptions,
	groupOptions,
	discordServers,
	onChange,
	onSave,
	onRemove,
	isSaving,
	isExisting = false,
	showAlertTypeSelector = true,
	showGroupAudience = true,
	saveButtonVariant = 'confirm',
	removeButtonVariant = 'destructive',
	className,
}: {
	row: AlertDestinationEditorRow
	alertTypeOptions?: SelectOption[]
	destinationTypeOptions: SelectOption[]
	groupOptions?: SelectOption[]
	discordServers: Array<{ id: string; guildName: string; guildId: string }>
	onChange: (patch: Partial<AlertDestinationEditorRow>) => void
	onSave: () => Promise<void>
	onRemove: () => void
	isSaving: boolean
	isExisting?: boolean
	showAlertTypeSelector?: boolean
	showGroupAudience?: boolean
	saveButtonVariant?: ButtonVariant
	removeButtonVariant?: ButtonVariant
	className?: string
}) {
	const showChannelFields = row.destinationType === 'discord_channel'
	const showUserFields = row.destinationType === 'discord_user'
	const showWebhookFields = row.destinationType === 'discord_webhook'
	const showGroupFields = row.destinationType === 'group'
	const hasAlertTypeSelector = showAlertTypeSelector && (alertTypeOptions?.length ?? 0) > 0
	const removeButtonLabel = removeButtonVariant === 'cancel' ? 'Cancel' : 'Remove'

	return (
		<div
			className={cn(
				'space-y-4 rounded-xl border border-border/60 bg-card p-4',
				isExisting ? '' : 'border-dashed bg-muted/10',
				className
			)}
		>
			<div className="flex items-center justify-between gap-3">
				<div className="space-y-1">
					<div className="font-medium">{isExisting ? 'Current Destination' : 'New Destination'}</div>
					<div className="text-xs text-muted-foreground">Alert type and delivery target.</div>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant={row.isEnabled ? 'success' : 'ghost'}>
						{row.isEnabled ? 'Enabled' : 'Disabled'}
					</Badge>
					<Switch checked={row.isEnabled} onCheckedChange={(checked) => onChange({ isEnabled: checked })} />
				</div>
			</div>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{hasAlertTypeSelector && (
					<div className="space-y-2">
						<Label htmlFor={`alert-type-${row.id}`}>Alert Type</Label>
						<Select
							inputId={`alert-type-${row.id}`}
							options={alertTypeOptions ?? []}
							value={row.alertType}
							onValueChange={(value) => onChange({ alertType: value })}
							placeholder="Select alert type"
							className="w-full"
							searchable
						/>
					</div>
				)}

				<div className="space-y-2">
					<Label htmlFor={`destination-type-${row.id}`}>Destination Type</Label>
					<Select
						inputId={`destination-type-${row.id}`}
						options={destinationTypeOptions}
						value={row.destinationType}
						onValueChange={(value) =>
							onChange({
								destinationType: value as AlertDestinationEditorRow['destinationType'],
								discordServerId: value === 'discord_channel' ? row.discordServerId : '',
								channelId: value === 'discord_channel' ? row.channelId : '',
								coreUserId: value === 'discord_user' ? row.coreUserId : '',
								groupId: value === 'group' ? row.groupId : '',
								webhookUrl: value === 'discord_webhook' ? row.webhookUrl : '',
							})
						}
						placeholder="Select destination type"
						className="w-full"
						searchable
					/>
				</div>

				{showChannelFields && (
					<>
						<div className="space-y-2">
							<Label htmlFor={`discord-server-${row.id}`}>Discord Server</Label>
							<Select
								inputId={`discord-server-${row.id}`}
								options={discordServers.map((server) => ({
									value: server.id,
									label: `${server.guildName} (${server.guildId})`,
								}))}
								value={row.discordServerId}
								onValueChange={(value) => onChange({ discordServerId: value })}
								placeholder="Select a Discord server"
								className="w-full"
								contentClassName="w-[min(90vw,32rem)]"
								listMaxHeight="24rem"
								searchable
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor={`channel-id-${row.id}`}>Channel ID</Label>
							<Input
								id={`channel-id-${row.id}`}
								value={row.channelId}
								onChange={(event) => onChange({ channelId: event.target.value })}
								placeholder="Discord channel ID"
							/>
						</div>
					</>
				)}

				{showUserFields && (
					<div className="space-y-2">
						<Label htmlFor={`core-user-id-${row.id}`}>Core User ID</Label>
						<Input
							id={`core-user-id-${row.id}`}
							value={row.coreUserId}
							onChange={(event) => onChange({ coreUserId: event.target.value })}
							placeholder="Core user ID"
						/>
					</div>
				)}

				{showWebhookFields && (
					<div className="space-y-2 md:col-span-2 lg:col-span-2">
						<Label htmlFor={`webhook-url-${row.id}`}>Webhook URL</Label>
						<Input
							id={`webhook-url-${row.id}`}
							value={row.webhookUrl}
							onChange={(event) => onChange({ webhookUrl: event.target.value })}
							placeholder="https://discord.com/api/webhooks/..."
						/>
					</div>
				)}

				{showGroupFields && (
					<div className="space-y-4 lg:col-span-2">
						<div className="space-y-2">
							<Label htmlFor={`group-id-${row.id}`}>Target Group</Label>
							<Select
								inputId={`group-id-${row.id}`}
								options={groupOptions ?? []}
								value={row.groupId}
								onValueChange={(value) => onChange({ groupId: value })}
								placeholder="Select a structure group"
								className="w-full"
								searchable
							/>
						</div>

						{showGroupAudience && (
							<div className="space-y-2">
								<Label>Audience</Label>
								<div className="space-y-2 rounded-lg border border-border/60 p-3">
									<CheckRow
										label="Admins"
										checked={row.sendToAdmins}
										onCheckedChange={(checked) => onChange({ sendToAdmins: checked })}
									/>
									<CheckRow
										label="Owners"
										checked={row.sendToOwners}
										onCheckedChange={(checked) => onChange({ sendToOwners: checked })}
									/>
									<CheckRow
										label="Members"
										checked={row.sendToMembers}
										onCheckedChange={(checked) => onChange({ sendToMembers: checked })}
									/>
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			<div className="flex items-center justify-end gap-2">
				<Button variant={removeButtonVariant} size="sm" onClick={onRemove} showIcon={false}>
					<Trash2 className="h-4 w-4" />
					{removeButtonLabel}
				</Button>
				<Button variant={saveButtonVariant} size="sm" onClick={() => void onSave()} loading={isSaving} showIcon={false}>
					<Save className="h-4 w-4" />
					Save
				</Button>
			</div>
		</div>
	)
}

function CheckRow({
	label,
	checked,
	onCheckedChange,
}: {
	label: string
	checked: boolean
	onCheckedChange: (checked: boolean) => void
}) {
	return (
		<div className="flex items-center gap-2">
			<Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
			<span className="text-sm">{label}</span>
		</div>
	)
}
