import { Check, XCircle } from 'lucide-react'
import { useState } from 'react'

import { PermissionTargetBadge } from '@/components/permission-target-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import type { FormEvent } from 'react'
import type { AppTranslationKey } from '@/i18n'
import type {
	CreateGroupScopedPermissionRequest,
	GroupPermissionWithDetails,
	PermissionTarget,
	UpdateGroupPermissionRequest,
} from '@/lib/api'

interface GroupPermissionFormProps {
	groupId: string
	permission?: GroupPermissionWithDetails
	onSubmit: (
		data: CreateGroupScopedPermissionRequest | UpdateGroupPermissionRequest
	) => Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
}

// URN validation regex - minimum 3 parts (urn:namespace:action)
const URN_REGEX = /^urn:[a-z0-9_-]+(:[a-z0-9_-]+)+$/

export function GroupPermissionForm({
	groupId,
	permission,
	onSubmit,
	onCancel,
	isSubmitting,
}: GroupPermissionFormProps) {
	const { t } = useAppTranslation()
	const isEditing = !!permission

	const [formData, setFormData] = useState<CreateGroupScopedPermissionRequest>({
		groupId,
		urn: permission?.customUrn || '',
		name: permission?.customName || '',
		description: permission?.customDescription || '',
		targetType: permission?.targetType || 'all_members',
	})

	const [errors, setErrors] = useState<
		Partial<Record<keyof CreateGroupScopedPermissionRequest, AppTranslationKey>>
	>({})
	const [urnTouched, setUrnTouched] = useState(false)

	const validateUrn = (urn: string): AppTranslationKey | null => {
		if (!urn.trim()) {
			return 'groups.permissions.urnRequired'
		}

		if (!urn.startsWith('urn:')) {
			return 'groups.permissions.urnPrefix'
		}

		const parts = urn.split(':')
		if (parts.length < 3) {
			return 'groups.permissions.urnParts'
		}

		if (!URN_REGEX.test(urn)) {
			return 'groups.permissions.urnCharacters'
		}

		return null
	}

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreateGroupScopedPermissionRequest, AppTranslationKey>> =
			{}

		// Validate URN
		const urnError = validateUrn(formData.urn)
		if (urnError) {
			newErrors.urn = urnError
		}

		// Validate name
		if (!formData.name.trim()) {
			newErrors.name = 'groups.permissions.nameRequired'
		} else if (formData.name.length > 255) {
			newErrors.name = 'groups.form.nameTooLong'
		}

		// Validate description
		if (formData.description && formData.description.length > 1000) {
			newErrors.description = 'groups.form.descriptionTooLong'
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault()

		console.log('Form submitted', formData)

		if (!validate()) {
			console.log('Validation failed', errors)
			return
		}

		console.log('Validation passed, calling onSubmit')

		try {
			await onSubmit(formData)
			console.log('onSubmit completed successfully')
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
					{t('groups.permissions.urnLabel')} <span className="text-destructive">*</span>
				</Label>
				<div className="relative">
					<Input
						id="urn"
						value={formData.urn}
						onChange={(e) =>
							setFormData({ ...formData, urn: (e.target as HTMLInputElement).value })
						}
						onBlur={handleUrnBlur}
						placeholder="urn:namespace:action"
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
						{t(urnError)}
					</p>
				)}
				{!urnError && (
					<p id="urn-help" className="text-sm text-muted-foreground">
						{t('groups.permissions.urnHint')}
						{isEditing && (
							<span className="ml-2 text-xs">{t('groups.permissions.urnUnchangeable')}</span>
						)}
					</p>
				)}
			</div>

			<div className="space-y-2">
				<Label htmlFor="name">
					{t('groups.permissions.displayName')} <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: (e.target as HTMLInputElement).value })}
					placeholder={t('groups.permissions.namePlaceholder')}
					disabled={isSubmitting}
				/>
				{errors.name && <p className="text-sm text-destructive">{t(errors.name)}</p>}
			</div>

			<div className="space-y-2">
				<Label htmlFor="target-type">
					{t('groups.permissions.targetType')} <span className="text-destructive">*</span>
				</Label>
				<Select
					value={formData.targetType}
					onValueChange={(value) =>
						setFormData({ ...formData, targetType: value as PermissionTarget })
					}
					inputId="target-type"
					options={[
						{ value: 'all_members', label: t('groups.permissions.targets.all_members') },
						{ value: 'all_admins', label: t('groups.permissions.targets.all_admins') },
						{ value: 'owner_only', label: t('groups.permissions.targets.owner_only') },
						{ value: 'owner_and_admins', label: t('groups.permissions.targets.owner_and_admins') },
					]}
					disabled={isSubmitting}
				/>
				<p className="text-xs text-muted-foreground">{t('groups.permissions.targetHint')}</p>
				<div className="pt-2">
					<PermissionTargetBadge target={formData.targetType} />
				</div>
			</div>

			<div className="space-y-2">
				<Label htmlFor="description">{t('groups.permissions.descriptionLabel')}</Label>
				<textarea
					id="description"
					value={formData.description || ''}
					onChange={(e) =>
						setFormData({ ...formData, description: (e.target as HTMLTextAreaElement).value })
					}
					placeholder={t('groups.permissions.descriptionPlaceholder')}
					disabled={isSubmitting}
					className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					rows={3}
				/>
				{errors.description && <p className="text-sm text-destructive">{t(errors.description)}</p>}
			</div>

			<div className="flex justify-end gap-2 pt-4">
				<Button variant="cancel" type="button" onClick={onCancel} disabled={isSubmitting}>
					{t('common.cancel')}
				</Button>
				<Button
					variant="confirm"
					type="submit"
					loading={isSubmitting}
					loadingText={t('groups.edit.saving')}
				>
					{isEditing ? t('groups.permissions.update') : t('groups.permissions.create')}
				</Button>
			</div>
		</form>
	)
}
