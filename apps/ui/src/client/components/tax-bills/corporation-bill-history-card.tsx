import { useMemo } from 'react'

import { TaxReportTable } from '@/components/tax-report-table'
import { billStatusBadgeVariant } from '@/components/tax-reports/grids/shared'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Badge } from '@/components/ui/badge'
import { useTaxCorporationBillEventHistory } from '@/hooks/corporation-tax'
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
				header: 'Event Time',
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => formatTaxDate(row.createdAt),
			},
			{
				id: 'eventType',
				header: 'Event',
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => row.eventType,
			},
			{
				id: 'billId',
				header: 'Bill',
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => (
					<span className="font-mono text-xs">{row.billId}</span>
				),
			},
			{
				id: 'assessmentId',
				header: 'Assessment',
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => (
					<span className="font-mono text-xs">{row.assessmentId}</span>
				),
			},
			{
				id: 'statusTransition',
				header: 'Transition',
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
				header: 'Actor',
				sortable: true,
				cell: (row: TaxBillingEventHistoryRow) => (
					<span className="font-mono text-xs">{row.actorUserId ?? '-'}</span>
				),
			},
		],
		[]
	)

	if (!props.effectiveCorporationId) {
		return (
			<div className="py-8 text-sm text-muted-foreground">
				Select a corporation to view assessment bill history.
			</div>
		)
	}

	return (
		<TaxReportTable
			columns={columns}
			rows={rows}
			loading={isLoading}
			error={error}
			emptyMessage="No bill history entries were found for this corporation."
			pagination={grid.pagination}
			onPaginationChange={grid.onPaginationChange}
			rowCount={data?.totalRows ?? 0}
			itemLabel="events"
			sorting={grid.sorting}
			onSortingChange={grid.onSortingChange}
			getRowKey={(row) => row.id}
		/>
	)
}
