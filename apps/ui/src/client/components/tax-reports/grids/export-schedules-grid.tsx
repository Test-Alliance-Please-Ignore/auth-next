import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxReportTypeLabel, formatTaxStatus, TaxCorporationDisplay } from '@/lib/tax-display'

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
	const { t } = useAppTranslation()

	const columns = useMemo(
		() => [
			{
				id: 'name',
				header: t('tax.name'),
				sortable: true,
				cell: (row: TaxExportSchedule) => row.name,
			},
			{
				id: 'corporationId',
				header: t('tax.corporation'),
				sortable: true,
				cell: (row: TaxExportSchedule) =>
					row.corporationId ? (
						<TaxCorporationDisplay
							corporationId={row.corporationId}
							entityNames={props.entityNames}
						/>
					) : (
						t('tax.global')
					),
			},
			{
				id: 'reportType',
				header: t('tax.report'),
				sortable: true,
				cell: (row: TaxExportSchedule) => formatTaxReportTypeLabel(row.reportType),
			},
			{
				id: 'format',
				header: t('tax.format'),
				sortable: true,
				cell: (row: TaxExportSchedule) => row.format.toUpperCase(),
			},
			{
				id: 'frequency',
				header: t('tax.frequency'),
				sortable: true,
				cell: (row: TaxExportSchedule) =>
					row.frequency === 'weekly' ? t('tax.weekly') : t('tax.monthly'),
			},
			{
				id: 'isActive',
				header: t('tax.active'),
				sortable: true,
				cell: (row: TaxExportSchedule) => (
					<Badge variant={row.isActive ? 'default' : 'secondary'}>
						{formatTaxStatus(row.isActive ? 'active' : 'paused')}
					</Badge>
				),
			},
			{
				id: 'nextRunAt',
				header: t('tax.nextRun'),
				sortable: true,
				cell: (row: TaxExportSchedule) => formatTaxDateTime(row.nextRunAt),
			},
			{
				id: 'lastRunAt',
				header: t('tax.lastRun'),
				sortable: true,
				cell: (row: TaxExportSchedule) => formatTaxDateTime(row.lastRunAt),
			},
		],
		[props.entityNames, t]
	)
	return (
		<DataTable
			variant="plain"
			errorMessage={t('tax.failedToLoadReport')}
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage={t('tax.noExportSchedulesFound')}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel={t('tax.schedules')}
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			getRowKey={(row) => row.id}
		/>
	)
}
