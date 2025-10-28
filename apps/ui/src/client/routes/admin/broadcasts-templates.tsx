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
	useBroadcastTemplates,
	useCreateBroadcastTemplate,
	useDeleteBroadcastTemplate,
	useUpdateBroadcastTemplate,
} from '@/hooks/useBroadcasts'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { BroadcastTemplate, CreateBroadcastTemplateRequest } from '@/lib/api'

export default function BroadcastTemplatesPage() {
	usePageTitle('Admin - Broadcast Templates')
	const { data: templates, isLoading } = useBroadcastTemplates()
	const { data: groups } = useGroups()
	const createTemplate = useCreateBroadcastTemplate()
	const updateTemplate = useUpdateBroadcastTemplate()
	const deleteTemplate = useDeleteBroadcastTemplate()

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)
	const [editDialogOpen, setEditDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedTemplate, setSelectedTemplate] = useState<BroadcastTemplate | null>(null)

	// Form state
	const [formData, setFormData] = useState<CreateBroadcastTemplateRequest>({
		name: '',
		description: '',
		targetType: 'discord_channel',
		groupId: '',
		fieldSchema: [{ name: 'message', label: 'Message', type: 'text', required: true }],
		messageTemplate: '{{message}}',
	})

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	const resetForm = () => {
		setFormData({
			name: '',
			description: '',
			targetType: 'discord_channel',
			groupId: '',
			fieldSchema: [{ name: 'message', label: 'Message', type: 'text', required: true }],
			messageTemplate: '{{message}}',
		})
	}

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault()
		try {
			await createTemplate.mutateAsync(formData)
			setCreateDialogOpen(false)
			resetForm()
			setMessage({ type: 'success', text: 'Broadcast template created successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create template',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleEdit = (template: BroadcastTemplate) => {
		setSelectedTemplate(template)
		setFormData({
			name: template.name,
			description: template.description || '',
			targetType: template.targetType,
			groupId: template.groupId,
			fieldSchema: template.fieldSchema,
			messageTemplate: template.messageTemplate,
		})
		setEditDialogOpen(true)
	}

	const handleUpdate = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!selectedTemplate) return

		try {
			await updateTemplate.mutateAsync({
				id: selectedTemplate.id,
				data: {
					name: formData.name,
					description: formData.description,
					fieldSchema: formData.fieldSchema,
					messageTemplate: formData.messageTemplate,
				},
			})
			setEditDialogOpen(false)
			setSelectedTemplate(null)
			resetForm()
			setMessage({ type: 'success', text: 'Template updated successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update template',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDeleteClick = (template: BroadcastTemplate) => {
		setSelectedTemplate(template)
		setDeleteDialogOpen(true)
	}

	const handleDeleteConfirm = async () => {
		if (!selectedTemplate) return

		try {
			await deleteTemplate.mutateAsync(selectedTemplate.id)
			setDeleteDialogOpen(false)
			setSelectedTemplate(null)
			setMessage({ type: 'success', text: 'Template deleted successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete template',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Broadcast Templates</h1>
					<p className="text-muted-foreground mt-1">Create reusable message templates</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Create Template
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

			{/* Templates List */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Templates</CardTitle>
					<CardDescription>Manage broadcast message templates</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-muted-foreground">Loading templates...</p>
					) : !templates || templates.length === 0 ? (
						<p className="text-muted-foreground">No templates found. Create one to get started.</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Target Type</TableHead>
									<TableHead>Group</TableHead>
									<TableHead>Fields</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{templates.map((template) => {
									const group = groups?.find((g) => g.id === template.groupId)
									return (
										<TableRow key={template.id}>
											<TableCell className="font-medium">{template.name}</TableCell>
											<TableCell>{template.targetType}</TableCell>
											<TableCell>{group?.name || template.groupId}</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{template.fieldSchema.length} field(s)
											</TableCell>
											<TableCell className="text-right space-x-2">
												<Button size="sm" variant="outline" onClick={() => handleEdit(template)}>
													Edit
												</Button>
												<DestructiveButton
													size="sm"
													onClick={() => handleDeleteClick(template)}
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
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Create Broadcast Template</DialogTitle>
						<DialogDescription>Create a reusable template for broadcasts</DialogDescription>
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
							<Label htmlFor="messageTemplate">Message Template *</Label>
							<Textarea
								id="messageTemplate"
								value={formData.messageTemplate}
								onChange={(e) => setFormData({ ...formData, messageTemplate: e.target.value })}
								rows={4}
								placeholder="Use {{fieldName}} for dynamic fields"
							/>
							<p className="text-xs text-muted-foreground mt-1">
								Use placeholders like {'{{message}}'} that match field names below
							</p>
						</div>
						<DialogFooter>
							<CancelButton onClick={() => setCreateDialogOpen(false)} type="button">
								Cancel
							</CancelButton>
							<ConfirmButton type="submit" loading={createTemplate.isPending} loadingText="Creating...">
								Create Template
							</ConfirmButton>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Edit Dialog */}
			<Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Edit Broadcast Template</DialogTitle>
						<DialogDescription>Update template settings</DialogDescription>
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
							<Label htmlFor="edit-messageTemplate">Message Template *</Label>
							<Textarea
								id="edit-messageTemplate"
								value={formData.messageTemplate}
								onChange={(e) => setFormData({ ...formData, messageTemplate: e.target.value })}
								rows={4}
								placeholder="Use {{fieldName}} for dynamic fields"
							/>
							<p className="text-xs text-muted-foreground mt-1">
								Use placeholders like {'{{message}}'} that match field names
							</p>
						</div>
						<DialogFooter>
							<CancelButton
								onClick={() => {
									setEditDialogOpen(false)
									setSelectedTemplate(null)
									resetForm()
								}}
								type="button"
							>
								Cancel
							</CancelButton>
							<ConfirmButton type="submit" loading={updateTemplate.isPending} loadingText="Updating...">
								Update Template
							</ConfirmButton>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Template</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{selectedTemplate?.name}"? Broadcasts using this template
							will not be affected.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<CancelButton
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedTemplate(null)
							}}
							disabled={deleteTemplate.isPending}
						>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleDeleteConfirm}
							loading={deleteTemplate.isPending}
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
