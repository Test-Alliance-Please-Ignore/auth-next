import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxDivisionLabel, formatTaxIskFull, TaxEntityDisplay } from '@/lib/tax-display'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type { TaxEssPayoutRow } from '@repo/corporation-tax'

export function EssPayoutGrid(props: {
	rows: TaxEssPayoutRow[]
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
	const columns = useMemo<MRT_ColumnDef<TaxEssPayoutRow>[]>(
		() => [
			{
				accessorKey: 'entryDate',
				header: 'Date',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDateTime(row.original.entryDate),
			},
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={props.entityNames} />
				),
			},
			{
				accessorKey: 'division',
				header: 'Division',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDivisionLabel(row.original.division),
			},
			{
				accessorKey: 'amount',
				header: 'Amount',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.amount),
			},
			{
				accessorKey: 'firstPartyId',
				header: 'Sender',
				enableSorting: false,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.firstPartyId} entityNames={props.entityNames} />
				),
			},
			{
				accessorKey: 'secondPartyId',
				header: 'Recipient',
				enableSorting: false,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.secondPartyId} entityNames={props.entityNames} />
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
			emptyMessage="No ESS rows found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			pageCount={props.pageCount}
			rowCount={props.rowCount}
		/>
	)
}
