import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePageTitle } from '@/hooks/usePageTitle'
import { i18n, useAppTranslation } from '@/i18n'

import {
	formDataToRequest,
	ProviderDetailsForm,
	validateProviderForm,
} from '../components/provider-details-form'
import { ServicesSelection } from '../components/services-selection'
import { WizardStepIndicator } from '../components/wizard-step-indicator'
import { useAddProviderService, useCreateIndustryProvider } from '../hooks'
import { SERVICE_TYPE_LABELS } from '../types'

import type { ProviderFormData } from '../components/provider-details-form'
import type { ServiceType } from '../types'

const WIZARD_STEPS = [
	{
		get label() {
			return i18n.t('industry.providerDetails')
		},
		get description() {
			return i18n.t('industry.basicInformation')
		},
	},
	{
		get label() {
			return i18n.t('industry.addServices')
		},
		get description() {
			return i18n.t('industry.selectServices')
		},
	},
]

type CreationStatus = 'idle' | 'creating-provider' | 'adding-services' | 'complete' | 'error'

export default function IndustryProviderNewPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('industry.adminCreateProvider'))
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
					error instanceof Error ? error.message : t('industry.failedToCreateProvider')
				)
			}
		}
	}

	const handleFinish = async () => {
		if (!createdProviderId) return

		if (selectedServices.length === 0) {
			// No services selected, just navigate to detail page
			void navigate(`/admin/industry-providers/${createdProviderId}`)
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
					error: error instanceof Error ? error.message : t('industry.failedToAddService'),
				})
			}
		}

		setServiceCreationResults(results)
		setCreationStatus('complete')

		// Wait a bit then navigate
		setTimeout(() => {
			void navigate(`/admin/industry-providers/${createdProviderId}`)
		}, 2000)
	}

	const handleSkipServices = () => {
		if (createdProviderId) {
			void navigate(`/admin/industry-providers/${createdProviderId}`)
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
					<ArrowLeft className="h-4 w-4" />
					{t('industry.back')}
				</Button>
				<div>
					<h1 className="text-3xl font-bold gradient-text">{t('industry.createProvider')}</h1>
					<p className="text-muted-foreground mt-1">{t('industry.setUpANewServiceProvider')}</p>
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
						<CardTitle>{t('industry.providerDetails')}</CardTitle>
						<CardDescription>
							{t('industry.enterTheBasicInformationForTheNewServiceProvider')}
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
								{t('industry.cancel')}
							</Button>
							<Button onClick={handleNextStep} disabled={isProcessing}>
								{creationStatus === 'creating-provider' ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin" />
										{t('industry.creating')}
									</>
								) : (
									<>
										{t('industry.next')}
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
						<CardTitle>{t('industry.addServices')}</CardTitle>
						<CardDescription>
							{t('industry.selectTheServicesThisProviderWillOfferYouCanAdd')}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{creationStatus === 'complete' && (
							<div className="mb-6 p-4 rounded-lg border border-primary bg-primary/10">
								<div className="flex items-center gap-2 text-primary font-medium mb-2">
									<Check className="h-5 w-5" />
									{t('industry.providerCreatedSuccessfully')}
								</div>
								{serviceCreationResults.length > 0 && (
									<div className="space-y-1 text-sm">
										{serviceCreationResults.map((result) => (
											<div
												key={result.type}
												className={result.success ? 'text-green-500' : 'text-destructive'}
											>
												{result.success ? '✓' : '✗'} {SERVICE_TYPE_LABELS[result.type]}
												{result.error && ` - ${result.error}`}
											</div>
										))}
									</div>
								)}
								<p className="text-sm text-muted-foreground mt-2">
									{t('industry.redirectingToProviderDetails')}
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
										{t('industry.skipForNow')}
									</Button>
									<Button onClick={handleFinish} disabled={isProcessing}>
										{creationStatus === 'adding-services' ? (
											<>
												<Loader2 className="h-4 w-4 animate-spin" />
												{t('industry.addingServices')}
											</>
										) : (
											<>
												<Check className="h-4 w-4" />
												{selectedServices.length > 0
													? t('industry.finishValue1Services', { value1: selectedServices.length })
													: t('industry.finish')}
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
