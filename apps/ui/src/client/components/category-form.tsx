import { useState } from 'react'

import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'

import type { Category, CategoryPermission, CreateCategoryRequest, Visibility } from '@/lib/api'

interface CategoryFormProps {
	category?: Category
	onSubmit: (data: CreateCategoryRequest) => Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
}

export function CategoryForm({ category, onSubmit, onCancel, isSubmitting }: CategoryFormProps) {
	const [formData, setFormData] = useState<CreateCategoryRequest>({
		name: category?.name || '',
		description: category?.description || '',
		visibility: category?.visibility || 'public',
		allowGroupCreation: category?.allowGroupCreation || 'anyone',
	})

	const [errors, setErrors] = useState<Partial<Record<keyof CreateCategoryRequest, string>>>({})

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreateCategoryRequest, string>> = {}

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
					Name <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: (e.target as HTMLInputElement).value })}
					placeholder="Enter category name"
					disabled={isSubmitting}
				/>
				{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
			</div>

			<div className="space-y-2">
				<Label htmlFor="description">Description</Label>
				<textarea
					id="description"
					value={formData.description || ''}
					onChange={(e) =>
						setFormData({ ...formData, description: (e.target as HTMLTextAreaElement).value })
					}
					placeholder="Enter category description (optional)"
					disabled={isSubmitting}
					className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					rows={3}
				/>
				{errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
			</div>

			<div className="space-y-2">
				<Label htmlFor="visibility">Visibility</Label>
				<Select
					value={formData.visibility}
					onValueChange={(value: Visibility) => setFormData({ ...formData, visibility: value })}
					disabled={isSubmitting}
				>
					<SelectTrigger id="visibility">
						<SelectValue placeholder="Select visibility" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="public">Public - Visible to all users</SelectItem>
						<SelectItem value="hidden">Hidden - Only visible to members</SelectItem>
						<SelectItem value="system">System - Only visible to admins</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<div className="space-y-2">
				<Label htmlFor="allowGroupCreation">Group Creation Permission</Label>
				<Select
					value={formData.allowGroupCreation}
					onValueChange={(value: CategoryPermission) =>
						setFormData({ ...formData, allowGroupCreation: value })
					}
					disabled={isSubmitting}
				>
					<SelectTrigger id="allowGroupCreation">
						<SelectValue placeholder="Select permission" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="anyone">Anyone - All users can create groups</SelectItem>
						<SelectItem value="admin_only">Admin Only - Only admins can create groups</SelectItem>
					</SelectContent>
				</Select>
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
