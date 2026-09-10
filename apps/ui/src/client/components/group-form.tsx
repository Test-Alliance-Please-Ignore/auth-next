import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'
import type { AppTranslationKey } from '@/i18n'
import type { Category, CreateGroupRequest } from '@/lib/api'

interface GroupFormProps {
	categories: Category[]
	onSubmit: (data: CreateGroupRequest) => void
	onCancel: () => void
	isSubmitting?: boolean
	canEditAdminManaged?: boolean
}

export function GroupForm({
	categories,
	onSubmit,
	onCancel,
	isSubmitting,
	canEditAdminManaged = false,
}: GroupFormProps) {
	const { t } = useAppTranslation()
	const [formData, setFormData] = useState<CreateGroupRequest>({
		categoryId: '',
		name: '',
		description: '',
		visibility: 'public',
		joinMode: 'open',
	})

	const [errors, setErrors] = useState<
		Partial<Record<keyof CreateGroupRequest, AppTranslationKey>>
	>({})

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreateGroupRequest, AppTranslationKey>> = {}

		if (!formData.categoryId) {
			newErrors.categoryId = 'groups.form.categoryRequired'
		}

		if (!formData.name.trim()) {
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

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault()
		if (validate()) {
			onSubmit(formData)
		}
	}

	return (
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
				{errors.categoryId && <p className="text-sm text-destructive">{t(errors.categoryId)}</p>}
			</div>

			{/* Name Input */}
			<div className="space-y-2">
				<Label htmlFor="name">
					{t('groups.form.name')} <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: (e.target as HTMLInputElement).value })}
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
				{errors.description && <p className="text-sm text-destructive">{t(errors.description)}</p>}
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

			{/* Form Actions */}
			<div className="flex justify-end gap-2 pt-4">
				<Button variant="cancel" type="button" onClick={onCancel} disabled={isSubmitting}>
					{t('common.cancel')}
				</Button>
				<Button
					variant="confirm"
					type="submit"
					loading={isSubmitting}
					loadingText={t('groups.form.creating')}
				>
					{t('groups.form.create')}
				</Button>
			</div>
		</form>
	)
}
