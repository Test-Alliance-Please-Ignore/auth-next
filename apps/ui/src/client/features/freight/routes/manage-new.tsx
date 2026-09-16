import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateFreightRoute } from '@/hooks/useFreightRoutes'
import { useSystemSearch } from '@/hooks/useLocationSearch'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

import { formatISK, formatNumber, getExpirationOptions, getNumberInputSeparators } from '../utils'

import type { FormEvent } from 'react'
import type { CreateFreightRouteInput, FreightRouteStatus } from '@repo/freight'
import type { AppTranslationKey } from '@/i18n'

export default function FreightManageNewPage() {
	const { t, locale } = useAppTranslation()
	const expirationOptions = getExpirationOptions(t)
	const numberInputSeparators = getNumberInputSeparators(locale)
	usePageTitle(t('freight.form.createTitle'))

	const navigate = useNavigate()
	const createRoute = useCreateFreightRoute()

	const [formData, setFormData] = useState<{
		pickupName: string
		destinationName: string
		iskPerVolumeUnit: string
		minReward: string
		maxVolume: string
		collateralFeeRate: string
		expiration: string
		daysToComplete: string
		notes: string
		sortOrder: string
		status: FreightRouteStatus
	}>({
		pickupName: '',
		destinationName: '',
		iskPerVolumeUnit: '',
		minReward: '',
		maxVolume: '',
		collateralFeeRate: '',
		expiration: '7',
		daysToComplete: '',
		notes: '',
		sortOrder: '0',
		status: 'active',
	})

	const [errors, setErrors] = useState<Record<string, AppTranslationKey>>({})
	const [message, setMessage] = useState<{
		type: 'success' | 'error'
		key: AppTranslationKey
	} | null>(null)
	const [pickupSystemId, setPickupSystemId] = useState<string | null>(null)
	const [destinationSystemId, setDestinationSystemId] = useState<string | null>(null)
	const [pickupQuery, setPickupQuery] = useState('')
	const [destinationQuery, setDestinationQuery] = useState('')

	const pickupSearch = useSystemSearch(pickupQuery)
	const destinationSearch = useSystemSearch(destinationQuery)

	const pickupOptions = useMemo(
		() =>
			(pickupSearch.data ?? []).map((system) => ({
				value: String(system.systemId),
				label: system.systemName,
				description: system.regionName,
			})),
		[pickupSearch.data]
	)

	const destinationOptions = useMemo(
		() =>
			(destinationSearch.data ?? []).map((system) => ({
				value: String(system.systemId),
				label: system.systemName,
				description: system.regionName,
			})),
		[destinationSearch.data]
	)

	const handleChange = (field: string, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }))
		if (errors[field]) {
			setErrors((prev) => {
				const { [field]: _, ...rest } = prev
				return rest
			})
		}
		if (message) setMessage(null)
	}

	const validate = (): boolean => {
		const newErrors: Record<string, AppTranslationKey> = {}

		if (!formData.pickupName.trim()) {
			newErrors.pickupName = 'freight.form.validation.pickup'
		} else if (!pickupSystemId) {
			newErrors.pickupName = 'freight.form.validation.selectSystem'
		}

		if (!formData.destinationName.trim()) {
			newErrors.destinationName = 'freight.form.validation.destination'
		} else if (!destinationSystemId) {
			newErrors.destinationName = 'freight.form.validation.selectSystem'
		}

		if (
			formData.pickupName.trim() &&
			formData.destinationName.trim() &&
			formData.pickupName.trim() === formData.destinationName.trim()
		) {
			newErrors.destinationName = 'freight.form.validation.sameLocation'
		}

		if (!formData.iskPerVolumeUnit.trim()) {
			newErrors.iskPerVolumeUnit = 'freight.form.validation.price'
		} else if (isNaN(Number(formData.iskPerVolumeUnit)) || Number(formData.iskPerVolumeUnit) <= 0) {
			newErrors.iskPerVolumeUnit = 'freight.form.validation.positivePrice'
		}

		if (
			formData.minReward.trim() &&
			(isNaN(Number(formData.minReward)) || Number(formData.minReward) <= 0)
		) {
			newErrors.minReward = 'freight.form.validation.positiveMinimum'
		}

		if (
			formData.maxVolume.trim() &&
			(isNaN(Number(formData.maxVolume)) || Number(formData.maxVolume) <= 0)
		) {
			newErrors.maxVolume = 'freight.form.validation.positiveVolume'
		}

		if (formData.expiration && !expirationOptions.some((o) => o.value === formData.expiration)) {
			newErrors.expiration = 'freight.form.validation.expiration'
		}

		if (formData.daysToComplete.trim()) {
			const days = Number(formData.daysToComplete)
			if (isNaN(days) || days < 1 || days > 365) {
				newErrors.daysToComplete = 'freight.form.validation.days'
			}
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
			const input: CreateFreightRouteInput = {
				pickupName: formData.pickupName.trim(),
				destinationName: formData.destinationName.trim(),
				pickupSystemId: pickupSystemId || undefined,
				destinationSystemId: destinationSystemId || undefined,
				iskPerVolumeUnit: formData.iskPerVolumeUnit.trim(),
				minReward: formData.minReward.trim() || undefined,
				maxVolume: formData.maxVolume.trim() || undefined,
				collateralFeeRate: formData.collateralFeeRate.trim()
					? (Number(formData.collateralFeeRate) / 100).toString()
					: undefined,
				expiration: formData.expiration.trim() ? Number(formData.expiration) : undefined,
				daysToComplete: formData.daysToComplete.trim()
					? Number(formData.daysToComplete)
					: undefined,
				notes: formData.notes.trim() || undefined,
				sortOrder: formData.sortOrder.trim() ? Number(formData.sortOrder) : 0,
				status: formData.status,
			}

			await createRoute.mutateAsync(input)

			setMessage({ type: 'success', key: 'freight.form.created' })
			setTimeout(() => {
				void navigate('/freight/manage')
			}, 1000)
		} catch (error) {
			console.error('Error creating route:', error)
			setMessage({ type: 'error', key: 'freight.form.createFailed' })
		}
	}

	return (
		<Container size="narrow">
			<div className="mb-section md:mb-10 flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{t('freight.form.createTitle')}</h1>
					<p className="text-muted-foreground mt-1">{t('freight.form.createDescription')}</p>
				</div>
				<Button variant="ghost" asChild>
					<Link to="/freight/manage">{t('freight.common.back')}</Link>
				</Button>
			</div>

			<form onSubmit={handleSubmit}>
				<Card>
					<CardHeader>
						<CardTitle>{t('freight.form.details')}</CardTitle>
						<CardDescription>{t('freight.form.description')}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						{/* Success/Error Message */}
						{message && (
							<Card variant={message.type === 'success' ? 'flat' : 'flat'}>
								<CardContent className="pt-6">
									<p className={message.type === 'success' ? 'text-success' : 'text-destructive'}>
										{t(message.key)}
									</p>
								</CardContent>
							</Card>
						)}

						{/* Pickup Location */}
						<div className="space-y-2">
							<Label htmlFor="pickupName">
								{t('freight.form.pickup')}
								<span className="text-destructive ml-1">*</span>
							</Label>
							<Select
								inputId="pickupName"
								value={pickupSystemId ?? ''}
								onValueChange={(nextValue, option) => {
									if (!option) {
										return
									}
									setPickupSystemId(nextValue)
									setPickupQuery('')
									handleChange('pickupName', option.label)
								}}
								query={pickupQuery}
								onQueryChange={(nextQuery) => {
									setPickupQuery(nextQuery)
									setPickupSystemId(null)
									handleChange('pickupName', nextQuery)
								}}
								searchable
								searchDelegate={() => pickupOptions}
								options={pickupOptions}
								minQueryLength={3}
								debounceMs={0}
								placeholder={t('freight.form.systemSearch')}
								loading={pickupSearch.isFetching || pickupSearch.isPending}
								emptyText={t('freight.form.noSystems')}
								inputClassName={errors.pickupName ? 'border-destructive' : ''}
							/>
							{errors.pickupName && (
								<p className="text-sm text-destructive">{t(errors.pickupName)}</p>
							)}
							<p className="text-sm text-muted-foreground">{t('freight.form.pickupHint')}</p>
						</div>

						{/* Destination Location */}
						<div className="space-y-2">
							<Label htmlFor="destinationName">
								{t('freight.form.destination')}
								<span className="text-destructive ml-1">*</span>
							</Label>
							<Select
								inputId="destinationName"
								value={destinationSystemId ?? ''}
								onValueChange={(nextValue, option) => {
									if (!option) {
										return
									}
									setDestinationSystemId(nextValue)
									setDestinationQuery('')
									handleChange('destinationName', option.label)
								}}
								query={destinationQuery}
								onQueryChange={(nextQuery) => {
									setDestinationQuery(nextQuery)
									setDestinationSystemId(null)
									handleChange('destinationName', nextQuery)
								}}
								searchable
								searchDelegate={() => destinationOptions}
								options={destinationOptions}
								minQueryLength={3}
								debounceMs={0}
								placeholder={t('freight.form.systemSearch')}
								loading={destinationSearch.isFetching || destinationSearch.isPending}
								emptyText={t('freight.form.noSystems')}
								inputClassName={errors.destinationName ? 'border-destructive' : ''}
							/>
							{errors.destinationName && (
								<p className="text-sm text-destructive">{t(errors.destinationName)}</p>
							)}
							<p className="text-sm text-muted-foreground">{t('freight.form.destinationHint')}</p>
						</div>

						{/* ISK per m³ */}
						<div className="space-y-2">
							<Label htmlFor="iskPerVolumeUnit">
								{t('freight.form.price')}
								<span className="text-destructive ml-1">*</span>
							</Label>
							<NumberInput
								{...numberInputSeparators}
								id="iskPerVolumeUnit"
								min={0}
								suffix=" ISK"
								placeholder={formatISK(1000, { showDecimals: false })}
								value={formData.iskPerVolumeUnit}
								onChange={(val) => handleChange('iskPerVolumeUnit', val)}
								error={!!errors.iskPerVolumeUnit}
							/>
							{errors.iskPerVolumeUnit && (
								<p className="text-sm text-destructive">{t(errors.iskPerVolumeUnit)}</p>
							)}
							<p className="text-sm text-muted-foreground">{t('freight.form.priceHint')}</p>
						</div>

						{/* Minimum Reward */}
						<div className="space-y-2">
							<Label htmlFor="minReward">{t('freight.form.minimum')}</Label>
							<NumberInput
								{...numberInputSeparators}
								id="minReward"
								min={0}
								suffix=" ISK"
								placeholder={formatISK(1000000, { showDecimals: false })}
								value={formData.minReward}
								onChange={(val) => handleChange('minReward', val)}
								error={!!errors.minReward}
							/>
							{errors.minReward && (
								<p className="text-sm text-destructive">{t(errors.minReward)}</p>
							)}
							<p className="text-sm text-muted-foreground">{t('freight.form.minimumHint')}</p>
						</div>

						{/* Max Volume */}
						<div className="space-y-2">
							<Label htmlFor="maxVolume">{t('freight.form.maxVolume')}</Label>
							<NumberInput
								{...numberInputSeparators}
								id="maxVolume"
								min={0}
								placeholder={t('freight.form.unlimitedPlaceholder')}
								value={formData.maxVolume}
								onChange={(val) => handleChange('maxVolume', val)}
								error={!!errors.maxVolume}
							/>
							{errors.maxVolume && (
								<p className="text-sm text-destructive">{t(errors.maxVolume)}</p>
							)}
							<p className="text-sm text-muted-foreground">{t('freight.form.maxVolumeHint')}</p>
						</div>

						{/* Collateral Fee Rate */}
						<div className="space-y-2">
							<Label htmlFor="collateralFeeRate">{t('freight.form.feeRate')}</Label>
							<NumberInput
								{...numberInputSeparators}
								id="collateralFeeRate"
								step={0.01}
								value={formData.collateralFeeRate}
								onChange={(value) => handleChange('collateralFeeRate', value)}
								placeholder={t('freight.form.feePlaceholder', { example: formatNumber(1.5) })}
							/>
							<p className="text-sm text-muted-foreground">{t('freight.form.feeHint')}</p>
						</div>

						{/* Expiration */}
						<div className="space-y-2">
							<Label htmlFor="expiration">{t('freight.form.expiration')}</Label>
							<Select
								inputId="expiration"
								value={formData.expiration}
								onValueChange={(nextValue) => handleChange('expiration', nextValue)}
								options={expirationOptions}
								placeholder={
									expirationOptions.find((o) => o.value === formData.expiration)?.label ??
									t('freight.form.expirationPlaceholder')
								}
								inputClassName={errors.expiration ? 'border-destructive' : ''}
							/>
							{errors.expiration && (
								<p className="text-sm text-destructive">{t(errors.expiration)}</p>
							)}
							<p className="text-sm text-muted-foreground">{t('freight.form.expirationHint')}</p>
						</div>

						{/* Days to Complete */}
						<div className="space-y-2">
							<Label htmlFor="daysToComplete">{t('freight.common.daysToComplete')}</Label>
							<NumberInput
								{...numberInputSeparators}
								id="daysToComplete"
								min={1}
								max={365}
								step={1}
								placeholder={t('freight.form.daysPlaceholder')}
								value={formData.daysToComplete}
								onChange={(val) => handleChange('daysToComplete', val)}
								error={!!errors.daysToComplete}
							/>
							{errors.daysToComplete && (
								<p className="text-sm text-destructive">{t(errors.daysToComplete)}</p>
							)}
							<p className="text-sm text-muted-foreground">{t('freight.form.daysHint')}</p>
						</div>

						{/* Notes */}
						<div className="space-y-2">
							<Label htmlFor="notes">{t('freight.form.notes')}</Label>
							<Textarea
								id="notes"
								value={formData.notes}
								onChange={(e) => handleChange('notes', e.target.value)}
								placeholder={t('freight.form.notesPlaceholder')}
								rows={4}
							/>
							<p className="text-sm text-muted-foreground">{t('freight.form.notesHint')}</p>
						</div>

						{/* Sort Order */}
						<div className="space-y-2">
							<Label htmlFor="sortOrder">{t('freight.form.sortOrder')}</Label>
							<Input
								id="sortOrder"
								type="number"
								step="1"
								value={formData.sortOrder}
								onChange={(e) => handleChange('sortOrder', e.target.value)}
								placeholder="0"
							/>
							<p className="text-sm text-muted-foreground">{t('freight.form.sortHint')}</p>
						</div>

						{/* Status */}
						<div className="space-y-2">
							<Label htmlFor="status">{t('freight.form.initialStatus')}</Label>
							<Select
								inputId="status"
								value={formData.status}
								onValueChange={(nextValue) => handleChange('status', nextValue)}
								options={[
									{ value: 'active', label: t('freight.form.active') },
									{ value: 'inactive', label: t('freight.form.inactive') },
								]}
								placeholder={
									formData.status === 'active'
										? t('freight.form.active')
										: t('freight.form.inactive')
								}
							/>
							<p className="text-sm text-muted-foreground">{t('freight.form.statusHint')}</p>
						</div>
					</CardContent>
				</Card>

				{/* Form Actions */}
				<div className="flex justify-end gap-3 mt-6">
					<Button variant="cancel" type="button" onClick={() => navigate('/freight/manage')}>
						{t('common.cancel')}
					</Button>
					<Button
						variant="confirm"
						type="submit"
						loading={createRoute.isPending}
						loadingText={t('freight.common.creating')}
					>
						{t('freight.common.create')}
					</Button>
				</div>
			</form>
		</Container>
	)
}
