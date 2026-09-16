import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { useAppTranslation } from '@/i18n'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxIskFull, formatTaxNumber } from '@/lib/tax-display'

import type { TaxCompliancePoint } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export function ComplianceGrid(props: {
	rows: TaxCompliancePoint[]
	loading: boolean
	error: unknown
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
				id: 'rollupDate',
				header: t('tax.date'),
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxDateTime(row.rollupDate),
			},
			{
				id: 'taxDue',
				header: t('tax.taxDue'),
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxPaid',
				header: t('tax.taxPaid'),
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxIskFull(row.taxPaid),
			},
			{
				id: 'taxDelta',
				header: t('tax.delta'),
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxIskFull(row.taxDelta),
			},
			{
				id: 'entryCount',
				header: t('tax.entries'),
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxNumber(row.entryCount),
			},
		],
		[t]
	)

	return (
		<DataTable
			variant="plain"
			errorMessage={t('tax.failedToLoadReport')}
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage={t('tax.noComplianceTrendPointsAvailable')}
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel={t('tax.periods')}
			getRowKey={(row) => row.rollupDate.toISOString()}
		/>
	)
}
