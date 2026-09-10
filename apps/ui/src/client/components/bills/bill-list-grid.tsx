import { Users } from 'lucide-react'
import { useMemo } from 'react'

import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { ISKAmount } from '@/components/bills/isk-amount'
import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { formatDueDate } from '@/lib/bills-utils'
import { formatDateTime } from '@/lib/date-utils'

import type { ReactNode } from 'react'
import type { BillWithDetails } from '@repo/bills'
import type { BillListSortingState } from './bill-list-types'

export function BillListGrid(props: {
	rows: BillWithDetails[]
	loading?: boolean
	error?: unknown
	sorting: BillListSortingState
	onSortingChange: (sorting: BillListSortingState) => void
	pagination: {
		pageIndex: number
		pageSize: number
	}
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	rowCount: number
	renderActions?: (bill: BillWithDetails) => ReactNode
	renderExpandedGroupBill?: (bill: BillWithDetails) => ReactNode
	emptyMessage?: string
	onRowClick?: (bill: BillWithDetails) => void
	rowHref?: (bill: BillWithDetails) => string
	paginationLeadingAction?: ReactNode
	clamped?: boolean
}) {
	const columns = useMemo(
		() => [
			{
				id: 'status',
				header: 'Status',
				sortable: true,
				cell: (bill: BillWithDetails) =>
					bill.groupBillMixed ? (
						<Badge variant="ghost">Mixed</Badge>
					) : (
						<BillStatusBadge status={bill.status} />
					),
			},
			{
				id: 'title',
				header: 'Title',
				link: props.rowHref,
				cell: (bill: BillWithDetails) => (
					<div className="flex items-center gap-2">
						<span>{bill.title}</span>
						{bill.groupBillTotalCount != null && (
							<span
								className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-500"
								title={`Group bill: ${bill.groupBillPaidCount ?? 0}/${bill.groupBillTotalCount} paid`}
							>
								<Users className="h-3 w-3" />
								{bill.groupBillPaidCount ?? 0}/{bill.groupBillTotalCount}
							</span>
						)}
					</div>
				),
			},
			{
				id: 'payerId',
				header: 'Payer',
				cell: (bill: BillWithDetails) => {
					const isGroup = bill.payerType === 'group'
					const displayName = bill.payerName || (isGroup ? 'Group' : bill.payerId)
					return (
						<div className="flex flex-col">
							<div className="flex items-center gap-1.5">
								{isGroup && <Users className="h-3 w-3 shrink-0 text-blue-400" />}
								<span>{displayName}</span>
							</div>
							<span className="text-xs text-muted-foreground">{bill.payerId}</span>
						</div>
					)
				},
			},
			{
				id: 'payeeId',
				header: 'Payee',
				cell: (bill: BillWithDetails) =>
					bill.payeeId ? (
						<div className="flex flex-col">
							<span>{bill.payeeName || bill.payeeId}</span>
							<span className="text-xs text-muted-foreground">{bill.payeeId}</span>
						</div>
					) : (
						<span className="text-muted-foreground">-</span>
					),
			},
			{
				id: 'issuerId',
				header: 'Issuer',
				cell: (bill: BillWithDetails) => (
					<div className="flex flex-col">
						<span>{bill.issuerName || bill.issuerId}</span>
						<span className="text-xs text-muted-foreground">{bill.issuerId}</span>
					</div>
				),
			},
			{
				id: 'amount',
				header: 'Amount',
				sortable: true,
				cell: (bill: BillWithDetails) => <ISKAmount amount={bill.amount} />,
			},
			{
				id: 'dueDate',
				header: 'Due',
				sortable: true,
				cell: (bill: BillWithDetails) => formatDueDate(bill.dueDate, bill.status),
			},
			{
				id: 'createdAt',
				header: 'Created',
				sortable: true,
				cell: (bill: BillWithDetails) => formatDateTime(bill.createdAt),
			},
			...(props.renderActions
				? [
						{
							id: 'actions',
							header: 'Actions',
							className: 'text-right',
							headerClassName: 'text-center',
							sticky: 'right' as const,
							cell: (bill: BillWithDetails) => props.renderActions?.(bill),
						},
					]
				: []),
		],
		[props.renderActions, props.rowHref]
	)

	return (
		<DataTable
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage={props.emptyMessage ?? 'No bills found.'}
			sorting={[{ id: props.sorting.sortBy, desc: props.sorting.sortDir === 'desc' }]}
			onSortingChange={(nextSorting) => {
				const next = nextSorting[0]
				if (!next) return
				props.onSortingChange({
					sortBy: next.id as BillListSortingState['sortBy'],
					sortDir: next.desc ? 'desc' : 'asc',
				})
			}}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel="bills"
			getRowKey={(bill) => bill.id}
			rowLink={props.rowHref}
			paginationLeadingAction={props.paginationLeadingAction}
			clamped={props.clamped}
			onRowClick={props.onRowClick}
			renderExpandedRow={props.renderExpandedGroupBill}
			getRowCanExpand={(bill) => Boolean(bill.groupBillTotalCount != null && bill.groupBillId)}
		/>
	)
}
