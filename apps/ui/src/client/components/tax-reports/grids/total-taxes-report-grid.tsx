import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
import { formatTaxIskFull, formatTaxNumber, TaxCorporationDisplay } from '@/lib/tax-display'

import type { TaxTotalTaxesByCorporationRow } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export function TotalTaxesReportGrid(props: {
	rows: TaxTotalTaxesByCorporationRow[]
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
				cell: (row: TaxTotalTaxesByCorporationRow) => (
					<TaxCorporationDisplay
						corporationId={row.corporationId}
						entityNames={props.entityNames}
					/>
				),
			},
			{
				id: 'taxableItemCount',
				header: 'Taxable Items',
				sortable: true,
				cell: (row: TaxTotalTaxesByCorporationRow) => formatTaxNumber(row.taxableItemCount),
			},
			{
				id: 'taxDue',
				header: 'Tax Due',
				sortable: true,
				cell: (row: TaxTotalTaxesByCorporationRow) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxPaid',
				header: 'Tax Paid',
				sortable: true,
				cell: (row: TaxTotalTaxesByCorporationRow) => formatTaxIskFull(row.taxPaid),
			},
			{
				id: 'taxDelta',
				header: 'Delta',
				sortable: true,
				cell: (row: TaxTotalTaxesByCorporationRow) => formatTaxIskFull(row.taxDelta),
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
			emptyMessage="No totals found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel="corporations"
			getRowKey={(row) => row.corporationId}
		/>
	)
}
