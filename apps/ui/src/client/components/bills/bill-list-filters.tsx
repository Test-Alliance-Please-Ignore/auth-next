import { Layers, LayoutList } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { FilterField } from '@/components/ui/filter-field'
import { Select } from '@/components/ui/select'
import { useAppTranslation } from '@/i18n'
import { formatBillStatus, formatEntityType } from '@/lib/bills-utils'

import type { BillStatus, EntityType } from '@repo/bills'
import type { SelectOption } from '@/components/ui/select'

export function BillListFilters(props: {
	status?: BillStatus
	payerType?: EntityType
	payeeType?: EntityType
	issuerId?: string
	issuerQuery?: string
	setIssuerQuery?: (value: string) => void
	payerId?: string
	payerQuery: string
	setPayerQuery: (value: string) => void
	payeeId?: string
	payeeQuery: string
	setPayeeQuery: (value: string) => void
	dueAfter?: string
	dueBefore?: string
	issuerOptions?: SelectOption[]
	payerOptions: SelectOption[]
	payeeOptions: SelectOption[]
	issuerLoading?: boolean
	payerLoading?: boolean
	payerError?: boolean
	payeeLoading?: boolean
	payeeError?: boolean
	onStatusChange: (value?: BillStatus) => void
	onPayerTypeChange: (value?: EntityType) => void
	onPayeeTypeChange: (value?: EntityType) => void
	onIssuerIdChange?: (value?: string) => void
	onPayerIdChange: (value?: string) => void
	onPayeeIdChange: (value?: string) => void
	onDateRangeChange: (fromDate: string, toDate: string) => void
	onReset: () => void
	coalesced?: boolean
	hasGroupBills?: boolean
	onCoalescedToggle?: () => void
}) {
	const { t } = useAppTranslation()
	const id = useId()
	const statusOptions = [
		{ value: 'all', label: t('bills.filters.allStatuses') },
		...(['draft', 'issued', 'paid', 'cancelled', 'overdue'] as const).map((value) => ({
			value,
			label: formatBillStatus(value),
		})),
	]
	const entityOptions = [
		{ value: 'all', label: t('bills.filters.allTypes') },
		...(['character', 'corporation', 'group'] as const).map((value) => ({
			value,
			label: formatEntityType(value),
		})),
	]
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('bills.filters.title')}</CardTitle>
				<CardDescription>{t('bills.filters.description')}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
					<FilterField label={t('bills.columns.status')}>
						<label className="sr-only" htmlFor={`${id}-status`}>
							{t('bills.columns.status')}
						</label>
						<Select
							inputId={`${id}-status`}
							value={props.status ?? 'all'}
							onValueChange={(value) =>
								props.onStatusChange(value === 'all' ? undefined : (value as BillStatus))
							}
							options={statusOptions.map((option) => ({
								value: option.value,
								label: option.label,
							}))}
							placeholder={t('bills.filters.allStatuses')}
						/>
					</FilterField>
					<FilterField label={t('bills.filters.payerType')}>
						<label className="sr-only" htmlFor={`${id}-payerType`}>
							{t('bills.filters.payerType')}
						</label>
						<Select
							inputId={`${id}-payerType`}
							value={props.payerType ?? 'all'}
							onValueChange={(value) =>
								props.onPayerTypeChange(value === 'all' ? undefined : (value as EntityType))
							}
							options={entityOptions.map((option) => ({
								value: option.value,
								label: option.label,
							}))}
							placeholder={t('bills.filters.allTypes')}
						/>
					</FilterField>
					<FilterField label={t('bills.filters.payeeType')}>
						<label className="sr-only" htmlFor={`${id}-payeeType`}>
							{t('bills.filters.payeeType')}
						</label>
						<Select
							inputId={`${id}-payeeType`}
							value={props.payeeType ?? 'all'}
							onValueChange={(value) =>
								props.onPayeeTypeChange(value === 'all' ? undefined : (value as EntityType))
							}
							options={entityOptions
								.filter((option) => option.value !== 'group')
								.map((option) => ({ value: option.value, label: option.label }))}
							placeholder={t('bills.filters.allTypes')}
						/>
					</FilterField>
					<FilterField label={t('bills.filters.dueRange')}>
						<DateRangeInput
							value={{
								fromDate: props.dueAfter ?? '',
								toDate: props.dueBefore ?? '',
							}}
							onChange={(nextValue) =>
								props.onDateRangeChange(nextValue.fromDate, nextValue.toDate)
							}
						/>
					</FilterField>
				</div>
				<div
					className={`grid grid-cols-1 gap-4 ${
						props.onIssuerIdChange ? 'md:grid-cols-[3fr_3fr_3fr_1fr]' : 'md:grid-cols-[4fr_4fr_2fr]'
					}`}
				>
					<div>
						<label htmlFor={`${id}-payer`} className="text-sm text-muted-foreground">
							{t('bills.columns.payer')}
						</label>
						<Select
							inputId={`${id}-payer`}
							value={props.payerId ?? ''}
							onValueChange={(nextValue) => {
								props.onPayerIdChange(nextValue || undefined)
							}}
							query={props.payerQuery}
							onQueryChange={props.setPayerQuery}
							searchable
							searchDelegate={() => props.payerOptions}
							options={props.payerOptions}
							loading={props.payerLoading}
							placeholder={t('bills.filters.payerSearch')}
							queryHintText={t('bills.filters.queryHint')}
							minQueryLength={2}
							debounceMs={0}
							emptyText={t('bills.filters.payerEmpty')}
						/>
						{props.payerError && (
							<p role="alert" className="text-sm text-destructive">
								{t('bills.filters.payerFailed')}
							</p>
						)}
					</div>
					<div>
						<label htmlFor={`${id}-payee`} className="text-sm text-muted-foreground">
							{t('bills.columns.payee')}
						</label>
						<Select
							inputId={`${id}-payee`}
							value={props.payeeId ?? ''}
							onValueChange={(nextValue) => {
								props.onPayeeIdChange(nextValue || undefined)
							}}
							query={props.payeeQuery}
							onQueryChange={props.setPayeeQuery}
							searchable
							searchDelegate={() => props.payeeOptions}
							options={props.payeeOptions}
							loading={props.payeeLoading}
							placeholder={t('bills.filters.payeeSearch')}
							queryHintText={t('bills.filters.queryHint')}
							minQueryLength={2}
							debounceMs={0}
							emptyText={t('bills.filters.payeeEmpty')}
						/>
						{props.payeeError && (
							<p role="alert" className="text-sm text-destructive">
								{t('bills.filters.payeeFailed')}
							</p>
						)}
					</div>
					{props.onIssuerIdChange && props.setIssuerQuery ? (
						<div>
							<label htmlFor={`${id}-issuer`} className="text-sm text-muted-foreground">
								{t('bills.columns.issuer')}
							</label>
							<Select
								inputId={`${id}-issuer`}
								value={props.issuerId ?? ''}
								onValueChange={(nextValue) => {
									props.onIssuerIdChange?.(nextValue || undefined)
								}}
								query={props.issuerQuery ?? ''}
								onQueryChange={props.setIssuerQuery}
								searchable
								searchDelegate={() => props.issuerOptions ?? []}
								options={props.issuerOptions ?? []}
								loading={props.issuerLoading}
								placeholder={t('bills.filters.issuerSearch')}
								queryHintText={t('bills.filters.queryHint')}
								minQueryLength={2}
								debounceMs={0}
								emptyText={t('bills.filters.issuerEmpty')}
							/>
						</div>
					) : null}
					<div className="flex items-end justify-end gap-2">
						{props.onCoalescedToggle && props.hasGroupBills !== false && (
							<Button
								variant="ghost"
								onClick={props.onCoalescedToggle}
								title={
									props.coalesced
										? t('bills.filters.showIndividual')
										: t('bills.filters.showGrouped')
								}
							>
								{props.coalesced ? (
									<>
										<LayoutList className="h-4 w-4" />
										{t('bills.filters.individual')}
									</>
								) : (
									<>
										<Layers className="h-4 w-4" />
										{t('bills.filters.grouped')}
									</>
								)}
							</Button>
						)}
						<Button variant="ghost" onClick={props.onReset}>
							{t('bills.filters.reset')}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
