import { createMRTColumnHelper } from 'mantine-react-table'
import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { Badge } from '@/components/ui/badge'
import { formatTaxIskFull, formatTaxNumber, TaxEntityDisplay } from '@/lib/tax-display'

import { billStatusBadgeVariant, sortByCentiColumnValue } from './shared'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type { TaxBillStatusReportRow } from '@repo/corporation-tax'

export function BillStatusReportGrid(props: {
	rows: TaxBillStatusReportRow[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	sorting: MRT_SortingState
	onSortingChange: (sorting: MRT_SortingState) => void
}) {
	const columnHelper = createMRTColumnHelper<TaxBillStatusReportRow>()
	const columns = useMemo<MRT_ColumnDef<TaxBillStatusReportRow>[]>(
		() => [
			columnHelper.accessor('corporationId', {
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={props.entityNames} />
				),
			}),
			columnHelper.accessor('billStatus', {
				header: 'Bill Status',
				enableSorting: true,
				Cell: ({ row }) => (
					<Badge variant={billStatusBadgeVariant(row.original.billStatus)}>
						{row.original.billStatus}
					</Badge>
				),
			}),
			columnHelper.accessor('assessmentCount', {
				header: 'Assessments',
				enableSorting: true,
				Cell: ({ row }) => formatTaxNumber(row.original.assessmentCount),
			}),
			columnHelper.accessor('taxDueCenti', {
				id: 'taxDue',
				header: 'Tax Due',
				enableSorting: true,
				sortingFn: (rowA, rowB, columnId) => sortByCentiColumnValue(rowA, rowB, columnId),
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDue),
			}),
			columnHelper.accessor('taxPaidCenti', {
				id: 'taxPaid',
				header: 'Tax Paid',
				enableSorting: true,
				sortingFn: (rowA, rowB, columnId) => sortByCentiColumnValue(rowA, rowB, columnId),
				Cell: ({ row }) => formatTaxIskFull(row.original.taxPaid),
			}),
			columnHelper.accessor('taxDeltaCenti', {
				id: 'taxDelta',
				header: 'Delta',
				enableSorting: true,
				sortingFn: (rowA, rowB, columnId) => sortByCentiColumnValue(rowA, rowB, columnId),
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
			emptyMessage="No bill status rows found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
		/>
	)
}
