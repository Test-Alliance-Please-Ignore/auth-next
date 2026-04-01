import { Layers, LayoutList } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { FilterField } from '@/components/ui/filter-field'
import { GhostButton } from '@/components/ui/ghost-button'
import { Select } from '@/components/ui/select'

import type { BillStatus, EntityType } from '@repo/bills'
import type { SelectOption } from '@/components/ui/select'

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'draft', label: 'Draft' },
	{ value: 'issued', label: 'Issued' },
	{ value: 'paid', label: 'Paid' },
	{ value: 'cancelled', label: 'Cancelled' },
	{ value: 'overdue', label: 'Overdue' },
]

const ENTITY_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: 'all', label: 'All types' },
	{ value: 'character', label: 'Character' },
	{ value: 'corporation', label: 'Corporation' },
	{ value: 'group', label: 'Group' },
]

const PAYEE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: 'all', label: 'All types' },
	{ value: 'character', label: 'Character' },
	{ value: 'corporation', label: 'Corporation' },
]

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
	payeeLoading?: boolean
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
	return (
		<Card>
			<CardHeader>
				<CardTitle>Filters</CardTitle>
				<CardDescription>
					Filter bills by status, parties, types, and due-date range.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
					<FilterField label="Status">
						<Select
							value={props.status ?? 'all'}
							onValueChange={(value) =>
								props.onStatusChange(value === 'all' ? undefined : (value as BillStatus))
							}
							options={STATUS_OPTIONS.map((option) => ({ value: option.value,
								label: option.label,
							}))}
							placeholder="All statuses"
						/>
					</FilterField>
					<FilterField label="Payer Type">
						<Select
							value={props.payerType ?? 'all'}
							onValueChange={(value) =>
								props.onPayerTypeChange(value === 'all' ? undefined : (value as EntityType))
							}
							options={ENTITY_TYPE_OPTIONS.map((option) => ({ value: option.value,
								label: option.label,
							}))}
							placeholder="All types"
						/>
					</FilterField>
					<FilterField label="Payee Type">
						<Select
							value={props.payeeType ?? 'all'}
							onValueChange={(value) =>
								props.onPayeeTypeChange(value === 'all' ? undefined : (value as EntityType))
							}
							options={PAYEE_TYPE_OPTIONS.map((option) => ({ value: option.value,
								label: option.label,
							}))}
							placeholder="All types"
						/>
					</FilterField>
					<FilterField label="Due Date Range">
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
						<label className="text-sm text-muted-foreground">Payer</label>
						<Select
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
							placeholder="Search payer name or ID"
							queryHintText="Type at least 2 characters"
							minQueryLength={2}
							debounceMs={0}
							emptyText="No payer matches"
						/>
					</div>
					<div>
						<label className="text-sm text-muted-foreground">Payee</label>
						<Select
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
							placeholder="Search payee name or ID"
							queryHintText="Type at least 2 characters"
							minQueryLength={2}
							debounceMs={0}
							emptyText="No payee matches"
						/>
					</div>
					{props.onIssuerIdChange && props.setIssuerQuery ? (
						<div>
							<label className="text-sm text-muted-foreground">Issuer</label>
							<Select
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
								placeholder="Search issuer name or user ID"
								queryHintText="Type at least 2 characters"
								minQueryLength={2}
								debounceMs={0}
								emptyText="No issuer matches"
							/>
						</div>
					) : null}
					<div className="flex items-end justify-end gap-2">
						{props.onCoalescedToggle && props.hasGroupBills !== false && (
							<GhostButton
								onClick={props.onCoalescedToggle}
								title={
									props.coalesced
										? 'Show individual sub-bills'
										: 'Show coalesced group rows'
								}
							>
								{props.coalesced ? (
									<>
										<LayoutList className="mr-2 h-4 w-4" />
										Uncoalesced
									</>
								) : (
									<>
										<Layers className="mr-2 h-4 w-4" />
										Coalesced
									</>
								)}
							</GhostButton>
						)}
						<GhostButton onClick={props.onReset}>Reset Filters</GhostButton>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
