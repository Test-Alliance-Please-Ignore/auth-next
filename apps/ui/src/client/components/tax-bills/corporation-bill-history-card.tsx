import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Badge } from '@/components/ui/badge'
import { useTaxCorporationBillEventHistory } from '@/hooks/corporation-tax'
import { formatTaxDate } from '@/lib/tax-date'

import { billStatusBadgeVariant } from './helpers'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type { BillStatus } from '@repo/bills'
import type { TaxBillingEventHistoryRow } from '@repo/corporation-tax'

type CorporationBillHistoryCardProps = {
	effectiveCorporationId: string | null
	canView: boolean
}

export function CorporationBillHistoryCard({
	effectiveCorporationId,
	canView,
}: CorporationBillHistoryCardProps) {
	const grid = useReportGridState({
		defaultSortBy: 'createdAt',
		defaultSortDir: 'desc',
		defaultPageSize: 25,
		resetOn: { effectiveCorporationId },
	})
	const { data, isLoading, error } = useTaxCorporationBillEventHistory(
		effectiveCorporationId ?? undefined,
		{
			limit: grid.limit,
			offset: grid.offset,
			enabled: canView,
		}
	)
	const billHistoryRows = data?.rows ?? []
	const rowCount = data?.totalRows ?? 0
	const pageCount = grid.pageCountFor(rowCount)

	const columns = useMemo<Array<MRT_ColumnDef<TaxBillingEventHistoryRow>>>(
		() => [
			{
				id: 'createdAt',
				accessorFn: (row) => new Date(row.createdAt).getTime(),
				header: 'Event Time',
				enableSorting: true,
				sortingFn: 'basic',
				Cell: ({ row }) => formatTaxDate(row.original.createdAt),
			},
			{
				accessorKey: 'eventType',
				header: 'Event',
				enableSorting: true,
			},
			{
				id: 'billId',
				accessorFn: (row) => row.billId,
				header: 'Bill',
				enableSorting: true,
				Cell: ({ row }) => <span className="font-mono text-xs">{row.original.billId}</span>,
			},
			{
				id: 'assessmentId',
				accessorFn: (row) => row.assessmentId,
				header: 'Assessment',
				enableSorting: true,
				Cell: ({ row }) => <span className="font-mono text-xs">{row.original.assessmentId}</span>,
			},
			{
				id: 'statusTransition',
				accessorFn: (row) => `${row.fromStatus ?? ''}:${row.toStatus ?? ''}`,
				header: 'Transition',
				enableSorting: true,
				Cell: ({ row }) => {
					if (!row.original.fromStatus && !row.original.toStatus) {
						return '-'
					}
					const fromStatus = row.original.fromStatus as BillStatus | null
					const toStatus = row.original.toStatus as BillStatus | null
					return (
						<div className="flex items-center gap-2">
							<Badge variant={billStatusBadgeVariant(fromStatus ?? 'unbilled')}>
								{row.original.fromStatus ?? 'none'}
							</Badge>
							<span className="text-muted-foreground">→</span>
							<Badge variant={billStatusBadgeVariant(toStatus ?? 'unbilled')}>
								{row.original.toStatus ?? 'none'}
							</Badge>
						</div>
					)
				},
			},
			{
				id: 'actor',
				accessorFn: (row) => row.actorUserId ?? '',
				header: 'Actor',
				enableSorting: true,
				Cell: ({ row }) => (
					<span className="font-mono text-xs">{row.original.actorUserId ?? '-'}</span>
				),
			},
		],
		[]
	)
	const sorting: MRT_SortingState = useMemo(() => [{ id: 'createdAt', desc: true }], [])

	const content = !effectiveCorporationId ? (
		<div className="py-8 text-sm text-muted-foreground">
			Select a corporation to view assessment bill history.
		</div>
	) : (
		<TaxReportDataGrid
			columns={columns}
			rows={billHistoryRows}
			loading={isLoading}
			error={error}
			sorting={sorting}
			pagination={grid.pagination}
			onPaginationChange={grid.onPaginationChange}
			rowCount={rowCount}
			pageCount={pageCount}
			emptyMessage="No bill history entries were found for this corporation."
		/>
	)

	return <div>{content}</div>
}
