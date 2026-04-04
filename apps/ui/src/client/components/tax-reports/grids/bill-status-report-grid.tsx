import { createMRTColumnHelper } from 'mantine-react-table'
import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { Badge } from '@/components/ui/badge'
import { formatTaxDate } from '@/lib/tax-date'
import { formatTaxIskFull, TaxEntityDisplay } from '@/lib/tax-display'

import { billStatusBadgeVariant } from './shared'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type { TaxBillStatusReportRow } from '@repo/corporation-tax'
import { Button } from '@/components/ui/button'

export function BillStatusReportGrid(props: {
	rows: TaxBillStatusReportRow[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	sorting: MRT_SortingState
	onSortingChange: (sorting: MRT_SortingState) => void
	pagination: {
		pageIndex: number
		pageSize: number
	}
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	pageCount: number
	rowCount: number
	canManage?: boolean
	onSyncBillStatus?: (assessmentId: string) => void
	onRetractBill?: (assessmentId: string) => void
	syncBillPending?: boolean
	retractBillPending?: boolean
}) {
	const columnHelper = createMRTColumnHelper<TaxBillStatusReportRow>()
	const columns = useMemo<Array<MRT_ColumnDef<TaxBillStatusReportRow>>>(
		() => [
			columnHelper.accessor('billStatus', {
				header: 'Bill Status',
				enableSorting: true,
				Cell: ({ row }) => (
					<Badge variant={billStatusBadgeVariant(row.original.billStatus)}>
						{row.original.billStatus}
					</Badge>
				),
			}),
			columnHelper.accessor('corporationId', {
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={props.entityNames} />
				),
			}),
			columnHelper.accessor('taxPeriodStart', {
				header: 'Period Start',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDate(row.original.taxPeriodStart),
			}),
			columnHelper.accessor('taxPeriodEnd', {
				header: 'Period End',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDate(row.original.taxPeriodEnd),
			}),
			columnHelper.accessor('issueDate', {
				header: 'Issue Date',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDate(row.original.issueDate),
			}),
			columnHelper.accessor('dueDate', {
				header: 'Due Date',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDate(row.original.dueDate),
			}),
			columnHelper.accessor('taxDueCenti', {
				id: 'taxDue',
				header: 'Tax Due',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDue),
			}),
			columnHelper.accessor('taxPaidCenti', {
				id: 'taxPaid',
				header: 'Tax Paid',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.taxPaid),
			}),
			columnHelper.accessor('taxDeltaCenti', {
				id: 'taxDelta',
				header: 'Delta',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDelta),
			}),
			columnHelper.display({
				id: 'actions',
				header: 'Actions',
				enableSorting: false,
				Cell: ({ row }) => {
					const billStatus = row.original.billStatus
					const canSync = billStatus === 'issued' || billStatus === 'overdue'
					const canRetract = billStatus === 'issued' || billStatus === 'overdue'
					const busy = props.syncBillPending || props.retractBillPending
					if (!props.canManage) {
						return <span className="text-xs text-muted-foreground">-</span>
					}
					return (
						<div className="flex items-center justify-end gap-2">
							{canSync ? (
								<Button variant="primary"
									size="sm"
									disabled={Boolean(busy) || !props.onSyncBillStatus}
									onClick={() => props.onSyncBillStatus?.(row.original.assessmentId)}
								>
									{props.syncBillPending ? 'Syncing...' : 'Sync'}
								</Button>
							) : null}
							{canRetract ? (
								<Button variant="danger"
									size="sm"
									showIcon={false}
									disabled={Boolean(busy) || !props.onRetractBill}
									onClick={() => props.onRetractBill?.(row.original.assessmentId)}
								>
									{props.retractBillPending ? 'Retracting...' : 'Retract'}
								</Button>
							) : null}
							{!canSync && !canRetract ? (
								<span className="text-xs text-muted-foreground">No actions</span>
							) : null}
						</div>
					)
				},
			}),
		],
		[
			columnHelper,
			props.canManage,
			props.entityNames,
			props.retractBillPending,
			props.syncBillPending,
		]
	)

	return (
		<TaxReportDataGrid
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No bill status rows found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			pageCount={props.pageCount}
			rowCount={props.rowCount}
			pinnedRightColumnIds={['actions']}
		/>
	)
}
