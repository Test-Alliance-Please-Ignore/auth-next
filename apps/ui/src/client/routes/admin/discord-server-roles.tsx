import { ArrowLeft, Edit, Plus, RefreshCw, Trash2 } from 'lucide-react'
import parseDuration from 'parse-duration'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
	useCreateDiscordRole,
	useCreateDiscordSelfAssignableRole,
	useDeleteDiscordRole,
	useDeleteDiscordSelfAssignableRole,
	useDiscordSelfAssignableRoles,
	useDiscordServers,
	useRefreshDiscordServerMembers,
	useUpdateDiscordRole,
	useUpdateDiscordSelfAssignableRole,
} from '@/hooks/useDiscord'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CreateDiscordRoleRequest, UpdateDiscordRoleRequest } from '@/lib/api'

const DURATION_PRESETS = [
	'1 hour',
	'6 hours',
	'12 hours',
	'1 day',
	'3 days',
	'1 week',
	'1 month',
	'1 year',
].map((label) => ({ value: label, label }))

const DURATION_OPTIONS = [...DURATION_PRESETS, { value: 'custom', label: 'Custom' }]

type DurationDraft = { mode: string; customValue: string }

const MIN_DURATION_SECONDS = 60
const MAX_DURATION_SECONDS = 31536000
const MAX_DURATION_INPUT_LENGTH = 100

const durationUnits = parseDuration.unit as Record<string, number>
durationUnits.month = 30 * 24 * 60 * 60 * 1000
durationUnits.mo = durationUnits.month
durationUnits.year = 365 * 24 * 60 * 60 * 1000
durationUnits.yr = durationUnits.year
durationUnits.y = durationUnits.year

function isValidDuration(value: string): boolean {
	const normalized = value.trim().toLowerCase()
	if (['forever', 'none', 'never', 'permanent'].includes(normalized)) return true
	if (!normalized || normalized.length > MAX_DURATION_INPUT_LENGTH) return false

	const milliseconds = parseDuration(normalized)
	const seconds = milliseconds === null ? 0 : Math.round(milliseconds / 1000)
	return (
		milliseconds !== null &&
		Number.isFinite(milliseconds) &&
		seconds >= MIN_DURATION_SECONDS &&
		seconds <= MAX_DURATION_SECONDS
	)
}

function durationBorderClass(isValid: boolean | null): string {
	if (isValid === true) return 'border-2 border-emerald-500 focus-visible:ring-emerald-500'
	if (isValid === false) return 'border-2 border-red-500 focus-visible:ring-red-500'
	return ''
}

function formatDuration(seconds: number | null): string {
	if (seconds === null) return 'forever'
	const units: Array<[string, number]> = [
		['year', 365 * 24 * 60 * 60],
		['month', 30 * 24 * 60 * 60],
		['week', 7 * 24 * 60 * 60],
		['day', 24 * 60 * 60],
		['hour', 60 * 60],
		['minute', 60],
	]
	for (const [name, unitSeconds] of units) {
		if (seconds % unitSeconds === 0 && seconds >= unitSeconds) {
			const count = seconds / unitSeconds
			return `${count} ${name}${count === 1 ? '' : 's'}`
		}
	}
	return `${seconds} seconds`
}

function getDurationDraft(seconds: number | null): DurationDraft {
	const value = formatDuration(seconds)
	return DURATION_PRESETS.some((option) => option.value === value)
		? { mode: value, customValue: '' }
		: { mode: 'custom', customValue: value }
}

export default function AdminDiscordServerRolesPage() {
	const { serverId } = useParams<{ serverId: string }>()
	usePageTitle('Admin - Discord Server Roles')
	const { data: discordServers, isLoading } = useDiscordServers()
	const createRole = useCreateDiscordRole()
	const updateRole = useUpdateDiscordRole()
	const deleteRole = useDeleteDiscordRole()
	const refreshMembers = useRefreshDiscordServerMembers()
	const selfAssignableRoles = useDiscordSelfAssignableRoles(serverId ?? '')
	const createSelfAssignableRole = useCreateDiscordSelfAssignableRole()
	const updateSelfAssignableRole = useUpdateDiscordSelfAssignableRole()
	const deleteSelfAssignableRole = useDeleteDiscordSelfAssignableRole()
	const { message, showSuccess, showError } = useMessage()

	const [createRoleDialogOpen, setCreateRoleDialogOpen] = useState(false)
	const [editRoleDialogOpen, setEditRoleDialogOpen] = useState(false)
	const [deleteRoleDialogOpen, setDeleteRoleDialogOpen] = useState(false)
	const [refreshing, setRefreshing] = useState(false)
	const [activeTab, setActiveTab] = useState('managed')
	const [newSelfAssignableRoleId, setNewSelfAssignableRoleId] = useState('')
	const [newSelfAssignableDuration, setNewSelfAssignableDuration] = useState<DurationDraft>({
		mode: '1 day',
		customValue: '',
	})
	const [selfAssignableDurationDrafts, setSelfAssignableDurationDrafts] = useState<
		Record<string, DurationDraft>
	>({})
	const [selfAssignableRoleDrafts, setSelfAssignableRoleDrafts] = useState<Record<string, string>>({})
	const [editingSelfAssignableRoleId, setEditingSelfAssignableRoleId] = useState<string | null>(null)
	const [isCreatingSelfAssignableRole, setIsCreatingSelfAssignableRole] = useState(false)
	const [newCustomDurationValid, setNewCustomDurationValid] = useState<boolean | null>(null)
	const [customDurationValidity, setCustomDurationValidity] = useState<
		Record<string, boolean | null>
	>({})
	const [selectedRole, setSelectedRole] = useState<{
		roleId: string
		roleName: string
		description: string | null
		isActive: boolean
		autoApply: boolean
	} | null>(null)

	const [roleFormData, setRoleFormData] = useState<CreateDiscordRoleRequest>({
		roleId: '',
		roleName: '',
		description: '',
		autoApply: false,
	})

	const [roleEditFormData, setRoleEditFormData] = useState<UpdateDiscordRoleRequest>({
		roleName: '',
		description: '',
		isActive: true,
		autoApply: false,
	})

	useEffect(() => {
		if (newSelfAssignableDuration.mode !== 'custom') {
			setNewCustomDurationValid(null)
			return
		}
		const timer = setTimeout(
			() => setNewCustomDurationValid(isValidDuration(newSelfAssignableDuration.customValue)),
			350
		)
		return () => clearTimeout(timer)
	}, [newSelfAssignableDuration])

	useEffect(() => {
		const timer = setTimeout(() => {
			setCustomDurationValidity((current) => {
				const next: Record<string, boolean | null> = {}
				for (const [configId, draft] of Object.entries(selfAssignableDurationDrafts)) {
					next[configId] = draft.mode === 'custom' ? isValidDuration(draft.customValue) : null
				}
				return Object.keys(next).length === Object.keys(current).length &&
					Object.entries(next).every(([configId, value]) => current[configId] === value)
					? current
					: next
			})
		}, 350)
		return () => clearTimeout(timer)
	}, [selfAssignableDurationDrafts])

	const server = useMemo(
		() => discordServers?.find((candidate) => candidate.id === serverId) ?? null,
		[discordServers, serverId]
	)
	const normalizedRoleId = roleFormData.roleId.trim()
	const normalizedRoleName = roleFormData.roleName.trim().toLowerCase()
	const duplicateRoleId =
		normalizedRoleId.length > 0 &&
		(server?.roles.some((role) => role.roleId === normalizedRoleId) ?? false)
	const duplicateRoleName =
		normalizedRoleName.length > 0 &&
		(server?.roles.some((role) => role.roleName.trim().toLowerCase() === normalizedRoleName) ?? false)

	const handleCreateRole = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!server || !roleFormData.roleId || !roleFormData.roleName) {
			showError('Role ID and name are required')
			return
		}
		if (duplicateRoleId || duplicateRoleName) {
			showError('A managed role with this ID or name already exists')
			return
		}

		try {
			await createRole.mutateAsync({ serverId: server.id, data: roleFormData })
			setCreateRoleDialogOpen(false)
			setRoleFormData({ roleId: '', roleName: '', description: '', autoApply: false })
			showSuccess('Role added successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to add role')
		}
	}

	const handleUpdateRole = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!server || !selectedRole) return

		try {
			await updateRole.mutateAsync({
				serverId: server.id,
				roleId: selectedRole.roleId,
				data: roleEditFormData,
			})
			setEditRoleDialogOpen(false)
			setSelectedRole(null)
			showSuccess('Role updated successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update role')
		}
	}

	const handleDeleteRole = async () => {
		if (!server || !selectedRole) return
		try {
			await deleteRole.mutateAsync({ serverId: server.id, roleId: selectedRole.roleId })
			setDeleteRoleDialogOpen(false)
			setSelectedRole(null)
			showSuccess('Role deleted successfully!')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to delete role')
		}
	}

	const handleRefreshMembers = async () => {
		if (!server) return
		setRefreshing(true)
		try {
			const result = await refreshMembers.mutateAsync(server.id)
			showSuccess(
				`Refresh complete! Processed ${result.totalProcessed} users: ${result.successfulInvites} successful, ${result.failedInvites} failed`
			)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to refresh members')
		} finally {
			setRefreshing(false)
		}
	}

	const managedRoleOptions = useMemo(
		() =>
			(server?.roles ?? [])
				.filter((role) => role.isActive)
				.map((role) => ({ value: role.id, label: role.roleName, description: role.roleId })),
		[server?.roles]
	)

	const saveNewSelfAssignableRole = async () => {
		if (!server || !newSelfAssignableRoleId) {
			showError('Select a managed role')
			return
		}
		if (
			newSelfAssignableDuration.mode === 'custom' &&
			newCustomDurationValid !== true
		) {
			showError('Enter a valid duration')
			return
		}
		try {
			await createSelfAssignableRole.mutateAsync({
				serverId: server.id,
				data: {
					discordRoleId: newSelfAssignableRoleId,
					defaultDuration:
						newSelfAssignableDuration.mode === 'custom'
							? newSelfAssignableDuration.customValue
							: newSelfAssignableDuration.mode,
				},
			})
			setNewSelfAssignableRoleId('')
			setNewSelfAssignableDuration({ mode: '1 day', customValue: '' })
			setIsCreatingSelfAssignableRole(false)
			showSuccess('Self-assignable role saved')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to save self-assignable role')
		}
	}

	const saveSelfAssignableDuration = async (
		configId: string,
		draft: DurationDraft,
		discordRoleId?: string
	) => {
		if (!server) return
		if (draft.mode === 'custom' && customDurationValidity[configId] !== true) {
			showError('Enter a valid duration')
			return
		}
		const value = draft.mode === 'custom' ? draft.customValue : draft.mode
		try {
			await updateSelfAssignableRole.mutateAsync({
				serverId: server.id,
				configId,
				data: { defaultDuration: value, ...(discordRoleId ? { discordRoleId } : {}) },
			})
			setEditingSelfAssignableRoleId(null)
			setSelfAssignableRoleDrafts((current) => {
				const { [configId]: _, ...rest } = current
				return rest
			})
			setSelfAssignableDurationDrafts((current) => {
				const { [configId]: _, ...rest } = current
				return rest
			})
			showSuccess('Self-assignable duration updated')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to update duration')
		}
	}

	if (isLoading) {
		return (
			<div className="flex justify-center py-12">
				<LoadingSpinner label="Loading Discord server..." />
			</div>
		)
	}

	if (!server) {
		return (
			<Card>
				<CardContent className="py-8">
					<p className="text-muted-foreground">Discord server not found.</p>
					<Button asChild variant="ghost" className="mt-3">
						<Link to="/admin/discord-servers">Back to Servers</Link>
					</Button>
				</CardContent>
			</Card>
		)
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<div className="text-sm text-muted-foreground">
						Discord / Servers / {server.guildName} / Roles
					</div>
					<h1 className="text-3xl font-bold gradient-text">Discord Server Roles</h1>
					<p className="text-muted-foreground mt-1">Manage role registry for this server</p>
				</div>
				<div className="flex items-center gap-2">
					<Button asChild variant="ghost">
						<Link to="/admin/discord-servers">
							<ArrowLeft className="h-4 w-4" />
							Back to Servers
						</Link>
					</Button>
					<Button variant="ghost" onClick={handleRefreshMembers} disabled={refreshing}>
						<RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
						Refresh All Members
					</Button>
					<Button variant="primary" onClick={() => setCreateRoleDialogOpen(true)}>
						<Plus className="h-4 w-4" />
						Add Role
					</Button>
				</div>
			</div>

			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList>
					<TabsTrigger value="managed">Managed Roles</TabsTrigger>
					<TabsTrigger value="self-assignable">Self-Assignable Roles</TabsTrigger>
				</TabsList>
				<TabsContent value="managed">
					<Card variant="elevated">
						<CardHeader>
							<CardTitle>Roles</CardTitle>
							<CardDescription>Server: {server.guildName}</CardDescription>
						</CardHeader>
						<CardContent>
							{server.roles.length === 0 ? (
								<p className="text-sm text-muted-foreground">No roles configured.</p>
							) : (
								<div className="max-h-[65vh] overflow-y-auto pr-1">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Role Name</TableHead>
												<TableHead>Role ID</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Description</TableHead>
												<TableHead className="text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{server.roles.map((role) => (
												<TableRow key={role.id}>
													<TableCell className="font-medium">{role.roleName}</TableCell>
													<TableCell className="font-mono text-xs text-muted-foreground">
														{role.roleId}
													</TableCell>
													<TableCell>
														<div className="flex items-center gap-2">
															<span
																className={`text-xs ${role.isActive ? 'text-primary' : 'text-muted-foreground'}`}
															>
																{role.isActive ? 'Active' : 'Inactive'}
															</span>
															{role.autoApply && (
																<span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
																	Auto-apply
																</span>
															)}
														</div>
													</TableCell>
													<TableCell className="max-w-md truncate text-sm text-muted-foreground">
														{role.description || '—'}
													</TableCell>
													<TableCell className="text-right">
														<div className="inline-flex gap-2">
										<Button
																variant="ghost"
																size="sm"
																onClick={() => {
																	setSelectedRole({
																		roleId: role.id,
																		roleName: role.roleName,
																		description: role.description,
																		isActive: role.isActive,
																		autoApply: role.autoApply,
																	})
																	setRoleEditFormData({
																		roleName: role.roleName,
																		description: role.description || '',
																		isActive: role.isActive,
																		autoApply: role.autoApply,
																	})
																	setEditRoleDialogOpen(true)
																}}
															>
																<Edit className="h-4 w-4" />
															</Button>
															<Button
																variant="ghost"
																size="sm"
																onClick={() => {
																	setSelectedRole({
																		roleId: role.id,
																		roleName: role.roleName,
																		description: role.description,
																		isActive: role.isActive,
																		autoApply: role.autoApply,
																	})
																	setDeleteRoleDialogOpen(true)
																}}
															>
																<Trash2 className="h-4 w-4 text-destructive" />
															</Button>
														</div>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>
				<TabsContent value="self-assignable">
					<Card variant="elevated">
						<CardHeader>
							<CardTitle>Self-Assignable Roles</CardTitle>
							<CardDescription>
								Choose from this server&apos;s managed roles. Unmanaged Discord roles are not
								eligible.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							{selfAssignableRoles.isLoading ? (
								<LoadingSpinner label="Loading self-assignable roles..." />
							) : selfAssignableRoles.data?.length ? (
								<div className="overflow-x-auto rounded-lg border border-border/50 bg-card">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Role</TableHead>
												<TableHead>Duration</TableHead>
												<TableHead className="text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{selfAssignableRoles.data?.map((config) => {
												const isEditing = editingSelfAssignableRoleId === config.id
												const duration =
													selfAssignableDurationDrafts[config.id] ??
													getDurationDraft(config.defaultDurationSeconds)
												return (
													<TableRow key={config.id}>
														{isEditing ? (
															<>
																<TableCell>
																	<Select
																		options={managedRoleOptions}
																		value={selfAssignableRoleDrafts[config.id] ?? config.discordRole.id}
																		onValueChange={(value) =>
																			setSelfAssignableRoleDrafts((current) => ({
																				...current,
																				[config.id]: value,
																			}))
																		}
																		searchable
																		placeholder={config.discordRole.roleName}
																	/>
																</TableCell>
																<TableCell>
																	<div className="space-y-2">
																		<Select
																			options={DURATION_OPTIONS}
																			value={duration.mode}
																			onValueChange={(mode) =>
																				setSelfAssignableDurationDrafts((current) => ({
																					...current,
																					[config.id]: { ...duration, mode },
																				}))
																			}
																			placeholder="Select duration"
																		/>
																		{duration.mode === 'custom' && (
																			<Input
																				value={duration.customValue}
																				onChange={(event) =>
																					setSelfAssignableDurationDrafts((current) => ({
																						...current,
																						[config.id]: { ...duration, customValue: event.target.value },
																					}))
																				}
																				placeholder="Custom duration, e.g. 90 minutes or forever"
																				maxLength={MAX_DURATION_INPUT_LENGTH}
																				className={durationBorderClass(customDurationValidity[config.id] ?? null)}
																				aria-invalid={customDurationValidity[config.id] === false}
																			/>
																			)}
																	</div>
																</TableCell>
																<TableCell className="text-right">
																	<div className="inline-flex gap-1">
																		<Button
																			variant="confirm"
																			className="px-2"
																			onClick={() =>
																				void saveSelfAssignableDuration(
																						config.id,
																						duration,
																						selfAssignableRoleDrafts[config.id]
																					)
																			}
											loading={updateSelfAssignableRole.isPending}
											disabled={duration.mode === 'custom' && customDurationValidity[config.id] !== true}
																		>
																			Save
																		</Button>
										<Button
																			variant="ghost"
																			className="px-2"
																			onClick={() => {
																				setEditingSelfAssignableRoleId(null)
																				setSelfAssignableRoleDrafts((current) => {
																					const { [config.id]: _, ...rest } = current
																					return rest
																				})
																				setSelfAssignableDurationDrafts((current) => {
																					const { [config.id]: _, ...rest } = current
																					return rest
																				})
																			}}
																		>
																			Cancel
																		</Button>
																	</div>
																</TableCell>
															</>
														) : (
															<>
																<TableCell className="font-medium">{config.discordRole.roleName}</TableCell>
																<TableCell className="text-sm text-muted-foreground">
																	{duration.mode === 'custom' ? duration.customValue : duration.mode}
																</TableCell>
																<TableCell className="text-right">
																	<div className="inline-flex gap-1">
																		<Button
																			variant="ghost"
																			className="px-2"
																			onClick={() => {
																				setEditingSelfAssignableRoleId(config.id)
																				setSelfAssignableRoleDrafts((current) => ({
																					...current,
																					[config.id]: config.discordRole.id,
																				}))
																				setSelfAssignableDurationDrafts((current) => ({
																					...current,
																					[config.id]: getDurationDraft(config.defaultDurationSeconds),
																				}))
																			}}
																			aria-label={`Edit ${config.discordRole.roleName} configuration`}
																			title="Edit role"
																		>
																			<Edit className="h-4 w-4" />
																		</Button>
																		<Button
																			variant="ghost"
																			className="px-2"
																			onClick={async () => {
																				if (!server) return
																				try {
																					await deleteSelfAssignableRole.mutateAsync({
																						serverId: server.id,
																						configId: config.id,
																					})
																					showSuccess('Self-assignable role removed')
																			} catch (error) {
																					showError(
																						error instanceof Error
																							? error.message
																							: 'Failed to remove self-assignable role'
																					)
																				}
																			}}
																			aria-label={`Remove ${config.discordRole.roleName} configuration`}
																			title="Remove role"
																		>
																			<Trash2 className="h-4 w-4 text-destructive" />
																		</Button>
																	</div>
																</TableCell>
															</>
														)}
													</TableRow>
												)
											})}
											{isCreatingSelfAssignableRole && (
												<TableRow>
													<TableCell>
														<Select
															options={managedRoleOptions}
															value={newSelfAssignableRoleId}
															onValueChange={setNewSelfAssignableRoleId}
															searchable
															placeholder="Select managed role"
														/>
													</TableCell>
													<TableCell>
														<div className="space-y-2">
															<Select
																options={DURATION_OPTIONS}
																value={newSelfAssignableDuration.mode}
																onValueChange={(mode) =>
																	setNewSelfAssignableDuration((current) => ({ ...current, mode }))
																}
																placeholder="Select duration"
															/>
															{newSelfAssignableDuration.mode === 'custom' && (
																<Input
																	value={newSelfAssignableDuration.customValue}
																	onChange={(event) =>
																		setNewSelfAssignableDuration((current) => ({
																			...current,
																			customValue: event.target.value,
																		}))
																	}
																	placeholder="Custom duration, e.g. 90 minutes or forever"
																	maxLength={MAX_DURATION_INPUT_LENGTH}
																	className={durationBorderClass(newCustomDurationValid)}
																	aria-invalid={newCustomDurationValid === false}
																/>
																)}
															</div>
													</TableCell>
													<TableCell className="text-right">
														<div className="inline-flex gap-1">
															<Button
																variant="confirm"
																className="px-2"
																onClick={saveNewSelfAssignableRole}
											loading={createSelfAssignableRole.isPending}
											disabled={
												newSelfAssignableDuration.mode === 'custom' &&
												newCustomDurationValid !== true
											}
															>
																Save
															</Button>
															<Button
																variant="ghost"
																className="px-2"
																onClick={() => {
																	setIsCreatingSelfAssignableRole(false)
																	setNewSelfAssignableRoleId('')
																	setNewSelfAssignableDuration({ mode: '1 day', customValue: '' })
																}}
															>
																Cancel
															</Button>
														</div>
													</TableCell>
												</TableRow>
											)}
										</TableBody>
									</Table>
								</div>
							) : (
								<p className="text-sm text-muted-foreground">No self-assignable roles configured.</p>
							)}
							{!isCreatingSelfAssignableRole && (
								<div className="flex justify-center">
									<Button
										variant="secondary"
										className="px-2"
										onClick={() => setIsCreatingSelfAssignableRole(true)}
									>
										<Plus className="h-4 w-4" />
										Add configuration
									</Button>
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			<Dialog open={createRoleDialogOpen} onOpenChange={setCreateRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add Role</DialogTitle>
						<DialogDescription>Add a new role to {server.guildName}</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleCreateRole} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="roleId">Role ID *</Label>
							<Input
								id="roleId"
								type="text"
								value={roleFormData.roleId}
								onChange={(e) => setRoleFormData({ ...roleFormData, roleId: e.target.value })}
								className={duplicateRoleId ? 'border-destructive focus-visible:ring-destructive' : undefined}
								aria-invalid={duplicateRoleId}
								required
							/>
							{duplicateRoleId && (
								<p className="text-xs text-destructive">This role ID is already managed.</p>
							)}
						</div>
						<div className="space-y-2">
							<Label htmlFor="roleName">Role Name *</Label>
							<Input
								id="roleName"
								type="text"
								value={roleFormData.roleName}
								onChange={(e) => setRoleFormData({ ...roleFormData, roleName: e.target.value })}
								className={duplicateRoleName ? 'border-destructive focus-visible:ring-destructive' : undefined}
								aria-invalid={duplicateRoleName}
								required
							/>
							{duplicateRoleName && (
								<p className="text-xs text-destructive">This role name is already managed.</p>
							)}
						</div>
						<div className="space-y-2">
							<Label htmlFor="role-description">Description (Optional)</Label>
							<Input
								id="role-description"
								type="text"
								value={roleFormData.description}
								onChange={(e) => setRoleFormData({ ...roleFormData, description: e.target.value })}
							/>
						</div>
						<div className="flex items-center space-x-2">
							<Switch
								id="autoApply"
								checked={roleFormData.autoApply ?? false}
								onCheckedChange={(checked) =>
									setRoleFormData({ ...roleFormData, autoApply: checked })
								}
							/>
							<Label htmlFor="autoApply" className="cursor-pointer">
								Auto-apply to all users
							</Label>
						</div>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setCreateRoleDialogOpen(false)}>
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								disabled={duplicateRoleId || duplicateRoleName}
								loading={createRole.isPending}
								loadingText="Adding..."
							>
								Add Role
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={editRoleDialogOpen} onOpenChange={setEditRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Role</DialogTitle>
						<DialogDescription>Update role information</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleUpdateRole} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="edit-roleName">Role Name *</Label>
							<Input
								id="edit-roleName"
								type="text"
								value={roleEditFormData.roleName}
								onChange={(e) =>
									setRoleEditFormData({ ...roleEditFormData, roleName: e.target.value })
								}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="edit-role-description">Description (Optional)</Label>
							<Input
								id="edit-role-description"
								type="text"
								value={roleEditFormData.description}
								onChange={(e) =>
									setRoleEditFormData({ ...roleEditFormData, description: e.target.value })
								}
							/>
						</div>
						<div className="flex items-center space-x-2">
							<Switch
								id="edit-role-active"
								checked={roleEditFormData.isActive ?? true}
								onCheckedChange={(checked) =>
									setRoleEditFormData({ ...roleEditFormData, isActive: checked })
								}
							/>
							<Label htmlFor="edit-role-active">Active</Label>
						</div>
						<div className="flex items-center space-x-2">
							<Switch
								id="edit-role-autoApply"
								checked={roleEditFormData.autoApply ?? false}
								onCheckedChange={(checked) =>
									setRoleEditFormData({ ...roleEditFormData, autoApply: checked })
								}
							/>
							<Label htmlFor="edit-role-autoApply">Auto-apply to all users</Label>
						</div>
						<DialogFooter>
							<Button variant="cancel" type="button" onClick={() => setEditRoleDialogOpen(false)}>
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateRole.isPending}
								loadingText="Updating..."
							>
								Update Role
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={deleteRoleDialogOpen} onOpenChange={setDeleteRoleDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Role</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete role "{selectedRole?.roleName}"?
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteRoleDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteRole}
							loading={deleteRole.isPending}
							loadingText="Deleting..."
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
