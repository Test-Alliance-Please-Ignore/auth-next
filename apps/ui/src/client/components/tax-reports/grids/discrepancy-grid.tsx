import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { useAppTranslation } from '@/i18n'
import { formatTaxDateTime } from '@/lib/tax-date'
import { TaxCorporationDisplay } from '@/lib/tax-display'

import { toJsonPreview } from './shared'

import type { TaxDiscrepancy } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export function DiscrepancyGrid(props: {
	rows: TaxDiscrepancy[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	sorting: TaxReportSortingState
	onSortingChange: (sorting: TaxReportSortingState) => void
	pagination: { pageIndex: number; pageSize: number }
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	rowCount: number
}) {
	const { t } = useAppTranslation()

	const columns = useMemo(
		() => [
			{
				id: 'corporationId',
				header: t('tax.corporation'),
				sortable: true,
				cell: (row: TaxDiscrepancy) => (
					<TaxCorporationDisplay
						corporationId={row.corporationId}
						entityNames={props.entityNames}
					/>
				),
			},
			{
				id: 'discrepancyType',
				header: t('tax.type'),
				sortable: true,
				cell: (row: TaxDiscrepancy) => row.discrepancyType,
			},
			{
				id: 'severity',
				header: t('tax.severity'),
				sortable: true,
				cell: (row: TaxDiscrepancy) => row.severity,
			},
			{
				id: 'assessmentId',
				header: t('tax.assessment'),
				cell: (row: TaxDiscrepancy) => row.assessmentId ?? '-',
			},
			{
				id: 'createdAt',
				header: t('tax.created'),
				sortable: true,
				cell: (row: TaxDiscrepancy) => formatTaxDateTime(row.createdAt),
			},
			{
				id: 'details',
				header: t('tax.details'),
				cell: (row: TaxDiscrepancy) => (
					<div className="max-w-[24rem] truncate">{toJsonPreview(row.details)}</div>
				),
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
			emptyMessage={t('tax.noOpenDiscrepanciesFound')}
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel={t('tax.discrepancies')}
			getRowKey={(row) => row.id}
		/>
	)
}
