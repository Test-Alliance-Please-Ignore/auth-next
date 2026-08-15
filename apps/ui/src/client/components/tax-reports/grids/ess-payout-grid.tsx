import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
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
	const columns = useMemo(
		() => [
			{
				id: 'entryDate',
				header: 'Date',
				sortable: true,
				cell: (row: TaxEssPayoutRow) => formatTaxDateTime(row.entryDate),
			},
			{
				id: 'corporationId',
				header: 'Corporation',
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
				header: 'Division',
				sortable: true,
				cell: (row: TaxEssPayoutRow) => formatTaxDivisionLabel(row.division),
			},
			{
				id: 'amount',
				header: 'Amount',
				sortable: true,
				cell: (row: TaxEssPayoutRow) => formatTaxIskFull(row.amount),
			},
			{
				id: 'firstPartyId',
				header: 'Sender',
				cell: (row: TaxEssPayoutRow) => (
					<TaxEntityDisplay entityId={row.firstPartyId} entityNames={props.entityNames} />
				),
			},
			{
				id: 'secondPartyId',
				header: 'Recipient',
				cell: (row: TaxEssPayoutRow) => (
					<TaxEntityDisplay entityId={row.secondPartyId} entityNames={props.entityNames} />
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
			emptyMessage="No ESS rows found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel="ESS rows"
			getRowKey={(row) => row.id}
		/>
	)
}
