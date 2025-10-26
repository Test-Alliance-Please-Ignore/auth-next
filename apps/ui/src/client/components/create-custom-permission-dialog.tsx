import { Check, Plus, XCircle } from 'lucide-react'
import { useState } from 'react'

import { PermissionTargetBadge } from '@/components/permission-target-badge'
import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
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

import type { CreateGroupScopedPermissionRequest, PermissionTarget } from '@/lib/api'

interface CreateCustomPermissionDialogProps {
	groupId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (data: CreateGroupScopedPermissionRequest) => Promise<void>
	isSubmitting?: boolean
}

// URN validation regex
const URN_REGEX = /^urn:[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+$/

export function CreateCustomPermissionDialog({
	groupId,
	open,
	onOpenChange,
	onSubmit,
	isSubmitting,
}: CreateCustomPermissionDialogProps) {
	const [formData, setFormData] = useState<CreateGroupScopedPermissionRequest>({
		groupId,
		urn: '',
		name: '',
		description: '',
		targetType: 'all_members',
	})

	const [errors, setErrors] = useState<
		Partial<Record<keyof CreateGroupScopedPermissionRequest, string>>
	>({})
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
		const newErrors: Partial<Record<keyof CreateGroupScopedPermissionRequest, string>> = {}

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

			// Reset form
			setFormData({
				groupId,
				urn: '',
				name: '',
				description: '',
				targetType: 'all_members',
			})
			setErrors({})
			setUrnTouched(false)
		} catch (error) {
			console.error('Form submission error:', error)
		}
	}

	const handleCancel = () => {
		setFormData({
			groupId,
			urn: '',
			name: '',
			description: '',
			targetType: 'all_members',
		})
		setErrors({})
		setUrnTouched(false)
		onOpenChange(false)
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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Create Custom Permission</DialogTitle>
					<DialogDescription>
						Create a group-scoped custom permission that is unique to this group
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* URN */}
					<div className="space-y-2">
						<Label htmlFor="custom-urn">
							URN (Unique Resource Name) <span className="text-destructive">*</span>
						</Label>
						<div className="relative">
							<Input
								id="custom-urn"
								value={formData.urn}
								onChange={(e) =>
									setFormData({ ...formData, urn: (e.target as HTMLInputElement).value })
								}
								onBlur={handleUrnBlur}
								placeholder="urn:namespace:resource:identifier"
								disabled={isSubmitting}
								className={cn(
									'font-mono text-sm pr-10',
									urnError && urnTouched && 'border-destructive focus-visible:ring-destructive',
									urnValid && 'border-green-500 focus-visible:ring-green-500'
								)}
								aria-invalid={!!urnError}
								aria-describedby={urnError ? 'custom-urn-error' : 'custom-urn-help'}
							/>
							{urnTouched && (
								<div className="absolute right-3 top-1/2 -translate-y-1/2">
									{urnValid && <Check className="h-4 w-4 text-green-500" />}
									{urnError && <XCircle className="h-4 w-4 text-destructive" />}
								</div>
							)}
						</div>
						{urnError && urnTouched && (
							<p id="custom-urn-error" className="text-sm text-destructive" role="alert">
								{urnError}
							</p>
						)}
						{!urnError && (
							<p id="custom-urn-help" className="text-sm text-muted-foreground">
								Format: urn:namespace:resource:identifier (lowercase, hyphens, underscores)
							</p>
						)}
					</div>

					{/* Name */}
					<div className="space-y-2">
						<Label htmlFor="custom-name">
							Display Name <span className="text-destructive">*</span>
						</Label>
						<Input
							id="custom-name"
							value={formData.name}
							onChange={(e) =>
								setFormData({ ...formData, name: (e.target as HTMLInputElement).value })
							}
							placeholder="Fleet Commander"
							disabled={isSubmitting}
						/>
						{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
					</div>

					{/* Target Type */}
					<div className="space-y-2">
						<Label htmlFor="custom-target-type">
							Target Type <span className="text-destructive">*</span>
						</Label>
						<Select
							value={formData.targetType}
							onValueChange={(value) => setFormData({ ...formData, targetType: value as PermissionTarget })}
							disabled={isSubmitting}
						>
							<SelectTrigger id="custom-target-type">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all_members">All Members</SelectItem>
								<SelectItem value="all_admins">All Admins</SelectItem>
								<SelectItem value="owner_only">Owner Only</SelectItem>
								<SelectItem value="owner_and_admins">Owner & Admins</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Who in the group should receive this permission?
						</p>
						<div className="pt-2">
							<PermissionTargetBadge target={formData.targetType} />
						</div>
					</div>

					{/* Description */}
					<div className="space-y-2">
						<Label htmlFor="custom-description">Description (optional)</Label>
						<textarea
							id="custom-description"
							value={formData.description || ''}
							onChange={(e) =>
								setFormData({ ...formData, description: (e.target as HTMLTextAreaElement).value })
							}
							placeholder="Ability to lead and organize fleet operations"
							disabled={isSubmitting}
							className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
							rows={3}
						/>
						{errors.description && (
							<p className="text-sm text-destructive">{errors.description}</p>
						)}
					</div>

					{/* Action Buttons */}
					<div className="flex justify-end gap-2 pt-4">
						<CancelButton type="button" onClick={handleCancel} disabled={isSubmitting}>
							Cancel
						</CancelButton>
						<ConfirmButton
							type="submit"
							loading={isSubmitting}
							loadingText="Creating..."
							showIcon={false}
						>
							<Plus className="mr-2 h-4 w-4" />
							Create Permission
						</ConfirmButton>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
