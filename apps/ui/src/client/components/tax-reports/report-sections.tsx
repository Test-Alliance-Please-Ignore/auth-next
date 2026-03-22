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
import {
	useTaxBillStatusReport,
	useTaxComplianceReport,
	useTaxDiscrepancyReport,
	useTaxEssPayoutReport,
	useTaxMissingEsiKeysReport,
	useTaxTopIncomeSourcesMonthlyReport,
	useTaxTotalTaxesReport,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'

import type { TaxRollupReportQueryFilters } from '@/lib/tax-report-types'
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

	const { data, isLoading, error } = useTaxTotalTaxesReport({
		...props.filters,
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const pageCount = gridState.pageCountFor(totalRows)
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
			pageCount={pageCount}
			rowCount={totalRows}
		/>
	)
}

export function TopIncomeSourcesReportSection(props: {
	filters: TaxRollupReportQueryFilters
	enabled: boolean
}) {
	const {
		data = [],
		isLoading,
		error,
	} = useTaxTopIncomeSourcesMonthlyReport({
		...props.filters,
		enabled: props.enabled,
	})

	if (isLoading) {
		return <div className="py-8 text-sm text-muted-foreground">Loading income sources...</div>
	}

	if (error) {
		return (
			<div className="py-8 text-sm text-destructive">
				{error instanceof Error ? error.message : 'Failed to load income sources report'}
			</div>
		)
	}
	return <TopIncomeSourcesMonthlyChart rows={data} />
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

	const { data, isLoading, error } = useTaxEssPayoutReport({
		...props.filters,
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const pageCount = gridState.pageCountFor(totalRows)
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
			pageCount={pageCount}
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

	const { data, isLoading, error } = useTaxDiscrepancyReport({
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
	const pageCount = gridState.pageCountFor(totalRows)
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
			pageCount={pageCount}
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

	const { data, isLoading, error } = useTaxBillStatusReport({
		...props.filters,
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const pageCount = gridState.pageCountFor(totalRows)
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
			pageCount={pageCount}
			rowCount={totalRows}
		/>
	)
}

export function ComplianceOverTimeReportSection(props: {
	filters: TaxRollupReportQueryFilters
	enabled: boolean
}) {
	const {
		data: rows = [],
		isLoading,
		error,
	} = useTaxComplianceReport({
		...props.filters,
		enabled: props.enabled,
	})

	const chartRows = useMemo(() => rows, [rows])

	return (
		<TaxComplianceReportSection
			loading={isLoading}
			error={error}
			rows={rows}
			chartRows={chartRows}
		/>
	)
}

export function MissingEsiKeysReportSection(props: { enabled: boolean }) {
	const gridState = useReportGridState({
		defaultSortBy: 'lastVerified',
		defaultSortDir: 'desc',
		defaultPageSize: REPORT_PAGE_SIZE_DEFAULT,
	})

	const { data, isLoading, error } = useTaxMissingEsiKeysReport({
		limit: gridState.limit,
		offset: gridState.offset,
		sortBy: gridState.sortBy,
		sortDir: gridState.sortDir,
		enabled: props.enabled,
	})
	const rows = data?.rows ?? []
	const totalRows = data?.totalRows ?? 0
	const pageCount = gridState.pageCountFor(totalRows)
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
			pageCount={pageCount}
			rowCount={totalRows}
		/>
	)
}
