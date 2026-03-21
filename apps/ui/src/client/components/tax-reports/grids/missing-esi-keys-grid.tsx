import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxNumber, TaxEntityDisplay } from '@/lib/tax-display'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type { TaxMissingEsiKeyRow } from '@repo/corporation-tax'

export function MissingEsiKeysGrid(props: {
	rows: TaxMissingEsiKeyRow[]
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
	const columns = useMemo<MRT_ColumnDef<TaxMissingEsiKeyRow>[]>(
		() => [
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={props.entityNames} />
				),
			},
			{
				accessorKey: 'isConfigured',
				header: 'Configured',
				enableSorting: false,
				Cell: ({ row }) => (row.original.isConfigured ? 'yes' : 'no'),
			},
			{
				accessorKey: 'missingRequiredScopes',
				header: 'Required Scopes',
				enableSorting: false,
				Cell: ({ row }) =>
					row.original.missingRequiredScopes.length > 0
						? row.original.missingRequiredScopes.join(', ')
						: 'complete',
			},
			{
				accessorKey: 'healthyDirectorCount',
				header: 'Healthy Directors',
				enableSorting: true,
				Cell: ({ row }) =>
					`${formatTaxNumber(row.original.healthyDirectorCount)}/${formatTaxNumber(row.original.directorCount)}`,
			},
			{
				accessorKey: 'lastVerified',
				header: 'Last Verified',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDateTime(row.original.lastVerified),
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
			emptyMessage="No missing ESI key coverage found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			pageCount={props.pageCount}
			rowCount={props.rowCount}
		/>
	)
}
