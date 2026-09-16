import { CorporationSearchSelect } from '@/components/corporation-search-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAppTranslation } from '@/i18n'

import type { TaxBillingPayeeType } from '@repo/corporation-tax'

type BillingPayeeSearchResult = {
	value: string
	label: string
	description: string
}

type BillingConfigurationFormProps = {
	editingBillingConfigId: string | null
	billingEnabledInput: boolean
	billingIssuerUserIdInput: string
	billingCharacterSearchInput: string
	billingCorporationSearchInput: string
	billingPayeeTypeInput: TaxBillingPayeeType | undefined
	billingPayeeIdInput: string
	billingDueDaysInput: string
	billingIsDefaultInput: boolean
	billingConfigValidationError: string | null
	isCreatingFirstBillingConfig: boolean
	isBillingDueDaysValid: boolean
	isBillingPayeeSelectionValid: boolean
	billingCharacterSearchLoading: boolean
	billingCharacterSearchResults: BillingPayeeSearchResult[]
	searchBillingCorporationPayees: (
		query: string
	) => Promise<Array<{ corporationId: string; name: string | null }>>
	isCreatePending: boolean
	isUpdatePending: boolean
	canIssue: boolean
	onBillingEnabledChange: (value: boolean) => void
	onBillingIssuerUserIdChange: (value: string) => void
	onBillingPayeeTypeChange: (value: TaxBillingPayeeType) => void
	onBillingCharacterSearchInputChange: (value: string) => void
	onBillingCorporationSearchInputChange: (value: string) => void
	onBillingPayeeIdChange: (value: string) => void
	onBillingDueDaysChange: (value: string) => void
	onBillingIsDefaultChange: (value: boolean) => void
	onValidationErrorChange: (value: string | null) => void
	onCancel: () => void
	onSubmit: () => void
}

export function BillingConfigurationForm({
	editingBillingConfigId,
	billingEnabledInput,
	billingIssuerUserIdInput,
	billingCharacterSearchInput,
	billingCorporationSearchInput,
	billingPayeeTypeInput,
	billingPayeeIdInput,
	billingDueDaysInput,
	billingIsDefaultInput,
	billingConfigValidationError,
	isCreatingFirstBillingConfig,
	isBillingDueDaysValid,
	isBillingPayeeSelectionValid,
	billingCharacterSearchLoading,
	billingCharacterSearchResults,
	searchBillingCorporationPayees,
	isCreatePending,
	isUpdatePending,
	canIssue,
	onBillingEnabledChange,
	onBillingIssuerUserIdChange,
	onBillingPayeeTypeChange,
	onBillingCharacterSearchInputChange,
	onBillingCorporationSearchInputChange,
	onBillingPayeeIdChange,
	onBillingDueDaysChange,
	onBillingIsDefaultChange,
	onValidationErrorChange,
	onCancel,
	onSubmit,
}: BillingConfigurationFormProps) {
	const { t } = useAppTranslation()

	return (
		<>
			<div className="grid gap-3 md:grid-cols-2">
				<div className="space-y-2">
					<Label>
						{t('tax.payeeType')}
						<span className="text-destructive">*</span>
					</Label>
					<Select
						value={billingPayeeTypeInput}
						onValueChange={(value) => {
							const nextType = value as TaxBillingPayeeType
							onValidationErrorChange(null)
							onBillingPayeeTypeChange(nextType)
						}}
						options={[
							{ value: 'character', label: t('tax.character') },
							{ value: 'corporation', label: t('tax.corporation') },
						]}
						placeholder={t('tax.selectPayeeType')}
					/>
				</div>
				<div className="space-y-2">
					<Label>
						{billingPayeeTypeInput === 'character'
							? t('tax.character')
							: billingPayeeTypeInput === 'corporation'
								? t('tax.corporation')
								: t('tax.payee')}{' '}
						<span className="text-destructive">*</span>
					</Label>
					{billingPayeeTypeInput === 'character' ? (
						<Select
							value={billingPayeeIdInput}
							onValueChange={(nextValue, option) => {
								if (!option) {
									return
								}
								onValidationErrorChange(null)
								onBillingCharacterSearchInputChange(option.label)
								onBillingPayeeIdChange(nextValue)
							}}
							query={billingCharacterSearchInput}
							onQueryChange={(value) => {
								onValidationErrorChange(null)
								onBillingCharacterSearchInputChange(value)
								onBillingPayeeIdChange('')
							}}
							searchable
							searchDelegate={() => billingCharacterSearchResults}
							options={billingCharacterSearchResults}
							minQueryLength={2}
							debounceMs={0}
							placeholder={t('tax.characterNameOrId')}
							loading={
								billingCharacterSearchInput.trim().length >= 2 && billingCharacterSearchLoading
							}
							queryHintText={t('tax.searchHint')}
							loadingText={t('tax.searchingCharacters')}
							emptyText={t('tax.noMatchingCharacters')}
						/>
					) : billingPayeeTypeInput === 'corporation' ? (
						<CorporationSearchSelect
							value={billingPayeeIdInput}
							label={billingCorporationSearchInput || undefined}
							onValueChange={(nextValue, corporationName) => {
								onValidationErrorChange(null)
								onBillingCorporationSearchInputChange(corporationName)
								onBillingPayeeIdChange(nextValue)
							}}
							query={billingCorporationSearchInput}
							onQueryChange={(value) => {
								onValidationErrorChange(null)
								onBillingCorporationSearchInputChange(value)
								onBillingPayeeIdChange('')
							}}
							placeholder={t('tax.corporationNameOrId')}
							searchCorporations={searchBillingCorporationPayees}
						/>
					) : (
						<Input value="" disabled placeholder={t('tax.selectPayeeTypeFirst')} />
					)}
				</div>
				<div className="space-y-2">
					<Label>{t('tax.issuerUserIdOptional')}</Label>
					<Input
						value={billingIssuerUserIdInput}
						onChange={(event) => onBillingIssuerUserIdChange(event.target.value)}
						placeholder={t('tax.defaultsToActingUser')}
					/>
				</div>
				<div className="space-y-2">
					<Label>
						{t('tax.dueDays')}
						<span className="text-destructive">*</span>
					</Label>
					<Input
						type="number"
						min={1}
						max={90}
						required
						value={billingDueDaysInput}
						onChange={(event) => {
							onValidationErrorChange(null)
							onBillingDueDaysChange(event.target.value)
						}}
					/>
					{!isBillingDueDaysValid ? (
						<div className="text-xs text-destructive">
							{t('tax.dueDaysIsRequiredAndMustBeAnIntegerBetween')}
						</div>
					) : null}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-6">
				<div className="flex items-center gap-2">
					<Switch checked={billingEnabledInput} onCheckedChange={onBillingEnabledChange} />
					<Label>{t('tax.billingEnabled')}</Label>
				</div>
				<div className="flex items-center gap-2">
					<Switch
						checked={isCreatingFirstBillingConfig ? true : billingIsDefaultInput}
						disabled={isCreatingFirstBillingConfig}
						onCheckedChange={onBillingIsDefaultChange}
					/>
					<Label>{t('tax.setAsDefaultPayee')}</Label>
				</div>
			</div>
			{billingConfigValidationError ? (
				<div className="text-xs text-destructive">{billingConfigValidationError}</div>
			) : null}
			{isCreatingFirstBillingConfig ? (
				<div className="text-xs text-muted-foreground">
					{t('tax.firstBillingConfigForThisCorporationIsAutomaticallySetAs')}
				</div>
			) : null}
			<div className="flex items-center justify-end gap-2">
				<Button variant="cancel" showIcon={false} onClick={onCancel}>
					{t('tax.cancel')}
				</Button>
				<Button
					variant="primary"
					disabled={
						!canIssue ||
						isCreatePending ||
						isUpdatePending ||
						!isBillingPayeeSelectionValid ||
						!isBillingDueDaysValid
					}
					onClick={onSubmit}
				>
					{editingBillingConfigId
						? isUpdatePending
							? t('tax.saving')
							: t('tax.saveChanges')
						: isCreatePending
							? t('tax.creating')
							: t('tax.saveConfig')}
				</Button>
			</div>
		</>
	)
}
