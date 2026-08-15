import { useMemo } from 'react'

import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { TaxReportTable } from '@/components/tax-report-table'
import { Button } from '@/components/ui/button'
import { formatTaxDate } from '@/lib/tax-date'
import { formatTaxIskFull, TaxCorporationDisplay } from '@/lib/tax-display'

import type { TaxBillStatusReportRow } from '@repo/corporation-tax'
import type { TaxReportSortingState } from '@/lib/tax-report-utils'

export function BillStatusReportGrid(props: {
	rows: TaxBillStatusReportRow[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	sorting: TaxReportSortingState
	onSortingChange: (sorting: TaxReportSortingState) => void
	pagination: { pageIndex: number; pageSize: number }
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	rowCount: number
	canManage?: boolean
	onSyncBillStatus?: (assessmentId: string) => void
	onRetractBill?: (assessmentId: string) => void
	syncBillPending?: boolean
	retractBillPending?: boolean
}) {
	const columns = useMemo(
		() => [
			{
				id: 'billStatus',
				header: 'Bill Status',
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => <BillStatusBadge status={row.billStatus} />,
			},
			{
				id: 'corporationId',
				header: 'Corporation',
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => (
					<TaxCorporationDisplay
						corporationId={row.corporationId}
						entityNames={props.entityNames}
					/>
				),
			},
			{
				id: 'taxPeriodStart',
				header: 'Period Start',
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxDate(row.taxPeriodStart),
			},
			{
				id: 'taxPeriodEnd',
				header: 'Period End',
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxDate(row.taxPeriodEnd),
			},
			{
				id: 'issueDate',
				header: 'Issue Date',
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxDate(row.issueDate),
			},
			{
				id: 'dueDate',
				header: 'Due Date',
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxDate(row.dueDate),
			},
			{
				id: 'taxDue',
				header: 'Tax Due',
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxIskFull(row.taxDue),
			},
			{
				id: 'taxPaid',
				header: 'Tax Paid',
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxIskFull(row.taxPaid),
			},
			{
				id: 'taxDelta',
				header: 'Delta',
				sortable: true,
				cell: (row: TaxBillStatusReportRow) => formatTaxIskFull(row.taxDelta),
			},
			{
				id: 'actions',
				header: 'Actions',
				className: 'text-right',
				headerClassName: 'text-right',
				cell: (row: TaxBillStatusReportRow) => {
					const canSync = row.billStatus === 'issued' || row.billStatus === 'overdue'
					const canRetract = canSync
					const busy = props.syncBillPending || props.retractBillPending
					if (!props.canManage) return <span className="text-xs text-muted-foreground">-</span>
					return (
						<div className="flex items-center justify-end gap-2">
							{canSync ? (
								<Button
									variant="primary"
									size="sm"
									disabled={Boolean(busy) || !props.onSyncBillStatus}
									onClick={() => props.onSyncBillStatus?.(row.assessmentId)}
								>
									{props.syncBillPending ? 'Syncing...' : 'Sync'}
								</Button>
							) : null}
							{canRetract ? (
								<Button
									variant="destructive"
									size="sm"
									showIcon={false}
									disabled={Boolean(busy) || !props.onRetractBill}
									onClick={() => props.onRetractBill?.(row.assessmentId)}
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
			},
		],
		[
			props.canManage,
			props.entityNames,
			props.onRetractBill,
			props.onSyncBillStatus,
			props.retractBillPending,
			props.syncBillPending,
		]
	)

	return (
		<TaxReportTable
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No bill status rows found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel="bills"
			getRowKey={(row) => row.assessmentId}
		/>
	)
}
