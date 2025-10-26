import { useState } from 'react'

import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type {
	CreatePermissionCategoryRequest,
	PermissionCategory,
	UpdatePermissionCategoryRequest,
} from '@/lib/api'

interface PermissionCategoryFormProps {
	category?: PermissionCategory
	onSubmit: (data: CreatePermissionCategoryRequest | UpdatePermissionCategoryRequest) => Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
}

export function PermissionCategoryForm({
	category,
	onSubmit,
	onCancel,
	isSubmitting,
}: PermissionCategoryFormProps) {
	const [formData, setFormData] = useState<CreatePermissionCategoryRequest>({
		name: category?.name || '',
		description: category?.description || '',
	})

	const [errors, setErrors] = useState<
		Partial<Record<keyof CreatePermissionCategoryRequest, string>>
	>({})

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreatePermissionCategoryRequest, string>> = {}

		if (!formData.name.trim()) {
			newErrors.name = 'Name is required'
		} else if (formData.name.length > 255) {
			newErrors.name = 'Name must be 255 characters or less'
		}

		if (formData.description && formData.description.length > 1000) {
			newErrors.description = 'Description must be 1000 characters or less'
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
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
					Category Name <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: (e.target as HTMLInputElement).value })}
					placeholder="Fleet Operations"
					disabled={isSubmitting}
				/>
				{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
			</div>

			<div className="space-y-2">
				<Label htmlFor="description">Description (optional)</Label>
				<textarea
					id="description"
					value={formData.description || ''}
					onChange={(e) =>
						setFormData({ ...formData, description: (e.target as HTMLTextAreaElement).value })
					}
					placeholder="Permissions for fleet management and operations"
					disabled={isSubmitting}
					className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					rows={3}
				/>
				{errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
			</div>

			<div className="flex justify-end gap-2 pt-4">
				<CancelButton type="button" onClick={onCancel} disabled={isSubmitting}>
					Cancel
				</CancelButton>
				<ConfirmButton type="submit" loading={isSubmitting} loadingText="Saving...">
					{category ? 'Update Category' : 'Create Category'}
				</ConfirmButton>
			</div>
		</form>
	)
}
