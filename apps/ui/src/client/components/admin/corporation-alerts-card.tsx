import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
	getAlertDestinationTypeOptions,
	validateAlertDestinationRequirements,
} from '@repo/alert-destinations'

import {
	AlertDestinationEditor,
	alertDestinationEditorRowFromDestination,
	createAlertDestinationEditorRow,
} from '@/components/admin/alert-destination-editor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import {
	useCorporationAlertDestinations,
	useCorporationAlertTypes,
	useCreateCorporationAlertDestination,
	useDeleteCorporationAlertDestination,
	useUpdateCorporationAlertDestination,
} from '@/hooks/useCorporationAlerts'
import { useDiscordServers } from '@/hooks/useDiscord'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import type { AlertDestinationType } from '@repo/alert-destinations'
import type { AlertDestinationEditorRow } from '@/components/admin/alert-destination-editor'
import type { AppTranslationKey, AppTranslator } from '@/i18n'
import type { CorporationAlertDestination } from '@/lib/api'

function AlertMessage({ text }: { text: (t: AppTranslator) => string }) {
	const { t } = useAppTranslation()
	return text(t)
}

// The shared validator also serves workers. Translate its known client-side
// failures here while keeping request validation and server responses intact.
const destinationValidationKeys: Record<string, AppTranslationKey> = {
	'discordServerId and channelId are required for discord_channel destinations':
		'admin.organizations.alerts.channelRequired',
	'coreUserId is required for discord_user destinations': 'admin.organizations.alerts.userRequired',
	'groupId is required for group destinations': 'admin.organizations.alerts.groupRequired',
	'webhookUrl is required for discord_webhook destinations':
		'admin.organizations.alerts.webhookRequired',
	'webhookUrl must be a valid Discord webhook URL for discord_webhook destinations':
		'admin.organizations.alerts.webhookInvalid',
}

type EditableRow = AlertDestinationEditorRow

function isCorpApplicationAlertType(alertType: string): boolean {
	return (
		alertType === 'corp_application_submitted' ||
		alertType === 'corp_application_first_time_accepted'
	)
}

const CORP_APPLICATION_ALERT_SECTIONS = [
	{
		type: 'corp_application_submitted',
		titleKey: 'admin.organizations.alerts.submitted',
		descriptionKey: 'admin.organizations.alerts.submittedDescription',
	},
	{
		type: 'corp_application_first_time_accepted',
		titleKey: 'admin.organizations.alerts.accepted',
		descriptionKey: 'admin.organizations.alerts.acceptedDescription',
	},
] as const

function buildCorporationAlertDestinationInput(row: EditableRow) {
	return {
		alertType: row.alertType,
		destinationType: row.destinationType,
		discordServerId: row.destinationType === 'discord_channel' ? row.discordServerId : null,
		channelId: row.destinationType === 'discord_channel' ? row.channelId : null,
		coreUserId: row.destinationType === 'discord_user' ? row.coreUserId : null,
		destinationConfig:
			row.destinationType === 'discord_webhook'
				? {
						webhookUrl: row.webhookUrl.trim(),
					}
				: undefined,
		isEnabled: row.isEnabled,
	}
}

function getDefaultRowFromDestination(destination: CorporationAlertDestination): EditableRow {
	return alertDestinationEditorRowFromDestination(destination)
}

function getNewRow(alertType: string): EditableRow {
	return createAlertDestinationEditorRow(alertType)
}

export function CorporationAlertsCard({ corporationId }: { corporationId: string }) {
	const { t } = useAppTranslation()
	const { data: alertTypes = [] } = useCorporationAlertTypes()
	const { data: alertDestinations = [], isLoading } = useCorporationAlertDestinations(corporationId)
	const { data: discordServers = [] } = useDiscordServers()
	const createDestination = useCreateCorporationAlertDestination()
	const updateDestination = useUpdateCorporationAlertDestination()
	const deleteDestination = useDeleteCorporationAlertDestination()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const [draftRows, setDraftRows] = useState<Record<string, EditableRow>>({})
	const [newRows, setNewRows] = useState<EditableRow[]>([])

	useEffect(() => {
		setDraftRows((current) => {
			const next: Record<string, EditableRow> = {}
			for (const destination of alertDestinations) {
				next[destination.id] = current[destination.id] ?? getDefaultRowFromDestination(destination)
			}
			return next
		})
	}, [alertDestinations])

	const regularAlertTypes = useMemo(
		() => alertTypes.filter((definition) => !isCorpApplicationAlertType(definition.type)),
		[alertTypes]
	)

	const rowsByType = useMemo(() => {
		const grouped = new Map<string, CorporationAlertDestination[]>()
		for (const destination of alertDestinations.filter(
			(destination) => !isCorpApplicationAlertType(destination.alertType)
		)) {
			const list = grouped.get(destination.alertType) ?? []
			list.push(destination)
			grouped.set(destination.alertType, list)
		}
		return grouped
	}, [alertDestinations])

	const newRowsByType = useMemo(() => {
		const grouped = new Map<string, EditableRow[]>()
		for (const row of newRows.filter((row) => !isCorpApplicationAlertType(row.alertType))) {
			const list = grouped.get(row.alertType) ?? []
			list.push(row)
			grouped.set(row.alertType, list)
		}
		return grouped
	}, [newRows])

	const handleAddRow = (alertType: string) => {
		setNewRows((current) => [...current, getNewRow(alertType)])
	}

	const handleUpdateExistingDraft = (destinationId: string, patch: Partial<EditableRow>) => {
		setDraftRows((current) => {
			const existing = current[destinationId]
			if (!existing) return current
			return {
				...current,
				[destinationId]: {
					...existing,
					...patch,
				},
			}
		})
	}

	const handleUpdateNewDraft = (rowId: string, patch: Partial<EditableRow>) => {
		setNewRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)))
	}

	const handleValidateDestination = (row: EditableRow): string | null => {
		return validateAlertDestinationRequirements({
			destinationType: row.destinationType as AlertDestinationType,
			discordServerId: row.discordServerId,
			channelId: row.channelId,
			coreUserId: row.coreUserId,
			groupId: row.groupId,
			destinationConfig:
				row.destinationType === 'discord_webhook'
					? {
							webhookUrl: row.webhookUrl,
						}
					: null,
		})
	}

	const handleSaveExisting = async (destination: CorporationAlertDestination) => {
		const draft = draftRows[destination.id] ?? getDefaultRowFromDestination(destination)
		const validationError = handleValidateDestination(draft)
		if (validationError) {
			toast.error(
				<AlertMessage
					text={(t) =>
						destinationValidationKeys[validationError]
							? t(destinationValidationKeys[validationError])
							: validationError
					}
				/>
			)
			return
		}

		try {
			await updateDestination.mutateAsync({
				corporationId,
				destinationId: destination.id,
				data: buildCorporationAlertDestinationInput(draft),
			})
			toast.success(<AlertMessage text={(t) => t('admin.organizations.alerts.saved')} />)
		} catch (error) {
			toast.error(
				<AlertMessage
					text={(t) =>
						error instanceof Error ? error.message : t('admin.organizations.alerts.saveError')
					}
				/>
			)
		}
	}

	const handleSaveNew = async (row: EditableRow) => {
		const validationError = handleValidateDestination(row)
		if (validationError) {
			toast.error(
				<AlertMessage
					text={(t) =>
						destinationValidationKeys[validationError]
							? t(destinationValidationKeys[validationError])
							: validationError
					}
				/>
			)
			return
		}

		try {
			await createDestination.mutateAsync({
				corporationId,
				data: buildCorporationAlertDestinationInput(row),
			})
			setNewRows((current) => current.filter((currentRow) => currentRow.id !== row.id))
			toast.success(<AlertMessage text={(t) => t('admin.organizations.alerts.created')} />)
		} catch (error) {
			toast.error(
				<AlertMessage
					text={(t) =>
						error instanceof Error ? error.message : t('admin.organizations.alerts.createError')
					}
				/>
			)
		}
	}

	const handleDeleteExisting = (destination: CorporationAlertDestination) => {
		requestConfirmation({
			title: (t) => t('admin.organizations.alerts.deleteTitle'),
			description: (t) => t('admin.organizations.alerts.deleteDescription'),
			confirmLabel: (t) => t('admin.organizations.alerts.delete'),
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteDestination.mutateAsync({ corporationId, destinationId: destination.id })
					toast.success(<AlertMessage text={(t) => t('admin.organizations.alerts.deleted')} />)
				} catch (error) {
					toast.error(
						<AlertMessage
							text={(t) =>
								error instanceof Error ? error.message : t('admin.organizations.alerts.deleteError')
							}
						/>
					)
				}
			},
		})
	}

	const handleClearNew = (rowId: string) => {
		setNewRows((current) => current.filter((row) => row.id !== rowId))
	}

	const getDestinationTypeOptions = () => [
		...getAlertDestinationTypeOptions(['discord_channel', 'discord_user', 'discord_webhook']).map(
			({ value }) => ({ value, label: t(`admin.organizations.alerts.destinationTypes.${value}`) })
		),
	]

	if (isLoading) {
		return (
			<Card className="border-border/80 bg-card/95 shadow-elevated">
				<CardHeader>
					<CardTitle>{t('admin.organizations.alerts.title')}</CardTitle>
					<CardDescription>{t('admin.organizations.alerts.loading')}</CardDescription>
				</CardHeader>
			</Card>
		)
	}

	return (
		<Card className="border-border/80 bg-card/95 shadow-elevated">
			<CardHeader>
				<div className="flex items-center justify-between gap-4">
					<div>
						<CardTitle>{t('admin.organizations.alerts.title')}</CardTitle>
						<CardDescription>{t('admin.organizations.alerts.description')}</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{alertTypes.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t('admin.organizations.alerts.noTypes')}</p>
				) : (
					<>
						{CORP_APPLICATION_ALERT_SECTIONS.map((section) => {
							const destinationsForType = alertDestinations.filter(
								(destination) => destination.alertType === section.type
							)
							const draftRowsForType = newRows.filter((row) => row.alertType === section.type)

							return (
								<div
									key={section.type}
									className="space-y-4 rounded-xl border border-border/80 bg-background/75 p-4 shadow-sm"
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="space-y-1">
											<h3 className="text-sm font-semibold">{t(section.titleKey)}</h3>
											<p className="text-sm text-muted-foreground">{t(section.descriptionKey)}</p>
										</div>
										<Button
											variant="primary"
											size="sm"
											onClick={() => handleAddRow(section.type)}
											disabled={createDestination.isPending}
										>
											<Plus className="h-4 w-4" />
											{t('admin.organizations.alerts.add')}
										</Button>
									</div>

									{destinationsForType.length === 0 && draftRowsForType.length === 0 ? (
										<p className="text-sm text-muted-foreground">
											{t('admin.organizations.alerts.empty')}
										</p>
									) : null}

									<div className="space-y-3">
										{destinationsForType.map((destination) => {
											const draft =
												draftRows[destination.id] ?? getDefaultRowFromDestination(destination)
											return (
												<AlertDestinationEditor
													key={destination.id}
													row={draft}
													showAlertTypeSelector={false}
													destinationTypeOptions={getDestinationTypeOptions()}
													discordServers={discordServers}
													onChange={(patch) => handleUpdateExistingDraft(destination.id, patch)}
													onSave={async () => handleSaveExisting(destination)}
													onRemove={() => handleDeleteExisting(destination)}
													isSaving={updateDestination.isPending}
													isExisting
													saveButtonVariant="primary"
													removeButtonVariant="destructive"
													className="rounded-xl border border-border/90 bg-card/95 p-4 shadow-md ring-1 ring-border/60"
												/>
											)
										})}

										{draftRowsForType.map((row) => (
											<AlertDestinationEditor
												key={row.id}
												row={row}
												showAlertTypeSelector={false}
												destinationTypeOptions={getDestinationTypeOptions()}
												discordServers={discordServers}
												onChange={(patch) => handleUpdateNewDraft(row.id, patch)}
												onSave={async () => handleSaveNew(row)}
												onRemove={() => handleClearNew(row.id)}
												isSaving={createDestination.isPending}
												removeButtonVariant="cancel"
												className="rounded-xl border border-dashed border-border/90 bg-card/90 p-4 shadow-md ring-1 ring-border/60"
											/>
										))}
									</div>
								</div>
							)
						})}

						{regularAlertTypes.map((definition) => {
							const destinationsForType = rowsByType.get(definition.type) ?? []
							const draftRowsForType = newRowsByType.get(definition.type) ?? []

							return (
								<div
									key={definition.type}
									className="space-y-4 rounded-xl border border-border/80 bg-background/75 p-4 shadow-sm"
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="space-y-1">
											<h3 className="text-sm font-semibold">{definition.label}</h3>
											<p className="text-sm text-muted-foreground">{definition.description}</p>
										</div>
										<Button
											variant="primary"
											size="sm"
											onClick={() => handleAddRow(definition.type)}
											disabled={createDestination.isPending}
										>
											<Plus className="h-4 w-4" />
											{t('admin.organizations.alerts.add')}
										</Button>
									</div>

									{destinationsForType.length === 0 && draftRowsForType.length === 0 ? (
										<p className="text-sm text-muted-foreground">
											{t('admin.organizations.alerts.empty')}
										</p>
									) : null}

									<div className="space-y-3">
										{destinationsForType.map((destination) => {
											const draft =
												draftRows[destination.id] ?? getDefaultRowFromDestination(destination)
											return (
												<AlertDestinationEditor
													key={destination.id}
													row={draft}
													showAlertTypeSelector={false}
													destinationTypeOptions={getDestinationTypeOptions()}
													discordServers={discordServers}
													onChange={(patch) => handleUpdateExistingDraft(destination.id, patch)}
													onSave={async () => handleSaveExisting(destination)}
													onRemove={() => handleDeleteExisting(destination)}
													isSaving={updateDestination.isPending}
													isExisting
													saveButtonVariant="primary"
													removeButtonVariant="destructive"
													className="rounded-xl border border-border/90 bg-card/95 p-4 shadow-md ring-1 ring-border/60"
												/>
											)
										})}

										{draftRowsForType.map((row) => (
											<AlertDestinationEditor
												key={row.id}
												row={row}
												showAlertTypeSelector={false}
												destinationTypeOptions={getDestinationTypeOptions()}
												discordServers={discordServers}
												onChange={(patch) => handleUpdateNewDraft(row.id, patch)}
												onSave={async () => handleSaveNew(row)}
												onRemove={() => handleClearNew(row.id)}
												isSaving={createDestination.isPending}
												removeButtonVariant="cancel"
												className="rounded-xl border border-dashed border-border/90 bg-card/90 p-4 shadow-md ring-1 ring-border/60"
											/>
										))}
									</div>
								</div>
							)
						})}
					</>
				)}
			</CardContent>
			{confirmationDialog}
		</Card>
	)
}
