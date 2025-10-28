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
import { Textarea } from '@/components/ui/textarea'

import type { Category, CreateGroupRequest } from '@/lib/api'

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
					disabled={isSubmitting}
				>
					<SelectTrigger id="categoryId">
						<SelectValue placeholder="Select a category" />
					</SelectTrigger>
					<SelectContent>
						{categories.map((category) => (
							<SelectItem key={category.id} value={category.id}>
								{category.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
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
					onValueChange={(value: 'public' | 'hidden' | 'system') =>
						setFormData({ ...formData, visibility: value })
					}
					disabled={isSubmitting}
				>
					<SelectTrigger id="visibility">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="public">Public (visible to all logged-in users)</SelectItem>
						<SelectItem value="hidden">Hidden (members know they're in it)</SelectItem>
						<SelectItem value="system">System (invisible to members)</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Join Mode Select */}
			<div className="space-y-2">
				<Label htmlFor="joinMode">Join Mode</Label>
				<Select
					value={formData.joinMode}
					onValueChange={(value: 'open' | 'approval' | 'invitation_only') =>
						setFormData({ ...formData, joinMode: value })
					}
					disabled={isSubmitting}
				>
					<SelectTrigger id="joinMode">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="open">Open (anyone can join)</SelectItem>
						<SelectItem value="approval">Approval (requires admin approval)</SelectItem>
						<SelectItem value="invitation_only">Invitation Only (invite required)</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Form Actions */}
			<div className="flex justify-end gap-2 pt-4">
				<CancelButton type="button" onClick={onCancel} disabled={isSubmitting}>
					Cancel
				</CancelButton>
				<ConfirmButton type="submit" loading={isSubmitting} loadingText="Creating...">
					Create Group
				</ConfirmButton>
			</div>
		</form>
	)
}
