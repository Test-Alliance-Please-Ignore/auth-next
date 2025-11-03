import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LocationSearch } from '@/components/ui/location-search'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateFreightRoute } from '@/hooks/useFreightRoutes'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CreateFreightRouteInput, FreightRouteStatus } from '@repo/freight'
import type { EsiLocationSearchResult } from '@/lib/esi-api'

export default function AdminFreightRoutesNewPage() {
	usePageTitle('Admin - Create Freight Route')

	const navigate = useNavigate()
	const createRoute = useCreateFreightRoute()

	const [formData, setFormData] = useState<{
		pickupLocation: EsiLocationSearchResult | null
		dropoffLocation: EsiLocationSearchResult | null
		iskPerVolumeUnit: string
		maxVolume: string
		notes: string
		status: FreightRouteStatus
	}>({
		pickupLocation: null,
		dropoffLocation: null,
		iskPerVolumeUnit: '',
		maxVolume: '',
		notes: '',
		status: 'active',
	})

	const [errors, setErrors] = useState<Record<string, string>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	const handleChange = (field: string, value: string | EsiLocationSearchResult | null) => {
		setFormData((prev) => ({ ...prev, [field]: value }))
		// Clear error when field is edited
		if (errors[field]) {
			setErrors((prev) => {
				const { [field]: _, ...rest } = prev
				return rest
			})
		}
		// Clear general message
		if (message) setMessage(null)
	}

	const validate = (): boolean => {
		const newErrors: Record<string, string> = {}

		if (!formData.pickupLocation) {
			newErrors.pickupLocation = 'Pickup location is required'
		}

		if (!formData.dropoffLocation) {
			newErrors.dropoffLocation = 'Destination location is required'
		}

		if (
			formData.pickupLocation &&
			formData.dropoffLocation &&
			formData.pickupLocation.id === formData.dropoffLocation.id
		) {
			newErrors.dropoffLocation = 'Pickup and destination cannot be the same'
		}

		if (!formData.iskPerVolumeUnit.trim()) {
			newErrors.iskPerVolumeUnit = 'Price per m³ is required'
		} else if (isNaN(Number(formData.iskPerVolumeUnit)) || Number(formData.iskPerVolumeUnit) <= 0) {
			newErrors.iskPerVolumeUnit = 'Price must be a positive number'
		}

		if (
			formData.maxVolume.trim() &&
			(isNaN(Number(formData.maxVolume)) || Number(formData.maxVolume) <= 0)
		) {
			newErrors.maxVolume = 'Max volume must be a positive number'
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
				pickupLocation: {
					solarSystemId: formData.pickupLocation!.systemId as any,
					regionId: formData.pickupLocation!.regionId as any,
					structureId: formData.pickupLocation!.id as any,
					constellationId: undefined,
				},
				dropoffLocation: {
					solarSystemId: formData.dropoffLocation!.systemId as any,
					regionId: formData.dropoffLocation!.regionId as any,
					structureId: formData.dropoffLocation!.id as any,
					constellationId: undefined,
				},
				iskPerVolumeUnit: formData.iskPerVolumeUnit.trim(),
				maxVolume: formData.maxVolume.trim() || undefined,
				notes: formData.notes.trim() || undefined,
				status: formData.status,
			}

			await createRoute.mutateAsync(input)

			setMessage({ type: 'success', text: 'Freight route created successfully!' })
			setTimeout(() => {
				navigate('/admin/freight-routes')
			}, 1000)
		} catch (error) {
			console.error('Error creating route:', error)
			setMessage({ type: 'error', text: 'Failed to create freight route. Please try again.' })
		}
	}

	return (
		<div className="space-y-6 max-w-4xl">
			{/* Page Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">Create Freight Route</h1>
				<p className="text-muted-foreground mt-1">
					Define a new official freight route with pricing
				</p>
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
						<LocationSearch
							label="Pickup Location"
							value={formData.pickupLocation}
							onChange={(location) => handleChange('pickupLocation', location)}
							placeholder="Search for a system or station..."
							required
							error={errors.pickupLocation}
						/>

						{/* Destination Location */}
						<LocationSearch
							label="Destination Location"
							value={formData.dropoffLocation}
							onChange={(location) => handleChange('dropoffLocation', location)}
							placeholder="Search for a system or station..."
							required
							error={errors.dropoffLocation}
						/>

						{/* ISK per m³ */}
						<div className="space-y-2">
							<Label htmlFor="iskPerVolumeUnit">
								Price (ISK per m³)
								<span className="text-destructive ml-1">*</span>
							</Label>
							<Input
								id="iskPerVolumeUnit"
								type="number"
								step="0.01"
								value={formData.iskPerVolumeUnit}
								onChange={(e) => handleChange('iskPerVolumeUnit', e.target.value)}
								placeholder="1000"
								className={errors.iskPerVolumeUnit ? 'border-destructive' : ''}
							/>
							{errors.iskPerVolumeUnit && (
								<p className="text-sm text-destructive">{errors.iskPerVolumeUnit}</p>
							)}
							<p className="text-sm text-muted-foreground">
								The cost per cubic meter for this route
							</p>
						</div>

						{/* Max Volume */}
						<div className="space-y-2">
							<Label htmlFor="maxVolume">Maximum Volume (m³)</Label>
							<Input
								id="maxVolume"
								type="number"
								step="0.01"
								value={formData.maxVolume}
								onChange={(e) => handleChange('maxVolume', e.target.value)}
								placeholder="Optional - leave empty for unlimited"
								className={errors.maxVolume ? 'border-destructive' : ''}
							/>
							{errors.maxVolume && <p className="text-sm text-destructive">{errors.maxVolume}</p>}
							<p className="text-sm text-muted-foreground">
								Maximum cargo volume allowed per contract (optional)
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

						{/* Status */}
						<div className="space-y-2">
							<Label htmlFor="status">Initial Status</Label>
							<Select
								value={formData.status}
								onValueChange={(value) => handleChange('status', value as FreightRouteStatus)}
							>
								<SelectTrigger id="status">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="active">Active (available for use)</SelectItem>
									<SelectItem value="inactive">Inactive (not available)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								Set route status - only active routes are available to customers
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Form Actions */}
				<div className="flex justify-end gap-3 mt-6">
					<CancelButton type="button" onClick={() => navigate('/admin/freight-routes')}>
						Cancel
					</CancelButton>
					<ConfirmButton type="submit" loading={createRoute.isPending} loadingText="Creating...">
						Create Route
					</ConfirmButton>
				</div>
			</form>
		</div>
	)
}
