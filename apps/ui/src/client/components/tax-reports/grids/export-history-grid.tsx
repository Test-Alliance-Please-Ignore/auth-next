import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { Badge } from '@/components/ui/badge'
import { GhostButton } from '@/components/ui/ghost-button'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxNumber, TaxEntityDisplay } from '@/lib/tax-display'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { TaxExportRecord } from '@repo/corporation-tax'

export function ExportHistoryGrid(props: {
	rows: TaxExportRecord[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	onDownload: (exportId: string) => void
	downloading: boolean
}) {
	const columns = useMemo<MRT_ColumnDef<TaxExportRecord>[]>(
		() => [
			{
				id: 'requestedAt',
				accessorFn: (row) => new Date(row.requestedAt).getTime(),
				header: 'Requested At',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxDateTime(row.original.requestedAt),
			},
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) =>
					row.original.corporationId ? (
						<TaxEntityDisplay
							entityId={row.original.corporationId}
							entityNames={props.entityNames}
						/>
					) : (
						'Global'
					),
			},
			{ accessorKey: 'reportType', header: 'Report', enableSorting: true },
			{
				accessorKey: 'format',
				header: 'Format',
				enableSorting: true,
				Cell: ({ row }) => row.original.format.toUpperCase(),
			},
			{
				accessorKey: 'status',
				header: 'Status',
				enableSorting: true,
				Cell: ({ row }) => (
					<Badge variant={row.original.status === 'failed' ? 'destructive' : 'outline'}>
						{row.original.status}
					</Badge>
				),
			},
			{
				accessorKey: 'rowCount',
				header: 'Rows',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxNumber(row.original.rowCount),
			},
			{
				id: 'completedAt',
				accessorFn: (row) =>
					row.completedAt ? new Date(row.completedAt).getTime() : Number.NEGATIVE_INFINITY,
				header: 'Completed',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxDateTime(row.original.completedAt),
			},
			{
				id: 'download',
				header: 'Download',
				enableSorting: false,
				Cell: ({ row }) => (
					<GhostButton
						size="sm"
						disabled={row.original.status !== 'completed' || props.downloading}
						onClick={() => props.onDownload(row.original.id)}
					>
						{props.downloading ? 'Preparing...' : 'Download'}
					</GhostButton>
				),
			},
		],
		[props.entityNames, props.downloading, props.onDownload]
	)
	return (
		<TaxReportDataGrid
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No export runs found."
		/>
	)
}
