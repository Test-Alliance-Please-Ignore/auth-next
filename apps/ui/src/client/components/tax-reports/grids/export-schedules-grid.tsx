import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { Badge } from '@/components/ui/badge'
import { formatTaxDateTime } from '@/lib/tax-date'
import { TaxEntityDisplay } from '@/lib/tax-display'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { TaxExportSchedule } from '@repo/corporation-tax'

export function ExportSchedulesGrid(props: {
	rows: TaxExportSchedule[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
}) {
	const columns = useMemo<MRT_ColumnDef<TaxExportSchedule>[]>(
		() => [
			{ accessorKey: 'name', header: 'Name', enableSorting: true },
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
			{ accessorKey: 'frequency', header: 'Frequency', enableSorting: true },
			{
				accessorKey: 'isActive',
				header: 'Active',
				enableSorting: true,
				Cell: ({ row }) => (
					<Badge variant={row.original.isActive ? 'default' : 'secondary'}>
						{row.original.isActive ? 'active' : 'paused'}
					</Badge>
				),
			},
			{
				id: 'nextRunAt',
				accessorFn: (row) =>
					row.nextRunAt ? new Date(row.nextRunAt).getTime() : Number.NEGATIVE_INFINITY,
				header: 'Next Run',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxDateTime(row.original.nextRunAt),
			},
			{
				id: 'lastRunAt',
				accessorFn: (row) =>
					row.lastRunAt ? new Date(row.lastRunAt).getTime() : Number.NEGATIVE_INFINITY,
				header: 'Last Run',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxDateTime(row.original.lastRunAt),
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
			emptyMessage="No export schedules found."
		/>
	)
}
