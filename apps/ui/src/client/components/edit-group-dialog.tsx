import { useEffect, useState } from 'react'

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

import type { Category, Group, UpdateGroupRequest } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface EditGroupDialogProps {
	group: Group
	categories: Category[]
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (data: UpdateGroupRequest) => Promise<void>
}

export function EditGroupDialog({
	group,
	categories,
	open,
	onOpenChange,
	onSubmit,
}: EditGroupDialogProps) {
	const [formData, setFormData] = useState<UpdateGroupRequest>({
		categoryId: group.categoryId,
		name: group.name,
		description: group.description || '',
		visibility: group.visibility,
		joinMode: group.joinMode,
	})

	const [errors, setErrors] = useState<Partial<Record<keyof UpdateGroupRequest, string>>>({})
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
		const newErrors: Partial<Record<keyof UpdateGroupRequest, string>> = {}

		if (!formData.categoryId) {
			newErrors.categoryId = 'Category is required'
		}

		if (!formData.name?.trim()) {
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
					<DialogTitle>Edit Group</DialogTitle>
					<DialogDescription>
						Update the group's name, description, category, visibility, and join mode.
					</DialogDescription>
				</DialogHeader>

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
							onChange={(e) =>
								setFormData({ ...formData, name: (e.target as HTMLInputElement).value })
							}
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

					<DialogFooter>
						<Button variant="cancel" type="button" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
							Cancel
						</Button>
						<Button variant="confirm" type="submit" loading={isSubmitting} loadingText="Updating...">
							Update Group
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
