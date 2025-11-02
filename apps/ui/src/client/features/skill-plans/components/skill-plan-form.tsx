import { useState } from 'react'
import { Button } from '../../../components/ui/button'
import { CancelButton } from '../../../components/ui/cancel-button'
import { ConfirmButton } from '../../../components/ui/confirm-button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Switch } from '../../../components/ui/switch'
import { Textarea } from '../../../components/ui/textarea'
import { MaintainerSelector } from './maintainer-selector'
import { CategorySelector } from './category-selector'
import type { CreateSkillPlanRequest, UpdateSkillPlanRequest, SkillPlan } from '../types'

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
	const [formData, setFormData] = useState<CreateSkillPlanRequest>({
		name: initialData?.name || '',
		description: initialData?.description || '',
		isPublished: initialData?.isPublished || false,
		maintainerId: initialData?.maintainerId || null,
		ownerCharacterId: initialData?.ownerCharacterId || null,
		categoryIds: initialData?.categories?.map(c => c.id) || [],
	})

	const [errors, setErrors] = useState<Partial<Record<keyof CreateSkillPlanRequest, string>>>({})

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreateSkillPlanRequest, string>> = {}

		if (!formData.name.trim()) {
			newErrors.name = 'Name is required'
		} else if (formData.name.length < 3) {
			newErrors.name = 'Name must be at least 3 characters'
		} else if (formData.name.length > 100) {
			newErrors.name = 'Name must be less than 100 characters'
		}

		if (!formData.description.trim()) {
			newErrors.description = 'Description is required'
		} else if (formData.description.length < 10) {
			newErrors.description = 'Description must be at least 10 characters'
		} else if (formData.description.length > 1000) {
			newErrors.description = 'Description must be less than 1000 characters'
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
				if (formData.description !== initialData?.description) updates.description = formData.description
				if (formData.isPublished !== initialData?.isPublished) updates.isPublished = formData.isPublished
				if (formData.maintainerId !== initialData?.maintainerId) updates.maintainerId = formData.maintainerId

				// Check if categories changed
				const initialCategoryIds = initialData?.categories?.map(c => c.id) || []
				const categoriesChanged = formData.categoryIds?.length !== initialCategoryIds.length ||
					formData.categoryIds?.some(id => !initialCategoryIds.includes(id))
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
					Plan Name <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: e.target.value })}
					placeholder="Enter a name for your skill plan"
					disabled={isSubmitting}
					maxLength={100}
				/>
				{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
			</div>

			{/* Description field */}
			<div className="space-y-2">
				<Label htmlFor="description">
					Description <span className="text-destructive">*</span>
				</Label>
				<Textarea
					id="description"
					value={formData.description}
					onChange={(e) => setFormData({ ...formData, description: e.target.value })}
					placeholder="Describe what this skill plan is for and when to use it"
					disabled={isSubmitting}
					rows={4}
					maxLength={1000}
				/>
				<p className="text-sm text-muted-foreground">
					{formData.description.length}/1000 characters
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
					<Label htmlFor="published">Published</Label>
					<p className="text-sm text-muted-foreground">
						Published plans are visible to all authenticated users
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
				<CancelButton onClick={onCancel} disabled={isSubmitting}>
					Cancel
				</CancelButton>
				<ConfirmButton type="submit" loading={isSubmitting}>
					{mode === 'create' ? 'Create Plan' : 'Save Changes'}
				</ConfirmButton>
			</div>
		</form>
	)
}