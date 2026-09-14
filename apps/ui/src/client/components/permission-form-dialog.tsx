import { Check, XCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import type { FormEvent } from 'react'
import type { AppTranslationKey } from '@/i18n'
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

// URN validation regex - minimum 3 parts (urn:namespace:action)
const URN_REGEX = /^urn:[a-z0-9_-]+(:[a-z0-9_-]+)+$/
const BROADCAST_SEGMENT_REGEX = /^[a-z0-9_-]+$/

export function PermissionFormDialog({
	permission,
	categories,
	onSubmit,
	onCancel,
	isSubmitting,
}: PermissionFormDialogProps) {
	const { t } = useAppTranslation()
	const isEditing = !!permission

	const [formData, setFormData] = useState<CreatePermissionRequest>({
		urn: permission?.urn || '',
		name: permission?.name || '',
		description: permission?.description || '',
		categoryId: permission?.categoryId || undefined,
	})

	const [errors, setErrors] = useState<
		Partial<Record<keyof CreatePermissionRequest, AppTranslationKey>>
	>({})
	const [urnTouched, setUrnTouched] = useState(false)

	const validateUrn = (urn: string): AppTranslationKey | null => {
		if (!urn.trim()) {
			return 'admin.validation.urnRequired'
		}

		if (!urn.startsWith('urn:')) {
			return 'admin.validation.urnPrefix'
		}

		const parts = urn.split(':')
		if (parts.length < 3) {
			return 'admin.validation.urnParts'
		}

		if (!URN_REGEX.test(urn)) {
			return 'admin.validation.urnCharacters'
		}

		if (urn.startsWith('urn:broadcasts:')) {
			const parts = urn.split(':')
			if (parts.length !== 5) {
				return 'admin.validation.broadcastFormat'
			}

			const entityNamespace = parts[2]
			const targetName = parts[3]
			const action = parts[4]

			if (!BROADCAST_SEGMENT_REGEX.test(entityNamespace)) {
				return 'admin.validation.broadcastNamespace'
			}

			if (!BROADCAST_SEGMENT_REGEX.test(targetName)) {
				return 'admin.validation.broadcastTarget'
			}

			if (action !== 'send' && action !== 'manage') {
				return 'admin.validation.broadcastAction'
			}
		}

		return null
	}

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof CreatePermissionRequest, AppTranslationKey>> = {}

		// Validate URN
		const urnError = validateUrn(formData.urn)
		if (urnError) {
			newErrors.urn = urnError
		}

		// Validate name
		if (!formData.name.trim()) {
			newErrors.name = 'admin.validation.displayNameRequired'
		} else if (formData.name.length > 255) {
			newErrors.name = 'admin.validation.nameTooLong'
		}

		// Validate description
		if (formData.description && formData.description.length > 1000) {
			newErrors.description = 'admin.validation.descriptionTooLong'
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: FormEvent) => {
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
					{t('admin.permissionForm.urn')} <span className="text-destructive">*</span>
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
						{t('admin.permissionForm.urnHelp')}
						<span className="ml-2">{t('admin.permissionForm.broadcastHelp')}</span>
						{isEditing && (
							<span className="ml-2 text-xs">{t('admin.permissionForm.urnImmutable')}</span>
						)}
					</p>
				)}
			</div>

			<div className="space-y-2">
				<Label htmlFor="name">
					{t('admin.permissionForm.name')} <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: (e.target as HTMLInputElement).value })}
					placeholder={t('admin.permissionForm.nameExample')}
					disabled={isSubmitting}
				/>
				{errors.name && <p className="text-sm text-destructive">{t(errors.name)}</p>}
			</div>

			<div className="space-y-2">
				<Label htmlFor="category">{t('admin.permissionForm.categoryOptional')}</Label>
				<Select
					value={formData.categoryId || 'none'}
					onValueChange={(value) =>
						setFormData({ ...formData, categoryId: value === 'none' ? undefined : value })
					}
					inputId="category"
					searchable
					options={[
						{ value: 'none', label: t('admin.permissionForm.noCategory') },
						...categories.map((category) => ({ value: category.id, label: category.name })),
					]}
					placeholder={t('admin.permissionForm.selectCategory')}
					disabled={isSubmitting}
				/>
			</div>

			<div className="space-y-2">
				<Label htmlFor="description">{t('admin.fields.descriptionOptional')}</Label>
				<textarea
					id="description"
					value={formData.description || ''}
					onChange={(e) =>
						setFormData({ ...formData, description: (e.target as HTMLTextAreaElement).value })
					}
					placeholder={t('admin.permissionForm.descriptionExample')}
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
					loadingText={t('admin.fields.saving')}
				>
					{isEditing ? t('admin.permissions.update') : t('admin.permissions.create')}
				</Button>
			</div>
		</form>
	)
}
