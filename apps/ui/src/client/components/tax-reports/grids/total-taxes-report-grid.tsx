import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { useAppTranslation } from '@/i18n'
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
	const { t } = useAppTranslation()

	const columns = useMemo(
		() => [
			{
				id: 'corporationId',
				header: t('tax.corporation'),
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
				header: t('tax.taxableItems'),
				sortable: true,
				cell: (row: TaxTotalTaxesByCorporationRow) => formatTaxNumber(row.taxableItemCount),
			},
			{
				id: 'taxDue',
				header: t('tax.taxDue'),
				sortable: true,
				cell: (row: TaxTotalTaxesByCorporationRow) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxPaid',
				header: t('tax.taxPaid'),
				sortable: true,
				cell: (row: TaxTotalTaxesByCorporationRow) => formatTaxIskFull(row.taxPaid),
			},
			{
				id: 'taxDelta',
				header: t('tax.delta'),
				sortable: true,
				cell: (row: TaxTotalTaxesByCorporationRow) => formatTaxIskFull(row.taxDelta),
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
			emptyMessage={t('tax.noTotalsFound')}
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel={t('tax.corporations')}
			getRowKey={(row) => row.corporationId}
		/>
	)
}
