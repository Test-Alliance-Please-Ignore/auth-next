import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePageTitle } from '@/hooks/usePageTitle'
import { characterPortraitUrl } from '@/lib/eve-images'
import { formatPoints } from '@/lib/format-utils'

import { DepositDialog } from '../components/deposit-dialog'
import { LedgerTable } from '../components/ledger-table'
import { useUserLedger, useWallet } from '../hooks'

export default function PredictionMarketWalletDetail() {
	usePageTitle('Admin - Wallet Detail')
	const { userId = '' } = useParams()
	const [pagination, setPagination] = useState({ limit: 50, offset: 0 })
	const [depositOpen, setDepositOpen] = useState(false)

	const wallet = useWallet(userId)
	const ledger = useUserLedger(userId, pagination)
	const total = ledger.data?.total ?? 0

	return (
		<div className="space-y-6">
			<div>
				<Link
					to="/admin/prediction-markets/wallets"
					className="text-sm text-muted-foreground hover:underline"
				>
					← Back to wallets
				</Link>
				<h1 className="mt-1 text-3xl font-bold gradient-text">Wallet</h1>
			</div>

			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<CardTitle>Balance</CardTitle>
					<Button variant="primary" size="sm" onClick={() => setDepositOpen(true)}>
						Deposit
					</Button>
				</CardHeader>
				<CardContent>
					{wallet.isLoading ? (
						<Skeleton className="h-12 w-48" />
					) : wallet.error ? (
						<p className="text-destructive">Failed to load wallet: {wallet.error.message}</p>
					) : (
						<div className="flex items-center gap-3">
							{wallet.data?.mainCharacterId ? (
								<img
									src={characterPortraitUrl(wallet.data.mainCharacterId, 64)}
									alt=""
									className="h-12 w-12 rounded-full"
								/>
							) : null}
							<div>
								<div className="font-mono text-2xl font-bold">
									{formatPoints(wallet.data?.balance ?? '0')}
								</div>
								<div className="text-sm text-muted-foreground">
									{wallet.data?.userName ?? userId}
								</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			<div className="space-y-3">
				<h2 className="text-xl font-semibold">Ledger</h2>
				<LedgerTable rows={ledger.data?.rows} isLoading={ledger.isLoading} error={ledger.error} />
				{total > 0 ? (
					<UserSearchPaginationControls
						totalCount={total}
						page={Math.floor(pagination.offset / pagination.limit) + 1}
						pageSize={pagination.limit}
						itemLabel="entries"
						nextButtonLoading={ledger.isFetching}
						onPageChange={(nextPage) =>
							setPagination((p) => ({ ...p, offset: (nextPage - 1) * p.limit }))
						}
						onPageSizeChange={(nextSize) => setPagination({ limit: nextSize, offset: 0 })}
					/>
				) : null}
			</div>

			<DepositDialog
				open={depositOpen}
				onOpenChange={setDepositOpen}
				defaultTargetUserId={userId}
				defaultTargetName={wallet.data?.userName ?? null}
			/>
		</div>
	)
}
