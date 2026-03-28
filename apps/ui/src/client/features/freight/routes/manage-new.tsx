import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Container } from '@/components/ui/container'
import { GhostButton } from '@/components/ui/ghost-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateFreightRoute } from '@/hooks/useFreightRoutes'
import { useSystemSearch } from '@/hooks/useLocationSearch'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CreateFreightRouteInput, FreightRouteStatus } from '@repo/freight'

const EXPIRATION_OPTIONS = [
	{ value: '1', label: '1 day' },
	{ value: '3', label: '3 days' },
	{ value: '7', label: '1 week' },
	{ value: '14', label: '2 weeks' },
	{ value: '28', label: '4 weeks' },
]

export default function FreightManageNewPage() {
	usePageTitle('Create Freight Route')

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

	const [errors, setErrors] = useState<Record<string, string>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
	const [pickupSystemId, setPickupSystemId] = useState<string | null>(null)
	const [destinationSystemId, setDestinationSystemId] = useState<string | null>(null)
	const [pickupQuery, setPickupQuery] = useState('')
	const [destinationQuery, setDestinationQuery] = useState('')

	const pickupSearch = useSystemSearch(pickupQuery)
	const destinationSearch = useSystemSearch(destinationQuery)

	const pickupOptions = useMemo(
		() =>
			(pickupSearch.data ?? []).map((system) => ({ value: String(system.systemId),
				label: system.systemName,
				description: system.regionName,
			})),
		[pickupSearch.data]
	)

	const destinationOptions = useMemo(
		() =>
			(destinationSearch.data ?? []).map((system) => ({ value: String(system.systemId),
				label: system.systemName,
				description: system.regionName,
			})),
		[destinationSearch.data]
	)

	const handleChange = (field: string, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }))
		// Clear system ID when user types manually (forces re-selection)
		if (field === 'pickupName') setPickupSystemId(null)
		if (field === 'destinationName') setDestinationSystemId(null)
		if (errors[field]) {
			setErrors((prev) => {
				const { [field]: _, ...rest } = prev
				return rest
			})
		}
		if (message) setMessage(null)
	}

	const validate = (): boolean => {
		const newErrors: Record<string, string> = {}

		if (!formData.pickupName.trim()) {
			newErrors.pickupName = 'Pickup location is required'
		} else if (!pickupSystemId) {
			newErrors.pickupName = 'Please select a system from the search results'
		}

		if (!formData.destinationName.trim()) {
			newErrors.destinationName = 'Destination location is required'
		} else if (!destinationSystemId) {
			newErrors.destinationName = 'Please select a system from the search results'
		}

		if (
			formData.pickupName.trim() &&
			formData.destinationName.trim() &&
			formData.pickupName.trim() === formData.destinationName.trim()
		) {
			newErrors.destinationName = 'Pickup and destination cannot be the same'
		}

		if (!formData.iskPerVolumeUnit.trim()) {
			newErrors.iskPerVolumeUnit = 'Price per m³ is required'
		} else if (isNaN(Number(formData.iskPerVolumeUnit)) || Number(formData.iskPerVolumeUnit) <= 0) {
			newErrors.iskPerVolumeUnit = 'Price must be a positive number'
		}

		if (
			formData.minReward.trim() &&
			(isNaN(Number(formData.minReward)) || Number(formData.minReward) <= 0)
		) {
			newErrors.minReward = 'Minimum reward must be a positive number'
		}

		if (
			formData.maxVolume.trim() &&
			(isNaN(Number(formData.maxVolume)) || Number(formData.maxVolume) <= 0)
		) {
			newErrors.maxVolume = 'Max volume must be a positive number'
		}

		if (formData.expiration && !EXPIRATION_OPTIONS.some((o) => o.value === formData.expiration)) {
			newErrors.expiration = 'Please select a valid expiration period'
		}

		if (formData.daysToComplete.trim()) {
			const days = Number(formData.daysToComplete)
			if (isNaN(days) || days < 1 || days > 365) {
				newErrors.daysToComplete = 'Days to complete must be between 1 and 365'
			}
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

			setMessage({ type: 'success', text: 'Freight route created successfully!' })
			setTimeout(() => {
				navigate('/freight/manage')
			}, 1000)
		} catch (error) {
			console.error('Error creating route:', error)
			setMessage({ type: 'error', text: 'Failed to create freight route. Please try again.' })
		}
	}

	return (
		<Container size="narrow">
			<div className="mb-section md:mb-10 flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Create Freight Route</h1>
					<p className="text-muted-foreground mt-1">
						Define a new official freight route with pricing
					</p>
				</div>
				<GhostButton asChild>
					<Link to="/freight/manage">Back to Routes</Link>
				</GhostButton>
			</div>

			<form onSubmit={handleSubmit}>
				<Card>
					<CardHeader>
						<CardTitle>Route Details</CardTitle>
						<CardDescription>
							Configure the pickup location, destination, and pricing for this route
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						{/* Success/Error Message */}
						{message && (
							<Card variant={message.type === 'success' ? 'flat' : 'flat'}>
								<CardContent className="pt-6">
									<p className={message.type === 'success' ? 'text-success' : 'text-destructive'}>
										{message.text}
									</p>
								</CardContent>
							</Card>
						)}

						{/* Pickup Location */}
						<div className="space-y-2">
							<Label htmlFor="pickupName">
								Pickup Location
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
									handleChange('pickupName', nextQuery)
								}}
								searchable
								searchDelegate={() => pickupOptions}
								options={pickupOptions}
								minQueryLength={3}
								debounceMs={0}
								placeholder="Search for a solar system..."
								loading={pickupSearch.isFetching || pickupSearch.isPending}
								emptyText="No systems found"
								inputClassName={errors.pickupName ? 'border-destructive' : ''}
							/>
							{errors.pickupName && <p className="text-sm text-destructive">{errors.pickupName}</p>}
							<p className="text-sm text-muted-foreground">
								Search for and select the pickup solar system
							</p>
						</div>

						{/* Destination Location */}
						<div className="space-y-2">
							<Label htmlFor="destinationName">
								Destination Location
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
									handleChange('destinationName', nextQuery)
								}}
								searchable
								searchDelegate={() => destinationOptions}
								options={destinationOptions}
								minQueryLength={3}
								debounceMs={0}
								placeholder="Search for a solar system..."
								loading={destinationSearch.isFetching || destinationSearch.isPending}
								emptyText="No systems found"
								inputClassName={errors.destinationName ? 'border-destructive' : ''}
							/>
							{errors.destinationName && (
								<p className="text-sm text-destructive">{errors.destinationName}</p>
							)}
							<p className="text-sm text-muted-foreground">
								Search for and select the destination solar system
							</p>
						</div>

						{/* ISK per m³ */}
						<div className="space-y-2">
							<Label htmlFor="iskPerVolumeUnit">
								Price (ISK per m³)
								<span className="text-destructive ml-1">*</span>
							</Label>
							<NumberInput
								id="iskPerVolumeUnit"
								min={0}
								placeholder="1,000"
								value={formData.iskPerVolumeUnit}
								onChange={(val) => handleChange('iskPerVolumeUnit', val)}
								error={!!errors.iskPerVolumeUnit}
							/>
							{errors.iskPerVolumeUnit && (
								<p className="text-sm text-destructive">{errors.iskPerVolumeUnit}</p>
							)}
							<p className="text-sm text-muted-foreground">
								The cost per cubic meter for this route
							</p>
						</div>

						{/* Minimum Reward */}
						<div className="space-y-2">
							<Label htmlFor="minReward">Minimum Reward (ISK)</Label>
							<NumberInput
								id="minReward"
								min={0}
								placeholder="Optional - minimum contract reward"
								value={formData.minReward}
								onChange={(val) => handleChange('minReward', val)}
								error={!!errors.minReward}
							/>
							{errors.minReward && <p className="text-sm text-destructive">{errors.minReward}</p>}
							<p className="text-sm text-muted-foreground">
								Minimum ISK reward for a contract on this route, regardless of volume (optional)
							</p>
						</div>

						{/* Max Volume */}
						<div className="space-y-2">
							<Label htmlFor="maxVolume">Maximum Volume (m³)</Label>
							<NumberInput
								id="maxVolume"
								min={0}
								placeholder="Optional - leave empty for unlimited"
								value={formData.maxVolume}
								onChange={(val) => handleChange('maxVolume', val)}
								error={!!errors.maxVolume}
							/>
							{errors.maxVolume && <p className="text-sm text-destructive">{errors.maxVolume}</p>}
							<p className="text-sm text-muted-foreground">
								Maximum cargo volume allowed per contract (optional)
							</p>
						</div>

						{/* Collateral Fee Rate */}
						<div className="space-y-2">
							<Label htmlFor="collateralFeeRate">Collateral Fee Rate (%)</Label>
							<Input
								id="collateralFeeRate"
								type="number"
								step="0.01"
								value={formData.collateralFeeRate}
								onChange={(e) => handleChange('collateralFeeRate', e.target.value)}
								placeholder="Optional - e.g. 1.5"
							/>
							<p className="text-sm text-muted-foreground">
								Percentage fee charged on collateral value (optional)
							</p>
						</div>

						{/* Expiration */}
						<div className="space-y-2">
							<Label htmlFor="expiration">Contract Expiration</Label>
							<Select
								inputId="expiration"
								value={formData.expiration}
								onValueChange={(nextValue) => handleChange('expiration', nextValue)}
								options={EXPIRATION_OPTIONS}
								placeholder={
									EXPIRATION_OPTIONS.find((o) => o.value === formData.expiration)?.label ??
									'Optional - select expiration period'
								}
								inputClassName={errors.expiration ? 'border-destructive' : ''}
							/>
							{errors.expiration && <p className="text-sm text-destructive">{errors.expiration}</p>}
							<p className="text-sm text-muted-foreground">
								How long the courier contract is available before expiring (optional)
							</p>
						</div>

						{/* Days to Complete */}
						<div className="space-y-2">
							<Label htmlFor="daysToComplete">Days to Complete</Label>
							<NumberInput
								id="daysToComplete"
								min={1}
								max={365}
								step={1}
								placeholder="Optional - days allowed to complete delivery"
								value={formData.daysToComplete}
								onChange={(val) => handleChange('daysToComplete', val)}
								error={!!errors.daysToComplete}
							/>
							{errors.daysToComplete && (
								<p className="text-sm text-destructive">{errors.daysToComplete}</p>
							)}
							<p className="text-sm text-muted-foreground">
								How many days the courier has to complete the delivery after accepting (optional)
							</p>
						</div>

						{/* Notes */}
						<div className="space-y-2">
							<Label htmlFor="notes">Notes</Label>
							<Textarea
								id="notes"
								value={formData.notes}
								onChange={(e) => handleChange('notes', e.target.value)}
								placeholder="Optional notes about route restrictions, risks, or special handling..."
								rows={4}
							/>
							<p className="text-sm text-muted-foreground">
								Admin notes about this route (visible to customers)
							</p>
						</div>

						{/* Sort Order */}
						<div className="space-y-2">
							<Label htmlFor="sortOrder">Sort Order</Label>
							<Input
								id="sortOrder"
								type="number"
								step="1"
								value={formData.sortOrder}
								onChange={(e) => handleChange('sortOrder', e.target.value)}
								placeholder="0"
							/>
							<p className="text-sm text-muted-foreground">
								Lower numbers appear first in the dropdown. The first route is selected by default.
							</p>
						</div>

						{/* Status */}
						<div className="space-y-2">
							<Label htmlFor="status">Initial Status</Label>
							<Select
								inputId="status"
								value={formData.status}
								onValueChange={(nextValue) => handleChange('status', nextValue)}
								options={[
									{ value: 'active', label: 'Active (available for use)' },
									{ value: 'inactive', label: 'Inactive (not available)' },
								]}
								placeholder={
									formData.status === 'active'
										? 'Active (available for use)'
										: 'Inactive (not available)'
								}
							/>
							<p className="text-sm text-muted-foreground">
								Set route status - only active routes are available to customers
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Form Actions */}
				<div className="flex justify-end gap-3 mt-6">
					<CancelButton type="button" onClick={() => navigate('/freight/manage')}>
						Cancel
					</CancelButton>
					<ConfirmButton type="submit" loading={createRoute.isPending} loadingText="Creating...">
						Create Route
					</ConfirmButton>
				</div>
			</form>
		</Container>
	)
}
