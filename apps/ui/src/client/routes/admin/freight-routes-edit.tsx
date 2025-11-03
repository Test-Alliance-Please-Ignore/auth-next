import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useFreightRoute, useUpdateFreightRoute } from '@/hooks/useFreightRoutes'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { FreightRouteStatus, UpdateFreightRouteInput } from '@repo/freight'
import type { EsiLocationSearchResult } from '@/lib/esi-api'

export default function AdminFreightRoutesEditPage() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { data: route, isLoading } = useFreightRoute(id!)
	const updateRoute = useUpdateFreightRoute()

	usePageTitle(route ? `Edit Route - ${route.pickupLocation.solarSystemId}` : 'Edit Freight Route')

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

	// Populate form when route loads
	useEffect(() => {
		if (route) {
			// Convert FreightLocation to EsiLocationSearchResult format for the form
			const pickupResult: EsiLocationSearchResult = {
				id: route.pickupLocation.structureId,
				name: 'Loading...', // Will be resolved by LocationSearch component
				systemId: route.pickupLocation.solarSystemId,
				systemName: 'Loading...',
				regionId: route.pickupLocation.regionId,
				regionName: 'Loading...',
				type: 'system', // Default, will be updated
			}

			const dropoffResult: EsiLocationSearchResult = {
				id: route.dropoffLocation.structureId,
				name: 'Loading...',
				systemId: route.dropoffLocation.solarSystemId,
				systemName: 'Loading...',
				regionId: route.dropoffLocation.regionId,
				regionName: 'Loading...',
				type: 'system',
			}

			setFormData({
				pickupLocation: pickupResult,
				dropoffLocation: dropoffResult,
				iskPerVolumeUnit: route.iskPerVolumeUnit,
				maxVolume: route.maxVolume || '',
				notes: route.notes || '',
				status: route.status,
			})
		}
	}, [route])

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

		if (!validate() || !id) {
			return
		}

		try {
			const input: UpdateFreightRouteInput = {
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

			await updateRoute.mutateAsync({ id, data: input })

			setMessage({ type: 'success', text: 'Freight route updated successfully!' })
			setTimeout(() => {
				navigate('/admin/freight-routes')
			}, 1000)
		} catch (error) {
			console.error('Error updating route:', error)
			setMessage({ type: 'error', text: 'Failed to update freight route. Please try again.' })
		}
	}

	if (isLoading) {
		return (
			<div className="space-y-6 max-w-4xl">
				<Skeleton className="h-12 w-64" />
				<Card>
					<CardHeader>
						<Skeleton className="h-6 w-32" />
						<Skeleton className="h-4 w-64" />
					</CardHeader>
					<CardContent className="space-y-6">
						{[...Array(5)].map((_, i) => (
							<Skeleton key={i} className="h-20 w-full" />
						))}
					</CardContent>
				</Card>
			</div>
		)
	}

	if (!route) {
		return (
			<div className="space-y-6 max-w-4xl">
				<Card>
					<CardContent className="pt-6">
						<p className="text-destructive">Freight route not found</p>
						<Button className="mt-4" onClick={() => navigate('/admin/freight-routes')}>
							Back to Routes
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="space-y-6 max-w-4xl">
			{/* Page Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">Edit Freight Route</h1>
				<p className="text-muted-foreground mt-1">Update route details and pricing</p>
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
							<Label htmlFor="status">Status</Label>
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
					<ConfirmButton type="submit" loading={updateRoute.isPending} loadingText="Saving...">
						Save Changes
					</ConfirmButton>
				</div>
			</form>
		</div>
	)
}
