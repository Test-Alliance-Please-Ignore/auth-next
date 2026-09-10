import { useMemo } from 'react'

import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/date-utils'
import { characterPortraitUrl } from '@/lib/eve-images'
import { formatPoints } from '@/lib/format-utils'

import type {
	DataTableColumn,
	DataTablePagination,
	DataTableSortingState,
} from '@/components/data-table'
import type { AdminWalletRow } from '../types'

export interface WalletListGridProps {
	rows: AdminWalletRow[]
	loading?: boolean
	error?: unknown
	sorting: DataTableSortingState
	onSortingChange: (sorting: DataTableSortingState) => void
	pagination: DataTablePagination
	onPaginationChange: (pagination: DataTablePagination) => void
	rowCount: number
	onDeposit: (wallet: AdminWalletRow) => void
	onViewLedger: (wallet: AdminWalletRow) => void
}

export function WalletListGrid(props: WalletListGridProps) {
	const { onDeposit, onViewLedger } = props

	const columns = useMemo<Array<DataTableColumn<AdminWalletRow>>>(
		() => [
			{
				id: 'user',
				header: 'User',
				cell: (wallet) => (
					<div className="flex items-center gap-2">
						{wallet.mainCharacterId ? (
							<img
								src={characterPortraitUrl(wallet.mainCharacterId, 32)}
								alt=""
								width={28}
								height={28}
								className="h-7 w-7 shrink-0 rounded-full"
							/>
						) : (
							<div className="h-7 w-7 shrink-0 rounded-full bg-muted" />
						)}
						<span>{wallet.userName || wallet.userId}</span>
					</div>
				),
			},
			{
				id: 'userId',
				header: 'User ID',
				sortable: true,
				cell: (wallet) => (
					<span className="font-mono text-xs text-muted-foreground">{wallet.userId}</span>
				),
			},
			{
				id: 'balance',
				header: 'Balance',
				sortable: true,
				headerClassName: 'text-right',
				className: 'text-right',
				cell: (wallet) => <span className="font-mono">{formatPoints(wallet.balance)}</span>,
			},
			{
				id: 'updatedAt',
				header: 'Updated',
				sortable: true,
				cell: (wallet) => formatDateTime(wallet.updatedAt),
			},
			{
				id: 'actions',
				header: 'Actions',
				headerClassName: 'text-center',
				className: 'text-right',
				sticky: 'right',
				cell: (wallet) => (
					<div className="flex justify-end gap-2 whitespace-nowrap">
						<Button variant="primary" size="sm" onClick={() => onDeposit(wallet)}>
							Deposit
						</Button>
						<Button variant="ghost" size="sm" onClick={() => onViewLedger(wallet)}>
							View ledger
						</Button>
					</div>
				),
			},
		],
		[onDeposit, onViewLedger]
	)

	return (
		<DataTable
			columns={columns}
			rows={props.rows}
			loading={props.loading}
			error={props.error}
			emptyMessage="No wallets found."
			sorting={props.sorting}
			onSortingChange={props.onSortingChange}
			pagination={props.pagination}
			onPaginationChange={props.onPaginationChange}
			rowCount={props.rowCount}
			itemLabel="wallets"
			getRowKey={(wallet) => wallet.userId}
		/>
	)
}
