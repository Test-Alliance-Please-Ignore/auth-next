import { createMRTColumnHelper } from 'mantine-react-table'
import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { Badge } from '@/components/ui/badge'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxIskFull, formatTaxNumber, TaxEntityDisplay } from '@/lib/tax-display'

import { billStatusBadgeVariant } from './shared'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type { TaxBillStatusReportRow } from '@repo/corporation-tax'

export function BillStatusReportGrid(props: {
	rows: TaxBillStatusReportRow[]
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
	const columnHelper = createMRTColumnHelper<TaxBillStatusReportRow>()
	const columns = useMemo<Array<MRT_ColumnDef<TaxBillStatusReportRow>>>(
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
			columnHelper.accessor('issueDate', {
				header: 'Issue Date',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDateTime(row.original.issueDate),
			}),
			columnHelper.accessor('dueDate', {
				header: 'Due Date',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDateTime(row.original.dueDate),
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
			emptyMessage="No bill status rows found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			pageCount={props.pageCount}
			rowCount={props.rowCount}
		/>
	)
}
