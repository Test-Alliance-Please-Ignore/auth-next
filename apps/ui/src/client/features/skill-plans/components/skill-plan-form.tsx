import { useState } from 'react'

import { useAppTranslation } from '@/i18n'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Switch } from '../../../components/ui/switch'
import { Textarea } from '../../../components/ui/textarea'
import { CategorySelector } from './category-selector'
import { MaintainerSelector } from './maintainer-selector'

import type { CreateSkillPlanRequest, SkillPlan, UpdateSkillPlanRequest } from '../types'

interface SkillPlanFormProps {
	initialData?: SkillPlan
	onSubmit: (data: CreateSkillPlanRequest | UpdateSkillPlanRequest) => Promise<void> | void
	onCancel: () => void
	isSubmitting?: boolean
	mode?: 'create' | 'edit'
}

export function SkillPlanForm({
	initialData,
	onSubmit,
	onCancel,
	isSubmitting = false,
	mode = 'create',
}: SkillPlanFormProps) {
	const { t } = useAppTranslation()

	const [formData, setFormData] = useState<CreateSkillPlanRequest>({
		name: initialData?.name || '',
		description: initialData?.description || '',
		isPublished: initialData?.isPublished || false,
		maintainerId: initialData?.maintainerId || null,
		ownerCharacterId: initialData?.ownerCharacterId || null,
		categoryIds: initialData?.categories?.map((c) => c.id) || [],
	})

	const [errors, setErrors] = useState<Partial<Record<keyof CreateSkillPlanRequest, string>>>({})

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreateSkillPlanRequest, string>> = {}

		if (!formData.name.trim()) {
			newErrors.name = t('skillPlans.nameRequired')
		} else if (formData.name.length < 3) {
			newErrors.name = t('skillPlans.nameMin3')
		} else if (formData.name.length > 100) {
			newErrors.name = t('skillPlans.nameMax100')
		}

		if (!formData.description.trim()) {
			newErrors.description = t('skillPlans.descriptionRequired')
		} else if (formData.description.length < 10) {
			newErrors.description = t('skillPlans.descriptionMin10')
		} else if (formData.description.length > 1000) {
			newErrors.description = t('skillPlans.descriptionMax1000')
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!validate()) return

		try {
			if (mode === 'edit') {
				// For edit mode, only send changed fields
				const updates: UpdateSkillPlanRequest = {}
				if (formData.name !== initialData?.name) updates.name = formData.name
				if (formData.description !== initialData?.description)
					updates.description = formData.description
				if (formData.isPublished !== initialData?.isPublished)
					updates.isPublished = formData.isPublished
				if (formData.maintainerId !== initialData?.maintainerId)
					updates.maintainerId = formData.maintainerId

				// Check if categories changed
				const initialCategoryIds = initialData?.categories?.map((c) => c.id) || []
				const categoriesChanged =
					formData.categoryIds?.length !== initialCategoryIds.length ||
					formData.categoryIds?.some((id) => !initialCategoryIds.includes(id))
				if (categoriesChanged) updates.categoryIds = formData.categoryIds

				await onSubmit(updates)
			} else {
				await onSubmit(formData)
			}
		} catch (error) {
			console.error('Failed to submit form:', error)
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{/* Name field */}
			<div className="space-y-2">
				<Label htmlFor="name">
					{t('skillPlans.planName')}
					<span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: e.target.value })}
					placeholder={t('skillPlans.enterANameForYourSkillPlan')}
					disabled={isSubmitting}
					maxLength={100}
				/>
				{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
			</div>

			{/* Description field */}
			<div className="space-y-2">
				<Label htmlFor="description">
					{t('skillPlans.description2')}
					<span className="text-destructive">*</span>
				</Label>
				<Textarea
					id="description"
					value={formData.description}
					onChange={(e) => setFormData({ ...formData, description: e.target.value })}
					placeholder={t('skillPlans.describeWhatThisSkillPlanIsForAndWhenTo')}
					disabled={isSubmitting}
					rows={4}
					maxLength={1000}
				/>
				<p className="text-sm text-muted-foreground">
					{formData.description.length}
					{t('skillPlans.message1000Characters')}
				</p>
				{errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
			</div>

			{/* Category selector */}
			<CategorySelector
				value={formData.categoryIds}
				onChange={(value) => setFormData({ ...formData, categoryIds: value })}
				disabled={isSubmitting}
			/>

			{/* Maintainer selector */}
			<MaintainerSelector
				value={formData.maintainerId}
				onChange={(value) => setFormData({ ...formData, maintainerId: value })}
				disabled={isSubmitting}
			/>

			{/* Published toggle */}
			<div className="flex items-center justify-between rounded-lg border p-4">
				<div className="space-y-0.5">
					<Label htmlFor="published">{t('skillPlans.published')}</Label>
					<p className="text-sm text-muted-foreground">
						{t('skillPlans.publishedPlansAreVisibleToAllAuthenticatedUsers')}
					</p>
				</div>
				<Switch
					id="published"
					checked={formData.isPublished}
					onCheckedChange={(checked) => setFormData({ ...formData, isPublished: checked })}
					disabled={isSubmitting}
				/>
			</div>

			{/* Form actions */}
			<div className="flex justify-end gap-2 pt-4">
				<Button variant="cancel" onClick={onCancel} disabled={isSubmitting}>
					{t('skillPlans.cancel')}
				</Button>
				<Button variant="confirm" type="submit" loading={isSubmitting}>
					{mode === 'create' ? t('skillPlans.createPlan') : t('skillPlans.saveChanges')}
				</Button>
			</div>
		</form>
	)
}
