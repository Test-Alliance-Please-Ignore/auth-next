import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DestructiveButton } from '@/components/ui/destructive-button'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
	useBroadcastTargets,
	useCreateBroadcastTarget,
	useDeleteBroadcastTarget,
	useUpdateBroadcastTarget,
} from '@/hooks/useBroadcasts'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { BroadcastTarget, CreateBroadcastTargetRequest } from '@/lib/api'

export default function BroadcastTargetsPage() {
	usePageTitle('Admin - Broadcast Targets')
	const { data: targets, isLoading } = useBroadcastTargets()
	const { data: groups } = useGroups()
	const createTarget = useCreateBroadcastTarget()
	const updateTarget = useUpdateBroadcastTarget()
	const deleteTarget = useDeleteBroadcastTarget()

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)
	const [editDialogOpen, setEditDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedTarget, setSelectedTarget] = useState<BroadcastTarget | null>(null)

	// Form state
	const [formData, setFormData] = useState<CreateBroadcastTargetRequest>({
		name: '',
		description: '',
		type: 'discord_channel',
		groupId: '',
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
			groupId: '',
			config: {
				guildId: '',
				channelId: '',
			},
		})
	}

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
		setSelectedTarget(target)
		setFormData({
			name: target.name,
			description: target.description || '',
			type: target.type,
			groupId: target.groupId,
			config: target.config as { guildId: string; channelId: string },
		})
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
					config: formData.config,
				},
			})
			setEditDialogOpen(false)
			setSelectedTarget(null)
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
					<Plus className="mr-2 h-4 w-4" />
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
					) : !targets || targets.length === 0 ? (
						<p className="text-muted-foreground">No targets found. Create one to get started.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Group</TableHead>
									<TableHead>Configuration</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{targets.map((target) => {
									const group = groups?.find((g) => g.id === target.groupId)
									const config = target.config as { guildId?: string; channelId?: string }
									return (
										<TableRow key={target.id}>
											<TableCell className="font-medium">{target.name}</TableCell>
											<TableCell>{target.type}</TableCell>
											<TableCell>{group?.name || target.groupId}</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{config.channelId && `Channel: ${config.channelId}`}
											</TableCell>
											<TableCell className="text-right space-x-2">
												<Button size="sm" variant="outline" onClick={() => handleEdit(target)}>
													Edit
												</Button>
												<DestructiveButton
													size="sm"
													onClick={() => handleDeleteClick(target)}
													showIcon={false}
												>
													Delete
												</DestructiveButton>
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
						<div>
							<Label htmlFor="group">Group *</Label>
							<Select
								value={formData.groupId}
								onValueChange={(value) => setFormData({ ...formData, groupId: value })}
							>
								<SelectTrigger id="group">
									<SelectValue placeholder="Select a group" />
								</SelectTrigger>
								<SelectContent>
									{groups?.map((group) => (
										<SelectItem key={group.id} value={group.id}>
											{group.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label htmlFor="guildId">Discord Guild ID *</Label>
							<Input
								id="guildId"
								value={formData.config.guildId}
								onChange={(e) =>
									setFormData({
										...formData,
										config: { ...formData.config, guildId: e.target.value },
									})
								}
								required
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
							<CancelButton onClick={() => setCreateDialogOpen(false)} type="button">
								Cancel
							</CancelButton>
							<ConfirmButton type="submit" loading={createTarget.isPending} loadingText="Creating...">
								Create Target
							</ConfirmButton>
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
							<Label htmlFor="edit-guildId">Discord Guild ID *</Label>
							<Input
								id="edit-guildId"
								value={formData.config.guildId}
								onChange={(e) =>
									setFormData({
										...formData,
										config: { ...formData.config, guildId: e.target.value },
									})
								}
								required
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
							<CancelButton
								onClick={() => {
									setEditDialogOpen(false)
									setSelectedTarget(null)
									resetForm()
								}}
								type="button"
							>
								Cancel
							</CancelButton>
							<ConfirmButton type="submit" loading={updateTarget.isPending} loadingText="Updating...">
								Update Target
							</ConfirmButton>
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
						<CancelButton
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedTarget(null)
							}}
							disabled={deleteTarget.isPending}
						>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleDeleteConfirm}
							loading={deleteTarget.isPending}
							loadingText="Deleting..."
							showIcon={false}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
