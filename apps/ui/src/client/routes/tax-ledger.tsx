import { useEffect, useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { TaxReportTable } from '@/components/tax-report-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { FilterField } from '@/components/ui/filter-field'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import {
	useTaxCapabilities,
	useTaxLedgerEntries,
	useTaxLedgerParties,
	useTaxWalletDivisions,
} from '@/hooks/corporation-tax'
import { useDebounce } from '@/hooks/useDebounce'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { formatTaxDateTime, getCurrentMonthDateRange } from '@/lib/tax-date'
import {
	formatTaxDivisionLabel,
	formatTaxIskFull,
	formatTaxLedgerSourceTypeLabel,
	formatTaxRefTypeLabel,
	getTaxRefTypeColor,
	TAX_LEDGER_SOURCE_TYPE_OPTIONS,
	TAX_REF_TYPE_OPTIONS,
	TaxEntityDisplay,
} from '@/lib/tax-display'

import type { TaxLedgerEntry } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

const PAGE_SIZE = 50
const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()
const ALL_DIVISIONS_VALUE = '__all_divisions__'
const ALL_INCOME_TYPES_VALUE = '__all_income_types__'
const ALL_DIVISIONS_OPTION = { value: ALL_DIVISIONS_VALUE, label: 'All divisions' } as const
const ALL_INCOME_TYPES_OPTION = {
	value: ALL_INCOME_TYPES_VALUE,
	label: 'All income types',
} as const
const LEDGER_SOURCE_TYPES = new Set([
	'corporation_wallet_journal',
	'corporation_wallet_transaction',
	'character_wallet_journal',
	'character_wallet_transaction',
])

function toStartOfDayIso(dateText: string): string {
	return new Date(`${dateText}T00:00:00.000Z`).toISOString()
}

function toEndOfDayIso(dateText: string): string {
	return new Date(`${dateText}T23:59:59.999Z`).toISOString()
}

function parseCsv(value: string): string[] {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
}

function toSearchOptions(options: Array<{ value: string; label: string }>) {
	return options
}

export default function TaxLedgerPage() {
	usePageTitle('Tax Ledger')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canAdminScope = globalCapabilities?.global.canManage ?? false
	const {
		corporationAccessLoading,
		accessibleCorporations,
		effectiveCorporationId,
		setSelectedCorporationId,
	} = useTaxCorporationAccessScope(false)
	const [page, setPage] = useState(0)
	const [pageSize, setPageSize] = useState(PAGE_SIZE)
	const [sortBy, setSortBy] = useState<
		'entryDate' | 'amount' | 'division' | 'refType' | 'sourceType'
	>('entryDate')
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
	const [fromDate, setFromDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [toDate, setToDate] = useState(DEFAULT_MONTH_RANGE.toDate)
	const [divisionFilter, setDivisionFilter] = useState(ALL_DIVISIONS_VALUE)
	const [divisionQuery, setDivisionQuery] = useState('')
	const [refTypesFilter, setRefTypesFilter] = useState(ALL_INCOME_TYPES_VALUE)
	const [refTypeQuery, setRefTypeQuery] = useState('')
	const [sourceTypesFilter, setSourceTypesFilter] = useState('')
	const [sourceTypeQuery, setSourceTypeQuery] = useState('')
	const [firstPartyIdFilter, setFirstPartyIdFilter] = useState('')
	const [secondPartyIdFilter, setSecondPartyIdFilter] = useState('')
	const [firstPartyQuery, setFirstPartyQuery] = useState('')
	const [secondPartyQuery, setSecondPartyQuery] = useState('')
	const [minAmountFilter, setMinAmountFilter] = useState('')

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canManage ?? false
	const canView = canAdminScope || canViewScoped

	useEffect(() => {
		if (!effectiveCorporationId) {
			setDivisionFilter(ALL_DIVISIONS_VALUE)
			setDivisionQuery('')
		}
	}, [effectiveCorporationId])

	useEffect(() => {
		setDivisionQuery('')
	}, [divisionFilter])

	const { data: walletDivisions = [] } = useTaxWalletDivisions(effectiveCorporationId, canView)

	const divisionOptions = useMemo(
		() => [
			ALL_DIVISIONS_OPTION,
			...walletDivisions.map((division) => ({
				value: String(division),
				label: formatTaxDivisionLabel(division),
			})),
		],
		[walletDivisions]
	)

	const incomeTypeOptions = useMemo(
		() => [ALL_INCOME_TYPES_OPTION, ...toSearchOptions(TAX_REF_TYPE_OPTIONS)],
		[]
	)

	useEffect(() => {
		if (divisionFilter === ALL_DIVISIONS_VALUE) {
			return
		}
		if (!walletDivisions.includes(Number(divisionFilter))) {
			setDivisionFilter(ALL_DIVISIONS_VALUE)
			setDivisionQuery('')
		}
	}, [divisionFilter, walletDivisions])

	const divisionValue =
		divisionFilter !== ALL_DIVISIONS_VALUE && Number.isInteger(Number(divisionFilter))
			? Number(divisionFilter)
			: undefined
	const refTypesValue = useMemo(
		() => (refTypesFilter === ALL_INCOME_TYPES_VALUE ? [] : parseCsv(refTypesFilter)),
		[refTypesFilter]
	)
	const sourceTypesValue = useMemo(
		() =>
			parseCsv(sourceTypesFilter).filter((sourceType) =>
				LEDGER_SOURCE_TYPES.has(sourceType)
			) as Array<
				| 'corporation_wallet_journal'
				| 'corporation_wallet_transaction'
				| 'character_wallet_journal'
				| 'character_wallet_transaction'
			>,
		[sourceTypesFilter]
	)
	const fromDateIso = fromDate ? toStartOfDayIso(fromDate) : undefined
	const toDateIso = toDate ? toEndOfDayIso(toDate) : undefined
	const firstPartyIdValue = firstPartyIdFilter.trim() || undefined
	const secondPartyIdValue = secondPartyIdFilter.trim() || undefined
	const minAmountValue = minAmountFilter.trim() || undefined

	const debouncedFirstPartyQuery = useDebounce(firstPartyQuery, 300)
	const debouncedSecondPartyQuery = useDebounce(secondPartyQuery, 300)
	const normalizedFirstPartyQuery = debouncedFirstPartyQuery.trim()
	const normalizedSecondPartyQuery = debouncedSecondPartyQuery.trim()
	const firstPartySearchPending = firstPartyQuery !== debouncedFirstPartyQuery
	const secondPartySearchPending = secondPartyQuery !== debouncedSecondPartyQuery

	const { data: senderPartyRows = [], isLoading: senderPartiesLoading } = useTaxLedgerParties(
		effectiveCorporationId,
		{
			fromDate: fromDateIso,
			toDate: toDateIso,
			limit: 100,
			q: normalizedFirstPartyQuery || undefined,
			direction: 'sender',
			enabled: canView && Boolean(effectiveCorporationId) && normalizedFirstPartyQuery.length >= 2,
		}
	)
	const { data: recipientPartyRows = [], isLoading: recipientPartiesLoading } = useTaxLedgerParties(
		effectiveCorporationId,
		{
			fromDate: fromDateIso,
			toDate: toDateIso,
			limit: 100,
			q: normalizedSecondPartyQuery || undefined,
			direction: 'recipient',
			enabled: canView && Boolean(effectiveCorporationId) && normalizedSecondPartyQuery.length >= 2,
		}
	)

	useEffect(() => {
		setPage(0)
	}, [
		effectiveCorporationId,
		fromDateIso,
		toDateIso,
		divisionValue,
		refTypesValue.join(','),
		sourceTypesValue.join(','),
		firstPartyIdValue,
		secondPartyIdValue,
		minAmountValue,
	])

	const {
		data: ledgerPage,
		isFetching: ledgerLoading,
		error: ledgerError,
	} = useTaxLedgerEntries(effectiveCorporationId, {
		division: divisionValue,
		refTypes: refTypesValue.length > 0 ? refTypesValue : undefined,
		sourceTypes: sourceTypesValue.length > 0 ? sourceTypesValue : undefined,
		firstPartyId: firstPartyIdValue,
		secondPartyId: secondPartyIdValue,
		fromDate: fromDateIso,
		toDate: toDateIso,
		minAmount: minAmountValue,
		limit: pageSize,
		offset: page * pageSize,
		sortBy,
		sortDir,
		enabled: canView && Boolean(effectiveCorporationId),
	})

	const ledgerEntries = ledgerPage?.rows ?? []
	const ledgerRowCount = ledgerPage?.totalRows ?? 0
	const ledgerSorting: TaxReportSortingState = [{ id: sortBy, desc: sortDir === 'desc' }]
	const onLedgerSortingChange = (next: TaxReportSortingState) => {
		const first = next[0]
		if (!first) return
		setSortBy(first.id as typeof sortBy)
		setSortDir(first.desc ? 'desc' : 'asc')
		setPage(0)
	}

	const ledgerEntityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const entry of ledgerEntries) {
			ids.add(entry.corporationId)
			if (entry.firstPartyId) ids.add(entry.firstPartyId)
			if (entry.secondPartyId) ids.add(entry.secondPartyId)
			if (entry.characterId) ids.add(entry.characterId)
		}
		for (const party of senderPartyRows) {
			ids.add(party.entityId)
		}
		for (const party of recipientPartyRows) {
			ids.add(party.entityId)
		}
		if (firstPartyIdFilter) ids.add(firstPartyIdFilter)
		if (secondPartyIdFilter) ids.add(secondPartyIdFilter)
		return [...ids]
	}, [ledgerEntries, senderPartyRows, recipientPartyRows, firstPartyIdFilter, secondPartyIdFilter])

	const { data: entityNames = {} } = useEntityNames(ledgerEntityIds, { enabled: canView })

	const senderPartyOptions = useMemo(
		() =>
			senderPartyRows.map((party) => ({
				value: party.entityId,
				label: party.entityName ?? entityNames[party.entityId] ?? party.entityId,
				description: party.entityId,
			})),
		[entityNames, senderPartyRows]
	)
	const recipientPartyOptions = useMemo(
		() =>
			recipientPartyRows.map((party) => ({
				value: party.entityId,
				label: party.entityName ?? entityNames[party.entityId] ?? party.entityId,
				description: party.entityId,
			})),
		[entityNames, recipientPartyRows]
	)
	const partyNameById = useMemo(
		() =>
			new Map(
				[...senderPartyOptions, ...recipientPartyOptions].map((option) => [
					option.value,
					option.label,
				])
			),
		[senderPartyOptions, recipientPartyOptions]
	)

	const ledgerColumns = useMemo(
		() => [
			{
				id: 'entryDate',
				header: 'Date',
				sortable: true,
				cell: (row: TaxLedgerEntry) => formatTaxDateTime(row.entryDate),
			},
			{
				id: 'refType',
				header: 'Income Type',
				sortable: true,
				cell: (row: TaxLedgerEntry) => (
					<div className="flex items-center gap-2">
						<span
							className="h-2.5 w-2.5 rounded-full"
							style={{ backgroundColor: getTaxRefTypeColor(row.refType) }}
						/>
						<span>{formatTaxRefTypeLabel(row.refType)}</span>
					</div>
				),
			},
			{
				id: 'amount',
				header: 'Amount',
				sortable: true,
				cell: (row: TaxLedgerEntry) => formatTaxIskFull(row.amount),
			},
			{
				id: 'division',
				header: 'Division',
				sortable: true,
				cell: (row: TaxLedgerEntry) => formatTaxDivisionLabel(row.division),
			},
			{
				id: 'sourceType',
				header: 'Source',
				sortable: true,
				cell: (row: TaxLedgerEntry) => formatTaxLedgerSourceTypeLabel(row.sourceType),
			},
			{
				id: 'firstPartyId',
				header: 'Sender',
				cell: (row: TaxLedgerEntry) => (
					<TaxEntityDisplay entityId={row.firstPartyId} entityNames={entityNames} />
				),
			},
			{
				id: 'secondPartyId',
				header: 'Recipient',
				cell: (row: TaxLedgerEntry) => (
					<TaxEntityDisplay entityId={row.secondPartyId} entityNames={entityNames} />
				),
			},
		],
		[entityNames]
	)

	const resetFilters = () => {
		setFromDate(DEFAULT_MONTH_RANGE.fromDate)
		setToDate(DEFAULT_MONTH_RANGE.toDate)
		setDivisionFilter(ALL_DIVISIONS_VALUE)
		setDivisionQuery('')
		setRefTypesFilter(ALL_INCOME_TYPES_VALUE)
		setRefTypeQuery('')
		setSourceTypesFilter('')
		setSourceTypeQuery('')
		setFirstPartyIdFilter('')
		setSecondPartyIdFilter('')
		setFirstPartyQuery('')
		setSecondPartyQuery('')
		setMinAmountFilter('')
		setPage(0)
	}

	if (!corporationAccessLoading && !scopedCapabilitiesLoading && !canView) {
		return (
			<Container>
				<Card>
					<CardHeader>
						<CardTitle>Tax Ledger</CardTitle>
						<CardDescription>You do not have permission to view tax ledger data.</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="Tax Ledger"
				description="Explore normalized ledger entries with transaction-level filtering."
			/>

			<Section>
				{accessibleCorporations.length > 0 ? (
					<TaxCorporationScopeSelector
						corporations={accessibleCorporations}
						effectiveCorporationId={effectiveCorporationId}
						onSelect={setSelectedCorporationId}
					/>
				) : (
					<Card>
						<CardHeader>
							<CardTitle>No Corporation Scope</CardTitle>
							<CardDescription>
								No accessible corporations were found for ledger exploration.
							</CardDescription>
						</CardHeader>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Filters</CardTitle>
						<CardDescription>
							Refine the ledger by date range, wallet division, income type, source type, and
							parties.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 md:grid-cols-4">
						<FilterField label="Date range">
							<DateRangeInput
								value={{ fromDate, toDate }}
								onChange={({ fromDate: nextFromDate, toDate: nextToDate }) => {
									setFromDate(nextFromDate)
									setToDate(nextToDate)
								}}
								placeholder="Date range"
							/>
						</FilterField>
						<FilterField label="Division">
							<Select
								value={divisionFilter}
								onValueChange={(nextValue) => {
									setDivisionFilter(nextValue)
									setDivisionQuery('')
								}}
								query={divisionQuery}
								onQueryChange={setDivisionQuery}
								searchable
								options={toSearchOptions(divisionOptions)}
								disabled={!effectiveCorporationId}
								placeholder={
									divisionFilter === ALL_DIVISIONS_VALUE
										? 'All divisions'
										: formatTaxDivisionLabel(divisionFilter)
								}
								emptyText="No wallet divisions found"
							/>
						</FilterField>
						<FilterField label="Income type">
							<Select
								value={refTypesFilter}
								onValueChange={(nextValue) => {
									setRefTypesFilter(nextValue)
									setRefTypeQuery('')
								}}
								query={refTypeQuery}
								onQueryChange={setRefTypeQuery}
								searchable
								options={incomeTypeOptions}
								listMaxHeight={420}
								placeholder={
									refTypesFilter === ALL_INCOME_TYPES_VALUE
										? 'All income types'
										: formatTaxRefTypeLabel(refTypesFilter)
								}
								emptyText="No income types found"
							/>
						</FilterField>
						<FilterField label="Source type">
							<Select
								value={sourceTypesFilter}
								onValueChange={(nextValue) => {
									setSourceTypesFilter(nextValue)
									setSourceTypeQuery('')
								}}
								query={sourceTypeQuery}
								onQueryChange={setSourceTypeQuery}
								searchable
								options={toSearchOptions(TAX_LEDGER_SOURCE_TYPE_OPTIONS)}
								listClassName="max-h-72"
								placeholder={
									sourceTypesFilter
										? formatTaxLedgerSourceTypeLabel(sourceTypesFilter)
										: 'Source type'
								}
								emptyText="No source types found"
							/>
						</FilterField>
						<FilterField label="Min amount">
							<Input
								value={minAmountFilter}
								onChange={(event) => setMinAmountFilter(event.target.value)}
								placeholder="Min amount"
							/>
						</FilterField>
						<FilterField label="Sender">
							<Select
								value={firstPartyIdFilter}
								onValueChange={(nextValue) => {
									setFirstPartyIdFilter(nextValue)
								}}
								query={firstPartyQuery}
								onQueryChange={(value) => {
									setFirstPartyQuery(value)
									if (!value.trim()) {
										setFirstPartyIdFilter('')
										return
									}
									setFirstPartyIdFilter('')
								}}
								searchable
								searchDelegate={() => senderPartyOptions}
								options={senderPartyOptions}
								minQueryLength={2}
								debounceMs={0}
								loading={senderPartiesLoading || firstPartySearchPending}
								queryHintText="Type at least 2 characters to search senders"
								placeholder={
									firstPartyIdFilter
										? (partyNameById.get(firstPartyIdFilter) ?? firstPartyIdFilter)
										: 'Sender name or ID'
								}
								emptyText="No sender matches found"
							/>
						</FilterField>
						<FilterField label="Recipient">
							<Select
								value={secondPartyIdFilter}
								onValueChange={(nextValue) => {
									setSecondPartyIdFilter(nextValue)
								}}
								query={secondPartyQuery}
								onQueryChange={(value) => {
									setSecondPartyQuery(value)
									if (!value.trim()) {
										setSecondPartyIdFilter('')
										return
									}
									setSecondPartyIdFilter('')
								}}
								searchable
								searchDelegate={() => recipientPartyOptions}
								options={recipientPartyOptions}
								minQueryLength={2}
								debounceMs={0}
								loading={recipientPartiesLoading || secondPartySearchPending}
								queryHintText="Type at least 2 characters to search recipients"
								placeholder={
									secondPartyIdFilter
										? (partyNameById.get(secondPartyIdFilter) ?? secondPartyIdFilter)
										: 'Recipient name or ID'
								}
								emptyText="No recipient matches found"
							/>
						</FilterField>
						<div className="flex items-end md:justify-end">
							<Button variant="ghost" onClick={resetFilters}>
								Clear Filters
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Ledger Entries</CardTitle>
						<CardDescription>
							{effectiveCorporationId
								? `Showing entries for ${entityNames[effectiveCorporationId] ?? effectiveCorporationId}.`
								: 'Select a corporation to load entries.'}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<TaxReportTable
							columns={ledgerColumns}
							rows={ledgerEntries}
							loading={ledgerLoading}
							error={ledgerError}
							emptyMessage="No ledger entries found."
							sorting={ledgerSorting}
							onSortingChange={onLedgerSortingChange}
							pagination={{ pageIndex: page, pageSize }}
							onPaginationChange={(next) => {
								setPageSize(next.pageSize)
								setPage(next.pageSize === pageSize ? Math.max(0, next.pageIndex) : 0)
							}}
							rowCount={ledgerRowCount}
							itemLabel="ledger entries"
							getRowKey={(row) => row.id}
						/>
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
