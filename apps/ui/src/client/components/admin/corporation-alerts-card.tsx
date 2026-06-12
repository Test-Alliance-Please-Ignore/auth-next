import { Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

import type { CorporationAlertDestination } from '@/lib/api'

type EditableRow = {
	id: string
	alertType: string
	destinationType: 'discord_channel'
	discordServerId: string
	channelId: string
	isEnabled: boolean
}

function getDefaultRowFromDestination(destination: CorporationAlertDestination): EditableRow {
	return {
		id: destination.id,
		alertType: destination.alertType,
		destinationType: 'discord_channel',
		discordServerId: destination.discordServerId ?? '',
		channelId: destination.channelId ?? '',
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

	const handleSaveExisting = async (destination: CorporationAlertDestination) => {
		const draft = draftRows[destination.id] ?? getDefaultRowFromDestination(destination)
		if (!draft.discordServerId || !draft.channelId) {
			toast.error('Discord server and channel ID are required.')
			return
		}

		try {
			await updateDestination.mutateAsync({
				corporationId,
				destinationId: destination.id,
				data: {
					alertType: draft.alertType,
					destinationType: draft.destinationType,
					discordServerId: draft.discordServerId,
					channelId: draft.channelId,
					isEnabled: draft.isEnabled,
				},
			})
			toast.success('Alert destination saved.')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save alert destination.')
		}
	}

	const handleSaveNew = async (row: EditableRow) => {
		if (!row.discordServerId || !row.channelId) {
			toast.error('Discord server and channel ID are required.')
			return
		}

		try {
			await createDestination.mutateAsync({
				corporationId,
				data: {
					alertType: row.alertType,
					destinationType: row.destinationType,
					discordServerId: row.discordServerId,
					channelId: row.channelId,
					isEnabled: row.isEnabled,
				},
			})
			setNewRows((current) => current.filter((currentRow) => currentRow.id !== row.id))
			toast.success('Alert destination created.')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to create alert destination.')
		}
	}

	const handleClearExisting = async (destinationId: string) => {
		try {
			await deleteDestination.mutateAsync({ corporationId, destinationId })
			toast.success('Alert destination removed.')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to remove alert destination.')
		}
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
										variant="secondary"
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
															variant="secondary"
															size="sm"
															onClick={() => void handleSaveExisting(destination)}
															disabled={updateDestination.isPending}
														>
															<Save className="h-4 w-4" />
															Save
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => void handleClearExisting(destination.id)}
															disabled={deleteDestination.isPending}
														>
															<Trash2 className="h-4 w-4 text-destructive" />
															Clear
														</Button>
													</div>
												</div>

												<div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
													<div className="space-y-2">
														<Label htmlFor={`alert-server-${destination.id}`}>Discord Server</Label>
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
													</div>

													<div className="space-y-2">
														<Label htmlFor={`alert-channel-${destination.id}`}>Channel ID</Label>
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
												</div>

												<div className="mt-4 flex items-center gap-2">
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
														variant="secondary"
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

											<div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
												<div className="space-y-2">
													<Label htmlFor={`new-alert-server-${row.id}`}>Discord Server</Label>
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
												</div>

												<div className="space-y-2">
													<Label htmlFor={`new-alert-channel-${row.id}`}>Channel ID</Label>
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
											</div>

											<div className="mt-4 flex items-center gap-2">
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
									))}
								</div>
							</div>
						)
					})
				)}
			</CardContent>
		</Card>
	)
}
