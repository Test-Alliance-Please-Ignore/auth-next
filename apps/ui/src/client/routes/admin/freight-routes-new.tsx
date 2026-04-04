import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateFreightRoute } from '@/hooks/useFreightRoutes'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CreateFreightRouteInput, FreightRouteStatus } from '@repo/freight'
import { Button } from '@/components/ui/button'

export default function AdminFreightRoutesNewPage() {
	usePageTitle('Admin - Create Freight Route')

	const navigate = useNavigate()
	const createRoute = useCreateFreightRoute()

	const [formData, setFormData] = useState<{
		pickupName: string
		destinationName: string
		iskPerVolumeUnit: string
		maxVolume: string
		collateralFeeRate: string
		expiration: string
		daysToComplete: string
		notes: string
		status: FreightRouteStatus
	}>({
		pickupName: '',
		destinationName: '',
		iskPerVolumeUnit: '',
		maxVolume: '',
		collateralFeeRate: '',
		expiration: '7',
		daysToComplete: '3',
		notes: '',
		status: 'active',
	})

	const [errors, setErrors] = useState<Record<string, string>>({})
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

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
		const newErrors: Record<string, string> = {}

		if (!formData.pickupName.trim()) {
			newErrors.pickupName = 'Pickup location is required'
		}

		if (!formData.destinationName.trim()) {
			newErrors.destinationName = 'Destination location is required'
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
			formData.maxVolume.trim() &&
			(isNaN(Number(formData.maxVolume)) || Number(formData.maxVolume) <= 0)
		) {
			newErrors.maxVolume = 'Max volume must be a positive number'
		}

		if (!formData.expiration.trim()) {
			newErrors.expiration = 'Contract expiration is required'
		} else if (isNaN(Number(formData.expiration)) || Number(formData.expiration) < 1) {
			newErrors.expiration = 'Expiration must be at least 1 day'
		}

		if (!formData.daysToComplete.trim()) {
			newErrors.daysToComplete = 'Days to complete is required'
		} else if (isNaN(Number(formData.daysToComplete)) || Number(formData.daysToComplete) < 1) {
			newErrors.daysToComplete = 'Days to complete must be at least 1 day'
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
				iskPerVolumeUnit: formData.iskPerVolumeUnit.trim(),
				maxVolume: formData.maxVolume.trim() || undefined,
				collateralFeeRate: formData.collateralFeeRate.trim()
					? (Number(formData.collateralFeeRate) / 100).toString()
					: undefined,
				expiration: formData.expiration.trim() ? Number(formData.expiration) : undefined,
				daysToComplete: formData.daysToComplete.trim()
					? Number(formData.daysToComplete)
					: undefined,
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
						<div className="space-y-2">
							<Label htmlFor="pickupName">
								Pickup Location
								<span className="text-destructive ml-1">*</span>
							</Label>
							<Input
								id="pickupName"
								value={formData.pickupName}
								onChange={(e) => handleChange('pickupName', e.target.value)}
								placeholder="e.g. Jita 4-4 CNAP or BWF-ZZ Fortizar"
								className={errors.pickupName ? 'border-destructive' : ''}
							/>
							{errors.pickupName && <p className="text-sm text-destructive">{errors.pickupName}</p>}
							<p className="text-sm text-muted-foreground">
								The pickup location name as it should appear to customers
							</p>
						</div>

						{/* Destination Location */}
						<div className="space-y-2">
							<Label htmlFor="destinationName">
								Destination Location
								<span className="text-destructive ml-1">*</span>
							</Label>
							<Input
								id="destinationName"
								value={formData.destinationName}
								onChange={(e) => handleChange('destinationName', e.target.value)}
								placeholder="e.g. Jita 4-4 CNAP or BWF-ZZ Fortizar"
								className={errors.destinationName ? 'border-destructive' : ''}
							/>
							{errors.destinationName && (
								<p className="text-sm text-destructive">{errors.destinationName}</p>
							)}
							<p className="text-sm text-muted-foreground">
								The destination location name as it should appear to customers
							</p>
						</div>

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
							<Label htmlFor="expiration">
								Contract Expiration (days)
								<span className="text-destructive ml-1">*</span>
							</Label>
							<Input
								id="expiration"
								type="number"
								step="1"
								min="1"
								value={formData.expiration}
								onChange={(e) => handleChange('expiration', e.target.value)}
								placeholder="Optional - days until contract expires"
							/>
							<p className="text-sm text-muted-foreground">
								How many days the courier contract should be available before expiring (optional)
							</p>
						</div>

						{/* Days to Complete */}
						<div className="space-y-2">
							<Label htmlFor="daysToComplete">
								Days to Complete
								<span className="text-destructive ml-1">*</span>
							</Label>
							<Input
								id="daysToComplete"
								type="number"
								step="1"
								min="1"
								value={formData.daysToComplete}
								onChange={(e) => handleChange('daysToComplete', e.target.value)}
								placeholder="Optional - days allowed to complete delivery"
							/>
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

						{/* Status */}
						<div className="space-y-2">
							<Label htmlFor="status">Initial Status</Label>
							<Select
								value={formData.status}
								onValueChange={(value) => handleChange('status', value as FreightRouteStatus)}
								inputId="status"
								options={[
									{ value: 'active',
										label: 'Active (available for use)',
									},
									{ value: 'inactive',
										label: 'Inactive (not available)',
									},
								]}
							/>
							<p className="text-sm text-muted-foreground">
								Set route status - only active routes are available to customers
							</p>
						</div>
					</CardContent>
				</Card>

				{/* Form Actions */}
				<div className="flex justify-end gap-3 mt-6">
					<Button variant="cancel" type="button" onClick={() => navigate('/admin/freight-routes')}>
						Cancel
					</Button>
					<Button variant="confirm" type="submit" loading={createRoute.isPending} loadingText="Creating...">
						Create Route
					</Button>
				</div>
			</form>
		</div>
	)
}
