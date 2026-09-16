import { useState } from 'react'

import { useAppTranslation } from '@/i18n'

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
	const { t } = useAppTranslation()

	const [formData, setFormData] = useState({
		name: initialData?.name || '',
		description: initialData?.description || '',
		displayOrder: initialData?.displayOrder || 0,
	})

	const [errors, setErrors] = useState<Partial<Record<string, string>>>({})

	const validate = (): boolean => {
		const newErrors: Partial<Record<string, string>> = {}

		if (!formData.name.trim()) {
			newErrors.name = t('skillPlans.nameRequired')
		} else if (formData.name.length < 2) {
			newErrors.name = t('skillPlans.nameMin2')
		} else if (formData.name.length > 50) {
			newErrors.name = t('skillPlans.nameMax50')
		}

		if (!formData.description.trim()) {
			newErrors.description = t('skillPlans.descriptionRequired')
		} else if (formData.description.length < 10) {
			newErrors.description = t('skillPlans.descriptionMin10')
		} else if (formData.description.length > 200) {
			newErrors.description = t('skillPlans.descriptionMax200')
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
					{t('skillPlans.categoryName')}
					<span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={formData.name}
					onChange={(e) => setFormData({ ...formData, name: e.target.value })}
					placeholder={t('skillPlans.eGPvpMiningIndustry')}
					disabled={isSubmitting}
					maxLength={50}
				/>
				{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
			</div>

			{/* Description field */}
			<div className="space-y-2">
				<Label htmlFor="description">
					{t('skillPlans.description2')}
					<span className="text-destructive">*</span>
				</Label>
				<Textarea
					id="description"
					value={formData.description}
					onChange={(e) => setFormData({ ...formData, description: e.target.value })}
					placeholder={t('skillPlans.describeWhatTypesOfSkillPlansBelongInThisCategory')}
					disabled={isSubmitting}
					rows={3}
					maxLength={200}
				/>
				<p className="text-sm text-muted-foreground">
					{formData.description.length}
					{t('skillPlans.message200Characters')}
				</p>
				{errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
			</div>

			{/* Display order field */}
			<div className="space-y-2">
				<Label htmlFor="displayOrder">{t('skillPlans.displayOrder')}</Label>
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
				<p className="text-sm text-muted-foreground">
					{t('skillPlans.lowerNumbersAppearFirstInLists')}
				</p>
			</div>

			{/* Form actions */}
			<div className="flex justify-end gap-2 pt-4">
				<Button variant="cancel" onClick={onCancel} disabled={isSubmitting}>
					{t('skillPlans.cancel')}
				</Button>
				<Button variant="confirm" type="submit" loading={isSubmitting}>
					{mode === 'create' ? t('skillPlans.createCategory') : t('skillPlans.saveChanges')}
				</Button>
			</div>
		</form>
	)
}
