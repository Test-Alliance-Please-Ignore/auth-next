import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { billStatusBadgeVariant } from '@/components/tax-reports/grids/shared'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Badge } from '@/components/ui/badge'
import { useTaxCorporationBillEventHistory } from '@/hooks/corporation-tax'
import { useAppTranslation } from '@/i18n'
import { formatTaxDate } from '@/lib/tax-date'

import type {
	TaxBillingEventHistoryRow,
	TaxBillingEventSortBy,
	TaxBillStatus,
} from '@repo/corporation-tax'

export function CorporationBillHistoryCard(props: {
	effectiveCorporationId: string | null
	canView: boolean
}) {
	const { t } = useAppTranslation()

	const grid = useReportGridState({
		defaultSortBy: 'createdAt',
		defaultSortDir: 'desc',
		defaultPageSize: 25,
		resetOn: props.effectiveCorporationId,
	})
	const {
		data,
		isFetching: isLoading,
		error,
	} = useTaxCorporationBillEventHistory(props.effectiveCorporationId ?? undefined, {
		limit: grid.limit,
		offset: grid.offset,
		sortBy: grid.sortBy as TaxBillingEventSortBy,
		sortDir: grid.sortDir,
		enabled: props.canView,
	})
	const rows = data?.rows ?? []
	const columns = useMemo(
		() => [
			{
				id: 'createdAt',
				header: t('tax.eventTime'),
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => formatTaxDate(row.createdAt),
			},
			{
				id: 'eventType',
				header: t('tax.event'),
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => row.eventType,
			},
			{
				id: 'billId',
				header: t('tax.bill'),
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => (
					<span className="font-mono text-xs">{row.billId}</span>
				),
			},
			{
				id: 'assessmentId',
				header: t('tax.assessment'),
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => (
					<span className="font-mono text-xs">{row.assessmentId}</span>
				),
			},
			{
				id: 'statusTransition',
				header: t('tax.transition'),
				sortable: false,
				cell: (row: TaxBillingEventHistoryRow) => {
					if (!row.fromStatus && !row.toStatus) return '-'
					return (
						<div className="flex items-center gap-2">
							<Badge
								variant={billStatusBadgeVariant(
									(row.fromStatus as TaxBillStatus | null) ?? 'draft'
								)}
							>
								{row.fromStatus ?? 'none'}
							</Badge>
							<span className="text-muted-foreground">→</span>
							<Badge
								variant={billStatusBadgeVariant((row.toStatus as TaxBillStatus | null) ?? 'draft')}
							>
								{row.toStatus ?? 'none'}
							</Badge>
						</div>
					)
				},
			},
			{
				id: 'actorUserId',
				header: t('tax.actor'),
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => (
					<span className="font-mono text-xs">{row.actorUserId ?? '-'}</span>
				),
			},
		],
		[t]
	)

	if (!props.effectiveCorporationId) {
		return (
			<div className="py-8 text-sm text-muted-foreground">
				{t('tax.selectACorporationToViewAssessmentBillHistory')}
			</div>
		)
	}

	return (
		<DataTable
			variant="plain"
			errorMessage={t('tax.failedToLoadReport')}
			columns={columns}
			rows={rows}
			loading={isLoading}
			error={error}
			emptyMessage={t('tax.noBillHistoryEntriesWereFoundForThisCorporation')}
			pagination={grid.pagination}
			onPaginationChange={grid.onPaginationChange}
			rowCount={data?.totalRows ?? 0}
			itemLabel={t('tax.events')}
			sorting={grid.sorting}
			onSortingChange={grid.onSortingChange}
			getRowKey={(row) => row.id}
		/>
	)
}
