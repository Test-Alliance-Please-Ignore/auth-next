import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

import { useIndustryProvider, useUpdateIndustryProvider } from '../hooks'
import { ENTITY_TYPE_LABELS } from '../types'

import type { UpdateIndustryProviderRequest } from '../types'

export default function IndustryProviderEditPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('industry.adminEditProvider'))
	const { providerId } = useParams<{ providerId: string }>()
	const navigate = useNavigate()

	const { data: provider, isLoading } = useIndustryProvider(providerId)
	const updateProvider = useUpdateIndustryProvider()

	// Form state
	const [formData, setFormData] = useState({
		name: '',
		description: '',
		acceptingOrders: false,
	})

	const [errors, setErrors] = useState<Partial<Record<keyof typeof formData, string>>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Populate form when provider loads
	useEffect(() => {
		if (provider) {
			setFormData({
				name: provider.name,
				description: provider.description || '',
				acceptingOrders: provider.acceptingOrders,
			})
		}
	}, [provider])

	const validate = (): boolean => {
		const newErrors: Partial<Record<keyof typeof formData, string>> = {}

		if (!formData.name.trim()) {
			newErrors.name = t('industry.nameRequired')
		} else if (formData.name.length > 255) {
			newErrors.name = t('industry.nameTooLong')
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleChange = (field: keyof typeof formData, value: string | boolean) => {
		setFormData((prev) => ({ ...prev, [field]: value }))
		// Clear error when field is edited
		if (errors[field]) {
			setErrors((prev) => {
				const { [field]: _, ...rest } = prev
				return rest
			})
		}
		// Clear message
		if (message) setMessage(null)
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!validate() || !providerId) return

		const data: UpdateIndustryProviderRequest = {
			name: formData.name.trim(),
			description: formData.description.trim() || null,
			acceptingOrders: formData.acceptingOrders,
		}

		try {
			await updateProvider.mutateAsync({ id: providerId, data })
			setMessage({ type: 'success', text: t('industry.providerUpdatedSuccessfully') })
			setTimeout(() => {
				void navigate(`/admin/industry-providers/${providerId}`)
			}, 1000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : t('industry.failedToUpdateProvider'),
			})
		}
	}

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate(-1)}>
						<ArrowLeft className="h-4 w-4" />
						{t('industry.back')}
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">
					{t('industry.loadingProvider')}
				</div>
			</div>
		)
	}

	if (!provider) {
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/industry-providers')}>
						<ArrowLeft className="h-4 w-4" />
						{t('industry.back')}
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">
					{t('industry.providerNotFound')}
				</div>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center gap-4">
				<Button variant="ghost" onClick={() => navigate(-1)}>
					<ArrowLeft className="h-4 w-4" />
					{t('industry.back')}
				</Button>
				<div>
					<h1 className="text-3xl font-bold gradient-text">{t('industry.editProvider')}</h1>
					<p className="text-muted-foreground mt-1">{t('industry.updateProviderInformation')}</p>
				</div>
			</div>

			{/* Message */}
			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Form */}
			<Card>
				<CardHeader>
					<CardTitle>{t('industry.providerDetails')}</CardTitle>
					<CardDescription>
						{t('industry.updateTheProviderSNameDescriptionAndStatus')}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-6">
						{/* Name */}
						<div className="space-y-2">
							<Label htmlFor="name">
								{t('industry.name')}
								<span className="text-destructive">*</span>
							</Label>
							<Input
								id="name"
								value={formData.name}
								onChange={(e) => handleChange('name', e.target.value)}
								placeholder={t('industry.enterProviderName')}
								maxLength={255}
							/>
							{errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
						</div>

						{/* Description */}
						<div className="space-y-2">
							<Label htmlFor="description">{t('industry.description')}</Label>
							<Textarea
								id="description"
								value={formData.description}
								onChange={(e) => handleChange('description', e.target.value)}
								placeholder={t('industry.enterADescriptionForThisProvider')}
								rows={3}
							/>
						</div>

						{/* Owner Info (Read-only) */}
						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label>{t('industry.ownerType2')}</Label>
								<Select
									value={provider.ownerEntityType}
									options={Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({
										value,
										label,
									}))}
									disabled
								/>
								<p className="text-xs text-muted-foreground">
									{t('industry.ownerTypeCannotBeChangedAfterCreation')}
								</p>
							</div>

							<div className="space-y-2">
								<Label>{t('industry.ownerId2')}</Label>
								<Input value={provider.ownerEntityId} disabled />
								<p className="text-xs text-muted-foreground">
									{t('industry.ownerIdCannotBeChangedAfterCreation')}
								</p>
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
								checked={formData.acceptingOrders}
								onCheckedChange={(checked) => handleChange('acceptingOrders', checked)}
							/>
						</div>

						{/* Actions */}
						<div className="flex justify-end gap-2 pt-4">
							<Button variant="cancel" type="button" onClick={() => navigate(-1)}>
								{t('industry.cancel')}
							</Button>
							<Button
								variant="confirm"
								type="submit"
								loading={updateProvider.isPending}
								loadingText={t('industry.saving')}
							>
								{t('industry.saveChanges')}
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	)
}
