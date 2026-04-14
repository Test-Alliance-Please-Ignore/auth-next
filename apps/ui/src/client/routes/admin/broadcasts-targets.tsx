import { TextInput as MantineTextInput } from '@mantine/core'
import { Edit, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

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
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
	useBroadcastTargets,
	useCreateBroadcastTarget,
	useDeleteBroadcastTarget,
	useUpdateBroadcastTarget,
} from '@/hooks/useBroadcasts'
import { useDiscordServers } from '@/hooks/useDiscord'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useGlobalPermissions } from '@/hooks/usePermissions'
import {
	MANTINE_THEMED_INPUT_CLASS_NAMES,
	MANTINE_THEMED_INPUT_STYLES,
} from '@/lib/mantine-input-styles'

import type { BroadcastTarget, CreateBroadcastTargetRequest } from '@/lib/api'

export default function BroadcastTargetsPage() {
	usePageTitle('Admin - Broadcast Targets')
	const { data: targets, isLoading, error } = useBroadcastTargets()
	const { data: discordServers = [] } = useDiscordServers()
	const { data: globalPermissions = [] } = useGlobalPermissions()
	const createTarget = useCreateBroadcastTarget()
	const updateTarget = useUpdateBroadcastTarget()
	const deleteTarget = useDeleteBroadcastTarget()
	const discordServerOptions = discordServers.map((server) => ({
		value: server.guildId,
		label: server.guildName,
		description: server.guildId,
	}))
	const broadcastPermissionOptions = globalPermissions
		.filter(
			(permission) =>
				permission.urn.startsWith('urn:broadcasts:') && permission.urn !== 'urn:broadcasts:manage'
		)
		.map((permission) => ({
			value: permission.urn,
			label: permission.name,
			description: permission.urn,
		}))

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)
	const [editDialogOpen, setEditDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedTarget, setSelectedTarget] = useState<BroadcastTarget | null>(null)
	const [editPermissionUrns, setEditPermissionUrns] = useState({
		send: '',
		manage: '',
	})

	// Form state
	const [formData, setFormData] = useState<CreateBroadcastTargetRequest>({
		name: '',
		description: '',
		type: 'discord_channel',
		permissionEntityNamespace: '',
		permissionTargetName: '',
		config: {
			guildId: '',
			channelId: '',
		},
	})

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	const resetForm = () => {
		setFormData({
			name: '',
			description: '',
			type: 'discord_channel',
			permissionEntityNamespace: '',
			permissionTargetName: '',
			config: {
				guildId: '',
				channelId: '',
			},
		})
	}

	const sanitizePermissionPart = (value: string): string =>
		value
			.toLowerCase()
			.replace(/[^a-z0-9_-]/g, '')
			.slice(0, 64)

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault()
		try {
			await createTarget.mutateAsync(formData)
			setCreateDialogOpen(false)
			resetForm()
			setMessage({ type: 'success', text: 'Broadcast target created successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create target',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleEdit = (target: BroadcastTarget) => {
		const sendPermissionUrn =
			globalPermissions.find((permission) => permission.id === target.sendPermissionId)?.urn ?? ''
		const managePermissionUrn =
			globalPermissions.find((permission) => permission.id === target.managePermissionId)?.urn ?? ''
		setSelectedTarget(target)
		setFormData({
			name: target.name,
			description: target.description || '',
			type: target.type,
			permissionEntityNamespace: '',
			permissionTargetName: '',
			config: target.config as { guildId: string; channelId: string },
		})
		setEditPermissionUrns({ send: sendPermissionUrn, manage: managePermissionUrn })
		setEditDialogOpen(true)
	}

	const handleUpdate = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!selectedTarget) return

		try {
			await updateTarget.mutateAsync({
				id: selectedTarget.id,
				data: {
					name: formData.name,
					description: formData.description,
					sendPermissionUrn: editPermissionUrns.send.trim() || undefined,
					managePermissionUrn: editPermissionUrns.manage.trim() || undefined,
					config: formData.config,
				},
			})
			setEditDialogOpen(false)
			setSelectedTarget(null)
			setEditPermissionUrns({ send: '', manage: '' })
			resetForm()
			setMessage({ type: 'success', text: 'Target updated successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update target',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDeleteClick = (target: BroadcastTarget) => {
		setSelectedTarget(target)
		setDeleteDialogOpen(true)
	}

	const handleDeleteConfirm = async () => {
		if (!selectedTarget) return

		try {
			await deleteTarget.mutateAsync(selectedTarget.id)
			setDeleteDialogOpen(false)
			setSelectedTarget(null)
			setMessage({ type: 'success', text: 'Target deleted successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete target',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Broadcast Targets</h1>
					<p className="text-muted-foreground mt-1">
						Manage where broadcasts can be sent (Discord channels, etc.)
					</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)}>
					<Plus className="h-4 w-4" />
					Create Target
				</Button>
			</div>

			{/* Success/Error Message */}
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

			{/* Targets List */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Targets</CardTitle>
					<CardDescription>Configure broadcast destinations</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-muted-foreground">Loading targets...</p>
					) : error ? (
						<p className="text-destructive">
							{error instanceof Error ? error.message : 'Failed to load targets'}
						</p>
					) : !targets || targets.length === 0 ? (
						<p className="text-muted-foreground">No targets found. Create one to get started.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Description</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Configuration</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{targets.map((target) => {
									const config = target.config as { guildId?: string; channelId?: string }
									return (
										<TableRow key={target.id}>
											<TableCell className="font-medium">{target.name}</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{target.description || '-'}
											</TableCell>
											<TableCell>{target.type}</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{config.channelId && `Channel: ${config.channelId}`}
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-2">
													<Button
														size="sm"
														variant="ghost"
														onClick={() => handleEdit(target)}
														title="Edit target"
													>
														<Edit className="h-4 w-4" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleDeleteClick(target)}
														title="Delete target"
													>
														<Trash2 className="h-4 w-4 text-destructive" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									)
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Create Dialog */}
			<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create Broadcast Target</DialogTitle>
						<DialogDescription>Add a new destination for broadcasts</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleCreate} className="space-y-4">
						<div>
							<Label htmlFor="name">Name *</Label>
							<Input
								id="name"
								value={formData.name}
								onChange={(e) => setFormData({ ...formData, name: e.target.value })}
								required
							/>
						</div>
						<div>
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								value={formData.description}
								onChange={(e) => setFormData({ ...formData, description: e.target.value })}
								rows={2}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="permissionEntityNamespace">Permission Entity Namespace *</Label>
							<MantineTextInput
								id="permissionEntityNamespace"
								value={formData.permissionEntityNamespace}
								onChange={(e) =>
									setFormData({
										...formData,
										permissionEntityNamespace: sanitizePermissionPart(e.currentTarget.value),
									})
								}
								placeholder="test-alliance"
								description="Allowed characters: a-z, 0-9, -, _"
								withAsterisk
								classNames={MANTINE_THEMED_INPUT_CLASS_NAMES}
								styles={MANTINE_THEMED_INPUT_STYLES}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="permissionTargetName">Permission Target Name *</Label>
							<MantineTextInput
								id="permissionTargetName"
								value={formData.permissionTargetName}
								onChange={(e) =>
									setFormData({
										...formData,
										permissionTargetName: sanitizePermissionPart(e.currentTarget.value),
									})
								}
								placeholder="info-all"
								description="Allowed characters: a-z, 0-9, -, _"
								withAsterisk
								classNames={MANTINE_THEMED_INPUT_CLASS_NAMES}
								styles={MANTINE_THEMED_INPUT_STYLES}
							/>
						</div>
						<div>
							<Label htmlFor="guildId">Discord Server *</Label>
							<Select
								inputId="guildId"
								value={formData.config.guildId}
								onValueChange={(value) =>
									setFormData({
										...formData,
										config: { ...formData.config, guildId: value },
									})
								}
								options={discordServerOptions}
								searchable
								placeholder="Select a configured Discord server"
								emptyText="No configured Discord servers found"
								getOptionSearchText={(option) => `${option.label} ${option.description ?? ''}`}
							/>
						</div>
						<div>
							<Label htmlFor="channelId">Discord Channel ID *</Label>
							<Input
								id="channelId"
								value={formData.config.channelId}
								onChange={(e) =>
									setFormData({
										...formData,
										config: { ...formData.config, channelId: e.target.value },
									})
								}
								required
							/>
						</div>
						<DialogFooter>
							<Button variant="cancel" onClick={() => setCreateDialogOpen(false)} type="button">
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={createTarget.isPending}
								loadingText="Creating..."
								disabled={
									!formData.permissionEntityNamespace ||
									!formData.permissionTargetName ||
									!formData.config.guildId ||
									!formData.config.channelId
								}
							>
								Create Target
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Edit Dialog */}
			<Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit Broadcast Target</DialogTitle>
						<DialogDescription>Update target settings</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleUpdate} className="space-y-4">
						<div>
							<Label htmlFor="edit-name">Name *</Label>
							<Input
								id="edit-name"
								value={formData.name}
								onChange={(e) => setFormData({ ...formData, name: e.target.value })}
								required
							/>
						</div>
						<div>
							<Label htmlFor="edit-description">Description</Label>
							<Textarea
								id="edit-description"
								value={formData.description}
								onChange={(e) => setFormData({ ...formData, description: e.target.value })}
								rows={2}
							/>
						</div>
						<div>
							<Label htmlFor="edit-sendPermissionUrn">Send Permission URN</Label>
							<Select
								inputId="edit-sendPermissionUrn"
								options={broadcastPermissionOptions}
								value={editPermissionUrns.send}
								onValueChange={(value) =>
									setEditPermissionUrns((current) => ({ ...current, send: value }))
								}
								searchable
								placeholder="Select send permission"
								emptyText="No broadcast permissions found"
								getOptionSearchText={(option) => `${option.label} ${option.description ?? ''}`}
							/>
						</div>
						<div>
							<Label htmlFor="edit-managePermissionUrn">Manage Permission URN</Label>
							<Select
								inputId="edit-managePermissionUrn"
								options={broadcastPermissionOptions}
								value={editPermissionUrns.manage}
								onValueChange={(value) =>
									setEditPermissionUrns((current) => ({ ...current, manage: value }))
								}
								searchable
								placeholder="Select manage permission"
								emptyText="No broadcast permissions found"
								getOptionSearchText={(option) => `${option.label} ${option.description ?? ''}`}
							/>
						</div>
						<div>
							<Label htmlFor="edit-guildId">Discord Server *</Label>
							<Select
								inputId="edit-guildId"
								value={formData.config.guildId}
								onValueChange={(value) =>
									setFormData({
										...formData,
										config: { ...formData.config, guildId: value },
									})
								}
								options={discordServerOptions}
								searchable
								placeholder="Select a configured Discord server"
								emptyText="No configured Discord servers found"
								getOptionSearchText={(option) => `${option.label} ${option.description ?? ''}`}
							/>
						</div>
						<div>
							<Label htmlFor="edit-channelId">Discord Channel ID *</Label>
							<Input
								id="edit-channelId"
								value={formData.config.channelId}
								onChange={(e) =>
									setFormData({
										...formData,
										config: { ...formData.config, channelId: e.target.value },
									})
								}
								required
							/>
						</div>
						<DialogFooter>
							<Button
								variant="cancel"
								onClick={() => {
									setEditDialogOpen(false)
									setSelectedTarget(null)
									setEditPermissionUrns({ send: '', manage: '' })
									resetForm()
								}}
								type="button"
							>
								Cancel
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateTarget.isPending}
								loadingText="Updating..."
							>
								Update Target
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Target</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{selectedTarget?.name}"? This will also delete all
							broadcasts and deliveries associated with this target.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedTarget(null)
							}}
							disabled={deleteTarget.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteConfirm}
							loading={deleteTarget.isPending}
							loadingText="Deleting..."
							showIcon={false}
						>
							<Trash2 className="h-4 w-4" />
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
