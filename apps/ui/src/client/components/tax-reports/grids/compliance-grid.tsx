import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
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
	const columns = useMemo(
		() => [
			{
				id: 'rollupDate',
				header: 'Date',
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxDateTime(row.rollupDate),
			},
			{
				id: 'taxDue',
				header: 'Tax Due',
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxPaid',
				header: 'Tax Paid',
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxIskFull(row.taxPaid),
			},
			{
				id: 'taxDelta',
				header: 'Delta',
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxIskFull(row.taxDelta),
			},
			{
				id: 'entryCount',
				header: 'Entries',
				sortable: true,
				cell: (row: TaxCompliancePoint) => formatTaxNumber(row.entryCount),
			},
		],
		[]
	)

	return (
		<TaxReportTable
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No compliance trend points available."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel="periods"
			getRowKey={(row) => row.rollupDate.toISOString()}
		/>
	)
}
