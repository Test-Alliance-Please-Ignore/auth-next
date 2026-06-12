import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import toast from '@/lib/toast'
import { useDiscordServers } from '@/hooks/useDiscord'
import {
	AlertDestinationEditor,
	type AlertDestinationEditorRow,
	alertDestinationEditorRowFromDestination,
	createAlertDestinationEditorRow,
} from '@/components/admin/alert-destination-editor'
import {
	useCorporationAlertDestinations,
	useCorporationAlertTypes,
	useCreateCorporationAlertDestination,
	useDeleteCorporationAlertDestination,
	useUpdateCorporationAlertDestination,
} from '@/hooks/useCorporationAlerts'

import type { CorporationAlertDestination } from '@/lib/api'

type EditableRow = AlertDestinationEditorRow

function getDefaultRowFromDestination(destination: CorporationAlertDestination): EditableRow {
	return alertDestinationEditorRowFromDestination(destination)
}

function getNewRow(alertType: string): EditableRow {
	return createAlertDestinationEditorRow(alertType)
}

export function CorporationAlertsCard({ corporationId }: { corporationId: string }) {
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

	const rowsByType = useMemo(() => {
		const grouped = new Map<string, CorporationAlertDestination[]>()
		for (const destination of alertDestinations) {
			const list = grouped.get(destination.alertType) ?? []
			list.push(destination)
			grouped.set(destination.alertType, list)
		}
		return grouped
	}, [alertDestinations])

	const newRowsByType = useMemo(() => {
		const grouped = new Map<string, EditableRow[]>()
		for (const row of newRows) {
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
		setNewRows((current) =>
			current.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
		)
	}

	const handleValidateDestination = (row: EditableRow): string | null => {
		if (row.destinationType === 'discord_channel') {
			if (!row.discordServerId || !row.channelId) {
				return 'Discord server and channel ID are required.'
			}
			return null
		}

		if (!row.coreUserId) {
			return 'Core user ID is required for direct user destinations.'
		}

		return null
	}

	const handleSaveExisting = async (destination: CorporationAlertDestination) => {
		const draft = draftRows[destination.id] ?? getDefaultRowFromDestination(destination)
		const validationError = handleValidateDestination(draft)
		if (validationError) {
			toast.error(validationError)
			return
		}

		try {
			await updateDestination.mutateAsync({
				corporationId,
				destinationId: destination.id,
				data: {
					alertType: draft.alertType,
					destinationType: draft.destinationType,
					discordServerId: draft.destinationType === 'discord_channel' ? draft.discordServerId : null,
					channelId: draft.destinationType === 'discord_channel' ? draft.channelId : null,
					coreUserId: draft.destinationType === 'discord_user' ? draft.coreUserId : null,
					isEnabled: draft.isEnabled,
				},
			})
			toast.success('Alert destination saved.')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save alert destination.')
		}
	}

	const handleSaveNew = async (row: EditableRow) => {
		const validationError = handleValidateDestination(row)
		if (validationError) {
			toast.error(validationError)
			return
		}

		try {
			await createDestination.mutateAsync({
				corporationId,
				data: {
					alertType: row.alertType,
					destinationType: row.destinationType,
					discordServerId: row.destinationType === 'discord_channel' ? row.discordServerId : null,
					channelId: row.destinationType === 'discord_channel' ? row.channelId : null,
					coreUserId: row.destinationType === 'discord_user' ? row.coreUserId : null,
					isEnabled: row.isEnabled,
				},
			})
			setNewRows((current) => current.filter((currentRow) => currentRow.id !== row.id))
			toast.success('Alert destination created.')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to create alert destination.')
		}
	}

	const handleDeleteExisting = (destination: CorporationAlertDestination) => {
		requestConfirmation({
			title: 'Delete destination?',
			description: 'This will remove the destination from this alert type.',
			confirmLabel: 'Delete Destination',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteDestination.mutateAsync({ corporationId, destinationId: destination.id })
					toast.success('Alert destination deleted.')
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'Failed to delete alert destination.')
				}
			},
		})
	}

	const handleClearNew = (rowId: string) => {
		setNewRows((current) => current.filter((row) => row.id !== rowId))
	}

	const getDestinationTypeOptions = () => [
		{ value: 'discord_channel', label: 'Discord Channel' },
		{ value: 'discord_user', label: 'Discord User' },
	]

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Alert Destinations</CardTitle>
					<CardDescription>Loading configured alert destinations...</CardDescription>
				</CardHeader>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-4">
					<div>
						<CardTitle>Alert Destinations</CardTitle>
						<CardDescription>
							Route corporation alerts to Discord channels or direct user destinations.
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{alertTypes.length === 0 ? (
					<p className="text-sm text-muted-foreground">No alert types are currently registered.</p>
				) : (
					alertTypes.map((definition) => {
						const destinationsForType = rowsByType.get(definition.type) ?? []
						const draftRowsForType = newRowsByType.get(definition.type) ?? []

						return (
							<div key={definition.type} className="space-y-4 rounded-lg border p-4">
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
										Add Destination
									</Button>
								</div>

								{destinationsForType.length === 0 && draftRowsForType.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										No destinations configured for this alert type.
									</p>
								) : null}

								<div className="space-y-3">
									{destinationsForType.map((destination) => {
										const draft = draftRows[destination.id] ?? getDefaultRowFromDestination(destination)
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
												className="rounded-md border bg-muted/20 p-3"
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
											className="rounded-md border border-dashed bg-muted/10 p-3"
										/>
									))}
								</div>
							</div>
						)
					})
				)}
			</CardContent>
			{confirmationDialog}
		</Card>
	)
}
