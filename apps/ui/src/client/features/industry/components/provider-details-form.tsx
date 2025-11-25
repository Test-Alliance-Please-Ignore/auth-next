import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { ENTITY_TYPE_LABELS, IndustryEntityType } from '../types'

import type { CreateIndustryProviderRequest } from '../types'

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
	const handleChange = <K extends keyof ProviderFormData>(
		field: K,
		value: ProviderFormData[K]
	) => {
		onChange({ ...data, [field]: value })
	}

	return (
		<div className="space-y-6">
			{/* Name */}
			<div className="space-y-2">
				<Label htmlFor="name">
					Name <span className="text-destructive">*</span>
				</Label>
				<Input
					id="name"
					value={data.name}
					onChange={(e) => handleChange('name', e.target.value)}
					placeholder="Enter provider name"
					maxLength={255}
					disabled={disabled}
				/>
				{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
			</div>

			{/* Description */}
			<div className="space-y-2">
				<Label htmlFor="description">Description</Label>
				<Textarea
					id="description"
					value={data.description}
					onChange={(e) => handleChange('description', e.target.value)}
					placeholder="Enter a description for this provider"
					rows={3}
					disabled={disabled}
				/>
			</div>

			{/* Owner Info */}
			<div className="grid gap-4 md:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="ownerEntityType">
						Owner Type <span className="text-destructive">*</span>
					</Label>
					<Select
						value={data.ownerEntityType}
						onValueChange={(value) =>
							handleChange('ownerEntityType', value as IndustryEntityType)
						}
						disabled={disabled}
					>
						<SelectTrigger id="ownerEntityType">
							<SelectValue placeholder="Select owner type" />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{errors.ownerEntityType && (
						<p className="text-sm text-destructive">{errors.ownerEntityType}</p>
					)}
				</div>

				<div className="space-y-2">
					<Label htmlFor="ownerEntityId">
						Owner ID <span className="text-destructive">*</span>
					</Label>
					<Input
						id="ownerEntityId"
						value={data.ownerEntityId}
						onChange={(e) => handleChange('ownerEntityId', e.target.value)}
						placeholder="Enter owner entity ID (UUID)"
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
					<Label htmlFor="acceptingOrders">Accepting Orders</Label>
					<p className="text-sm text-muted-foreground">
						Allow new orders to be placed with this provider
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
		errors.name = 'Name is required'
	} else if (data.name.length > 255) {
		errors.name = 'Name must be 255 characters or less'
	}

	if (!data.ownerEntityType) {
		errors.ownerEntityType = 'Owner type is required'
	}

	if (!data.ownerEntityId.trim()) {
		errors.ownerEntityId = 'Owner ID is required'
	} else {
		// Basic UUID validation
		const uuidRegex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		if (!uuidRegex.test(data.ownerEntityId.trim())) {
			errors.ownerEntityId = 'Owner ID must be a valid UUID'
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
