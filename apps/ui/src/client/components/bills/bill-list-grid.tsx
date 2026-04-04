import { Users } from 'lucide-react'
import { createMRTColumnHelper } from 'mantine-react-table'
import { useMemo } from 'react'

import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { ISKAmount } from '@/components/bills/isk-amount'
import { Badge } from '@/components/ui/badge'
import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatDueDate } from '@/lib/bills-utils'

import type {
	MRT_ColumnDef,
	MRT_Row,
	MRT_SortingState,
	MRT_TableOptions,
} from 'mantine-react-table'
import type { ReactNode } from 'react'
import type { BillWithDetails } from '@repo/bills'

function formatDateTime(value: Date | string): string {
	const date = typeof value === 'string' ? new Date(value) : value
	if (Number.isNaN(date.getTime())) return '-'
	return date.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

export function BillListGrid(props: {
	rows: BillWithDetails[]
	loading?: boolean
	error?: unknown
	sorting: MRT_SortingState
	onSortingChange: (sorting: MRT_SortingState) => void
	pagination: {
		pageIndex: number
		pageSize: number
	}
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	pageCount: number
	rowCount: number
	renderActions?: (bill: BillWithDetails, row: MRT_Row<BillWithDetails>) => ReactNode
	renderExpandedGroupBill?: (bill: BillWithDetails) => ReactNode
	emptyMessage?: string
}) {
	const columnHelper = createMRTColumnHelper<BillWithDetails>()
	const columns = useMemo<Array<MRT_ColumnDef<BillWithDetails>>>(
		() => [
			columnHelper.accessor('status', {
				id: 'status',
				header: 'Status',
				enableSorting: true,
				Cell: ({ row }) =>
					row.original.groupBillMixed ? (
						<Badge variant="ghost">Mixed</Badge>
					) : (
						<BillStatusBadge status={row.original.status} />
					),
			}),
			columnHelper.accessor('title', {
				id: 'title',
				header: 'Title',
				enableSorting: false,
				Cell: ({ row }) => (
					<div className="flex items-center gap-2">
						<span>{row.original.title}</span>
						{row.original.groupBillTotalCount != null && (
							<span
								className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-500"
								title={`Group bill: ${row.original.groupBillPaidCount ?? 0}/${row.original.groupBillTotalCount} paid`}
							>
								<Users className="h-3 w-3" />
								{row.original.groupBillPaidCount ?? 0}/{row.original.groupBillTotalCount}
							</span>
						)}
					</div>
				),
			}),
			columnHelper.accessor((row) => row.payerName || row.payerId, {
				id: 'payerId',
				header: 'Payer',
				enableSorting: false,
				Cell: ({ row }) => {
					const isGroup = row.original.payerType === 'group'
					const displayName = row.original.payerName || (isGroup ? 'Group' : row.original.payerId)
					return (
						<div className="flex flex-col">
							<div className="flex items-center gap-1.5">
								{isGroup && <Users className="h-3 w-3 shrink-0 text-blue-400" />}
								<span>{displayName}</span>
							</div>
							<span className="text-xs text-muted-foreground">{row.original.payerId}</span>
						</div>
					)
				},
			}),
			columnHelper.accessor((row) => row.payeeName || row.payeeId || '-', {
				id: 'payeeId',
				header: 'Payee',
				enableSorting: false,
				Cell: ({ row }) =>
					row.original.payeeId ? (
						<div className="flex flex-col">
							<span>{row.original.payeeName || row.original.payeeId}</span>
							<span className="text-xs text-muted-foreground">{row.original.payeeId}</span>
						</div>
					) : (
						<span className="text-muted-foreground">-</span>
					),
			}),
			columnHelper.accessor((row) => row.issuerName || row.issuerId, {
				id: 'issuerId',
				header: 'Issuer',
				enableSorting: false,
				Cell: ({ row }) => (
					<div className="flex flex-col">
						<span>{row.original.issuerName || row.original.issuerId}</span>
						<span className="text-xs text-muted-foreground">{row.original.issuerId}</span>
					</div>
				),
			}),
			columnHelper.accessor('amount', {
				id: 'amount',
				header: 'Amount',
				enableSorting: true,
				Cell: ({ row }) => <ISKAmount amount={row.original.amount} />,
			}),
			columnHelper.accessor('dueDate', {
				id: 'dueDate',
				header: 'Due',
				enableSorting: true,
				Cell: ({ row }) => formatDueDate(row.original.dueDate),
			}),
			columnHelper.accessor('createdAt', {
				id: 'createdAt',
				header: 'Created',
				enableSorting: true,
				Cell: ({ row }) => formatDateTime(row.original.createdAt),
			}),
			...(props.renderActions
				? [
						columnHelper.display({
							id: 'actions',
							header: 'Actions',
							enableSorting: false,
							Cell: ({ row }) => props.renderActions!(row.original, row),
						}),
					]
				: []),
		],
		[columnHelper, props.renderActions]
	)

	const renderDetailPanel = props.renderExpandedGroupBill
		? ({ row }: { row: MRT_Row<BillWithDetails> }) =>
				row.original.groupBillTotalCount != null
					? props.renderExpandedGroupBill!(row.original)
					: null
		: undefined

	const mantineExpandButtonProps: MRT_TableOptions<BillWithDetails>['mantineExpandButtonProps'] =
		props.renderExpandedGroupBill
			? ({ row }) => ({
					style: row.original.groupBillTotalCount == null ? { visibility: 'hidden' } : undefined,
				})
			: undefined

	return (
		<TaxReportDataGrid
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage={props.emptyMessage ?? 'No bills found.'}
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			pageCount={props.pageCount}
			rowCount={props.rowCount}
			pinnedRightColumnIds={props.renderActions ? ['actions'] : undefined}
			renderDetailPanel={renderDetailPanel}
			mantineExpandButtonProps={mantineExpandButtonProps}
		/>
	)
}
