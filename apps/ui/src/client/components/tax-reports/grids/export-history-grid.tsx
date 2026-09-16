import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppTranslation } from '@/i18n'
import { formatTaxDateTime } from '@/lib/tax-date'
import {
	formatTaxNumber,
	formatTaxReportTypeLabel,
	formatTaxStatus,
	TaxCorporationDisplay,
} from '@/lib/tax-display'

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
	const { t } = useAppTranslation()

	const columns = useMemo(
		() => [
			{
				id: 'requestedAt',
				header: t('tax.requestedAt'),
				sortable: true,
				cell: (row: TaxExportRecord) => formatTaxDateTime(row.requestedAt),
			},
			{
				id: 'corporationId',
				header: t('tax.corporation'),
				sortable: true,
				cell: (row: TaxExportRecord) =>
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
				cell: (row: TaxExportRecord) => formatTaxReportTypeLabel(row.reportType),
			},
			{
				id: 'format',
				header: t('tax.format'),
				sortable: true,
				cell: (row: TaxExportRecord) => row.format.toUpperCase(),
			},
			{
				id: 'status',
				header: t('tax.status'),
				sortable: true,
				cell: (row: TaxExportRecord) => (
					<Badge variant={row.status === 'failed' ? 'destructive' : 'ghost'}>
						{formatTaxStatus(row.status)}
					</Badge>
				),
			},
			{
				id: 'rowCount',
				header: t('tax.rows'),
				sortable: true,
				cell: (row: TaxExportRecord) => formatTaxNumber(row.rowCount),
			},
			{
				id: 'completedAt',
				header: t('tax.completed'),
				sortable: true,
				cell: (row: TaxExportRecord) => formatTaxDateTime(row.completedAt),
			},
			{
				id: 'download',
				header: t('tax.download'),
				className: 'text-right',
				headerClassName: 'text-right',
				cell: (row: TaxExportRecord) => (
					<Button
						variant="ghost"
						size="sm"
						disabled={row.status !== 'completed' || props.downloading}
						onClick={() => props.onDownload(row.id)}
					>
						{props.downloading ? t('tax.preparing') : t('tax.download')}
					</Button>
				),
			},
		],
		[props.downloading, props.entityNames, props.onDownload, t]
	)
	return (
		<DataTable
			variant="plain"
			errorMessage={t('tax.failedToLoadReport')}
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage={t('tax.noExportRunsFound')}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel={t('tax.exports')}
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			getRowKey={(row) => row.id}
		/>
	)
}
