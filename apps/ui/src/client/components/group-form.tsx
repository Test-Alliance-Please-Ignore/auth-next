import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import type { Category, CreateGroupRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface GroupFormProps {
	categories: Category[]
	onSubmit: (data: CreateGroupRequest) => void
	onCancel: () => void
	isSubmitting?: boolean
}

export function GroupForm({ categories, onSubmit, onCancel, isSubmitting }: GroupFormProps) {
	const [formData, setFormData] = useState<CreateGroupRequest>({
		categoryId: '',
		name: '',
		description: '',
		visibility: 'public',
		joinMode: 'open',
	})

	const [errors, setErrors] = useState<Partial<Record<keyof CreateGroupRequest, string>>>({})

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreateGroupRequest, string>> = {}

		if (!formData.categoryId) {
			newErrors.categoryId = 'Category is required'
		}

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

	const handleSubmit = (e: React.FormEvent) => {
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
					Category <span className="text-destructive">*</span>
				</Label>
				<Select
					value={formData.categoryId}
					onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
					inputId="categoryId"
					options={categories.map((category) => ({ value: category.id,
						label: category.name,
					}))}
					placeholder="Select a category"
					disabled={isSubmitting}
				/>
				{errors.categoryId && <p className="text-sm text-destructive">{errors.categoryId}</p>}
			</div>

			{/* Name Input */}
			<div className="space-y-2">
				<Label htmlFor="name">
					Name <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: (e.target as HTMLInputElement).value })}
					placeholder="Enter group name"
					disabled={isSubmitting}
				/>
				{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
			</div>

			{/* Description Textarea */}
			<div className="space-y-2">
				<Label htmlFor="description">Description</Label>
				<Textarea
					id="description"
					value={formData.description || ''}
					onChange={(e) =>
						setFormData({ ...formData, description: (e.target as HTMLTextAreaElement).value })
					}
					placeholder="Enter group description (optional)"
					disabled={isSubmitting}
					rows={3}
				/>
				{errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
			</div>

			{/* Visibility Select */}
			<div className="space-y-2">
				<Label htmlFor="visibility">Visibility</Label>
				<Select
					value={formData.visibility}
					onValueChange={(value) =>
						setFormData({ ...formData, visibility: value as 'public' | 'hidden' | 'system' })
					}
					inputId="visibility"
					options={[
						{ value: 'public',
							label: 'Public (visible to all logged-in users)',
						},
						{ value: 'hidden',
							label: "Hidden (members know they're in it)",
						},
						{ value: 'system',
							label: 'System (invisible to members)',
						},
					]}
					disabled={isSubmitting}
				/>
			</div>

			{/* Join Mode Select */}
			<div className="space-y-2">
				<Label htmlFor="joinMode">Join Mode</Label>
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
						{ value: 'open', label: 'Open (anyone can join)' },
						{ value: 'approval',
							label: 'Approval (requires admin approval)',
						},
						{ value: 'invitation_only',
							label: 'Invitation Only (invite required)',
						},
					]}
					disabled={isSubmitting}
				/>
			</div>

			{/* Form Actions */}
			<div className="flex justify-end gap-2 pt-4">
				<Button variant="cancel" type="button" onClick={onCancel} disabled={isSubmitting}>
					Cancel
				</Button>
				<Button variant="confirm" type="submit" loading={isSubmitting} loadingText="Creating...">
					Create Group
				</Button>
			</div>
		</form>
	)
}
