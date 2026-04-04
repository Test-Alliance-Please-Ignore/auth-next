import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePageTitle } from '@/hooks/usePageTitle'

import {
	formDataToRequest,
	ProviderDetailsForm,
	validateProviderForm,
} from '../components/provider-details-form'
import { ServicesSelection } from '../components/services-selection'
import { WizardStepIndicator } from '../components/wizard-step-indicator'
import { useAddProviderService, useCreateIndustryProvider } from '../hooks'
import { SERVICE_TYPE_LABELS, ServiceType } from '../types'

import type { ProviderFormData } from '../components/provider-details-form'

const WIZARD_STEPS = [
	{ label: 'Provider Details', description: 'Basic information' },
	{ label: 'Add Services', description: 'Select services' },
]

type CreationStatus = 'idle' | 'creating-provider' | 'adding-services' | 'complete' | 'error'

export default function IndustryProviderNewPage() {
	usePageTitle('Admin - Create Provider')
	const navigate = useNavigate()

	// Wizard state
	const [currentStep, setCurrentStep] = useState(1)
	const [createdProviderId, setCreatedProviderId] = useState<string | null>(null)
	const [creationStatus, setCreationStatus] = useState<CreationStatus>('idle')
	const [creationError, setCreationError] = useState<string | null>(null)

	// Form state - Step 1
	const [providerData, setProviderData] = useState<ProviderFormData>({
		name: '',
		description: '',
		ownerEntityId: '',
		ownerEntityType: '',
		acceptingOrders: false,
	})
	const [providerErrors, setProviderErrors] = useState<
		Partial<Record<keyof ProviderFormData, string>>
	>({})

	// Form state - Step 2
	const [selectedServices, setSelectedServices] = useState<ServiceType[]>([])
	const [serviceCreationResults, setServiceCreationResults] = useState<
		Array<{ type: ServiceType; success: boolean; error?: string }>
	>([])

	// Mutations
	const createProvider = useCreateIndustryProvider()
	const addService = useAddProviderService()

	const handleProviderDataChange = (data: ProviderFormData) => {
		setProviderData(data)
		// Clear errors when data changes
		if (Object.keys(providerErrors).length > 0) {
			setProviderErrors({})
		}
	}

	const handleNextStep = async () => {
		if (currentStep === 1) {
			// Validate provider data
			const errors = validateProviderForm(providerData)
			if (Object.keys(errors).length > 0) {
				setProviderErrors(errors)
				return
			}

			// Create provider
			setCreationStatus('creating-provider')
			setCreationError(null)

			try {
				const request = formDataToRequest(providerData)
				const provider = await createProvider.mutateAsync(request)
				setCreatedProviderId(provider.id)
				setCreationStatus('idle')
				setCurrentStep(2)
			} catch (error) {
				setCreationStatus('error')
				setCreationError(
					error instanceof Error ? error.message : 'Failed to create provider'
				)
			}
		}
	}

	const handlePreviousStep = () => {
		if (currentStep === 2) {
			// Can't go back after provider is created
			// Provider already exists, just navigate to detail page
			if (createdProviderId) {
				navigate(`/admin/industry-providers/${createdProviderId}`)
			}
		}
	}

	const handleFinish = async () => {
		if (!createdProviderId) return

		if (selectedServices.length === 0) {
			// No services selected, just navigate to detail page
			navigate(`/admin/industry-providers/${createdProviderId}`)
			return
		}

		// Add services sequentially
		setCreationStatus('adding-services')
		const results: Array<{ type: ServiceType; success: boolean; error?: string }> = []

		for (const serviceType of selectedServices) {
			try {
				await addService.mutateAsync({
					providerId: createdProviderId,
					serviceType,
				})
				results.push({ type: serviceType, success: true })
			} catch (error) {
				results.push({
					type: serviceType,
					success: false,
					error: error instanceof Error ? error.message : 'Failed to add service',
				})
			}
		}

		setServiceCreationResults(results)
		setCreationStatus('complete')

		// Wait a bit then navigate
		setTimeout(() => {
			navigate(`/admin/industry-providers/${createdProviderId}`)
		}, 2000)
	}

	const handleSkipServices = () => {
		if (createdProviderId) {
			navigate(`/admin/industry-providers/${createdProviderId}`)
		}
	}

	const isProcessing =
		creationStatus === 'creating-provider' || creationStatus === 'adding-services'

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center gap-4">
				<Button
					variant="ghost"
					onClick={() => navigate('/admin/industry-providers')}
					disabled={isProcessing}
				>
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back
				</Button>
				<div>
					<h1 className="text-3xl font-bold gradient-text">Create Provider</h1>
					<p className="text-muted-foreground mt-1">
						Set up a new service provider
					</p>
				</div>
			</div>

			{/* Step Indicator */}
			<WizardStepIndicator
				steps={WIZARD_STEPS}
				currentStep={currentStep}
				onStepClick={undefined} // Can't go back after provider creation
			/>

			{/* Step Content */}
			{currentStep === 1 && (
				<Card>
					<CardHeader>
						<CardTitle>Provider Details</CardTitle>
						<CardDescription>
							Enter the basic information for the new service provider
						</CardDescription>
					</CardHeader>
					<CardContent>
						{creationError && (
							<div className="mb-6 p-4 rounded-lg border border-destructive bg-destructive/10">
								<p className="text-destructive">{creationError}</p>
							</div>
						)}

						<ProviderDetailsForm
							data={providerData}
							onChange={handleProviderDataChange}
							errors={providerErrors}
							disabled={isProcessing}
						/>

						<div className="flex justify-end gap-2 mt-6 pt-4 border-t">
							<Button
								variant="ghost"
								onClick={() => navigate('/admin/industry-providers')}
								disabled={isProcessing}
							>
								Cancel
							</Button>
							<Button onClick={handleNextStep} disabled={isProcessing}>
								{creationStatus === 'creating-provider' ? (
									<>
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
										Creating...
									</>
								) : (
									<>
										Next
										<ArrowRight className="h-4 w-4 ml-2" />
									</>
								)}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{currentStep === 2 && (
				<Card>
					<CardHeader>
						<CardTitle>Add Services</CardTitle>
						<CardDescription>
							Select the services this provider will offer. You can add more services later.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{creationStatus === 'complete' && (
							<div className="mb-6 p-4 rounded-lg border border-primary bg-primary/10">
								<div className="flex items-center gap-2 text-primary font-medium mb-2">
									<Check className="h-5 w-5" />
									Provider created successfully!
								</div>
								{serviceCreationResults.length > 0 && (
									<div className="space-y-1 text-sm">
										{serviceCreationResults.map((result) => (
											<div
												key={result.type}
												className={
													result.success ? 'text-green-500' : 'text-destructive'
												}
											>
												{result.success ? '✓' : '✗'}{' '}
												{SERVICE_TYPE_LABELS[result.type]}
												{result.error && ` - ${result.error}`}
											</div>
										))}
									</div>
								)}
								<p className="text-sm text-muted-foreground mt-2">
									Redirecting to provider details...
								</p>
							</div>
						)}

						{creationStatus !== 'complete' && (
							<>
								<ServicesSelection
									selectedServices={selectedServices}
									onChange={setSelectedServices}
									disabled={isProcessing}
								/>

								<div className="flex justify-between gap-2 mt-6 pt-4 border-t">
									<Button variant="ghost" onClick={handleSkipServices} disabled={isProcessing}>
										Skip for Now
									</Button>
									<Button onClick={handleFinish} disabled={isProcessing}>
										{creationStatus === 'adding-services' ? (
											<>
												<Loader2 className="h-4 w-4 mr-2 animate-spin" />
												Adding Services...
											</>
										) : (
											<>
												<Check className="h-4 w-4 mr-2" />
												{selectedServices.length > 0
													? `Finish (${selectedServices.length} services)`
													: 'Finish'}
											</>
										)}
									</Button>
								</div>
							</>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	)
}
