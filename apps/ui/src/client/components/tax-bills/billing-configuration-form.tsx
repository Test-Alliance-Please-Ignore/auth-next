import { CorporationSearchSelect } from '@/components/corporation-search-select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import type { TaxBillingPayeeType } from '@repo/corporation-tax'
import { Button } from '@/components/ui/button'

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
	searchBillingCorporationPayees: (query: string) => Promise<Array<{ corporationId: string; name: string | null }>>
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
	return (
		<>
			<div className="grid gap-3 md:grid-cols-2">
				<div className="space-y-2">
					<Label>
						Payee Type <span className="text-destructive">*</span>
					</Label>
					<Select
						value={billingPayeeTypeInput}
						onValueChange={(value) => {
							const nextType = value as TaxBillingPayeeType
							onValidationErrorChange(null)
							onBillingPayeeTypeChange(nextType)
						}}
						options={[
							{ value: 'character', label: 'Character' },
							{ value: 'corporation', label: 'Corporation' },
						]}
						placeholder="Select payee type"
					/>
				</div>
				<div className="space-y-2">
					<Label>
						{billingPayeeTypeInput === 'character'
							? 'Character'
							: billingPayeeTypeInput === 'corporation'
								? 'Corporation'
								: 'Payee'}{' '}
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
							placeholder="Character name or ID"
							loading={
								billingCharacterSearchInput.trim().length >= 2 &&
								billingCharacterSearchLoading
							}
							queryHintText="Type at least 2 characters"
							loadingText="Searching characters..."
							emptyText="No matching characters found"
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
							placeholder="Corporation name or ID"
							searchCorporations={searchBillingCorporationPayees}
						/>
					) : (
						<Input value="" disabled placeholder="Select payee type first" />
					)}
				</div>
				<div className="space-y-2">
					<Label>Issuer User ID (optional)</Label>
					<Input
						value={billingIssuerUserIdInput}
						onChange={(event) => onBillingIssuerUserIdChange(event.target.value)}
						placeholder="Defaults to acting user"
					/>
				</div>
				<div className="space-y-2">
					<Label>
						Due Days <span className="text-destructive">*</span>
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
							Due days is required and must be an integer between 1 and 90.
						</div>
					) : null}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-6">
				<div className="flex items-center gap-2">
					<Switch checked={billingEnabledInput} onCheckedChange={onBillingEnabledChange} />
					<Label>Billing enabled</Label>
				</div>
				<div className="flex items-center gap-2">
					<Switch
						checked={isCreatingFirstBillingConfig ? true : billingIsDefaultInput}
						disabled={isCreatingFirstBillingConfig}
						onCheckedChange={onBillingIsDefaultChange}
					/>
					<Label>Set as default payee</Label>
				</div>
			</div>
			{billingConfigValidationError ? (
				<div className="text-xs text-destructive">{billingConfigValidationError}</div>
			) : null}
			{isCreatingFirstBillingConfig ? (
				<div className="text-xs text-muted-foreground">
					First billing config for this corporation is automatically set as default.
				</div>
			) : null}
			<div className="flex items-center justify-end gap-2">
				<Button variant="cancel" showIcon={false} onClick={onCancel}>
					Cancel
				</Button>
				<Button variant="primary"
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
							? 'Saving...'
							: 'Save Changes'
						: isCreatePending
							? 'Creating...'
							: 'Save Config'}
				</Button>
			</div>
		</>
	)
}
