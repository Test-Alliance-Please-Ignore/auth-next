import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { useAppTranslation } from '@/i18n'
import { formatTaxDateTime } from '@/lib/tax-date'
import {
	formatTaxDivisionLabel,
	formatTaxIskFull,
	TaxCorporationDisplay,
	TaxEntityDisplay,
} from '@/lib/tax-display'

import type { TaxEssPayoutRow } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export function EssPayoutGrid(props: {
	rows: TaxEssPayoutRow[]
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
				id: 'entryDate',
				header: t('tax.date'),
				sortable: true,
				cell: (row: TaxEssPayoutRow) => formatTaxDateTime(row.entryDate),
			},
			{
				id: 'corporationId',
				header: t('tax.corporation'),
				sortable: true,
				cell: (row: TaxEssPayoutRow) => (
					<TaxCorporationDisplay
						corporationId={row.corporationId}
						entityNames={props.entityNames}
					/>
				),
			},
			{
				id: 'division',
				header: t('tax.division'),
				sortable: true,
				cell: (row: TaxEssPayoutRow) => formatTaxDivisionLabel(row.division),
			},
			{
				id: 'amount',
				header: t('tax.amount'),
				sortable: true,
				cell: (row: TaxEssPayoutRow) => formatTaxIskFull(row.amount),
			},
			{
				id: 'firstPartyId',
				header: t('tax.sender'),
				cell: (row: TaxEssPayoutRow) => (
					<TaxEntityDisplay entityId={row.firstPartyId} entityNames={props.entityNames} />
				),
			},
			{
				id: 'secondPartyId',
				header: t('tax.recipient'),
				cell: (row: TaxEssPayoutRow) => (
					<TaxEntityDisplay entityId={row.secondPartyId} entityNames={props.entityNames} />
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
			emptyMessage={t('tax.noEssRowsFound')}
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel={t('tax.essRows')}
			getRowKey={(row) => row.id}
		/>
	)
}
