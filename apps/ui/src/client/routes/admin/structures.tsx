import { Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ButtonVariant } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Container } from '@/components/ui/container'
import { FilterField } from '@/components/ui/filter-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select, type SelectOption } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
	AlertDestinationEditor,
	type AlertDestinationEditorRow,
	alertDestinationEditorRowFromDestination,
	createAlertDestinationEditorRow,
} from '@/components/admin/alert-destination-editor'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useCorporations } from '@/hooks/useCorporations'
import { useDiscordServers } from '@/hooks/useDiscord'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import toast from '@/lib/toast'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { STRUCTURE_STATE_OPTIONS } from '@repo/structure-states'

import type {
	CorporationAlertDestination,
	CreateStructureAlertDestinationRequest,
	CreateStructureGroupAlertConfigRequest,
	StructureCorporationGroupDefault,
	StructureGroupAlertConfig,
} from '@/lib/api'

const EMPTY_ARRAY: never[] = []

type AlertConfigDraft = {
	id: string
	alertType: string
	isEnabled: boolean
	destinationIds: string[]
	stateTransitions: string[]
}

type StructureGroupSettingDraft = {
	id: string
	groupId: string
}

type CorporationDefaultDraft = {
	id: string
	corporationId: string
	groupId: string | null
}

const DESTINATION_TYPE_OPTIONS: SelectOption[] = [
	{ value: 'discord_channel', label: 'Discord Channel' },
	{ value: 'discord_user', label: 'Discord User' },
	{ value: 'group', label: 'Group Broadcast' },
]

function alertConfigDraftFromRow(config: StructureGroupAlertConfig): AlertConfigDraft {
	const raw = config.config ?? {}
	return {
		id: config.id,
		alertType: config.alertType,
		isEnabled: config.isEnabled,
		destinationIds: config.destinationIds ?? [],
		stateTransitions: Array.isArray(raw.stateTransitions)
			? raw.stateTransitions.filter((value): value is string => typeof value === 'string')
			: [],
	}
}

function emptyAlertConfigDraft(alertType: string): AlertConfigDraft {
	return {
		id: crypto.randomUUID(),
		alertType,
		isEnabled: true,
		destinationIds: [],
		stateTransitions: [],
	}
}

function syncCorporationDefaultDrafts(
	current: Record<string, StructureCorporationGroupDefault>,
	rows: StructureCorporationGroupDefault[]
): Record<string, StructureCorporationGroupDefault> {
	const next = Object.fromEntries(
		rows
			.filter((row) => row.groupId !== null)
			.map((row) => [row.corporationId, row] as const)
	)
	const currentKeys = Object.keys(current)
	const nextKeys = Object.keys(next)
	if (currentKeys.length !== nextKeys.length) return next

	for (const key of nextKeys) {
		const currentRow = current[key]
		const nextRow = next[key]
		if (
			!currentRow ||
			currentRow.corporationId !== nextRow.corporationId ||
			currentRow.groupId !== nextRow.groupId ||
			currentRow.updatedBy !== nextRow.updatedBy ||
			currentRow.createdAt !== nextRow.createdAt ||
			currentRow.updatedAt !== nextRow.updatedAt
		) {
			return next
		}
	}

	return current
}

function syncDestinationDrafts(
	current: Record<string, AlertDestinationEditorRow>,
	rows: CorporationAlertDestination[]
): Record<string, AlertDestinationEditorRow> {
	const next = Object.fromEntries(
		rows.map((row) => [row.id, alertDestinationEditorRowFromDestination(row)] as const)
	)
	const currentKeys = Object.keys(current)
	const nextKeys = Object.keys(next)
	if (currentKeys.length !== nextKeys.length) return next

	for (const key of nextKeys) {
		const currentRow = current[key]
		const nextRow = next[key]
		if (
			!currentRow ||
			currentRow.id !== nextRow.id ||
			currentRow.alertType !== nextRow.alertType ||
			currentRow.destinationType !== nextRow.destinationType ||
			currentRow.discordServerId !== nextRow.discordServerId ||
			currentRow.channelId !== nextRow.channelId ||
			currentRow.coreUserId !== nextRow.coreUserId ||
			currentRow.groupId !== nextRow.groupId ||
			currentRow.isEnabled !== nextRow.isEnabled ||
			currentRow.sendToAdmins !== nextRow.sendToAdmins ||
			currentRow.sendToOwners !== nextRow.sendToOwners ||
			currentRow.sendToMembers !== nextRow.sendToMembers
		) {
			return next
		}
	}

	return current
}

function syncAlertConfigDrafts(
	current: Record<string, AlertConfigDraft>,
	configs: StructureGroupAlertConfig[]
): Record<string, AlertConfigDraft> {
	const next = Object.fromEntries(
		configs.map((config) => {
			const draft = alertConfigDraftFromRow(config)
			return [config.alertType, draft] as const
		})
	)
	const currentKeys = Object.keys(current)
	const nextKeys = Object.keys(next)
	if (currentKeys.length !== nextKeys.length) return next

	for (const key of nextKeys) {
		const currentRow = current[key]
		const nextRow = next[key]
		if (
			!currentRow ||
			currentRow.id !== nextRow.id ||
			currentRow.alertType !== nextRow.alertType ||
			currentRow.isEnabled !== nextRow.isEnabled ||
			currentRow.stateTransitions.join(',') !== nextRow.stateTransitions.join(',') ||
			currentRow.destinationIds.join(',') !== nextRow.destinationIds.join(',')
		) {
			return next
		}
	}

	return current
}

export default function AdminStructuresPage() {
	usePageTitle('Admin - Structures')
	const queryClient = useQueryClient()
	const { data: groups = EMPTY_ARRAY, isLoading: groupsLoading } = useGroups({ limit: 100 })
	const { data: corporations = EMPTY_ARRAY, isLoading: corporationsLoading } = useCorporations()
	const { data: discordServers = EMPTY_ARRAY } = useDiscordServers()

	const [selectedGroupId, setSelectedGroupId] = useState('')
	const [activeTab, setActiveTab] = useState('groups')
	const [newGroupSettingRows, setNewGroupSettingRows] = useState<StructureGroupSettingDraft[]>([])
	const [corporationDefaultDrafts, setCorporationDefaultDrafts] = useState<
		Record<string, StructureCorporationGroupDefault>
	>({})
	const [newCorporationDefaultRows, setNewCorporationDefaultRows] = useState<CorporationDefaultDraft[]>([])
	const [destinationDrafts, setDestinationDrafts] = useState<Record<string, AlertDestinationEditorRow>>(
		{}
	)
	const [newDestinationRows, setNewDestinationRows] = useState<AlertDestinationEditorRow[]>([])
	const [alertConfigDrafts, setAlertConfigDrafts] = useState<Record<string, AlertConfigDraft>>({})
	const [newStatusAlertConfigDraft, setNewStatusAlertConfigDraft] = useState<AlertConfigDraft | null>(null)
	const [newFuelAlertConfigType, setNewFuelAlertConfigType] = useState('')
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const { data: alertTypes = EMPTY_ARRAY } = useQuery({
		queryKey: ['admin', 'structures', 'alert-types'],
		queryFn: () => api.getAdminStructureAlertTypes(),
		staleTime: 1000 * 60 * 10,
	})

	const { data: structureGroupSettings = EMPTY_ARRAY, isLoading: groupSettingsLoading } = useQuery({
		queryKey: ['admin', 'structures', 'group-settings'],
		queryFn: () => api.getAdminStructureGroupSettings(),
		staleTime: 1000 * 30,
	})

	const { data: corporationDefaults = EMPTY_ARRAY, isLoading: corporationDefaultsLoading } = useQuery({
		queryKey: ['admin', 'structures', 'corporation-defaults'],
		queryFn: () => api.getAdminStructureCorporationDefaults(),
		staleTime: 1000 * 30,
	})

	const { data: alertDestinations = EMPTY_ARRAY } = useQuery({
		queryKey: ['admin', 'structures', 'destinations', selectedGroupId],
		queryFn: () => api.getAdminStructureAlertDestinations(selectedGroupId),
		enabled: Boolean(selectedGroupId),
		staleTime: 1000 * 15,
	})

	const { data: alertConfigs = EMPTY_ARRAY } = useQuery({
		queryKey: ['admin', 'structures', 'alert-configs', selectedGroupId],
		queryFn: () => api.getAdminStructureAlertConfigs(selectedGroupId),
		enabled: Boolean(selectedGroupId),
		staleTime: 1000 * 15,
	})

	useEffect(() => {
		setCorporationDefaultDrafts((current) => syncCorporationDefaultDrafts(current, corporationDefaults))
	}, [corporationDefaults])

	useEffect(() => {
		setDestinationDrafts((current) => syncDestinationDrafts(current, alertDestinations))
	}, [alertDestinations])

	useEffect(() => {
		setAlertConfigDrafts((current) => syncAlertConfigDrafts(current, alertConfigs))
	}, [alertConfigs, alertTypes])

	useEffect(() => {
		setNewDestinationRows((current) =>
			current.length > 0
				? current
				: alertTypes.length > 0
					? [createAlertDestinationEditorRow(alertTypes[0].type)]
					: current
		)
	}, [alertTypes])

	const groupOptions = useMemo(() => groups.map((group) => ({ value: group.id, label: group.name })), [groups])
	const corporationOptions = useMemo(
		() =>
			corporations.map((corporation) => ({
				value: corporation.corporationId,
				label: corporation.name,
			})),
		[corporations]
	)
	const configuredGroupIds = useMemo(
		() => new Set(structureGroupSettings.map((setting) => setting.groupId)),
		[structureGroupSettings]
	)
	const configuredGroupOptions = useMemo(
		() => groupOptions.filter((option) => configuredGroupIds.has(option.value)),
		[groupOptions, configuredGroupIds]
	)
	const configuredCorporationIds = useMemo(
		() => new Set(corporationDefaults.filter((row) => row.groupId !== null).map((row) => row.corporationId)),
		[corporationDefaults]
	)
	const availableGroupOptions = useMemo(
		() => groupOptions.filter((option) => !configuredGroupIds.has(option.value)),
		[groupOptions, configuredGroupIds]
	)
	const availableCorporationOptions = useMemo(
		() => corporationOptions.filter((option) => !configuredCorporationIds.has(option.value)),
		[corporationOptions, configuredCorporationIds]
	)
	const alertTypeOptions = useMemo(
		() => alertTypes.map((type) => ({ value: type.type, label: type.label })),
		[alertTypes]
	)
	const statusAlertTypes = useMemo(
		() => alertTypes.filter((type) => type.type === 'structure_state_changed'),
		[alertTypes]
	)
	const fuelAlertTypes = useMemo(
		() =>
			alertTypes.filter(
				(type) => type.type === 'structure_fuel_time_status' || type.type === 'structure_fuel_amount_status'
			),
		[alertTypes]
	)
	const availableFuelAlertTypeOptions = useMemo(
		() =>
			alertTypeOptions.filter(
				(option) =>
					fuelAlertTypes.some((type) => type.type === option.value) &&
					!alertConfigs.some((row) => row.alertType === option.value)
		),
		[alertConfigs, alertTypeOptions, fuelAlertTypes]
	)

	useEffect(() => {
		if (newFuelAlertConfigType && !availableFuelAlertTypeOptions.some((option) => option.value === newFuelAlertConfigType)) {
			setNewFuelAlertConfigType('')
		}
	}, [availableFuelAlertTypeOptions, newFuelAlertConfigType])

	const statusAlertType = statusAlertTypes[0] ?? null
	const statusAlertConfig = statusAlertType ? alertConfigs.find((row) => row.alertType === statusAlertType.type) ?? null : null
	const statusAlertDraft = statusAlertType
		? alertConfigDrafts[statusAlertType.type] ??
			(statusAlertConfig ? alertConfigDraftFromRow(statusAlertConfig) : emptyAlertConfigDraft(statusAlertType.type))
		: null
	const canAddStatusAlertConfig = Boolean(statusAlertType && !statusAlertConfig && !newStatusAlertConfigDraft)

	useEffect(() => {
		if (configuredGroupOptions.length === 0) {
			if (selectedGroupId) {
				setSelectedGroupId('')
			}
			return
		}

		if (!selectedGroupId || !configuredGroupIds.has(selectedGroupId)) {
			setSelectedGroupId(configuredGroupOptions[0].value)
		}
	}, [configuredGroupIds, configuredGroupOptions, selectedGroupId])
	const addGroupSetting = useMutation({
		mutationFn: (params: { groupId: string }) => api.updateAdminStructureGroupSetting(params.groupId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['admin', 'structures', 'group-settings'] })
			toast.success('Structure group added.')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Failed to add structure group.')
		},
	})

	const deleteGroupSetting = useMutation({
		mutationFn: (groupId: string) => api.deleteAdminStructureGroupSetting(groupId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['admin', 'structures', 'group-settings'] })
			toast.success('Structure group removed.')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Failed to remove structure group.')
		},
	})

	const saveCorporationDefault = useMutation({
		mutationFn: (params: { corporationId: string; groupId: string | null }) =>
			api.updateAdminStructureCorporationDefault(params.corporationId, {
				groupId: params.groupId,
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ['admin', 'structures', 'corporation-defaults'],
			})
			toast.success('Corporation default saved.')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Failed to save corporation default.')
		},
	})

	const createDestination = useApiMutation({
		mutationFn: (data: { groupId: string; payload: CreateStructureAlertDestinationRequest }) =>
			api.createAdminStructureAlertDestination(data.groupId, data.payload),
		successMessage: 'Structure alert destination created.',
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: ['admin', 'structures', 'destinations', variables.groupId],
			})
		},
	})

	const updateDestination = useApiMutation({
		mutationFn: (data: {
			groupId: string
			destinationId: string
			payload: Partial<CreateStructureAlertDestinationRequest>
		}) => api.updateAdminStructureAlertDestination(data.groupId, data.destinationId, data.payload),
		successMessage: 'Structure alert destination saved.',
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: ['admin', 'structures', 'destinations', variables.groupId],
			})
		},
	})

	const deleteDestination = useMutation({
		mutationFn: ({ groupId, destinationId }: { groupId: string; destinationId: string }) =>
			api.deleteAdminStructureAlertDestination(groupId, destinationId),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: ['admin', 'structures', 'destinations', variables.groupId],
			})
			toast.success('Structure alert destination deleted.')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Failed to delete destination.')
		},
	})

	const saveAlertConfig = useApiMutation({
		mutationFn: (data: { groupId: string; payload: CreateStructureGroupAlertConfigRequest; configId?: string }) =>
			data.configId
				? api.updateAdminStructureAlertConfig(data.groupId, data.configId, data.payload)
				: api.createAdminStructureAlertConfig(data.groupId, data.payload),
		successMessage: 'Structure alert config saved.',
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: ['admin', 'structures', 'alert-configs', variables.groupId],
			})
		},
	})

	const deleteAlertConfig = useMutation({
		mutationFn: ({ groupId, configId }: { groupId: string; configId: string }) =>
			api.deleteAdminStructureAlertConfig(groupId, configId),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: ['admin', 'structures', 'alert-configs', variables.groupId],
			})
			toast.success('Structure alert config deleted.')
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : 'Failed to delete alert config.')
		},
	})

	const canShowAdminData =
		!groupsLoading && !corporationsLoading && !groupSettingsLoading && !corporationDefaultsLoading

	if (!canShowAdminData) {
		return (
			<Container className="py-6">
				<LoadingSpinner label="Loading structure admin..." size="lg" />
			</Container>
		)
	}

	return (
		<Container className="space-y-6 py-6">
			<PageHeader
				title="Structures Admin"
				description="Site-admin configuration for structure groups, corporation defaults, reusable alert destinations, and group alert configs."
			/>

			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList>
					<TabsTrigger value="groups">Groups</TabsTrigger>
					<TabsTrigger value="corporations">Corp Defaults</TabsTrigger>
					<TabsTrigger value="alerts">Alerts</TabsTrigger>
				</TabsList>

				<TabsContent value="groups" className="space-y-4">
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between gap-4">
								<div className="space-y-1">
									<CardTitle>Structure Groups</CardTitle>
									<CardDescription>
										Add auth groups that can be assigned to structures and used by structure alert configs.
									</CardDescription>
								</div>
								<Button
									variant="primary"
									size="sm"
									onClick={() =>
										setNewGroupSettingRows((current) => [
											...current,
											{
												id: crypto.randomUUID(),
												groupId: '',
											},
										])
									}
									disabled={availableGroupOptions.length === 0}
								>
									<Plus className="h-4 w-4" />
									Add Group
								</Button>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							{newGroupSettingRows.length > 0 && (
								<div className="space-y-3 rounded-xl border border-dashed border-border/70 bg-muted/10 p-4">
									<div className="text-sm font-medium">New structure group</div>
									{newGroupSettingRows.map((row) => (
										<div key={row.id} className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_auto]">
											<Select
												options={availableGroupOptions}
												value={row.groupId}
												onValueChange={(value) =>
													setNewGroupSettingRows((current) =>
														current.map((currentRow) =>
															currentRow.id === row.id ? { ...currentRow, groupId: value } : currentRow
														)
													)
												}
												placeholder="Select auth group"
												searchable
											/>
											<div className="flex items-center justify-end gap-2">
												<Button
													variant="cancel"
													size="sm"
													showIcon={false}
													onClick={() =>
														setNewGroupSettingRows((current) =>
															current.filter((currentRow) => currentRow.id !== row.id)
														)
													}
												>
													<X className="h-4 w-4" />
													Cancel
												</Button>
												<Button
													variant="confirm"
													size="sm"
													showIcon={false}
													disabled={!row.groupId}
													onClick={async () => {
														if (!row.groupId) return
														await addGroupSetting.mutateAsync({ groupId: row.groupId })
														setNewGroupSettingRows((current) =>
															current.filter((currentRow) => currentRow.id !== row.id)
														)
													}}
													loading={addGroupSetting.isPending}
												>
													<Save className="h-4 w-4" />
													Create
												</Button>
											</div>
										</div>
									))}
								</div>
							)}
							<div className="overflow-x-auto">
								<table className="w-full border-collapse text-sm text-muted-foreground">
									<thead>
										<tr className="border-b border-border/60 text-xs uppercase tracking-wide">
											<th className="px-3 py-2 text-left font-medium">Group</th>
											<th className="px-3 py-2 text-left font-medium">Category</th>
											<th className="px-3 py-2 text-right font-medium">Actions</th>
										</tr>
									</thead>
									<tbody>
										{structureGroupSettings.map((setting) => {
											const group = groups.find((entry) => entry.id === setting.groupId)
											if (!group) return null
											return (
												<tr key={group.id} className="border-b border-border/50 hover:bg-muted/20">
													<td className="px-3 py-3 font-medium text-foreground">{group.name}</td>
													<td className="px-3 py-3 text-muted-foreground">{group.category.name}</td>
													<td className="px-3 py-3 text-right">
														<Button
															variant="destructive"
															size="sm"
															showIcon={false}
															onClick={() => void deleteGroupSetting.mutateAsync(group.id)}
															loading={deleteGroupSetting.isPending}
														>
															<Trash2 className="h-4 w-4" />
															Remove
														</Button>
													</td>
												</tr>
											)
										})}
									</tbody>
								</table>
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="corporations" className="space-y-4">
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between gap-4">
								<div className="space-y-1">
									<CardTitle>Corporation Defaults</CardTitle>
									<CardDescription>
										Add defaults only for corporations that need an explicit structure-group fallback.
									</CardDescription>
								</div>
								<Button
									variant="primary"
									size="sm"
									onClick={() =>
										setNewCorporationDefaultRows((current) => [
											...current,
											{
												id: crypto.randomUUID(),
												corporationId: '',
												groupId: null,
											},
										])
									}
									disabled={availableCorporationOptions.length === 0}
								>
									<Plus className="h-4 w-4" />
									Add Default
								</Button>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							{newCorporationDefaultRows.length > 0 && (
								<div className="space-y-3 rounded-xl border border-dashed border-border/70 bg-muted/10 p-4">
									<div className="text-sm font-medium">New corporation default</div>
									{newCorporationDefaultRows.map((row) => (
										<div key={row.id} className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
											<Select
												options={availableCorporationOptions}
												value={row.corporationId}
												onValueChange={(value) =>
													setNewCorporationDefaultRows((current) =>
														current.map((currentRow) =>
															currentRow.id === row.id ? { ...currentRow, corporationId: value } : currentRow
														)
													)
												}
												placeholder="Select corporation"
												searchable
											/>
											<Select
												options={configuredGroupOptions}
												value={row.groupId ?? ''}
												onValueChange={(value) =>
													setNewCorporationDefaultRows((current) =>
														current.map((currentRow) =>
															currentRow.id === row.id ? { ...currentRow, groupId: value || null } : currentRow
														)
													)
												}
												placeholder="Select a structure group"
												searchable
											/>
											<div className="flex items-center justify-end gap-2">
												<Button
													variant="cancel"
													size="sm"
													showIcon={false}
													onClick={() =>
														setNewCorporationDefaultRows((current) =>
															current.filter((currentRow) => currentRow.id !== row.id)
														)
													}
												>
													<X className="h-4 w-4" />
													Cancel
												</Button>
												<Button
													variant="confirm"
													size="sm"
													showIcon={false}
													disabled={!row.corporationId || !row.groupId}
													onClick={async () => {
														if (!row.corporationId || !row.groupId) return
														await saveCorporationDefault.mutateAsync({
															corporationId: row.corporationId,
															groupId: row.groupId,
														})
														setNewCorporationDefaultRows((current) =>
															current.filter((currentRow) => currentRow.id !== row.id)
														)
													}}
													loading={saveCorporationDefault.isPending}
												>
													<Save className="h-4 w-4" />
													Create
												</Button>
											</div>
										</div>
									))}
								</div>
							)}
							<div className="overflow-x-auto">
								<table className="w-full border-collapse text-sm text-muted-foreground">
									<thead>
										<tr className="border-b border-border/60 text-xs uppercase tracking-wide">
											<th className="px-3 py-2 text-left font-medium">Corporation</th>
											<th className="px-3 py-2 text-left font-medium">Default Group</th>
											<th className="px-3 py-2 text-right font-medium">Actions</th>
										</tr>
									</thead>
									<tbody>
										{Object.values(corporationDefaultDrafts).map((draft) => {
											const corporation = corporations.find((corp) => corp.corporationId === draft.corporationId)
											if (!corporation) return null
											return (
												<tr key={corporation.corporationId} className="border-b border-border/50 hover:bg-muted/20">
													<td className="px-3 py-3 font-medium text-foreground">{corporation.name}</td>
													<td className="px-3 py-3">
														<Select
															options={configuredGroupOptions}
															value={draft?.groupId ?? ''}
															onValueChange={(value) =>
																setCorporationDefaultDrafts((current) => ({
																	...current,
																	[corporation.corporationId]: {
																		...(current[corporation.corporationId] ?? {
																			corporationId: corporation.corporationId,
																			groupId: null,
																			updatedBy: null,
																			createdAt: new Date().toISOString(),
																			updatedAt: new Date().toISOString(),
																		}),
																		groupId: value || null,
																	},
																}))
															}
															searchable
														/>
													</td>
													<td className="px-3 py-3 text-right">
														<div className="inline-flex items-center gap-2">
															<Button
																variant="confirm"
																size="sm"
																showIcon={false}
																onClick={async () => {
																	await saveCorporationDefault.mutateAsync({
																		corporationId: corporation.corporationId,
																		groupId: draft?.groupId ?? null,
																	})
																}}
																loading={saveCorporationDefault.isPending}
															>
																<Save className="h-4 w-4" />
																Save
															</Button>
															<Button
																variant="destructive"
																size="sm"
																showIcon={false}
																onClick={async () => {
																	await saveCorporationDefault.mutateAsync({
																		corporationId: corporation.corporationId,
																		groupId: null,
																	})
																}}
																loading={saveCorporationDefault.isPending}
															>
																<Trash2 className="h-4 w-4" />
																Remove
															</Button>
														</div>
													</td>
												</tr>
											)
										})}
									</tbody>
								</table>
							</div>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="alerts" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Structure Alert Scope</CardTitle>
							<CardDescription>
								Select the auth group whose structure alert destinations and configs you want to edit.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<FilterField label="Structure Group">
								<Select
									options={configuredGroupOptions}
									value={selectedGroupId}
									onValueChange={setSelectedGroupId}
									placeholder="Select a structure group"
									searchable
								/>
							</FilterField>
						</CardContent>
					</Card>

					{selectedGroupId ? (
						<>
							<Card>
								<CardHeader>
									<div className="flex items-center justify-between gap-4">
										<div>
											<CardTitle>Shared Destinations</CardTitle>
											<CardDescription>
												Reusable alert destinations shared by structure alert configs in this group.
											</CardDescription>
										</div>
										<Button
											variant="primary"
											size="sm"
											onClick={() =>
												setNewDestinationRows((current) => [
													...current,
													createAlertDestinationEditorRow(
														alertTypes[0]?.type ?? 'structure_state_changed'
													),
												])
											}
										>
											<Plus className="h-4 w-4" />
											Add Destination
										</Button>
									</div>
								</CardHeader>
								<CardContent className="space-y-4">
									{newDestinationRows.map((row) => (
										<AlertDestinationEditor
											key={row.id}
											row={row}
											alertTypeOptions={alertTypeOptions}
											showAlertTypeSelector
											groupOptions={configuredGroupOptions}
											destinationTypeOptions={DESTINATION_TYPE_OPTIONS}
											discordServers={discordServers}
											onChange={(patch) =>
												setNewDestinationRows((current) =>
													current.map((currentRow) =>
														currentRow.id === row.id ? { ...currentRow, ...patch } : currentRow
													)
												)
											}
											onSave={async () => {
												const payload = buildDestinationPayload(row)
												await createDestination.mutateAsync({ groupId: selectedGroupId, payload })
												setNewDestinationRows((current) => current.filter((currentRow) => currentRow.id !== row.id))
											}}
											onRemove={() =>
												setNewDestinationRows((current) => current.filter((currentRow) => currentRow.id !== row.id))
											}
											isSaving={createDestination.isPending}
											removeButtonVariant="cancel"
										/>
									))}

									{alertDestinations.length === 0 ? (
										<div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
											No destinations configured for this group.
										</div>
										) : (
											alertDestinations.map((destination) => {
												const draft = destinationDrafts[destination.id]
												if (!draft) return null
												return (
											<AlertDestinationEditor
												key={destination.id}
												row={draft}
												alertTypeOptions={alertTypeOptions}
												showAlertTypeSelector
												groupOptions={configuredGroupOptions}
												destinationTypeOptions={DESTINATION_TYPE_OPTIONS}
												discordServers={discordServers}
													onChange={(patch) =>
														setDestinationDrafts((current) => ({
															...current,
															[destination.id]: { ...current[destination.id], ...patch },
														}))
													}
													onSave={async () => {
														const payload = buildDestinationPayload(draft)
														await updateDestination.mutateAsync({
															groupId: selectedGroupId,
															destinationId: destination.id,
															payload,
														})
													}}
													onRemove={() =>
														void deleteDestination.mutateAsync({
															groupId: selectedGroupId,
															destinationId: destination.id,
														})
													}
													isSaving={updateDestination.isPending}
													isExisting
												/>
											)
										})
									)}
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<div className="flex items-center justify-between gap-4">
										<div>
											<CardTitle>Status Alerts</CardTitle>
											<CardDescription>
												Trigger alerts when structures transition into selected destination states.
											</CardDescription>
										</div>
										<Button
											variant="primary"
											size="sm"
											onClick={() => {
												if (!statusAlertType) return
												setNewStatusAlertConfigDraft(emptyAlertConfigDraft(statusAlertType.type))
											}}
											disabled={!canAddStatusAlertConfig}
										>
											<Plus className="h-4 w-4" />
											Add Config
										</Button>
									</div>
								</CardHeader>
								<CardContent className="space-y-4">
									{statusAlertType ? (
										<>
											{statusAlertConfig ? (
												<AlertConfigEditor
													row={statusAlertDraft ?? emptyAlertConfigDraft(statusAlertType.type)}
													destinations={alertDestinations}
													alertTypeLabel={statusAlertType.label}
													description={statusAlertType.description}
													onChange={(patch) =>
														setAlertConfigDrafts((current) => ({
															...current,
															[statusAlertType.type]: {
																...(current[statusAlertType.type] ?? statusAlertDraft ?? emptyAlertConfigDraft(statusAlertType.type)),
																...patch,
															},
														}))
													}
													onSave={async () => {
														await saveAlertConfig.mutateAsync({
															groupId: selectedGroupId,
															configId: statusAlertConfig.id,
															payload: buildAlertConfigPayload(
																statusAlertDraft ?? emptyAlertConfigDraft(statusAlertType.type)
															),
														})
													}}
													onRemove={() =>
														requestConfirmation({
															title: `Delete ${statusAlertType.label}?`,
															description:
																'This will permanently remove the alert config for this structure group.',
															confirmLabel: 'Delete Config',
															intent: 'destructive',
															onConfirm: async () => {
																await deleteAlertConfig.mutateAsync({
																	groupId: selectedGroupId,
																	configId: statusAlertConfig.id,
																})
															},
														})
													}
													isSaving={saveAlertConfig.isPending}
													existingConfig={statusAlertConfig}
												/>
											) : null}

											{newStatusAlertConfigDraft ? (
												<div className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-4">
													<AlertConfigEditor
														row={newStatusAlertConfigDraft}
														destinations={alertDestinations}
														alertTypeLabel={statusAlertType.label}
														description={statusAlertType.description}
														onChange={(patch) =>
															setNewStatusAlertConfigDraft((current) =>
																current ? { ...current, ...patch } : current
															)
														}
														onSave={async () => {
															if (!newStatusAlertConfigDraft) return
															await saveAlertConfig.mutateAsync({
																groupId: selectedGroupId,
																payload: buildAlertConfigPayload(newStatusAlertConfigDraft),
															})
															setNewStatusAlertConfigDraft(null)
														}}
														onRemove={() => setNewStatusAlertConfigDraft(null)}
														isSaving={saveAlertConfig.isPending}
														removeButtonVariant="cancel"
													/>
												</div>
											) : null}

											{!statusAlertConfig && !newStatusAlertConfigDraft ? (
												<p className="text-sm text-muted-foreground">
													Add a status alert config to choose which destination states should trigger alerts.
												</p>
											) : null}
										</>
									) : null}
								</CardContent>
							</Card>

							<Card>
								<CardHeader>
									<div className="flex items-center justify-between gap-4">
										<div>
											<CardTitle>Fuel Alerts</CardTitle>
											<CardDescription>
												Use module-wide fuel settings and choose where low fuel alerts should be delivered.
											</CardDescription>
										</div>
										<Button
											variant="primary"
											size="sm"
											onClick={() => setNewFuelAlertConfigType(availableFuelAlertTypeOptions[0]?.value ?? '')}
											disabled={availableFuelAlertTypeOptions.length === 0}
										>
											<Plus className="h-4 w-4" />
											Add Config
										</Button>
									</div>
								</CardHeader>
								<CardContent className="space-y-4">
									{newFuelAlertConfigType ? (
										<div className="space-y-4 rounded-xl border border-dashed border-border/70 bg-muted/10 p-4">
											<div className="space-y-1">
												<div className="text-sm font-medium">New fuel alert config</div>
												<div className="text-xs text-muted-foreground">
													Select the fuel alert type to add for this structure group.
												</div>
											</div>
											<div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_auto]">
												<Select
													options={availableFuelAlertTypeOptions}
													value={newFuelAlertConfigType}
													onValueChange={setNewFuelAlertConfigType}
													placeholder="Select alert type"
													searchable
												/>
												<div className="flex items-center justify-end gap-2">
													<Button
														variant="cancel"
														size="sm"
														showIcon={false}
														onClick={() => setNewFuelAlertConfigType('')}
													>
														<X className="h-4 w-4" />
														Cancel
													</Button>
													<Button
														variant="confirm"
														size="sm"
														showIcon={false}
														disabled={!newFuelAlertConfigType}
														onClick={async () => {
															if (!newFuelAlertConfigType) return
															await saveAlertConfig.mutateAsync({
																groupId: selectedGroupId,
																payload: buildAlertConfigPayload(emptyAlertConfigDraft(newFuelAlertConfigType)),
															})
															setNewFuelAlertConfigType('')
														}}
														loading={saveAlertConfig.isPending}
													>
														<Save className="h-4 w-4" />
														Create
													</Button>
												</div>
											</div>
										</div>
									) : null}

									{fuelAlertTypes.some((alertType) => alertConfigs.some((row) => row.alertType === alertType.type)) ? (
										fuelAlertTypes.map((alertType) => {
											const existing = alertConfigs.find((row) => row.alertType === alertType.type)
											if (!existing) return null
											const draft = alertConfigDrafts[alertType.type] ?? alertConfigDraftFromRow(existing)
											return (
												<AlertConfigEditor
													key={alertType.type}
													row={draft}
													destinations={alertDestinations}
													alertTypeLabel={alertType.label}
													description={alertType.description}
													onChange={(patch) =>
														setAlertConfigDrafts((current) => ({
															...current,
															[alertType.type]: { ...current[alertType.type], ...patch },
														}))
													}
													onSave={async () => {
														await saveAlertConfig.mutateAsync({
															groupId: selectedGroupId,
															configId: existing.id,
															payload: buildAlertConfigPayload(draft),
														})
													}}
													onRemove={() =>
														requestConfirmation({
															title: `Delete ${alertType.label}?`,
															description:
																'This will permanently remove the alert config for this structure group.',
															confirmLabel: 'Delete Config',
															intent: 'destructive',
															onConfirm: async () => {
																await deleteAlertConfig.mutateAsync({
																	groupId: selectedGroupId,
																	configId: existing.id,
																})
															},
														})
													}
													isSaving={saveAlertConfig.isPending}
													existingConfig={existing}
												/>
											)
										})
									) : (
										<p className="text-sm text-muted-foreground">
											No fuel alert configs yet. Use Add Config to create time or amount-based fuel alerts.
										</p>
									)}
								</CardContent>
							</Card>
						</>
					) : (
						<Card>
							<CardContent className="p-6 text-sm text-muted-foreground">
								Select a structure group to manage destinations and alert configs.
							</CardContent>
						</Card>
					)}
				</TabsContent>
			</Tabs>
			{confirmationDialog}
		</Container>
	)
}

function buildDestinationPayload(row: AlertDestinationEditorRow): CreateStructureAlertDestinationRequest {
	return {
		alertType: row.alertType,
		destinationType: row.destinationType,
		discordServerId: row.destinationType === 'discord_channel' ? row.discordServerId || null : null,
		channelId: row.destinationType === 'discord_channel' ? row.channelId || null : null,
		coreUserId: row.destinationType === 'discord_user' ? row.coreUserId || null : null,
		groupId: row.destinationType === 'group' ? row.groupId || null : null,
		destinationConfig:
			row.destinationType === 'group'
				? {
						sendToAdmins: row.sendToAdmins,
						sendToOwners: row.sendToOwners,
						sendToMembers: row.sendToMembers,
					}
				: {},
		isEnabled: row.isEnabled,
	}
}

function buildAlertConfigPayload(row: AlertConfigDraft): CreateStructureGroupAlertConfigRequest {
	const payload: CreateStructureGroupAlertConfigRequest = {
		alertType: row.alertType,
		destinationIds: row.destinationIds,
		isEnabled: row.isEnabled,
	}

	if (row.alertType === 'structure_state_changed') {
		payload.config = {
			stateTransitions: row.stateTransitions,
		}
	} else if (row.alertType === 'structure_fuel_time_status' || row.alertType === 'structure_fuel_amount_status') {
		payload.config = {}
	}

	return payload
}

function AlertConfigEditor({
	row,
	destinations,
	alertTypeLabel,
	description,
	onChange,
	onSave,
	onRemove,
	isSaving,
	existingConfig,
	removeButtonVariant = 'destructive',
}: {
	row: AlertConfigDraft
	destinations: CorporationAlertDestination[]
	alertTypeLabel?: string
	description?: string
	onChange: (patch: Partial<AlertConfigDraft>) => void
	onSave: () => Promise<void>
	onRemove?: () => void
	isSaving: boolean
	existingConfig?: StructureGroupAlertConfig | null
	removeButtonVariant?: ButtonVariant
}) {
	const isStateChanged = row.alertType === 'structure_state_changed'
	const destinationRows = destinations
	const removeButtonLabel = removeButtonVariant === 'cancel' ? 'Cancel' : 'Remove'

	return (
		<div className="rounded-xl border border-border/60 bg-card p-4 space-y-4">
			<div className="flex items-center justify-between gap-3">
				<div className="space-y-1">
					<div className="font-medium">{alertTypeLabel ?? row.alertType}</div>
					<div className="text-xs text-muted-foreground">{description ?? 'Structure alert configuration.'}</div>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant={row.isEnabled ? 'success' : 'ghost'}>
						{row.isEnabled ? 'Enabled' : 'Disabled'}
					</Badge>
					<Switch checked={row.isEnabled} onCheckedChange={(checked) => onChange({ isEnabled: checked })} />
				</div>
			</div>

			<div className={isStateChanged ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'}>
				<div className="space-y-3">
					<div className="text-sm font-medium">Destinations</div>
					<div className="space-y-2 rounded-lg border border-border/60 p-3">
						{destinationRows.length === 0 ? (
							<div className="text-sm text-muted-foreground">Add shared destinations first.</div>
						) : (
							destinationRows.map((destination) => (
								<CheckRow
									key={destination.id}
									label={
										destination.destinationType === 'discord_channel'
											? `Channel ${destination.channelId ?? destination.id}`
											: destination.destinationType === 'discord_user'
												? `User ${destination.coreUserId ?? destination.id}`
												: `Group ${destination.groupId ?? destination.id}`
									}
									checked={row.destinationIds.includes(destination.id)}
									onCheckedChange={(checked) => {
										const next = checked
											? [...row.destinationIds, destination.id]
											: row.destinationIds.filter((id) => id !== destination.id)
										onChange({ destinationIds: next })
									}}
								/>
							))
						)}
					</div>
				</div>

				{isStateChanged ? (
					<div className="space-y-3">
						<div className="text-sm font-medium">Status</div>
						<div className="space-y-2 rounded-lg border border-border/60 p-3">
							<div className="text-sm text-muted-foreground">
								Select the destination status values that should trigger this alert.
							</div>
							<div className="max-h-64 space-y-2 overflow-y-auto">
								{STRUCTURE_STATE_OPTIONS.map((option) => (
									<CheckRow
										key={option.value}
										label={option.label}
										checked={row.stateTransitions.includes(option.value)}
										onCheckedChange={(checked) => {
											const next = checked
												? [...row.stateTransitions, option.value]
												: row.stateTransitions.filter((value) => value !== option.value)
											onChange({ stateTransitions: next })
										}}
									/>
								))}
							</div>
						</div>
					</div>
				) : null}
			</div>

			<div className="flex items-center justify-end gap-2">
				{onRemove && (
					<Button variant={removeButtonVariant} size="sm" onClick={onRemove} showIcon={false}>
						<Trash2 className="h-4 w-4" />
						{removeButtonLabel}
					</Button>
				)}
				<Button variant="confirm" size="sm" onClick={() => void onSave()} loading={isSaving} showIcon={false}>
					<Save className="h-4 w-4" />
					Save
				</Button>
			</div>
			{existingConfig && <div className="text-xs text-muted-foreground">Existing config id: {existingConfig.id}</div>}
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
