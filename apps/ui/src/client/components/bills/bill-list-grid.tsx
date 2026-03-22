import { createMRTColumnHelper } from 'mantine-react-table'
import { useMemo } from 'react'

import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { ISKAmount } from '@/components/bills/isk-amount'
import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { formatDueDate } from '@/lib/bills-utils'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
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
	renderActions?: (bill: BillWithDetails) => ReactNode
	emptyMessage?: string
}) {
	const columnHelper = createMRTColumnHelper<BillWithDetails>()
	const columns = useMemo<Array<MRT_ColumnDef<BillWithDetails>>>(
		() => [
			columnHelper.accessor('status', {
				id: 'status',
				header: 'Status',
				enableSorting: true,
				Cell: ({ row }) => <BillStatusBadge status={row.original.status} />,
			}),
			columnHelper.accessor('title', {
				id: 'title',
				header: 'Title',
				enableSorting: false,
			}),
			columnHelper.accessor((row) => row.payerName || row.payerId, {
				id: 'payerId',
				header: 'Payer',
				enableSorting: false,
				Cell: ({ row }) => (
					<div className="flex flex-col">
						<span>{row.original.payerName || row.original.payerId}</span>
						<span className="text-xs text-muted-foreground">{row.original.payerId}</span>
					</div>
				),
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
							Cell: ({ row }) => props.renderActions!(row.original),
						}),
					]
				: []),
		],
		[columnHelper, props.renderActions]
	)

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
		/>
	)
}
