import { useEffect, useState } from 'react'

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
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'
import type { AppTranslationKey } from '@/i18n'
import type { Category, Group, UpdateGroupRequest } from '@/lib/api'

interface EditGroupDialogProps {
	group: Group
	categories: Category[]
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (data: UpdateGroupRequest) => Promise<void>
	canEditAdminManaged?: boolean
}

export function EditGroupDialog({
	group,
	categories,
	open,
	onOpenChange,
	onSubmit,
	canEditAdminManaged = false,
}: EditGroupDialogProps) {
	const { t } = useAppTranslation()
	const [formData, setFormData] = useState<UpdateGroupRequest>({
		categoryId: group.categoryId,
		name: group.name,
		description: group.description || '',
		visibility: group.visibility,
		joinMode: group.joinMode,
	})

	const [errors, setErrors] = useState<
		Partial<Record<keyof UpdateGroupRequest, AppTranslationKey>>
	>({})
	const [isSubmitting, setIsSubmitting] = useState(false)

	// Reset form when group changes
	useEffect(() => {
		setFormData({
			categoryId: group.categoryId,
			name: group.name,
			description: group.description || '',
			visibility: group.visibility,
			joinMode: group.joinMode,
		})
		setErrors({})
	}, [group])

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof UpdateGroupRequest, AppTranslationKey>> = {}

		if (!formData.categoryId) {
			newErrors.categoryId = 'groups.form.categoryRequired'
		}

		if (!formData.name?.trim()) {
			newErrors.name = 'groups.form.nameRequired'
		} else if (formData.name.length > 255) {
			newErrors.name = 'groups.form.nameTooLong'
		}

		if (formData.description && formData.description.length > 1000) {
			newErrors.description = 'groups.form.descriptionTooLong'
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault()
		if (!validate()) return

		setIsSubmitting(true)
		try {
			await onSubmit(formData)
			onOpenChange(false)
		} catch (error) {
			// Error handling is done by parent component
			console.error('Failed to update group:', error)
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t('groups.form.edit')}</DialogTitle>
					<DialogDescription>{t('groups.form.editDescription')}</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Category Select */}
					<div className="space-y-2">
						<Label htmlFor="categoryId">
							{t('groups.category')} <span className="text-destructive">*</span>
						</Label>
						<Select
							value={formData.categoryId}
							onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
							inputId="categoryId"
							options={categories.map((category) => ({ value: category.id, label: category.name }))}
							placeholder={t('groups.form.selectCategory')}
							disabled={isSubmitting}
						/>
						{errors.categoryId && (
							<p className="text-sm text-destructive">{t(errors.categoryId)}</p>
						)}
					</div>

					{/* Name Input */}
					<div className="space-y-2">
						<Label htmlFor="name">
							{t('groups.form.name')} <span className="text-destructive">*</span>
						</Label>
						<Input
							id="name"
							value={formData.name}
							onChange={(e) =>
								setFormData({ ...formData, name: (e.target as HTMLInputElement).value })
							}
							placeholder={t('groups.form.namePlaceholder')}
							disabled={isSubmitting}
						/>
						{errors.name && <p className="text-sm text-destructive">{t(errors.name)}</p>}
					</div>

					{/* Description Textarea */}
					<div className="space-y-2">
						<Label htmlFor="description">{t('groups.form.description')}</Label>
						<Textarea
							id="description"
							value={formData.description || ''}
							onChange={(e) =>
								setFormData({ ...formData, description: (e.target as HTMLTextAreaElement).value })
							}
							placeholder={t('groups.form.descriptionPlaceholder')}
							disabled={isSubmitting}
							rows={3}
						/>
						{errors.description && (
							<p className="text-sm text-destructive">{t(errors.description)}</p>
						)}
					</div>

					{/* Visibility Select */}
					<div className="space-y-2">
						<Label htmlFor="visibility">{t('groups.visibility')}</Label>
						<Select
							value={formData.visibility}
							onValueChange={(value) =>
								setFormData({ ...formData, visibility: value as 'public' | 'hidden' | 'system' })
							}
							inputId="visibility"
							options={[
								{ value: 'public', label: t('groups.form.public') },
								{ value: 'hidden', label: t('groups.form.hidden') },
								{ value: 'system', label: t('groups.form.system') },
							]}
							disabled={isSubmitting}
						/>
					</div>

					{/* Join Mode Select */}
					<div className="space-y-2">
						<Label htmlFor="joinMode">{t('groups.joinMode')}</Label>
						<Select
							value={formData.joinMode}
							onValueChange={(value) =>
								setFormData({
									...formData,
									joinMode: value as 'open' | 'approval' | 'invitation_only',
								})
							}
							inputId="joinMode"
							options={[
								{ value: 'open', label: t('groups.form.open') },
								{ value: 'approval', label: t('groups.form.approval') },
								{ value: 'invitation_only', label: t('groups.form.invitationOnly') },
								...(canEditAdminManaged
									? [
											{
												value: 'admin_managed',
												label: t('groups.form.adminManaged'),
											},
										]
									: []),
							]}
							disabled={isSubmitting}
						/>
					</div>

					<DialogFooter>
						<Button
							variant="cancel"
							type="button"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							{t('common.cancel')}
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={isSubmitting}
							loadingText={t('groups.form.updating')}
						>
							{t('groups.form.update')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
