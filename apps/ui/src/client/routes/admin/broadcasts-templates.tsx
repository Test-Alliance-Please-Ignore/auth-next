import { CircleHelp, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { renderDiscordContentValue } from '@/components/discord-content-renderer'
import { Badge } from '@/components/ui/badge'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
import { Textarea } from '@/components/ui/textarea'
import {
	useBroadcastTargets,
	useBroadcastTemplates,
	useCreateBroadcastTemplate,
	useDeleteBroadcastTemplate,
	useUpdateBroadcastTemplate,
} from '@/hooks/useBroadcasts'
import { usePageTitle } from '@/hooks/usePageTitle'
import {
	BROADCAST_SYSTEM_TEMPLATE_TOKENS,
	getBroadcastSystemTemplateToken,
} from '@/features/broadcasts/template-tokens'

import type { BroadcastTarget, BroadcastTemplate, CreateBroadcastTemplateRequest } from '@/lib/api'

const TEMPLATE_TAG_BLOCK_REGEX = /\{\{([^}]*)\}\}/g
const TEMPLATE_FIELD_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/
const TEMPLATE_SELECT_LABEL_PATTERN = /^[a-zA-Z0-9_-]+$/

function toFieldLabel(name: string): string {
	const normalized = name
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim()

	if (!normalized) return ''

	return normalized
		.split(' ')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(' ')
}

function deriveFieldSchemaFromTemplate(
	messageTemplate: string,
	existing: CreateBroadcastTemplateRequest['fieldSchema']
): CreateBroadcastTemplateRequest['fieldSchema'] {
	const existingByName = new Map(existing.map((field) => [field.name, field]))
	const seen = new Set<string>()
	const fields: CreateBroadcastTemplateRequest['fieldSchema'] = []

	for (const match of messageTemplate.matchAll(TEMPLATE_TAG_BLOCK_REGEX)) {
		const rawToken = (match[1] ?? '').trim()
		const wrappedToken =
			rawToken.startsWith('<') && rawToken.endsWith('>')
				? rawToken.slice(1, -1).trim()
				: rawToken
		if (!wrappedToken) continue

		const systemToken = getBroadcastSystemTemplateToken(wrappedToken)
		if (systemToken) {
			const key = systemToken.name
			if (seen.has(key)) continue
			seen.add(key)
			fields.push({
				name: key,
				label: systemToken.label,
				type: systemToken.fieldType,
				required: systemToken.required,
				allowCustom: systemToken.allowCustom,
			})
			continue
		}

		if (wrappedToken.startsWith('select:')) {
			const selectBody = wrappedToken.slice('select:'.length)
			const separator = selectBody.indexOf(':')
			if (separator <= 0) {
				const labelName = selectBody.trim()
				if (!TEMPLATE_SELECT_LABEL_PATTERN.test(labelName)) {
					continue
				}
				const key = `select:${labelName}`
				if (seen.has(key)) continue
				seen.add(key)
				const prior = existingByName.get(key)
				fields.push({
					name: key,
					label: prior?.label ?? toFieldLabel(labelName),
					type: 'select',
					required: prior?.required ?? true,
					options: prior?.options ?? [],
				})
				continue
			}
			const labelName = selectBody.slice(0, separator).trim()
			const options = selectBody
				.slice(separator + 1)
				.split('|')
				.map((option) => toFieldLabel(option.trim()))
				.filter(Boolean)
			if (!TEMPLATE_SELECT_LABEL_PATTERN.test(labelName) || options.length === 0) {
				continue
			}
			const key = `select:${labelName}`
			if (seen.has(key)) continue
			seen.add(key)
			const prior = existingByName.get(key)
			fields.push({
				name: key,
				label: prior?.label ?? toFieldLabel(labelName),
				type: 'select',
				required: prior?.required ?? true,
				options,
			})
			continue
		}

		if (!TEMPLATE_FIELD_NAME_PATTERN.test(wrappedToken)) {
			continue
		}

		const key = wrappedToken
		if (seen.has(key)) continue
		seen.add(key)
		const prior = existingByName.get(key)
		if (prior) {
			fields.push(prior)
			continue
		}
		fields.push({
			name: key,
			label: toFieldLabel(key),
			type: key.toLowerCase() === 'message' ? 'textarea' : 'text',
			required: true,
		})
	}

	const frogsirenField = existing.find(
		(field) => field.type === 'system_frogsiren' && field.name === '__frogsirenEnabled'
	)
	if (frogsirenField) {
		fields.push({
			name: '__frogsirenEnabled',
			label: 'FrogSiren',
			type: 'system_frogsiren',
			required: false,
		})
	}

	const fleetTrackingField = existing.find(
		(field) =>
			field.name === '__fleetTrackingEnabled'
	)
	if (fleetTrackingField) {
		fields.push({
			name: '__fleetTrackingEnabled',
			label: 'Fleet Tracking',
			type: 'system_fleet_tracking',
			required: false,
		})
	}

	return fields
}

function getInvalidTemplateTags(messageTemplate: string): string[] {
	const invalid: string[] = []
	const seen = new Set<string>()
	for (const match of messageTemplate.matchAll(TEMPLATE_TAG_BLOCK_REGEX)) {
		const tag = (match[1] ?? '').trim()
		const wrappedToken =
			tag.startsWith('<') && tag.endsWith('>')
				? tag.slice(1, -1).trim()
				: tag
		if (TEMPLATE_FIELD_NAME_PATTERN.test(wrappedToken)) continue
		if (getBroadcastSystemTemplateToken(wrappedToken)) continue
		if (wrappedToken.startsWith('select:')) {
			const selectBody = wrappedToken.slice('select:'.length)
			const separator = selectBody.indexOf(':')
			if (separator <= 0) {
				if (TEMPLATE_SELECT_LABEL_PATTERN.test(selectBody.trim())) {
					continue
				}
			} else {
				const labelName = selectBody.slice(0, separator).trim()
				const options = selectBody
					.slice(separator + 1)
					.split('|')
					.map((option) => option.trim())
					.filter(Boolean)
				if (TEMPLATE_SELECT_LABEL_PATTERN.test(labelName) && options.length > 0) {
					continue
				}
			}
		}
		if (seen.has(tag)) continue
		seen.add(tag)
		invalid.push(tag)
	}
	return invalid
}

function templateContainsTokenName(messageTemplate: string, tokenName: string): boolean {
	const normalized = tokenName.trim()
	if (!normalized) return true
	const derived = deriveFieldSchemaFromTemplate(messageTemplate, [])
	return derived.some((field) => field.name === normalized)
}

function templateHasFleetTrackingRequiredTokens(messageTemplate: string): boolean {
	return (
		templateContainsTokenName(messageTemplate, 'fleetName') &&
		templateContainsTokenName(messageTemplate, 'fleetCommander')
	)
}

function TemplateTokenHelpPopover() {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs">
					<CircleHelp className="h-4 w-4" />
					Token help
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[36rem] max-w-[90vw] p-3 space-y-3 text-sm">
				<div>
					<p className="font-semibold">Template Tokens</p>
					<p className="text-xs text-muted-foreground">
						Default placeholders use <code>{'{{inputName}}'}</code>. They create text fields
						automatically.
					</p>
				</div>
				<div>
					<p className="font-medium">Custom select token</p>
					<p className="font-mono text-xs rounded bg-muted/40 px-2 py-1 mt-1">
						{'{{<select:labelName:option 1|option 2|option 3>}}'}
					</p>
					<p className="text-xs text-muted-foreground mt-1">
						Creates a searchable select field and renders the chosen option.
					</p>
				</div>
				<div className="space-y-2">
					<p className="font-medium">System tokens</p>
					{BROADCAST_SYSTEM_TEMPLATE_TOKENS.map((token) => (
						<div key={token.name} className="rounded border border-border/60 px-2 py-1.5">
							<div className="flex items-center justify-between gap-3">
								<span className="font-medium">{token.label}</span>
								<code className="text-xs">{token.tagSyntax}</code>
							</div>
							<p className="text-xs text-muted-foreground mt-1">{token.description}</p>
							<p className="text-xs text-muted-foreground">{token.renderBehavior}</p>
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	)
}

type TemplateDialogMode = 'create' | 'edit'

type TemplateDialogProps = {
	mode: TemplateDialogMode
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (event: React.FormEvent) => Promise<void>
	onCancel: () => void
	formData: CreateBroadcastTemplateRequest
	setFormData: (data: CreateBroadcastTemplateRequest) => void
	fleetTrackingEnabled: boolean
	setFleetTrackingEnabled: (enabled: boolean) => void
	frogsirenEnabled: boolean
	setFrogsirenEnabled: (enabled: boolean) => void
	targets: BroadcastTarget[]
	targetToAttach: string
	setTargetToAttach: (value: string) => void
	addTargetSelection: (targetId: string) => void
	removeTargetSelection: (targetId: string) => void
	handleMessageTemplateChange: (value: string) => void
	isPending: boolean
}

function TemplateDialog({
	mode,
	open,
	onOpenChange,
	onSubmit,
	onCancel,
	formData,
	setFormData,
	fleetTrackingEnabled,
	setFleetTrackingEnabled,
	frogsirenEnabled,
	setFrogsirenEnabled,
	targets,
	targetToAttach,
	setTargetToAttach,
	addTargetSelection,
	removeTargetSelection,
	handleMessageTemplateChange,
	isPending,
}: TemplateDialogProps) {
	const isCreate = mode === 'create'
	const idPrefix = isCreate ? 'create' : 'edit'

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{isCreate ? 'Create Broadcast Template' : 'Edit Broadcast Template'}
					</DialogTitle>
					<DialogDescription>
						{isCreate
							? 'Create a reusable template for broadcasts'
							: 'Update template settings'}
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
					<div>
						<Label htmlFor={`${idPrefix}-name`}>Name *</Label>
						<Input
							id={`${idPrefix}-name`}
							value={formData.name}
							onChange={(e) => setFormData({ ...formData, name: e.target.value })}
							required
						/>
					</div>
					<div>
						<Label htmlFor={`${idPrefix}-description`}>Description</Label>
						<Textarea
							id={`${idPrefix}-description`}
							value={formData.description}
							onChange={(e) => setFormData({ ...formData, description: e.target.value })}
							rows={2}
						/>
					</div>
					<div>
						<Label htmlFor={`${idPrefix}-display-order`}>Display Order</Label>
						<Input
							id={`${idPrefix}-display-order`}
							type="number"
							value={formData.displayOrder ?? 0}
							onChange={(e) =>
								setFormData({
									...formData,
									displayOrder: Number.isFinite(e.target.valueAsNumber)
										? Math.trunc(e.target.valueAsNumber)
										: 0,
								})
							}
						/>
					</div>
					<div className="rounded-md border border-border/60 px-3 py-2">
						<div className="flex items-center justify-between gap-3">
							<div className="space-y-0.5">
								<Label htmlFor={`${idPrefix}-template-fleet-tracking`}>
									Enable Fleet Tracking
								</Label>
								<p className="text-xs text-muted-foreground">
									Adds an optional fleet-tracking toggle when composing broadcasts with this template.
								</p>
							</div>
							<Switch
								id={`${idPrefix}-template-fleet-tracking`}
								checked={fleetTrackingEnabled}
								onCheckedChange={setFleetTrackingEnabled}
							/>
						</div>
					</div>
					<div className="rounded-md border border-border/60 px-3 py-2">
						<div className="flex items-center justify-between gap-3">
							<div className="space-y-0.5">
								<Label htmlFor={`${idPrefix}-template-frogsiren`}>Enable FrogSiren</Label>
								<p className="text-xs text-muted-foreground">
									Adds an optional FrogSiren toggle when composing broadcasts with this template.
								</p>
							</div>
							<Switch
								id={`${idPrefix}-template-frogsiren`}
								checked={frogsirenEnabled}
								onCheckedChange={setFrogsirenEnabled}
							/>
						</div>
					</div>
					<div>
						<Label>Targets *</Label>
						<div className="mt-2 space-y-2">
							<Select
								value={targetToAttach}
								onValueChange={(value) => {
									setTargetToAttach(value)
									addTargetSelection(value)
								}}
								options={targets
									.filter((target) => !formData.targetIds.includes(target.id))
									.map((target) => ({
										value: target.id,
										label: target.name,
									}))}
								placeholder="Search and attach a target"
								searchable
							/>
							<div className="flex flex-wrap gap-2 rounded-md border border-border bg-background p-2 min-h-10">
								{formData.targetIds.length === 0 ? (
									<span className="text-xs text-muted-foreground">No targets attached</span>
								) : (
									formData.targetIds.map((targetId) => {
										const target = targets.find((item) => item.id === targetId)
										return (
											<Badge
												key={targetId}
												variant="secondary"
												className="flex items-center gap-1 pr-1"
											>
												{target?.name ?? targetId}
												<Button
													type="button"
													variant="ghost"
													size="sm"
													className="h-5 w-5 p-0"
													onClick={() => removeTargetSelection(targetId)}
												>
													<X className="h-3 w-3" />
												</Button>
											</Badge>
										)
									})
								)}
							</div>
						</div>
					</div>
					<div>
						<div className="flex items-center justify-between gap-3">
							<Label htmlFor={`${idPrefix}-message-template`}>Message Template *</Label>
							<TemplateTokenHelpPopover />
						</div>
						<Textarea
							id={`${idPrefix}-message-template`}
							value={formData.messageTemplate}
							onChange={(e) => handleMessageTemplateChange(e.target.value)}
							rows={4}
							placeholder="Use {{fieldName}} for dynamic fields"
						/>
						<p className="text-xs text-muted-foreground mt-1">
							Each placeholder like {'{{message}}'} becomes a template field automatically.
						</p>
						<div className="mt-2 rounded-md border border-border bg-muted/20 p-3 text-sm overflow-y-auto min-h-[120px]">
							{formData.messageTemplate.trim() ? (
								renderDiscordContentValue(
									formData.messageTemplate,
									`${idPrefix}-template-preview`
								)
							) : (
								<span className="text-muted-foreground italic">Preview will appear here…</span>
							)}
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={onCancel} type="button">
							Cancel
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={isPending}
							loadingText={isCreate ? 'Creating...' : 'Updating...'}
						>
							{isCreate ? 'Create Template' : 'Update Template'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

export default function BroadcastTemplatesPage() {
	usePageTitle('Admin - Broadcast Templates')
	const { data: templates, isLoading } = useBroadcastTemplates()
	const { data: targets = [] } = useBroadcastTargets()
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
		displayOrder: 0,
		targetIds: [],
		fieldSchema: [{ name: 'message', label: 'Message', type: 'text', required: true }],
		messageTemplate: '{{message}}',
	})

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
	const [targetToAttach, setTargetToAttach] = useState('')

	const frogsirenEnabled = formData.fieldSchema.some(
		(field) => field.type === 'system_frogsiren' && field.name === '__frogsirenEnabled'
	)
	const fleetTrackingEnabled = formData.fieldSchema.some(
		(field) => field.name === '__fleetTrackingEnabled'
	)

	const resetForm = () => {
		setFormData({
			name: '',
			description: '',
			targetType: 'discord_channel',
			displayOrder: 0,
			targetIds: [],
			fieldSchema: [{ name: 'message', label: 'Message', type: 'text', required: true }],
			messageTemplate: '{{message}}',
		})
		setTargetToAttach('')
	}

	const addTargetSelection = (targetId: string) => {
		if (!targetId) return
		setFormData((current) => {
			if (current.targetIds.includes(targetId)) {
				return current
			}
			return {
				...current,
				targetIds: [...current.targetIds, targetId],
			}
		})
		setTargetToAttach('')
	}

	const removeTargetSelection = (targetId: string) => {
		setFormData((current) => ({
			...current,
			targetIds: current.targetIds.filter((id) => id !== targetId),
		}))
	}

	const handleMessageTemplateChange = (value: string) => {
		setFormData((current) => ({
			...current,
			messageTemplate: value,
			fieldSchema: deriveFieldSchemaFromTemplate(value, current.fieldSchema),
		}))
	}

	const setFrogsirenEnabled = (enabled: boolean) => {
		setFormData((current) => {
			const without = current.fieldSchema.filter(
				(field) => !(field.type === 'system_frogsiren' && field.name === '__frogsirenEnabled')
			)
			return {
				...current,
				fieldSchema: enabled
					? [
							...without,
							{
								name: '__frogsirenEnabled',
								label: 'FrogSiren',
								type: 'system_frogsiren',
								required: false,
							},
						]
					: without,
			}
		})
	}

	const setFleetTrackingEnabled = (enabled: boolean) => {
		setFormData((current) => {
			const without = current.fieldSchema.filter(
				(field) => field.name !== '__fleetTrackingEnabled'
			)
			return {
				...current,
				fieldSchema: enabled
					? [
							...without,
							{
								name: '__fleetTrackingEnabled',
								label: 'Fleet Tracking',
								type: 'system_fleet_tracking',
								required: false,
							},
						]
					: without,
			}
		})
	}

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault()
		const invalidTags = getInvalidTemplateTags(formData.messageTemplate)
		if (invalidTags.length > 0) {
			setMessage({
				type: 'error',
				text: `Invalid template tag name(s): ${invalidTags.join(', ')}. Use only letters, numbers, "_" or "-".`,
			})
			setTimeout(() => setMessage(null), 5000)
			return
		}
		if (
			fleetTrackingEnabled &&
			!templateHasFleetTrackingRequiredTokens(formData.messageTemplate)
		) {
			setMessage({
				type: 'error',
				text: 'Fleet tracking templates must include both {{<fleetName>}} and {{<fleetCommander>}} tokens.',
			})
			setTimeout(() => setMessage(null), 5000)
			return
		}
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
			displayOrder: template.displayOrder,
			targetIds: template.targetIds,
			fieldSchema: template.fieldSchema,
			messageTemplate: template.messageTemplate,
		})
		setEditDialogOpen(true)
	}

	const handleUpdate = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!selectedTemplate) return
		const invalidTags = getInvalidTemplateTags(formData.messageTemplate)
		if (invalidTags.length > 0) {
			setMessage({
				type: 'error',
				text: `Invalid template tag name(s): ${invalidTags.join(', ')}. Use only letters, numbers, "_" or "-".`,
			})
			setTimeout(() => setMessage(null), 5000)
			return
		}
		if (
			fleetTrackingEnabled &&
			!templateHasFleetTrackingRequiredTokens(formData.messageTemplate)
		) {
			setMessage({
				type: 'error',
				text: 'Fleet tracking templates must include both {{<fleetName>}} and {{<fleetCommander>}} tokens.',
			})
			setTimeout(() => setMessage(null), 5000)
			return
		}

		try {
			await updateTemplate.mutateAsync({
				id: selectedTemplate.id,
				data: {
					name: formData.name,
					description: formData.description,
					displayOrder: formData.displayOrder ?? 0,
					targetIds: formData.targetIds,
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
					<Plus className="h-4 w-4" />
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
			<Card>
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
									<TableHead>Order</TableHead>
									<TableHead>Target Type</TableHead>
									<TableHead>Target</TableHead>
									<TableHead>Fields</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{templates.map((template) => {
									const targetNames = template.targetIds
										.map((targetId) => targets.find((t) => t.id === targetId)?.name ?? targetId)
										.join(', ')
									return (
										<TableRow key={template.id}>
											<TableCell className="font-medium">{template.name}</TableCell>
											<TableCell>{template.displayOrder}</TableCell>
											<TableCell>{template.targetType}</TableCell>
											<TableCell>{targetNames}</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{template.fieldSchema.length} field(s)
											</TableCell>
											<TableCell className="text-right space-x-2">
												<Button size="sm" variant="ghost" onClick={() => handleEdit(template)}>
													Edit
												</Button>
												<Button variant="destructive"
													size="sm"
													onClick={() => handleDeleteClick(template)}
													showIcon={false}
												>
													Delete
												</Button>
											</TableCell>
										</TableRow>
									)
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<TemplateDialog
				mode="create"
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				onSubmit={handleCreate}
				onCancel={() => setCreateDialogOpen(false)}
				formData={formData}
				setFormData={setFormData}
				fleetTrackingEnabled={fleetTrackingEnabled}
				setFleetTrackingEnabled={setFleetTrackingEnabled}
				frogsirenEnabled={frogsirenEnabled}
				setFrogsirenEnabled={setFrogsirenEnabled}
				targets={targets}
				targetToAttach={targetToAttach}
				setTargetToAttach={setTargetToAttach}
				addTargetSelection={addTargetSelection}
				removeTargetSelection={removeTargetSelection}
				handleMessageTemplateChange={handleMessageTemplateChange}
				isPending={createTemplate.isPending}
			/>

			<TemplateDialog
				mode="edit"
				open={editDialogOpen}
				onOpenChange={setEditDialogOpen}
				onSubmit={handleUpdate}
				onCancel={() => {
					setEditDialogOpen(false)
					setSelectedTemplate(null)
					resetForm()
				}}
				formData={formData}
				setFormData={setFormData}
				fleetTrackingEnabled={fleetTrackingEnabled}
				setFleetTrackingEnabled={setFleetTrackingEnabled}
				frogsirenEnabled={frogsirenEnabled}
				setFrogsirenEnabled={setFrogsirenEnabled}
				targets={targets}
				targetToAttach={targetToAttach}
				setTargetToAttach={setTargetToAttach}
				addTargetSelection={addTargetSelection}
				removeTargetSelection={removeTargetSelection}
				handleMessageTemplateChange={handleMessageTemplateChange}
				isPending={updateTemplate.isPending}
			/>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Template</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{selectedTemplate?.name}"? Broadcasts using this
							template will not be affected.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel"
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedTemplate(null)
							}}
							disabled={deleteTemplate.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive"
							onClick={handleDeleteConfirm}
							loading={deleteTemplate.isPending}
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
