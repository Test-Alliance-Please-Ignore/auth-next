import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'
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
	const { t } = useAppTranslation()

	const columns = useMemo(
		() => [
			{
				id: 'corporationId',
				header: t('tax.corporation'),
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
				header: t('tax.configured'),
				cell: (row: TaxMissingEsiKeyRow) => (row.isConfigured ? 'yes' : 'no'),
			},
			{
				id: 'missingRequiredScopes',
				header: t('tax.requiredScopes'),
				cell: (row: TaxMissingEsiKeyRow) =>
					row.missingRequiredScopes.length > 0 ? row.missingRequiredScopes.join(', ') : 'complete',
			},
			{
				id: 'healthyDirectorCount',
				header: t('tax.healthyDirectors'),
				sortable: true,
				cell: (row: TaxMissingEsiKeyRow) => (
					<Badge variant={row.healthyDirectorCount > 0 ? 'success' : 'destructive'}>
						{`${formatTaxNumber(row.healthyDirectorCount)}/${formatTaxNumber(row.directorCount)}`}
					</Badge>
				),
			},
			{
				id: 'lastVerified',
				header: t('tax.lastVerified'),
				sortable: true,
				cell: (row: TaxMissingEsiKeyRow) => formatTaxDateTime(row.lastVerified),
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
			emptyMessage={t('tax.noMissingEsiKeyCoverageFound')}
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
