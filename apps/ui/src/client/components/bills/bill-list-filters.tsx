import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { FilterField } from '@/components/ui/filter-field'
import { GhostButton } from '@/components/ui/ghost-button'
import { SearchSelect } from '@/components/ui/search-select'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'

import type { BillStatus, EntityType } from '@repo/bills'
import type { SearchSelectOption } from '@/components/ui/search-select'

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
	issuerOptions?: SearchSelectOption[]
	payerOptions: SearchSelectOption[]
	payeeOptions: SearchSelectOption[]
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
						>
							<SelectTrigger>
								<SelectValue placeholder="All statuses" />
							</SelectTrigger>
							<SelectContent>
								{STATUS_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FilterField>
					<FilterField label="Payer Type">
						<Select
							value={props.payerType ?? 'all'}
							onValueChange={(value) =>
								props.onPayerTypeChange(value === 'all' ? undefined : (value as EntityType))
							}
						>
							<SelectTrigger>
								<SelectValue placeholder="All types" />
							</SelectTrigger>
							<SelectContent>
								{ENTITY_TYPE_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FilterField>
					<FilterField label="Payee Type">
						<Select
							value={props.payeeType ?? 'all'}
							onValueChange={(value) =>
								props.onPayeeTypeChange(value === 'all' ? undefined : (value as EntityType))
							}
						>
							<SelectTrigger>
								<SelectValue placeholder="All types" />
							</SelectTrigger>
							<SelectContent>
								{PAYEE_TYPE_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
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
						<SearchSelect
							value={props.payerQuery}
							onValueChange={props.setPayerQuery}
							options={props.payerOptions}
							onSelect={(option) => {
								props.onPayerIdChange(option.value)
								props.setPayerQuery(option.label)
							}}
							loading={props.payerLoading}
							placeholder="Search payer name or ID"
							minCharsText="Type at least 2 characters"
							emptyText="No payer matches"
						/>
					</div>
					<div>
						<label className="text-sm text-muted-foreground">Payee</label>
						<SearchSelect
							value={props.payeeQuery}
							onValueChange={props.setPayeeQuery}
							options={props.payeeOptions}
							onSelect={(option) => {
								props.onPayeeIdChange(option.value)
								props.setPayeeQuery(option.label)
							}}
							loading={props.payeeLoading}
							placeholder="Search payee name or ID"
							minCharsText="Type at least 2 characters"
							emptyText="No payee matches"
						/>
					</div>
					{props.onIssuerIdChange && props.setIssuerQuery ? (
						<div>
							<label className="text-sm text-muted-foreground">Issuer</label>
							<SearchSelect
								value={props.issuerQuery ?? ''}
								onValueChange={props.setIssuerQuery}
								options={props.issuerOptions ?? []}
								onSelect={(option) => {
									props.onIssuerIdChange?.(option.value)
									props.setIssuerQuery?.(option.label)
								}}
								loading={props.issuerLoading}
								placeholder="Search issuer name or user ID"
								minCharsText="Type at least 2 characters"
								emptyText="No issuer matches"
							/>
						</div>
					) : null}
					<div className="flex items-end justify-end">
						<GhostButton onClick={props.onReset}>Reset Filters</GhostButton>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
