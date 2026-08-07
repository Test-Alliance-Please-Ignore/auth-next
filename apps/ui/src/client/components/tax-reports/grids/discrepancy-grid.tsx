import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatTaxDateTime } from '@/lib/tax-date'
import { TaxEntityDisplay } from '@/lib/tax-display'

import { toJsonPreview } from './shared'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type { TaxDiscrepancy } from '@repo/corporation-tax'

export function DiscrepancyGrid(props: {
	rows: TaxDiscrepancy[]
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
	const columns = useMemo<Array<MRT_ColumnDef<TaxDiscrepancy>>>(
		() => [
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={props.entityNames} />
				),
			},
			{ accessorKey: 'discrepancyType', header: 'Type', enableSorting: true },
			{ accessorKey: 'severity', header: 'Severity', enableSorting: true },
			{
				accessorKey: 'assessmentId',
				header: 'Assessment',
				enableSorting: false,
				Cell: ({ row }) => row.original.assessmentId ?? '-',
			},
			{
				accessorKey: 'createdAt',
				header: 'Created',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDateTime(row.original.createdAt),
			},
			{
				accessorKey: 'details',
				header: 'Details',
				enableSorting: false,
				Cell: ({ row }) => (
					<div className="max-w-[24rem] truncate">{toJsonPreview(row.original.details)}</div>
				),
			},
		],
		[props.entityNames]
	)

	return (
		<TaxReportDataGrid
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No open discrepancies found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			pageCount={props.pageCount}
			rowCount={props.rowCount}
		/>
	)
}
