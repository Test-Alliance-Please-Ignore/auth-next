import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PrimaryButton } from '@/components/ui/primary-button'
import {
	useCreateTaxBillingConfig,
	useDeleteTaxBillingConfig,
	useSearchTaxBillingPayeeCharacters,
	useSearchTaxBillingPayeeCorporations,
	useSetDefaultTaxBillingConfig,
	useTaxBillingConfigs,
	useUpdateTaxBillingConfig,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'

import { BillingConfigurationForm } from './billing-configuration-form'
import { BillingConfigurationTable } from './billing-configuration-table'

import type { TaxBillingPayeeType, TaxCorporationBillingConfig } from '@repo/corporation-tax'

type BillingConfigurationCardProps = {
	effectiveCorporationId: string | undefined
	canIssue: boolean
	canView: boolean
}

export function BillingConfigurationCard({
	effectiveCorporationId,
	canIssue,
	canView,
}: BillingConfigurationCardProps) {
	const [editingBillingConfigId, setEditingBillingConfigId] = useState<string | null>(null)
	const [billingEnabledInput, setBillingEnabledInput] = useState(false)
	const [billingIssuerUserIdInput, setBillingIssuerUserIdInput] = useState('')
	const [billingPayeeIdInput, setBillingPayeeIdInput] = useState('')
	const [billingCharacterSearchInput, setBillingCharacterSearchInput] = useState('')
	const [billingCharacterSearchDebounced, setBillingCharacterSearchDebounced] = useState('')
	const [billingCorporationSearchInput, setBillingCorporationSearchInput] = useState('')
	const [billingCorporationSearchDebounced, setBillingCorporationSearchDebounced] = useState('')
	const [billingPayeeTypeInput, setBillingPayeeTypeInput] = useState<TaxBillingPayeeType>()
	const [billingDueDaysInput, setBillingDueDaysInput] = useState('14')
	const [billingIsDefaultInput, setBillingIsDefaultInput] = useState(false)
	const [billingConfigValidationError, setBillingConfigValidationError] = useState<string | null>(
		null
	)
	const [showBillingConfigForm, setShowBillingConfigForm] = useState(false)

	const {
		data: billingConfigs = [],
		isLoading: billingConfigsLoading,
		error: billingConfigsError,
	} = useTaxBillingConfigs(effectiveCorporationId, canView)

	const createBillingConfigMutation = useCreateTaxBillingConfig()
	const updateBillingConfigMutation = useUpdateTaxBillingConfig()
	const deleteBillingConfigMutation = useDeleteTaxBillingConfig()
	const setDefaultBillingConfigMutation = useSetDefaultTaxBillingConfig()

	const payeeEntityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const config of billingConfigs) {
			if (config.billingPayeeId) ids.add(config.billingPayeeId)
		}
		return [...ids]
	}, [billingConfigs])
	const { data: entityNames = {} } = useEntityNames(payeeEntityIds, { enabled: canView })

	const { data: billingCharacterSearchResults = [], isLoading: billingCharacterSearchLoading } =
		useSearchTaxBillingPayeeCharacters(
			effectiveCorporationId,
			billingCharacterSearchDebounced,
			billingPayeeTypeInput === 'character'
		)
	const { data: billingCorporationSearchResults = [], isLoading: billingCorporationSearchLoading } =
		useSearchTaxBillingPayeeCorporations(
			effectiveCorporationId,
			billingCorporationSearchDebounced,
			billingPayeeTypeInput === 'corporation'
		)

	useEffect(() => {
		if (billingPayeeTypeInput !== 'character') {
			setBillingCharacterSearchDebounced('')
			return
		}
		const timer = setTimeout(() => {
			setBillingCharacterSearchDebounced(billingCharacterSearchInput.trim())
		}, 300)
		return () => clearTimeout(timer)
	}, [billingCharacterSearchInput, billingPayeeTypeInput])

	useEffect(() => {
		if (billingPayeeTypeInput !== 'corporation') {
			setBillingCorporationSearchDebounced('')
			return
		}
		const timer = setTimeout(() => {
			setBillingCorporationSearchDebounced(billingCorporationSearchInput.trim())
		}, 300)
		return () => clearTimeout(timer)
	}, [billingCorporationSearchInput, billingPayeeTypeInput])

	const isCreatingFirstBillingConfig =
		showBillingConfigForm &&
		!editingBillingConfigId &&
		Boolean(effectiveCorporationId) &&
		billingConfigs.length === 0
	const parsedBillingDueDays = Number.parseInt(billingDueDaysInput, 10)
	const isBillingDueDaysValid =
		billingDueDaysInput.trim().length > 0 &&
		Number.isInteger(parsedBillingDueDays) &&
		parsedBillingDueDays >= 1 &&
		parsedBillingDueDays <= 90
	const isBillingPayeeSelectionValid = Boolean(
		billingPayeeTypeInput && billingPayeeIdInput.trim().length > 0
	)

	useEffect(() => {
		if (isCreatingFirstBillingConfig) {
			setBillingIsDefaultInput(true)
		}
	}, [isCreatingFirstBillingConfig])

	const resetBillingConfigForm = () => {
		setEditingBillingConfigId(null)
		setShowBillingConfigForm(false)
		setBillingEnabledInput(false)
		setBillingIssuerUserIdInput('')
		setBillingPayeeIdInput('')
		setBillingCharacterSearchInput('')
		setBillingCharacterSearchDebounced('')
		setBillingCorporationSearchInput('')
		setBillingCorporationSearchDebounced('')
		setBillingPayeeTypeInput(undefined)
		setBillingDueDaysInput('14')
		setBillingIsDefaultInput(false)
		setBillingConfigValidationError(null)
	}

	const beginEditConfig = (config: TaxCorporationBillingConfig) => {
		setBillingConfigValidationError(null)
		setShowBillingConfigForm(true)
		setEditingBillingConfigId(config.id)
		setBillingEnabledInput(config.billingEnabled)
		setBillingIssuerUserIdInput(config.billingIssuerUserId)
		setBillingPayeeIdInput(config.billingPayeeId)
		setBillingCharacterSearchInput(
			config.billingPayeeType === 'character'
				? (entityNames[config.billingPayeeId] ?? config.billingPayeeId)
				: ''
		)
		setBillingCorporationSearchInput(
			config.billingPayeeType === 'corporation'
				? (entityNames[config.billingPayeeId] ?? config.billingPayeeId)
				: ''
		)
		setBillingPayeeTypeInput(config.billingPayeeType)
		setBillingDueDaysInput(String(config.billingDueDays))
		setBillingIsDefaultInput(config.isDefault)
	}

	const submitBillingConfig = () => {
		if (!effectiveCorporationId) return
		if (!billingPayeeTypeInput) {
			setBillingConfigValidationError('Payee type is required.')
			return
		}
		if (!billingPayeeIdInput.trim()) {
			setBillingConfigValidationError(
				billingPayeeTypeInput === 'character'
					? 'Please select a character payee.'
					: 'Please select a corporation payee.'
			)
			return
		}
		if (!isBillingDueDaysValid) {
			setBillingConfigValidationError(
				'Due days is required and must be an integer between 1 and 90.'
			)
			return
		}
		setBillingConfigValidationError(null)

		const payload = {
			isDefault: isCreatingFirstBillingConfig ? true : billingIsDefaultInput,
			billingEnabled: billingEnabledInput,
			billingIssuerUserId: billingIssuerUserIdInput,
			billingPayeeId: billingPayeeIdInput,
			billingPayeeType: billingPayeeTypeInput,
			billingDueDays: parsedBillingDueDays,
		}

		if (editingBillingConfigId) {
			updateBillingConfigMutation.mutate(
				{
					corporationId: effectiveCorporationId,
					configId: editingBillingConfigId,
					updates: payload,
				},
				{ onSuccess: () => resetBillingConfigForm() }
			)
			return
		}
		createBillingConfigMutation.mutate(
			{
				corporationId: effectiveCorporationId,
				config: payload,
			},
			{ onSuccess: () => resetBillingConfigForm() }
		)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Billing Configuration</CardTitle>
				<CardDescription>
					Configure issuer, payee, due days, and default billing profile for the selected
					corporation.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{!effectiveCorporationId ? (
					<div className="text-sm text-muted-foreground">
						Select a corporation to configure billing.
					</div>
				) : (
					<>
						<BillingConfigurationTable
							canIssue={canIssue}
							billingConfigs={billingConfigs}
							loading={billingConfigsLoading}
							error={billingConfigsError}
							entityNames={entityNames}
							actionsDisabled={
								!canIssue ||
								setDefaultBillingConfigMutation.isPending ||
								deleteBillingConfigMutation.isPending
							}
							onEdit={beginEditConfig}
							onSetDefault={(configId) =>
								setDefaultBillingConfigMutation.mutate({
									corporationId: effectiveCorporationId,
									configId,
								})
							}
							onDelete={(configId) =>
								deleteBillingConfigMutation.mutate({
									corporationId: effectiveCorporationId,
									configId,
								})
							}
						/>

						{canIssue && !showBillingConfigForm ? (
							<div className="flex justify-center pt-2">
								<PrimaryButton
									className="min-w-44"
									onClick={() => {
										resetBillingConfigForm()
										setShowBillingConfigForm(true)
									}}
								>
									<Plus className="mr-2 h-4 w-4" />
									Add Config
								</PrimaryButton>
							</div>
						) : null}

						{canIssue && showBillingConfigForm ? (
							<BillingConfigurationForm
								editingBillingConfigId={editingBillingConfigId}
								billingEnabledInput={billingEnabledInput}
								billingIssuerUserIdInput={billingIssuerUserIdInput}
								billingCharacterSearchInput={billingCharacterSearchInput}
								billingCharacterSearchDebounced={billingCharacterSearchDebounced}
								billingCorporationSearchInput={billingCorporationSearchInput}
								billingCorporationSearchDebounced={billingCorporationSearchDebounced}
								billingPayeeTypeInput={billingPayeeTypeInput}
								billingPayeeIdInput={billingPayeeIdInput}
								billingDueDaysInput={billingDueDaysInput}
								billingIsDefaultInput={billingIsDefaultInput}
								billingConfigValidationError={billingConfigValidationError}
								isCreatingFirstBillingConfig={isCreatingFirstBillingConfig}
								isBillingDueDaysValid={isBillingDueDaysValid}
								isBillingPayeeSelectionValid={isBillingPayeeSelectionValid}
								billingCharacterSearchLoading={billingCharacterSearchLoading}
								billingCorporationSearchLoading={billingCorporationSearchLoading}
								billingCharacterSearchResults={billingCharacterSearchResults.map((character) => ({
									id: character.characterId,
									value: character.characterId,
									label: character.characterName,
									description: character.characterId,
								}))}
								billingCorporationSearchResults={billingCorporationSearchResults.map(
									(corporation) => ({
										id: corporation.corporationId,
										value: corporation.corporationId,
										label: corporation.name ?? corporation.corporationId,
										description: corporation.corporationId,
									})
								)}
								isCreatePending={createBillingConfigMutation.isPending}
								isUpdatePending={updateBillingConfigMutation.isPending}
								canIssue={canIssue && Boolean(effectiveCorporationId)}
								onBillingEnabledChange={setBillingEnabledInput}
								onBillingIssuerUserIdChange={setBillingIssuerUserIdInput}
								onBillingPayeeTypeChange={(value) => {
									setBillingPayeeTypeInput(value)
									if (value !== 'character') {
										setBillingCharacterSearchInput('')
									}
									if (value !== 'corporation') {
										setBillingCorporationSearchInput('')
									}
									setBillingPayeeIdInput('')
								}}
								onBillingCharacterSearchInputChange={setBillingCharacterSearchInput}
								onBillingCorporationSearchInputChange={setBillingCorporationSearchInput}
								onBillingPayeeIdChange={setBillingPayeeIdInput}
								onBillingDueDaysChange={setBillingDueDaysInput}
								onBillingIsDefaultChange={setBillingIsDefaultInput}
								onValidationErrorChange={setBillingConfigValidationError}
								onCancel={resetBillingConfigForm}
								onSubmit={submitBillingConfig}
							/>
						) : null}

						{createBillingConfigMutation.error ||
						updateBillingConfigMutation.error ||
						deleteBillingConfigMutation.error ||
						setDefaultBillingConfigMutation.error ? (
							<div className="text-sm text-destructive">
								{(createBillingConfigMutation.error ||
									updateBillingConfigMutation.error ||
									deleteBillingConfigMutation.error ||
									setDefaultBillingConfigMutation.error) instanceof Error
									? (
											createBillingConfigMutation.error ||
											updateBillingConfigMutation.error ||
											deleteBillingConfigMutation.error ||
											setDefaultBillingConfigMutation.error
										)?.message
									: 'Billing configuration update failed'}
							</div>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	)
}
