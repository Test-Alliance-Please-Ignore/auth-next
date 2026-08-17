import { useMemo } from 'react'

import {
	BillStatusReportGrid,
	DiscrepancyGrid,
	EssPayoutGrid,
	MissingEsiKeysGrid,
	TotalTaxesReportGrid,
} from '@/components/tax-reports/grids'
import { TaxComplianceReportSection } from '@/components/tax-reports/report-display'
import { TopIncomeSourcesMonthlyChart } from '@/components/tax-reports/top-income-sources-monthly-chart'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import {
	useTaxableIncomeRefTypes,
	useTaxBillStatusReport,
	useTaxComplianceReport,
	useTaxDiscrepancyReport,
	useTaxEssPayoutReport,
	useTaxMissingEsiKeysReport,
	useTaxTopIncomeSourcesMonthlyReport,
	useTaxTotalTaxesReport,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { TAX_REF_TYPE_OPTIONS } from '@/lib/tax-display'

import type { TaxIncomeSourceControls, TaxRollupReportQueryFilters } from '@/lib/tax-report-types'
import type { SortDirection } from '@/lib/tax-report-utils'

const REPORT_PAGE_SIZE_DEFAULT = 25

export function TotalTaxesReportSection(props: {
	filters: TaxRollupReportQueryFilters
	enabled: boolean
	onSortChange?: (sortBy: string, sortDir: SortDirection) => void
}) {
	const gridState = useReportGridState({
		defaultSortBy: 'taxDue',
		defaultSortDir: 'desc',
		defaultPageSize: REPORT_PAGE_SIZE_DEFAULT,
		resetOn: props.filters,
		onSortChange: props.onSortChange,
	})

	const {
		data,
		isFetching: isLoading,
		error,
	} = useTaxTotalTaxesReport({
		...props.filters,
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const entityIds = useMemo(() => rows.map((row) => row.corporationId), [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<TotalTaxesReportGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={gridState.sorting}
			onSortingChange={gridState.onSortingChange}
			pagination={gridState.pagination}
			onPaginationChange={gridState.onPaginationChange}
			rowCount={totalRows}
		/>
	)
}

export function TopIncomeSourcesReportSection(props: {
	filters: TaxRollupReportQueryFilters
	enabled: boolean
	controls: TaxIncomeSourceControls
	onControlsChange: (controls: TaxIncomeSourceControls) => void
}) {
	const { data: taxableIncomeTypes = [] } = useTaxableIncomeRefTypes(
		props.filters.corporationId,
		props.enabled
	)
	const {
		data = [],
		isLoading,
		error,
	} = useTaxTopIncomeSourcesMonthlyReport({
		...props.filters,
		refTypes: props.controls.refTypes,
		incomeMode: props.controls.incomeMode,
		walletSource: props.controls.walletSource,
		enabled: props.enabled,
	})

	return (
		<div className="space-y-4">
			<div className="max-w-3xl space-y-2">
				<div className="text-sm font-medium">Income Types</div>
				<div className="flex items-center gap-2">
					<div className="min-w-0 flex-1">
						<Select
							options={TAX_REF_TYPE_OPTIONS}
							values={props.controls.refTypes}
							onValuesChange={(refTypes) => props.onControlsChange({ ...props.controls, refTypes })}
							multiple
							searchable
							placeholder="All income types"
							inputClassName="h-10"
							contentClassName="w-[min(20rem,calc(100vw-2rem))] min-w-[min(20rem,calc(100vw-2rem))]"
						/>
					</div>
					<Button
						type="button"
						variant="secondary"
						className="h-10 shrink-0"
						showIcon={false}
						disabled={taxableIncomeTypes.length === 0}
						onClick={() =>
							props.onControlsChange({ ...props.controls, refTypes: taxableIncomeTypes })
						}
					>
						Taxable only
					</Button>
					<Button
						type="button"
						variant="secondary"
						className="h-10 shrink-0"
						showIcon={false}
						onClick={() =>
							props.onControlsChange({
								...props.controls,
								walletSource:
									props.controls.walletSource === 'corporation' ? 'character' : 'corporation',
								incomeMode: 'total',
							})
						}
					>
						{props.controls.walletSource === 'corporation'
							? 'Show Player Wallets'
							: 'Show Corporation Wallets'}
					</Button>
					{props.controls.walletSource === 'corporation' ? (
						<Button
							type="button"
							variant="secondary"
							className="h-10 shrink-0"
							showIcon={false}
							onClick={() =>
								props.onControlsChange({
									...props.controls,
									incomeMode: props.controls.incomeMode === 'total' ? 'assessed' : 'total',
								})
							}
						>
							{props.controls.incomeMode === 'total' ? 'Show Assessed' : 'Show Total'}
						</Button>
					) : null}
					<Button
						type="button"
						variant="ghost"
						className="h-10 shrink-0"
						showIcon={false}
						disabled={props.controls.refTypes.length === 0}
						onClick={() => props.onControlsChange({ ...props.controls, refTypes: [] })}
					>
						Reset
					</Button>
				</div>
			</div>

			{isLoading ? (
				<div className="py-8 text-sm text-muted-foreground">Loading income sources...</div>
			) : error ? (
				<div className="py-8 text-sm text-destructive">
					{error instanceof Error ? error.message : 'Failed to load income sources report'}
				</div>
			) : (
				<TopIncomeSourcesMonthlyChart
					rows={data}
					incomeMode={props.controls.incomeMode}
					walletSource={props.controls.walletSource}
				/>
			)}
		</div>
	)
}

export function EssPayoutReportSection(props: {
	filters: TaxRollupReportQueryFilters
	enabled: boolean
	onSortChange?: (sortBy: string, sortDir: SortDirection) => void
}) {
	const gridState = useReportGridState({
		defaultSortBy: 'entryDate',
		defaultSortDir: 'desc',
		defaultPageSize: REPORT_PAGE_SIZE_DEFAULT,
		resetOn: props.filters,
		onSortChange: props.onSortChange,
	})

	const {
		data,
		isFetching: isLoading,
		error,
	} = useTaxEssPayoutReport({
		...props.filters,
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const entityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const row of rows) {
			ids.add(row.corporationId)
			if (row.firstPartyId) ids.add(row.firstPartyId)
			if (row.secondPartyId) ids.add(row.secondPartyId)
		}
		return [...ids]
	}, [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<EssPayoutGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={gridState.sorting}
			onSortingChange={gridState.onSortingChange}
			pagination={gridState.pagination}
			onPaginationChange={gridState.onPaginationChange}
			rowCount={totalRows}
		/>
	)
}

export function DiscrepancyReportSection(props: {
	filters: Pick<TaxRollupReportQueryFilters, 'corporationId' | 'fromDate' | 'toDate'>
	enabled: boolean
	onSortChange?: (sortBy: string, sortDir: SortDirection) => void
}) {
	const gridState = useReportGridState({
		defaultSortBy: 'createdAt',
		defaultSortDir: 'desc',
		defaultPageSize: REPORT_PAGE_SIZE_DEFAULT,
		resetOn: props.filters,
		onSortChange: props.onSortChange,
	})

	const {
		data,
		isFetching: isLoading,
		error,
	} = useTaxDiscrepancyReport({
		corporationId: props.filters.corporationId,
		fromDate: props.filters.fromDate,
		toDate: props.filters.toDate,
		onlyOpen: true,
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const entityIds = useMemo(() => rows.map((row) => row.corporationId), [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<DiscrepancyGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={gridState.sorting}
			onSortingChange={gridState.onSortingChange}
			pagination={gridState.pagination}
			onPaginationChange={gridState.onPaginationChange}
			rowCount={totalRows}
		/>
	)
}

export function BillStatusReportSection(props: {
	filters: TaxRollupReportQueryFilters
	enabled: boolean
	onSortChange?: (sortBy: string, sortDir: SortDirection) => void
}) {
	const gridState = useReportGridState({
		defaultSortBy: 'dueDate',
		defaultSortDir: 'asc',
		defaultPageSize: REPORT_PAGE_SIZE_DEFAULT,
		resetOn: props.filters,
		onSortChange: props.onSortChange,
	})

	const {
		data,
		isFetching: isLoading,
		error,
	} = useTaxBillStatusReport({
		...props.filters,
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const entityIds = useMemo(() => rows.map((row) => row.corporationId), [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<BillStatusReportGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={gridState.sorting}
			onSortingChange={gridState.onSortingChange}
			pagination={gridState.pagination}
			onPaginationChange={gridState.onPaginationChange}
			rowCount={totalRows}
		/>
	)
}

export function ComplianceOverTimeReportSection(props: {
	filters: TaxRollupReportQueryFilters
	enabled: boolean
}) {
	const gridState = useReportGridState({
		defaultSortBy: 'rollupDate',
		defaultSortDir: 'asc',
		defaultPageSize: REPORT_PAGE_SIZE_DEFAULT,
		resetOn: props.filters,
	})

	const {
		data: chartPage,
		isFetching: chartLoading,
		error: chartError,
	} = useTaxComplianceReport({
		...props.filters,
		limit: 3650,
		offset: 0,
		sortBy: 'rollupDate',
		sortDir: 'asc',
		enabled: props.enabled,
	})
	const {
		data: tablePage,
		isFetching: tableLoading,
		error: tableError,
	} = useTaxComplianceReport({
		...props.filters,
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})

	const chartRows = useMemo(() => chartPage?.rows ?? [], [chartPage?.rows])
	const rows = tablePage?.rows ?? []

	return (
		<TaxComplianceReportSection
			loading={chartLoading || tableLoading}
			error={chartError ?? tableError}
			rows={rows}
			chartRows={chartRows}
			sorting={gridState.sorting}
			onSortingChange={gridState.onSortingChange}
			pagination={gridState.pagination}
			onPaginationChange={gridState.onPaginationChange}
			rowCount={tablePage?.totalRows ?? 0}
		/>
	)
}

export function MissingEsiKeysReportSection(props: { enabled: boolean }) {
	const gridState = useReportGridState({
		defaultSortBy: 'lastVerified',
		defaultSortDir: 'desc',
		defaultPageSize: REPORT_PAGE_SIZE_DEFAULT,
	})

	const {
		data,
		isFetching: isLoading,
		error,
	} = useTaxMissingEsiKeysReport({
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const entityIds = useMemo(() => rows.map((row) => row.corporationId), [rows])
	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: props.enabled })

	return (
		<MissingEsiKeysGrid
			rows={rows}
			loading={isLoading}
			error={error}
			entityNames={entityNames}
			sorting={gridState.sorting}
			onSortingChange={gridState.onSortingChange}
			pagination={gridState.pagination}
			onPaginationChange={gridState.onPaginationChange}
			rowCount={totalRows}
		/>
	)
}
