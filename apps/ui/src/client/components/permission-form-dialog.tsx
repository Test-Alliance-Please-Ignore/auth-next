import { Check, XCircle } from 'lucide-react'
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
import { cn } from '@/lib/utils'

import type {
	CreatePermissionRequest,
	Permission,
	PermissionCategory,
	UpdatePermissionRequest,
} from '@/lib/api'

interface PermissionFormDialogProps {
	permission?: Permission
	categories: PermissionCategory[]
	onSubmit: (data: CreatePermissionRequest | UpdatePermissionRequest) => Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
}

// URN validation regex
const URN_REGEX = /^urn:[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+$/

export function PermissionFormDialog({
	permission,
	categories,
	onSubmit,
	onCancel,
	isSubmitting,
}: PermissionFormDialogProps) {
	const isEditing = !!permission

	const [formData, setFormData] = useState<CreatePermissionRequest>({
		urn: permission?.urn || '',
		name: permission?.name || '',
		description: permission?.description || '',
		categoryId: permission?.categoryId || undefined,
	})

	const [errors, setErrors] = useState<Partial<Record<keyof CreatePermissionRequest, string>>>({})
	const [urnTouched, setUrnTouched] = useState(false)

	const validateUrn = (urn: string): string | null => {
		if (!urn.trim()) {
			return 'URN is required'
		}

		if (!urn.startsWith('urn:')) {
			return "URN must start with 'urn:'"
		}

		const parts = urn.split(':')
		if (parts.length !== 4) {
			return 'URN must have 3 parts separated by colons (urn:namespace:resource:identifier)'
		}

		if (!URN_REGEX.test(urn)) {
			return 'URN can only contain lowercase letters, numbers, hyphens, and underscores'
		}

		return null
	}

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreatePermissionRequest, string>> = {}

		// Validate URN
		const urnError = validateUrn(formData.urn)
		if (urnError) {
			newErrors.urn = urnError
		}

		// Validate name
		if (!formData.name.trim()) {
			newErrors.name = 'Display name is required'
		} else if (formData.name.length > 255) {
			newErrors.name = 'Name must be 255 characters or less'
		}

		// Validate description
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

	const handleUrnBlur = () => {
		setUrnTouched(true)
		const urnError = validateUrn(formData.urn)
		if (urnError) {
			setErrors((prev) => ({ ...prev, urn: urnError }))
		} else {
			setErrors((prev) => {
				const { urn: _urn, ...rest } = prev
				return rest
			})
		}
	}

	const urnError = errors.urn
	const urnValid = urnTouched && !urnError && formData.urn.trim().length > 0

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="urn">
					URN (Unique Resource Name) <span className="text-destructive">*</span>
				</Label>
				<div className="relative">
					<Input
						id="urn"
						value={formData.urn}
						onChange={(e) => setFormData({ ...formData, urn: (e.target as HTMLInputElement).value })}
						onBlur={handleUrnBlur}
						placeholder="urn:namespace:resource:identifier"
						disabled={isSubmitting || isEditing}
						className={cn(
							'font-mono text-sm pr-10',
							urnError && urnTouched && 'border-destructive focus-visible:ring-destructive',
							urnValid && 'border-green-500 focus-visible:ring-green-500'
						)}
						aria-invalid={!!urnError}
						aria-describedby={urnError ? 'urn-error' : 'urn-help'}
					/>
					{urnTouched && (
						<div className="absolute right-3 top-1/2 -translate-y-1/2">
							{urnValid && <Check className="h-4 w-4 text-green-500" />}
							{urnError && <XCircle className="h-4 w-4 text-destructive" />}
						</div>
					)}
				</div>
				{urnError && urnTouched && (
					<p id="urn-error" className="text-sm text-destructive" role="alert">
						{urnError}
					</p>
				)}
				{!urnError && (
					<p id="urn-help" className="text-sm text-muted-foreground">
						Format: urn:namespace:resource:identifier (lowercase, hyphens, underscores)
						{isEditing && <span className="ml-2 text-xs">(URN cannot be changed)</span>}
					</p>
				)}
			</div>

			<div className="space-y-2">
				<Label htmlFor="name">
					Display Name <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: (e.target as HTMLInputElement).value })}
					placeholder="Corporation Member"
					disabled={isSubmitting}
				/>
				{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
			</div>

			<div className="space-y-2">
				<Label htmlFor="category">Category (optional)</Label>
				<Select
					value={formData.categoryId || ''}
					onValueChange={(value) => setFormData({ ...formData, categoryId: value || undefined })}
					disabled={isSubmitting}
				>
					<SelectTrigger id="category">
						<SelectValue placeholder="Select a category" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">No category</SelectItem>
						{categories.map((category) => (
							<SelectItem key={category.id} value={category.id}>
								{category.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="space-y-2">
				<Label htmlFor="description">Description (optional)</Label>
				<textarea
					id="description"
					value={formData.description || ''}
					onChange={(e) =>
						setFormData({ ...formData, description: (e.target as HTMLTextAreaElement).value })
					}
					placeholder="Access to view corporation members"
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
					{isEditing ? 'Update Permission' : 'Create Permission'}
				</ConfirmButton>
			</div>
		</form>
	)
}
