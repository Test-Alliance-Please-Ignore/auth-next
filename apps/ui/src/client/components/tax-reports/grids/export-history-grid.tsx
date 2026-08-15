import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxNumber, TaxCorporationDisplay } from '@/lib/tax-display'

import type { TaxExportRecord } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export function ExportHistoryGrid(props: {
	rows: TaxExportRecord[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	onDownload: (exportId: string) => void
	downloading: boolean
	pagination: { pageIndex: number; pageSize: number }
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	rowCount: number
	sorting: TaxReportSortingState
	onSortingChange: (sorting: TaxReportSortingState) => void
}) {
	const columns = useMemo(
		() => [
			{
				id: 'requestedAt',
				header: 'Requested At',
				sortable: true,
				cell: (row: TaxExportRecord) => formatTaxDateTime(row.requestedAt),
			},
			{
				id: 'corporationId',
				header: 'Corporation',
				sortable: true,
				cell: (row: TaxExportRecord) =>
					row.corporationId ? (
						<TaxCorporationDisplay
							corporationId={row.corporationId}
							entityNames={props.entityNames}
						/>
					) : (
						'Global'
					),
			},
			{
				id: 'reportType',
				header: 'Report',
				sortable: true,
				cell: (row: TaxExportRecord) => row.reportType,
			},
			{
				id: 'format',
				header: 'Format',
				sortable: true,
				cell: (row: TaxExportRecord) => row.format.toUpperCase(),
			},
			{
				id: 'status',
				header: 'Status',
				sortable: true,
				cell: (row: TaxExportRecord) => (
					<Badge variant={row.status === 'failed' ? 'destructive' : 'ghost'}>{row.status}</Badge>
				),
			},
			{
				id: 'rowCount',
				header: 'Rows',
				sortable: true,
				cell: (row: TaxExportRecord) => formatTaxNumber(row.rowCount),
			},
			{
				id: 'completedAt',
				header: 'Completed',
				sortable: true,
				cell: (row: TaxExportRecord) => formatTaxDateTime(row.completedAt),
			},
			{
				id: 'download',
				header: 'Download',
				className: 'text-right',
				headerClassName: 'text-right',
				cell: (row: TaxExportRecord) => (
					<Button
						variant="ghost"
						size="sm"
						disabled={row.status !== 'completed' || props.downloading}
						onClick={() => props.onDownload(row.id)}
					>
						{props.downloading ? 'Preparing...' : 'Download'}
					</Button>
				),
			},
		],
		[props.downloading, props.entityNames, props.onDownload]
	)
	return (
		<TaxReportTable
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No export runs found."
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel="exports"
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			getRowKey={(row) => row.id}
		/>
	)
}
