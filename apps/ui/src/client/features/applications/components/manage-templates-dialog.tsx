/**
 * Manage Templates Dialog Component
 *
 * A dialog for HR staff to manage message templates for their corporation.
 * Supports creating, editing, and deleting templates.
 */

import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { useMessage } from '@/hooks/useMessage'
import { useAppTranslation } from '@/i18n'
import { formatRelativeTime as formatDistanceToNow } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import { useCreateTemplate, useDeleteTemplate, useTemplates, useUpdateTemplate } from '../hooks'

import type { MessageTemplate, MessageTemplateStatus } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface ManageTemplatesDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	corporationId: string
}

interface TemplateFormData {
	templateName: string
	messageTemplate: string
	description: string
	status: 'draft' | 'active' | 'inactive'
}

// ============================================================================
// Constants
// ============================================================================

const STATUS_COLORS: Record<MessageTemplateStatus, string> = {
	draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
	active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
	inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
	deleted: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

const INITIAL_FORM_DATA: TemplateFormData = {
	templateName: '',
	messageTemplate: '',
	description: '',
	status: 'active',
}

// ============================================================================
// Component
// ============================================================================

export function ManageTemplatesDialog({
	open,
	onOpenChange,
	corporationId,
}: ManageTemplatesDialogProps) {
	const { t } = useAppTranslation()

	const { showSuccess, showError } = useMessage()

	// State
	const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list')
	const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null)
	const [formData, setFormData] = useState<TemplateFormData>(INITIAL_FORM_DATA)
	const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

	// Fetch templates (all statuses except deleted)
	const { data: templates, isLoading } = useTemplates(corporationId)

	// Mutations
	const createMutation = useCreateTemplate()
	const updateMutation = useUpdateTemplate()
	const deleteMutation = useDeleteTemplate()

	// Handlers
	const handleCreate = () => {
		setFormData(INITIAL_FORM_DATA)
		setEditingTemplate(null)
		setMode('create')
	}

	const handleEdit = (template: MessageTemplate) => {
		setFormData({
			templateName: template.templateName,
			messageTemplate: template.messageTemplate,
			description: template.description || '',
			status: template.status === 'deleted' ? 'inactive' : template.status,
		})
		setEditingTemplate(template)
		setMode('edit')
	}

	const handleDelete = async (templateId: string) => {
		try {
			await deleteMutation.mutateAsync({ templateId, corporationId })
			showSuccess(t('hrpages.templateDeleted'))
			setDeleteConfirmId(null)
		} catch (error) {
			showError(error instanceof Error ? error.message : t('hrpages.failedToDeleteTemplate'))
		}
	}

	const handleSave = async () => {
		// Validate
		if (!formData.templateName.trim()) {
			showError(t('hrpages.templateNameIsRequired'))
			return
		}
		if (!formData.messageTemplate.trim()) {
			showError(t('hrpages.templateContentIsRequired'))
			return
		}

		try {
			if (mode === 'create') {
				await createMutation.mutateAsync({
					corporationId,
					data: {
						templateName: formData.templateName.trim(),
						messageTemplate: formData.messageTemplate.trim(),
						description: formData.description.trim() || undefined,
						status: formData.status,
					},
				})
				showSuccess(t('hrpages.templateCreated'))
			} else if (mode === 'edit' && editingTemplate) {
				await updateMutation.mutateAsync({
					templateId: editingTemplate.id,
					data: {
						templateName: formData.templateName.trim(),
						messageTemplate: formData.messageTemplate.trim(),
						description: formData.description.trim() || null,
						status: formData.status,
					},
				})
				showSuccess(t('hrpages.templateUpdated'))
			}
			setMode('list')
		} catch (error) {
			showError(error instanceof Error ? error.message : t('hrpages.failedToSaveTemplate'))
		}
	}

	const handleCancel = () => {
		setMode('list')
		setEditingTemplate(null)
		setFormData(INITIAL_FORM_DATA)
	}

	const handleClose = () => {
		onOpenChange(false)
		// Reset state after dialog closes
		setTimeout(() => {
			setMode('list')
			setEditingTemplate(null)
			setFormData(INITIAL_FORM_DATA)
			setDeleteConfirmId(null)
		}, 200)
	}

	const isSaving = createMutation.isPending || updateMutation.isPending

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>
						{mode === 'list' && t('hrpages.messageTemplates')}
						{mode === 'create' && t('hrpages.createTemplate')}
						{mode === 'edit' && t('hrpages.editTemplate')}
					</DialogTitle>
					<DialogDescription>
						{mode === 'list' && t('hrpages.manageMessageTemplatesForThisCorporation')}
						{mode === 'create' && t('hrpages.createANewMessageTemplate')}
						{mode === 'edit' && t('hrpages.editTheTemplateDetails')}
					</DialogDescription>
				</DialogHeader>

				{/* List View */}
				{mode === 'list' && (
					<>
						<div className="flex-1 overflow-y-auto min-h-[300px]">
							{isLoading ? (
								<div className="flex items-center justify-center py-8">
									<LoadingSpinner size="md" />
								</div>
							) : templates && templates.length > 0 ? (
								<div className="space-y-2">
									{templates.map((template) => (
										<div
											key={template.id}
											className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
										>
											<FileText className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="font-medium text-sm">{template.templateName}</span>
													<Badge
														variant="secondary"
														className={cn('text-xs', STATUS_COLORS[template.status])}
													>
														{template.status}
													</Badge>
												</div>
												{template.description && (
													<p className="text-xs text-muted-foreground mt-0.5 truncate">
														{template.description}
													</p>
												)}
												<p className="text-xs text-muted-foreground mt-1">
													{t('hrpages.updated')}{' '}
													{formatDistanceToNow(new Date(template.updatedAt), {
														addSuffix: true,
													})}
												</p>
											</div>
											<div className="flex items-center gap-1">
												<Button
													variant="ghost"
													size="sm"
													className="h-8 w-8 p-0"
													onClick={() => handleEdit(template)}
												>
													<Pencil className="h-4 w-4" />
												</Button>
												{deleteConfirmId === template.id ? (
													<div className="flex items-center gap-1">
														<Button
															variant="destructive"
															size="sm"
															className="h-8 px-2 text-xs"
															onClick={() => handleDelete(template.id)}
															disabled={deleteMutation.isPending}
														>
															{deleteMutation.isPending ? (
																<LoadingSpinner size="sm" />
															) : (
																t('hrpages.confirm')
															)}
														</Button>
														<Button
															variant="ghost"
															size="sm"
															className="h-8 px-2 text-xs"
															onClick={() => setDeleteConfirmId(null)}
														>
															{t('hrpages.cancel')}
														</Button>
													</div>
												) : (
													<Button
														variant="ghost"
														size="sm"
														className="h-8 w-8 p-0 text-destructive hover:text-destructive"
														onClick={() => setDeleteConfirmId(template.id)}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												)}
											</div>
										</div>
									))}
								</div>
							) : (
								<div className="flex flex-col items-center justify-center py-12 text-center">
									<FileText className="h-12 w-12 text-muted-foreground mb-4" />
									<p className="text-muted-foreground">{t('hrpages.noTemplatesYet')}</p>
									<p className="text-xs text-muted-foreground mt-1">
										{t('hrpages.createYourFirstTemplateToSpeedUpMessaging')}
									</p>
								</div>
							)}
						</div>
						<DialogFooter>
							<Button variant="ghost" onClick={handleClose}>
								{t('hrpages.close')}
							</Button>
							<Button onClick={handleCreate}>
								<Plus className="h-4 w-4" />
								{t('hrpages.createTemplate')}
							</Button>
						</DialogFooter>
					</>
				)}

				{/* Create/Edit View */}
				{(mode === 'create' || mode === 'edit') && (
					<>
						<div className="flex-1 space-y-4 overflow-y-auto">
							<div className="space-y-2">
								<Label htmlFor="templateName">{t('hrpages.templateName')}</Label>
								<Input
									id="templateName"
									value={formData.templateName}
									onChange={(e) =>
										setFormData((prev) => ({ ...prev, templateName: e.target.value }))
									}
									placeholder={t('hrpages.eGWelcomeMessageFollowUpRequest')}
									disabled={isSaving}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="description">{t('hrpages.descriptionOptional')}</Label>
								<Input
									id="description"
									value={formData.description}
									onChange={(e) =>
										setFormData((prev) => ({ ...prev, description: e.target.value }))
									}
									placeholder={t('hrpages.briefDescriptionOfWhenToUseThisTemplate')}
									disabled={isSaving}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="messageTemplate">{t('hrpages.templateContent')}</Label>
								<Textarea
									id="messageTemplate"
									value={formData.messageTemplate}
									onChange={(e) =>
										setFormData((prev) => ({ ...prev, messageTemplate: e.target.value }))
									}
									placeholder={t('hrpages.enterYourMessageTemplateContent')}
									rows={6}
									className="resize-none"
									disabled={isSaving}
								/>
								<p className="text-xs text-muted-foreground">
									{t('hrpages.thisContentWillBeInsertedIntoTheMessageBoxWhen')}
								</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="status">{t('hrpages.status')}</Label>
								<Select
									value={formData.status}
									onValueChange={(value) =>
										setFormData((prev) => ({
											...prev,
											status: value as 'draft' | 'active' | 'inactive',
										}))
									}
									inputId="status"
									options={[
										{ value: 'active', label: t('hrpages.active') },
										{ value: 'draft', label: t('hrpages.draft') },
										{ value: 'inactive', label: t('hrpages.inactive') },
									]}
									disabled={isSaving}
								/>
								<p className="text-xs text-muted-foreground">
									{t('hrpages.onlyActiveTemplatesAppearInTheTemplateSelector')}
								</p>
							</div>
						</div>
						<DialogFooter>
							<Button variant="ghost" onClick={handleCancel} disabled={isSaving}>
								{t('hrpages.cancel')}
							</Button>
							<Button onClick={handleSave} disabled={isSaving}>
								{isSaving ? (
									<>
										<LoadingSpinner size="sm" className="mr-2" />
										{t('hrpages.saving')}
									</>
								) : mode === 'create' ? (
									t('hrpages.createTemplate')
								) : (
									t('hrpages.saveChanges')
								)}
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	)
}
