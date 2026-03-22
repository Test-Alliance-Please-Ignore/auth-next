import { useEffect, useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { FilterField } from '@/components/ui/filter-field'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { SearchSelect } from '@/components/ui/search-select'
import { Section } from '@/components/ui/section'
import {
	useTaxCapabilities,
	useTaxLedgerEntries,
	useTaxWalletDivisions,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { formatTaxDateTime, getCurrentMonthDateRange } from '@/lib/tax-date'
import {
	formatTaxDivisionLabel,
	formatTaxIskFull,
	formatTaxLedgerSourceTypeLabel,
	formatTaxRefTypeLabel,
	TAX_LEDGER_SOURCE_TYPE_OPTIONS,
	TAX_REF_TYPE_OPTIONS,
	TaxEntityDisplay,
} from '@/lib/tax-display'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { TaxLedgerEntry } from '@repo/corporation-tax'

const PAGE_SIZE = 50
const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()
const ALL_DIVISIONS_OPTION = {
	id: '__all_divisions__',
	value: '',
	label: 'All divisions',
} as const
const ALL_INCOME_TYPES_OPTION = {
	id: '__all_income_types__',
	value: '',
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

function toSearchOptions(options: Array<{ id: string; value: string; label: string }>) {
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
	const [fromDate, setFromDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [toDate, setToDate] = useState(DEFAULT_MONTH_RANGE.toDate)
	const [divisionFilter, setDivisionFilter] = useState('')
	const [divisionQuery, setDivisionQuery] = useState('')
	const [refTypesFilter, setRefTypesFilter] = useState('')
	const [refTypeQuery, setRefTypeQuery] = useState('')
	const [sourceTypesFilter, setSourceTypesFilter] = useState('')
	const [sourceTypeQuery, setSourceTypeQuery] = useState('')
	const [firstPartyIdFilter, setFirstPartyIdFilter] = useState('')
	const [secondPartyIdFilter, setSecondPartyIdFilter] = useState('')
	const [minAmountFilter, setMinAmountFilter] = useState('')

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canManage ?? false
	const canView = canAdminScope || canViewScoped

	useEffect(() => {
		if (!effectiveCorporationId) {
			setDivisionFilter('')
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
				id: String(division),
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
		if (!divisionFilter) {
			return
		}
		if (!walletDivisions.includes(Number(divisionFilter))) {
			setDivisionFilter('')
			setDivisionQuery('')
		}
	}, [divisionFilter, walletDivisions])

	const divisionValue =
		divisionFilter.trim() !== '' && Number.isInteger(Number(divisionFilter))
			? Number(divisionFilter)
			: undefined
	const refTypesValue = useMemo(() => parseCsv(refTypesFilter), [refTypesFilter])
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
		data: ledgerEntries = [],
		isLoading: ledgerLoading,
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
		enabled: canView && Boolean(effectiveCorporationId),
	})

	const hasNextPage = ledgerEntries.length === pageSize
	const approximateRowCount = page * pageSize + ledgerEntries.length + (hasNextPage ? 1 : 0)
	const pageCount = Math.max(1, Math.ceil(approximateRowCount / pageSize))

	const ledgerEntityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const entry of ledgerEntries) {
			ids.add(entry.corporationId)
			if (entry.firstPartyId) ids.add(entry.firstPartyId)
			if (entry.secondPartyId) ids.add(entry.secondPartyId)
			if (entry.characterId) ids.add(entry.characterId)
		}
		return [...ids]
	}, [ledgerEntries])

	const { data: entityNames = {} } = useEntityNames(ledgerEntityIds, { enabled: canView })

	const ledgerColumns = useMemo<MRT_ColumnDef<TaxLedgerEntry>[]>(
		() => [
			{
				accessorKey: 'entryDate',
				header: 'Date',
				enableSorting: false,
				Cell: ({ row }) => formatTaxDateTime(row.original.entryDate),
			},
			{
				accessorKey: 'refType',
				header: 'Income Type',
				enableSorting: false,
				Cell: ({ row }) => formatTaxRefTypeLabel(row.original.refType),
			},
			{
				accessorKey: 'amount',
				header: 'Amount',
				enableSorting: false,
				Cell: ({ row }) => formatTaxIskFull(row.original.amount),
			},
			{
				accessorKey: 'division',
				header: 'Division',
				enableSorting: false,
				Cell: ({ row }) => formatTaxDivisionLabel(row.original.division),
			},
			{
				accessorKey: 'sourceType',
				header: 'Source',
				enableSorting: false,
				Cell: ({ row }) => formatTaxLedgerSourceTypeLabel(row.original.sourceType),
			},
			{
				accessorKey: 'firstPartyId',
				header: 'Sender',
				enableSorting: false,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.firstPartyId} entityNames={entityNames} />
				),
			},
			{
				accessorKey: 'secondPartyId',
				header: 'Recipient',
				enableSorting: false,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.secondPartyId} entityNames={entityNames} />
				),
			},
		],
		[entityNames]
	)

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
						<CardTitle>Ledger Filters</CardTitle>
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
							<SearchSelect
								value={divisionQuery}
								onValueChange={setDivisionQuery}
								options={toSearchOptions(divisionOptions)}
								onSelect={(option) => {
									setDivisionFilter(option.value)
									setDivisionQuery('')
								}}
								filterMode="local"
								mode="dropdown"
								minQueryLength={0}
								disabled={!effectiveCorporationId}
								placeholder={
									divisionFilter ? formatTaxDivisionLabel(divisionFilter) : 'All divisions'
								}
								emptyText="No wallet divisions found"
							/>
						</FilterField>
						<FilterField label="Income type">
							<SearchSelect
								value={refTypeQuery}
								onValueChange={setRefTypeQuery}
								options={incomeTypeOptions}
								onSelect={(option) => {
									setRefTypesFilter(option.value)
									setRefTypeQuery('')
								}}
								filterMode="local"
								mode="dropdown"
								listMaxHeight={420}
								placeholder={
									refTypesFilter ? formatTaxRefTypeLabel(refTypesFilter) : 'All income types'
								}
								emptyText="No income types found"
							/>
						</FilterField>
						<FilterField label="Source type">
							<SearchSelect
								value={sourceTypeQuery}
								onValueChange={setSourceTypeQuery}
								options={toSearchOptions(TAX_LEDGER_SOURCE_TYPE_OPTIONS)}
								onSelect={(option) => {
									setSourceTypesFilter(option.value)
									setSourceTypeQuery('')
								}}
								filterMode="local"
								mode="dropdown"
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
							<Input
								value={firstPartyIdFilter}
								onChange={(event) => setFirstPartyIdFilter(event.target.value)}
								placeholder="Sender"
							/>
						</FilterField>
						<FilterField label="Recipient">
							<Input
								value={secondPartyIdFilter}
								onChange={(event) => setSecondPartyIdFilter(event.target.value)}
								placeholder="Recipient"
							/>
						</FilterField>
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
						{ledgerLoading ? (
							<div className="py-8 text-sm text-muted-foreground">Loading ledger entries...</div>
						) : ledgerError ? (
							<div className="py-8 text-sm text-destructive">
								{ledgerError instanceof Error
									? ledgerError.message
									: 'Failed to load ledger entries'}
							</div>
						) : (
							<TaxReportDataGrid
								columns={ledgerColumns}
								rows={ledgerEntries}
								emptyMessage="No ledger entries found."
								pagination={{ pageIndex: page, pageSize }}
								onPaginationChange={(next) => {
									setPageSize(next.pageSize)
									setPage(next.pageSize === pageSize ? Math.max(0, next.pageIndex) : 0)
								}}
								pageCount={pageCount}
								rowCount={approximateRowCount}
							/>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
