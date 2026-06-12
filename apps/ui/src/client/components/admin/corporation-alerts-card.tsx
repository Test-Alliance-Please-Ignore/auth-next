import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import toast from '@/lib/toast'
import { useDiscordServers } from '@/hooks/useDiscord'
import {
	useCorporationAlertDestinations,
	useCorporationAlertTypes,
	useCreateCorporationAlertDestination,
	useDeleteCorporationAlertDestination,
	useUpdateCorporationAlertDestination,
} from '@/hooks/useCorporationAlerts'

import type { CorporationAlertDestination, CorporationAlertDestinationType } from '@/lib/api'

type EditableRow = {
	id: string
	alertType: string
	destinationType: CorporationAlertDestinationType
	discordServerId: string
	channelId: string
	coreUserId: string
	isEnabled: boolean
}

function getDefaultRowFromDestination(destination: CorporationAlertDestination): EditableRow {
	return {
		id: destination.id,
		alertType: destination.alertType,
		destinationType: destination.destinationType === 'discord_user' ? 'discord_user' : 'discord_channel',
		discordServerId: destination.discordServerId ?? '',
		channelId: destination.channelId ?? '',
		coreUserId: destination.coreUserId ?? '',
		isEnabled: destination.isEnabled,
	}
}

function getNewRow(alertType: string): EditableRow {
	return {
		id: crypto.randomUUID(),
		alertType,
		destinationType: 'discord_channel',
		discordServerId: '',
		channelId: '',
		coreUserId: '',
		isEnabled: true,
	}
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

	const getDestinationTypeLabel = (destinationType: string): string => {
		if (destinationType === 'discord_user') {
			return 'Discord User'
		}
		return 'Discord Channel'
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
											<div key={destination.id} className="rounded-md border bg-muted/20 p-3">
												<div className="flex flex-wrap items-center justify-between gap-2">
													<div className="flex items-center gap-2">
														<Badge variant="ghost">
															{getDestinationTypeLabel(draft.destinationType)}
														</Badge>
														<Badge variant={draft.isEnabled ? 'success' : 'secondary'}>
															{draft.isEnabled ? 'Enabled' : 'Disabled'}
														</Badge>
													</div>
													<div className="flex gap-2">
														<Button
															variant="primary"
															size="sm"
															onClick={() => void handleSaveExisting(destination)}
															disabled={updateDestination.isPending}
														>
															<Save className="h-4 w-4" />
															Save
														</Button>
														<Button
															variant="destructive"
															size="sm"
															onClick={() => handleDeleteExisting(destination)}
															disabled={deleteDestination.isPending}
														>
															<Trash2 className="h-4 w-4" />
															Delete
														</Button>
													</div>
												</div>

												<div className="mt-4 space-y-3">
													<div className="grid gap-3 md:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)]">
														<div className="space-y-2">
															<Label htmlFor={`alert-destination-type-${destination.id}`}>Destination Type</Label>
															<Select
																inputId={`alert-destination-type-${destination.id}`}
																value={draft.destinationType}
																onValueChange={(value) =>
																	handleUpdateExistingDraft(destination.id, {
																		destinationType: value as CorporationAlertDestinationType,
																		...(value === 'discord_channel'
																			? { coreUserId: '' }
																			: { discordServerId: '', channelId: '' }),
																	})
																}
																options={getDestinationTypeOptions()}
																placeholder="Select destination type"
																className="w-full"
															/>
														</div>

														<div className="space-y-2">
															<Label htmlFor={`alert-target-${destination.id}`}>
																{draft.destinationType === 'discord_channel' ? 'Channel Destination' : 'User Destination'}
															</Label>
															{draft.destinationType === 'discord_channel' ? (
																<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
																	<Select
																		inputId={`alert-server-${destination.id}`}
																		value={draft.discordServerId}
																		onValueChange={(value) =>
																			handleUpdateExistingDraft(destination.id, {
																				discordServerId: value,
																			})
																		}
																		options={discordServers.map((server) => ({
																			value: server.id,
																			label: `${server.guildName} (${server.guildId})`,
																		}))}
																		placeholder="Select a Discord server"
																		className="w-full"
																		contentClassName="w-[min(90vw,32rem)]"
																		listMaxHeight="24rem"
																	/>
																	<Input
																		id={`alert-channel-${destination.id}`}
																		value={draft.channelId}
																		onChange={(event) =>
																			handleUpdateExistingDraft(destination.id, {
																				channelId: event.target.value,
																			})
																		}
																		placeholder="Discord channel ID"
																	/>
																</div>
															) : (
																<Input
																	id={`alert-user-${destination.id}`}
																	value={draft.coreUserId}
																	onChange={(event) =>
																		handleUpdateExistingDraft(destination.id, {
																			coreUserId: event.target.value,
																		})
																	}
																	placeholder="Core user ID"
																/>
															)}
														</div>
													</div>

													<div className="flex items-center gap-2">
														<Switch
															id={`alert-enabled-${destination.id}`}
															checked={draft.isEnabled}
															onCheckedChange={(checked) =>
																handleUpdateExistingDraft(destination.id, {
																	isEnabled: checked,
																})
															}
														/>
														<Label htmlFor={`alert-enabled-${destination.id}`}>Enabled</Label>
													</div>
												</div>
											</div>
										)
									})}

									{draftRowsForType.map((row) => (
										<div key={row.id} className="rounded-md border border-dashed bg-muted/10 p-3">
											<div className="flex flex-wrap items-center justify-between gap-2">
												<div className="flex items-center gap-2">
													<Badge variant="ghost">
														{getDestinationTypeLabel(row.destinationType)}
													</Badge>
													<Badge variant={row.isEnabled ? 'success' : 'secondary'}>
														{row.isEnabled ? 'Enabled' : 'Disabled'}
													</Badge>
												</div>
												<div className="flex gap-2">
													<Button
														variant="primary"
														size="sm"
														onClick={() => void handleSaveNew(row)}
														disabled={createDestination.isPending}
													>
														<Save className="h-4 w-4" />
														Save
													</Button>
													<Button variant="ghost" size="sm" onClick={() => handleClearNew(row.id)}>
														<Trash2 className="h-4 w-4 text-destructive" />
														Clear
													</Button>
												</div>
											</div>

											<div className="mt-4 space-y-3">
												<div className="grid gap-3 md:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)]">
													<div className="space-y-2">
														<Label htmlFor={`new-alert-destination-type-${row.id}`}>Destination Type</Label>
														<Select
															inputId={`new-alert-destination-type-${row.id}`}
															value={row.destinationType}
															onValueChange={(value) =>
																handleUpdateNewDraft(row.id, {
																	destinationType: value as CorporationAlertDestinationType,
																	...(value === 'discord_channel'
																		? { coreUserId: '' }
																		: { discordServerId: '', channelId: '' }),
																})
															}
															options={getDestinationTypeOptions()}
															placeholder="Select destination type"
															className="w-full"
														/>
													</div>

													<div className="space-y-2">
														<Label htmlFor={`new-alert-target-${row.id}`}>
															{row.destinationType === 'discord_channel' ? 'Channel Destination' : 'User Destination'}
														</Label>
														{row.destinationType === 'discord_channel' ? (
															<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
																<Select
																	inputId={`new-alert-server-${row.id}`}
																	value={row.discordServerId}
																	onValueChange={(value) =>
																		handleUpdateNewDraft(row.id, { discordServerId: value })
																	}
																	options={discordServers.map((server) => ({
																		value: server.id,
																		label: `${server.guildName} (${server.guildId})`,
																	}))}
																	placeholder="Select a Discord server"
																	className="w-full"
																	contentClassName="w-[min(90vw,32rem)]"
																	listMaxHeight="24rem"
																/>
																<Input
																	id={`new-alert-channel-${row.id}`}
																	value={row.channelId}
																	onChange={(event) =>
																		handleUpdateNewDraft(row.id, {
																			channelId: event.target.value,
																		})
																	}
																	placeholder="Discord channel ID"
																/>
															</div>
														) : (
															<Input
																id={`new-alert-user-${row.id}`}
																value={row.coreUserId}
																onChange={(event) =>
																	handleUpdateNewDraft(row.id, {
																		coreUserId: event.target.value,
																	})
																}
																placeholder="Core user ID"
															/>
														)}
													</div>
												</div>

												<div className="flex items-center gap-2">
													<Switch
														id={`new-alert-enabled-${row.id}`}
														checked={row.isEnabled}
														onCheckedChange={(checked) =>
															handleUpdateNewDraft(row.id, {
																isEnabled: checked,
															})
														}
													/>
													<Label htmlFor={`new-alert-enabled-${row.id}`}>Enabled</Label>
												</div>
											</div>
										</div>
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
