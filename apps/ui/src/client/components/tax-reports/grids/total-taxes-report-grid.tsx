import { createMRTColumnHelper } from 'mantine-react-table'
import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatTaxIskFull, formatTaxNumber, TaxEntityDisplay } from '@/lib/tax-display'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type { TaxTotalTaxesByCorporationRow } from '@repo/corporation-tax'

export function TotalTaxesReportGrid(props: {
	rows: TaxTotalTaxesByCorporationRow[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	sorting: MRT_SortingState
	onSortingChange: (sorting: MRT_SortingState) => void
	pagination: {
		pageIndex: number
		pageSize: number
	}
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	pageCount: number
	rowCount: number
}) {
	const columnHelper = createMRTColumnHelper<TaxTotalTaxesByCorporationRow>()
	const columns = useMemo<Array<MRT_ColumnDef<TaxTotalTaxesByCorporationRow>>>(
		() => [
			columnHelper.accessor('corporationId', {
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={props.entityNames} />
				),
			}),
			columnHelper.accessor('assessmentCount', {
				header: 'Assessments',
				enableSorting: true,
				Cell: ({ row }) => formatTaxNumber(row.original.assessmentCount),
			}),
			columnHelper.accessor('underpaidCount', {
				header: 'Underpaid',
				enableSorting: false,
				Cell: ({ row }) => formatTaxNumber(row.original.underpaidCount),
			}),
			columnHelper.accessor('paidCount', {
				header: 'Paid',
				enableSorting: false,
				Cell: ({ row }) => formatTaxNumber(row.original.paidCount),
			}),
			columnHelper.accessor('overpaidCount', {
				header: 'Overpaid',
				enableSorting: false,
				Cell: ({ row }) => formatTaxNumber(row.original.overpaidCount),
			}),
			columnHelper.accessor('taxDueCenti', {
				id: 'taxDue',
				header: 'Tax Due',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDue),
			}),
			columnHelper.accessor('taxPaidCenti', {
				id: 'taxPaid',
				header: 'Tax Paid',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.taxPaid),
			}),
			columnHelper.accessor('taxDeltaCenti', {
				id: 'taxDelta',
				header: 'Delta',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDelta),
			}),
		],
		[columnHelper, props.entityNames]
	)

	return (
		<TaxReportDataGrid
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No totals found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			pageCount={props.pageCount}
			rowCount={props.rowCount}
		/>
	)
}
