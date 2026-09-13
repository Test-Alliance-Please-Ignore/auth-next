import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'
import type { AppTranslationKey } from '@/i18n'
import type {
	CreatePermissionCategoryRequest,
	PermissionCategory,
	UpdatePermissionCategoryRequest,
} from '@/lib/api'

interface PermissionCategoryFormProps {
	category?: PermissionCategory
	onSubmit: (
		data: CreatePermissionCategoryRequest | UpdatePermissionCategoryRequest
	) => Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
}

export function PermissionCategoryForm({
	category,
	onSubmit,
	onCancel,
	isSubmitting,
}: PermissionCategoryFormProps) {
	const { t } = useAppTranslation()
	const [formData, setFormData] = useState<CreatePermissionCategoryRequest>({
		name: category?.name || '',
		description: category?.description || '',
	})

	const [errors, setErrors] = useState<
		Partial<Record<keyof CreatePermissionCategoryRequest, AppTranslationKey>>
	>({})

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreatePermissionCategoryRequest, AppTranslationKey>> = {}

		if (!formData.name.trim()) {
			newErrors.name = 'admin.validation.nameRequired'
		} else if (formData.name.length > 255) {
			newErrors.name = 'admin.validation.nameTooLong'
		}

		if (formData.description && formData.description.length > 1000) {
			newErrors.description = 'admin.validation.descriptionTooLong'
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault()

		if (!validate()) {
			return
		}

		try {
			await onSubmit(formData)
		} catch (error) {
			console.error('Form submission error:', error)
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="name">
					{t('admin.permissionForm.categoryName')} <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: (e.target as HTMLInputElement).value })}
					placeholder={t('admin.permissionForm.categoryExample')}
					disabled={isSubmitting}
				/>
				{errors.name && <p className="text-sm text-destructive">{t(errors.name)}</p>}
			</div>

			<div className="space-y-2">
				<Label htmlFor="description">{t('admin.fields.descriptionOptional')}</Label>
				<textarea
					id="description"
					value={formData.description || ''}
					onChange={(e) =>
						setFormData({ ...formData, description: (e.target as HTMLTextAreaElement).value })
					}
					placeholder={t('admin.permissionForm.categoryDescriptionExample')}
					disabled={isSubmitting}
					className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					rows={3}
				/>
				{errors.description && <p className="text-sm text-destructive">{t(errors.description)}</p>}
			</div>

			<div className="flex justify-end gap-2 pt-4">
				<Button variant="cancel" type="button" onClick={onCancel} disabled={isSubmitting}>
					{t('common.cancel')}
				</Button>
				<Button
					variant="confirm"
					type="submit"
					loading={isSubmitting}
					loadingText={t('admin.fields.saving')}
				>
					{category
						? t('admin.permissionCategories.update')
						: t('admin.permissionCategories.create')}
				</Button>
			</div>
		</form>
	)
}
