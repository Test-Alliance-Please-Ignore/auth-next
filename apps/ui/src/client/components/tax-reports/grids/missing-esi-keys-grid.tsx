import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
import { Badge } from '@/components/ui/badge'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxNumber, TaxCorporationDisplay } from '@/lib/tax-display'

import type { TaxMissingEsiKeyRow } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export function MissingEsiKeysGrid(props: {
	rows: TaxMissingEsiKeyRow[]
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
				cell: (row: TaxMissingEsiKeyRow) => (
					<TaxCorporationDisplay
						corporationId={row.corporationId}
						entityNames={props.entityNames}
					/>
				),
			},
			{
				id: 'isConfigured',
				header: 'Configured',
				cell: (row: TaxMissingEsiKeyRow) => (row.isConfigured ? 'yes' : 'no'),
			},
			{
				id: 'missingRequiredScopes',
				header: 'Required Scopes',
				cell: (row: TaxMissingEsiKeyRow) =>
					row.missingRequiredScopes.length > 0 ? row.missingRequiredScopes.join(', ') : 'complete',
			},
			{
				id: 'healthyDirectorCount',
				header: 'Healthy Directors',
				sortable: true,
				cell: (row: TaxMissingEsiKeyRow) => (
					<Badge variant={row.healthyDirectorCount > 0 ? 'success' : 'destructive'}>
						{`${formatTaxNumber(row.healthyDirectorCount)}/${formatTaxNumber(row.directorCount)}`}
					</Badge>
				),
			},
			{
				id: 'lastVerified',
				header: 'Last Verified',
				sortable: true,
				cell: (row: TaxMissingEsiKeyRow) => formatTaxDateTime(row.lastVerified),
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
			emptyMessage="No missing ESI key coverage found."
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
