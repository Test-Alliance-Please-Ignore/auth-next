import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePageTitle } from '@/hooks/usePageTitle'

import { DepositDialog } from '../components/deposit-dialog'
import { WalletListGrid } from '../components/wallet-list-grid'
import { useWallets } from '../hooks'

import type { AdminWalletRow } from '../types'
import type { MRT_SortingState } from 'mantine-react-table'

export default function PredictionMarketWallets() {
	usePageTitle('Admin - Prediction Market Wallets')
	const navigate = useNavigate()

	const [search, setSearch] = useState('')
	const [sorting, setSorting] = useState<MRT_SortingState>([{ id: 'balance', desc: true }])
	const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
	const [depositTarget, setDepositTarget] = useState<AdminWalletRow | null>(null)
	const [depositOpen, setDepositOpen] = useState(false)

	const sort = (sorting[0]?.id as 'balance' | 'updatedAt' | 'userId' | undefined) ?? 'balance'
	const order: 'asc' | 'desc' = sorting[0]?.desc ? 'desc' : 'asc'

	const { data, isLoading, error } = useWallets({
		search: search.trim() || undefined,
		sort,
		order,
		limit: pagination.pageSize,
		offset: pagination.pageIndex * pagination.pageSize,
	})

	const total = data?.total ?? 0
	const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pagination.pageSize)))

	const openDeposit = (wallet: AdminWalletRow | null) => {
		setDepositTarget(wallet)
		setDepositOpen(true)
	}

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Prediction Market Wallets</h1>
					<p className="mt-1 text-muted-foreground">
						Search balances, make deposits, and inspect a member&apos;s ledger.
					</p>
				</div>
				<Button variant="primary" onClick={() => openDeposit(null)}>
					Deposit
				</Button>
			</div>

			<Input
				placeholder="Search members by character name…"
				value={search}
				onChange={(e) => {
					setSearch(e.target.value)
					setPagination((p) => ({ ...p, pageIndex: 0 }))
				}}
				className="max-w-sm"
			/>

			<WalletListGrid
				rows={data?.rows ?? []}
				loading={isLoading}
				error={error}
				sorting={sorting}
				onSortingChange={(next) => {
					setSorting(next)
					setPagination((p) => ({ ...p, pageIndex: 0 }))
				}}
				pagination={pagination}
				onPaginationChange={setPagination}
				pageCount={pageCount}
				rowCount={total}
				onDeposit={(wallet) => openDeposit(wallet)}
				onViewLedger={(wallet) => navigate(`/admin/prediction-markets/wallets/${wallet.userId}`)}
			/>

			<DepositDialog
				open={depositOpen}
				onOpenChange={setDepositOpen}
				defaultTargetUserId={depositTarget?.userId}
				defaultTargetName={depositTarget?.userName ?? null}
			/>
		</div>
	)
}
