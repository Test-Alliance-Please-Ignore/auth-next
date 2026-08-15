import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
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
	const columns = useMemo(
		() => [
			{
				id: 'corporationId',
				header: 'Corporation',
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
				header: 'Type',
				sortable: true,
				cell: (row: TaxDiscrepancy) => row.discrepancyType,
			},
			{
				id: 'severity',
				header: 'Severity',
				sortable: true,
				cell: (row: TaxDiscrepancy) => row.severity,
			},
			{
				id: 'assessmentId',
				header: 'Assessment',
				cell: (row: TaxDiscrepancy) => row.assessmentId ?? '-',
			},
			{
				id: 'createdAt',
				header: 'Created',
				sortable: true,
				cell: (row: TaxDiscrepancy) => formatTaxDateTime(row.createdAt),
			},
			{
				id: 'details',
				header: 'Details',
				cell: (row: TaxDiscrepancy) => (
					<div className="max-w-[24rem] truncate">{toJsonPreview(row.details)}</div>
				),
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
			emptyMessage="No open discrepancies found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel="discrepancies"
			getRowKey={(row) => row.id}
		/>
	)
}
