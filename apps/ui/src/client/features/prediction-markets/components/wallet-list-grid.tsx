import { createMRTColumnHelper } from 'mantine-react-table'
import { useMemo } from 'react'

import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/date-utils'
import { characterPortraitUrl } from '@/lib/eve-images'
import { formatPoints } from '@/lib/format-utils'

import type { AdminWalletRow } from '../types'
import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'

const columnHelper = createMRTColumnHelper<AdminWalletRow>()

export interface WalletListGridProps {
	rows: AdminWalletRow[]
	loading?: boolean
	error?: unknown
	sorting: MRT_SortingState
	onSortingChange: (sorting: MRT_SortingState) => void
	pagination: { pageIndex: number; pageSize: number }
	onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
	pageCount: number
	rowCount: number
	onDeposit: (wallet: AdminWalletRow) => void
	onViewLedger: (wallet: AdminWalletRow) => void
}

export function WalletListGrid(props: WalletListGridProps) {
	const { onDeposit, onViewLedger } = props

	const columns = useMemo<Array<MRT_ColumnDef<AdminWalletRow>>>(
		() => [
			columnHelper.accessor((row) => row.userName || row.userId, {
				id: 'user',
				header: 'User',
				enableSorting: false,
				Cell: ({ row }) => (
					<div className="flex items-center gap-2">
						{row.original.mainCharacterId ? (
							<img
								src={characterPortraitUrl(row.original.mainCharacterId, 32)}
								alt=""
								width={28}
								height={28}
								className="h-7 w-7 shrink-0 rounded-full"
							/>
						) : (
							<div className="h-7 w-7 shrink-0 rounded-full bg-muted" />
						)}
						<span>{row.original.userName || row.original.userId}</span>
					</div>
				),
			}),
			columnHelper.accessor('userId', {
				id: 'userId',
				header: 'User ID',
				enableSorting: true,
				Cell: ({ row }) => (
					<span className="font-mono text-xs text-muted-foreground">{row.original.userId}</span>
				),
			}),
			columnHelper.accessor('balance', {
				id: 'balance',
				header: 'Balance',
				enableSorting: true,
				mantineTableHeadCellProps: { style: { textAlign: 'right' } },
				mantineTableBodyCellProps: { style: { textAlign: 'right' } },
				Cell: ({ row }) => <span className="font-mono">{formatPoints(row.original.balance)}</span>,
			}),
			columnHelper.accessor('updatedAt', {
				id: 'updatedAt',
				header: 'Updated',
				enableSorting: true,
				Cell: ({ row }) => formatDateTime(row.original.updatedAt),
			}),
			columnHelper.display({
				id: 'actions',
				header: 'Actions',
				enableSorting: false,
				size: 200,
				minSize: 180,
				maxSize: 240,
				mantineTableHeadCellProps: { style: { textAlign: 'center', whiteSpace: 'nowrap' } },
				mantineTableBodyCellProps: { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
				Cell: ({ row }) => (
					<div className="flex justify-end gap-2">
						<Button variant="primary" size="sm" onClick={() => onDeposit(row.original)}>
							Deposit
						</Button>
						<Button variant="ghost" size="sm" onClick={() => onViewLedger(row.original)}>
							View ledger
						</Button>
					</div>
				),
			}),
		],
		[onDeposit, onViewLedger]
	)

	return (
		<TaxReportDataGrid
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No wallets found."
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
