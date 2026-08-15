import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
import { Badge } from '@/components/ui/badge'
import { formatTaxDateTime } from '@/lib/tax-date'
import { TaxCorporationDisplay } from '@/lib/tax-display'

import type { TaxExportSchedule } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export function ExportSchedulesGrid(props: {
	rows: TaxExportSchedule[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	pagination: { pageIndex: number; pageSize: number }
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	rowCount: number
	sorting: TaxReportSortingState
	onSortingChange: (sorting: TaxReportSortingState) => void
}) {
	const columns = useMemo(
		() => [
			{ id: 'name', header: 'Name', sortable: true, cell: (row: TaxExportSchedule) => row.name },
			{
				id: 'corporationId',
				header: 'Corporation',
				sortable: true,
				cell: (row: TaxExportSchedule) =>
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
				cell: (row: TaxExportSchedule) => row.reportType,
			},
			{
				id: 'format',
				header: 'Format',
				sortable: true,
				cell: (row: TaxExportSchedule) => row.format.toUpperCase(),
			},
			{
				id: 'frequency',
				header: 'Frequency',
				sortable: true,
				cell: (row: TaxExportSchedule) => row.frequency,
			},
			{
				id: 'isActive',
				header: 'Active',
				sortable: true,
				cell: (row: TaxExportSchedule) => (
					<Badge variant={row.isActive ? 'default' : 'secondary'}>
						{row.isActive ? 'active' : 'paused'}
					</Badge>
				),
			},
			{
				id: 'nextRunAt',
				header: 'Next Run',
				sortable: true,
				cell: (row: TaxExportSchedule) => formatTaxDateTime(row.nextRunAt),
			},
			{
				id: 'lastRunAt',
				header: 'Last Run',
				sortable: true,
				cell: (row: TaxExportSchedule) => formatTaxDateTime(row.lastRunAt),
			},
		],
		[props.entityNames]
	)
	return (
		<TaxReportTable
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No export schedules found."
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel="schedules"
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			getRowKey={(row) => row.id}
		/>
	)
}
