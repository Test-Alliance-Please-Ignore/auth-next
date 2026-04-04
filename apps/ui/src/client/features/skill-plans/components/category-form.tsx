import { useState } from 'react'

import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Textarea } from '../../../components/ui/textarea'

import type { SkillPlanCategory } from '../types'

interface CategoryFormProps {
	initialData?: SkillPlanCategory
	onSubmit: (data: { name: string; description: string; displayOrder?: number }) => Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
	mode?: 'create' | 'edit'
}

export function CategoryForm({
	initialData,
	onSubmit,
	onCancel,
	isSubmitting = false,
	mode = 'create',
}: CategoryFormProps) {
	const [formData, setFormData] = useState({
		name: initialData?.name || '',
		description: initialData?.description || '',
		displayOrder: initialData?.displayOrder || 0,
	})

	const [errors, setErrors] = useState<Partial<Record<string, string>>>({})

	const validate = (): boolean => {
		const newErrors: Partial<Record<string, string>> = {}

		if (!formData.name.trim()) {
			newErrors.name = 'Name is required'
		} else if (formData.name.length < 2) {
			newErrors.name = 'Name must be at least 2 characters'
		} else if (formData.name.length > 50) {
			newErrors.name = 'Name must be less than 50 characters'
		}

		if (!formData.description.trim()) {
			newErrors.description = 'Description is required'
		} else if (formData.description.length < 10) {
			newErrors.description = 'Description must be at least 10 characters'
		} else if (formData.description.length > 200) {
			newErrors.description = 'Description must be less than 200 characters'
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!validate()) return

		try {
			await onSubmit(formData)
		} catch (error) {
			console.error('Failed to submit form:', error)
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			{/* Name field */}
			<div className="space-y-2">
				<Label htmlFor="name">
					Category Name <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: e.target.value })}
					placeholder="e.g., PvP, Mining, Industry"
					disabled={isSubmitting}
					maxLength={50}
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
					placeholder="Describe what types of skill plans belong in this category"
					disabled={isSubmitting}
					rows={3}
					maxLength={200}
				/>
				<p className="text-sm text-muted-foreground">
					{formData.description.length}/200 characters
				</p>
				{errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
			</div>

			{/* Display order field */}
			<div className="space-y-2">
				<Label htmlFor="displayOrder">Display Order</Label>
				<Input
					id="displayOrder"
					type="number"
					value={formData.displayOrder}
					onChange={(e) =>
						setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 0 })
					}
					placeholder="0"
					disabled={isSubmitting}
					min={0}
					max={999}
				/>
				<p className="text-sm text-muted-foreground">Lower numbers appear first in lists</p>
			</div>

			{/* Form actions */}
			<div className="flex justify-end gap-2 pt-4">
				<Button variant="cancel" onClick={onCancel} disabled={isSubmitting}>
					Cancel
				</Button>
				<Button variant="confirm" type="submit" loading={isSubmitting}>
					{mode === 'create' ? 'Create Category' : 'Save Changes'}
				</Button>
			</div>
		</form>
	)
}
