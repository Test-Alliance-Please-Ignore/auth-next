import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { i18n, useAppTranslation } from '@/i18n'

import { ENTITY_TYPE_LABELS } from '../types'

import type { CreateIndustryProviderRequest, IndustryEntityType } from '../types'

export interface ProviderFormData {
	name: string
	description: string
	ownerEntityId: string
	ownerEntityType: IndustryEntityType | ''
	acceptingOrders: boolean
}

interface ProviderDetailsFormProps {
	data: ProviderFormData
	onChange: (data: ProviderFormData) => void
	errors: Partial<Record<keyof ProviderFormData, string>>
	disabled?: boolean
}

export function ProviderDetailsForm({
	data,
	onChange,
	errors,
	disabled,
}: ProviderDetailsFormProps) {
	const { t } = useAppTranslation()

	const handleChange = <K extends keyof ProviderFormData>(field: K, value: ProviderFormData[K]) => {
		onChange({ ...data, [field]: value })
	}

	return (
		<div className="space-y-6">
			{/* Name */}
			<div className="space-y-2">
				<Label htmlFor="name">
					{t('industry.name')}
					<span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={data.name}
					onChange={(e) => handleChange('name', e.target.value)}
					placeholder={t('industry.enterProviderName')}
					maxLength={255}
					disabled={disabled}
				/>
				{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
			</div>

			{/* Description */}
			<div className="space-y-2">
				<Label htmlFor="description">{t('industry.description')}</Label>
				<Textarea
					id="description"
					value={data.description}
					onChange={(e) => handleChange('description', e.target.value)}
					placeholder={t('industry.enterADescriptionForThisProvider')}
					rows={3}
					disabled={disabled}
				/>
			</div>

			{/* Owner Info */}
			<div className="grid gap-4 md:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="ownerEntityType">
						{t('industry.ownerType')}
						<span className="text-destructive">*</span>
					</Label>
					<Select
						value={data.ownerEntityType}
						onValueChange={(value) => handleChange('ownerEntityType', value as IndustryEntityType)}
						inputId="ownerEntityType"
						options={Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({
							value,
							label,
						}))}
						placeholder={t('industry.selectOwnerType')}
						disabled={disabled}
					/>
					{errors.ownerEntityType && (
						<p className="text-sm text-destructive">{errors.ownerEntityType}</p>
					)}
				</div>

				<div className="space-y-2">
					<Label htmlFor="ownerEntityId">
						{t('industry.ownerId')}
						<span className="text-destructive">*</span>
					</Label>
					<Input
						id="ownerEntityId"
						value={data.ownerEntityId}
						onChange={(e) => handleChange('ownerEntityId', e.target.value)}
						placeholder={t('industry.enterOwnerEntityIdUuid')}
						disabled={disabled}
					/>
					{errors.ownerEntityId && (
						<p className="text-sm text-destructive">{errors.ownerEntityId}</p>
					)}
				</div>
			</div>

			{/* Accepting Orders */}
			<div className="flex items-center justify-between rounded-lg border p-4">
				<div className="space-y-0.5">
					<Label htmlFor="acceptingOrders">{t('industry.acceptingOrders')}</Label>
					<p className="text-sm text-muted-foreground">
						{t('industry.allowNewOrdersToBePlacedWithThisProvider')}
					</p>
				</div>
				<Switch
					id="acceptingOrders"
					checked={data.acceptingOrders}
					onCheckedChange={(checked) => handleChange('acceptingOrders', checked)}
					disabled={disabled}
				/>
			</div>
		</div>
	)
}

/**
 * Validate provider form data
 */
export function validateProviderForm(
	data: ProviderFormData
): Partial<Record<keyof ProviderFormData, string>> {
	const errors: Partial<Record<keyof ProviderFormData, string>> = {}

	if (!data.name.trim()) {
		errors.name = i18n.t('industry.nameRequired')
	} else if (data.name.length > 255) {
		errors.name = i18n.t('industry.nameTooLong')
	}

	if (!data.ownerEntityType) {
		errors.ownerEntityType = i18n.t('industry.ownerTypeRequired')
	}

	if (!data.ownerEntityId.trim()) {
		errors.ownerEntityId = i18n.t('industry.ownerIdRequired')
	} else {
		// Basic UUID validation
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		if (!uuidRegex.test(data.ownerEntityId.trim())) {
			errors.ownerEntityId = i18n.t('industry.ownerIdInvalid')
		}
	}

	return errors
}

/**
 * Convert form data to API request
 */
export function formDataToRequest(data: ProviderFormData): CreateIndustryProviderRequest {
	return {
		name: data.name.trim(),
		description: data.description.trim() || null,
		ownerEntityId: data.ownerEntityId.trim(),
		ownerEntityType: data.ownerEntityType as IndustryEntityType,
		acceptingOrders: data.acceptingOrders,
	}
}
