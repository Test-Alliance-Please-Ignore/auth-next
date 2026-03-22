import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchSelect } from '@/components/ui/search-select'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import type { TaxBillingPayeeType } from '@repo/corporation-tax'

type BillingPayeeSearchResult = {
	id: string
	value: string
	label: string
	description: string
}

type BillingConfigurationFormProps = {
	editingBillingConfigId: string | null
	billingEnabledInput: boolean
	billingIssuerUserIdInput: string
	billingCharacterSearchInput: string
	billingCharacterSearchDebounced: string
	billingCorporationSearchInput: string
	billingCorporationSearchDebounced: string
	billingPayeeTypeInput: TaxBillingPayeeType | undefined
	billingDueDaysInput: string
	billingIsDefaultInput: boolean
	billingConfigValidationError: string | null
	isCreatingFirstBillingConfig: boolean
	isBillingDueDaysValid: boolean
	isBillingPayeeSelectionValid: boolean
	billingCharacterSearchLoading: boolean
	billingCorporationSearchLoading: boolean
	billingCharacterSearchResults: BillingPayeeSearchResult[]
	billingCorporationSearchResults: BillingPayeeSearchResult[]
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
	billingCharacterSearchDebounced,
	billingCorporationSearchInput,
	billingCorporationSearchDebounced,
	billingPayeeTypeInput,
	billingDueDaysInput,
	billingIsDefaultInput,
	billingConfigValidationError,
	isCreatingFirstBillingConfig,
	isBillingDueDaysValid,
	isBillingPayeeSelectionValid,
	billingCharacterSearchLoading,
	billingCorporationSearchLoading,
	billingCharacterSearchResults,
	billingCorporationSearchResults,
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
					>
						<SelectTrigger>
							<SelectValue placeholder="Select payee type" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="character">Character</SelectItem>
							<SelectItem value="corporation">Corporation</SelectItem>
						</SelectContent>
					</Select>
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
						<SearchSelect
							value={billingCharacterSearchInput}
							onValueChange={(value) => {
								onValidationErrorChange(null)
								onBillingCharacterSearchInputChange(value)
								onBillingPayeeIdChange('')
							}}
							options={billingCharacterSearchResults}
							onSelect={(option) => {
								onValidationErrorChange(null)
								onBillingCharacterSearchInputChange(option.label)
								onBillingPayeeIdChange(option.id)
							}}
							filterMode="server"
							minQueryLength={2}
							placeholder="Character name or ID"
							loading={
								billingCharacterSearchInput.trim().length >= 2 &&
								(billingCharacterSearchLoading ||
									billingCharacterSearchInput.trim() !== billingCharacterSearchDebounced)
							}
							minCharsText="Type at least 2 characters"
							loadingText="Searching characters..."
							emptyText="No matching characters found"
						/>
					) : billingPayeeTypeInput === 'corporation' ? (
						<SearchSelect
							value={billingCorporationSearchInput}
							onValueChange={(value) => {
								onValidationErrorChange(null)
								onBillingCorporationSearchInputChange(value)
								onBillingPayeeIdChange('')
							}}
							options={billingCorporationSearchResults}
							onSelect={(option) => {
								onValidationErrorChange(null)
								onBillingCorporationSearchInputChange(option.label)
								onBillingPayeeIdChange(option.id)
							}}
							filterMode="server"
							minQueryLength={2}
							placeholder="Corporation name or ID"
							loading={
								billingCorporationSearchInput.trim().length >= 2 &&
								(billingCorporationSearchLoading ||
									billingCorporationSearchInput.trim() !== billingCorporationSearchDebounced)
							}
							minCharsText="Type at least 2 characters"
							loadingText="Searching corporations..."
							emptyText="No matching corporations found"
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
				<Button variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button
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
