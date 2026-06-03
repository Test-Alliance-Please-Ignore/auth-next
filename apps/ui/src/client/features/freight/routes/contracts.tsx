import { ArrowUpDown, ExternalLink, Package } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useFreightContracts, useOpenContractInGame } from '@/hooks/useFreightContracts'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/utils'

import { formatISK, formatNumber } from '../utils'

import type {
	FreightContractSortDirection,
	FreightContractSortKey,
} from '@/lib/freight-api'

type AriaSort = 'none' | 'ascending' | 'descending'

function formatVolume(volume: string | null): string {
	if (!volume) return '—'
	return `${formatNumber(volume)} m³`
}

function formatTimeRemaining(dateExpired: string): string {
	const now = Date.now()
	const expiry = new Date(dateExpired).getTime()
	const diff = expiry - now
	if (diff <= 0) return 'Expired'

	const days = Math.floor(diff / (1000 * 60 * 60 * 24))
	const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

	if (days > 0) return `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`
	return `${hours} hour${hours !== 1 ? 's' : ''}`
}

function sortLabel(direction: FreightContractSortDirection): Exclude<AriaSort, 'none'> {
	return direction === 'asc' ? 'ascending' : 'descending'
}

export default function FreightContractsPage() {
	usePageTitle('Open Contracts')

	const [sorting, setSorting] = useState<{
		key: FreightContractSortKey
		direction: FreightContractSortDirection
	}>({
		key: 'expires',
		direction: 'asc',
	})
	const [pagination, setPagination] = useState({ page: 1, pageSize: 25 })

	const { data: contractsPage, isLoading, isFetching } = useFreightContracts({
		status: 'outstanding',
		page: pagination.page,
		pageSize: pagination.pageSize,
		sortBy: sorting.key,
		sortDirection: sorting.direction,
	})
	const openInGame = useOpenContractInGame()

	const pageContracts = contractsPage?.items ?? []
	const totalCount = contractsPage?.pagination.totalItems ?? 0
	const currentPage = pagination.page
	const currentPageSize = pagination.pageSize
	const isRefreshing = isFetching && !isLoading

	const toggleSorting = (key: FreightContractSortKey) => {
		setPagination((prev) => ({ ...prev, page: 1 }))
		setSorting((prev) =>
			prev.key === key
				? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
				: { key, direction: 'asc' }
		)
	}

	const renderSortHead = (label: string, key: FreightContractSortKey, className?: string) => {
		const active = sorting.key === key
		return (
			<TableHead
				className={cn('whitespace-nowrap', className)}
				aria-sort={(active ? sortLabel(sorting.direction) : 'none') as AriaSort}
			>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="-ml-2 h-8 gap-1 px-2 font-medium text-muted-foreground hover:text-foreground"
					onClick={() => toggleSorting(key)}
				>
					<span>{label}</span>
					<ArrowUpDown
						className={cn('h-3.5 w-3.5 transition-opacity', active ? 'opacity-100' : 'opacity-50')}
					/>
				</Button>
			</TableHead>
		)
	}

	return (
		<Container size="wide">
			<div className="mb-section md:mb-10">
				<h1 className="text-3xl font-bold gradient-text">Open Contracts</h1>
				<p className="mt-1 text-muted-foreground">
					Outstanding courier contracts waiting to be picked up
				</p>
			</div>

			{!isLoading && totalCount > 0 ? (
				<div className="mb-4">
					<UserSearchPaginationControls
						totalCount={totalCount}
						page={currentPage}
						pageSize={currentPageSize}
						onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
						onPageSizeChange={(pageSize) => setPagination({ page: 1, pageSize })}
						itemLabel="contracts"
						nextButtonLoading={isRefreshing}
					/>
				</div>
			) : null}

			<div className="rounded-md border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							{renderSortHead('Pickup', 'pickup')}
							{renderSortHead('Dropoff', 'dropoff')}
							{renderSortHead('Volume', 'volume', 'text-right font-mono')}
							{renderSortHead('Reward', 'reward', 'text-right font-mono')}
							{renderSortHead('Collateral', 'collateral', 'text-right font-mono')}
							{renderSortHead('TTC', 'daysToComplete', 'text-center font-mono')}
							{renderSortHead('Expires', 'expires')}
							<TableHead className="sticky right-0 z-20 border-l border-border/50 bg-card text-right">
								Actions
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
									Loading outstanding contracts...
								</TableCell>
							</TableRow>
						) : pageContracts.length === 0 ? (
							<TableRow>
								<TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
									<div className="flex min-h-40 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
										<div>
											<Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
											<p>No outstanding contracts</p>
										</div>
									</div>
								</TableCell>
							</TableRow>
						) : (
							pageContracts.map((contract) => {
								const isPending =
									openInGame.isPending && openInGame.variables === contract.contractId

								return (
									<TableRow key={contract.id}>
										<TableCell className="font-medium">
											{contract.startLocationName ?? contract.startLocationId ?? '—'}
										</TableCell>
										<TableCell className="font-medium">
											{contract.endLocationName ?? contract.endLocationId ?? '—'}
										</TableCell>
										<TableCell className="font-mono text-right">
											{formatVolume(contract.volume)}
										</TableCell>
										<TableCell className="font-mono text-right">
											{contract.reward ? formatISK(contract.reward) : '—'}
										</TableCell>
										<TableCell className="font-mono text-right">
											{contract.collateral ? formatISK(contract.collateral) : '—'}
										</TableCell>
										<TableCell className="font-mono text-center">
											{contract.daysToComplete ?? '—'}
										</TableCell>
										<TableCell>{formatTimeRemaining(contract.dateExpired)}</TableCell>
										<TableCell className="sticky right-0 z-10 border-l border-border/50 bg-inherit text-right">
											<Button
												variant="secondary"
												size="sm"
												disabled={openInGame.isPending}
												onClick={() => openInGame.mutate(contract.contractId)}
												title="Open this contract in your EVE client"
											>
												<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
												{isPending ? 'Opening…' : 'In-game'}
											</Button>
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</div>

			{!isLoading && totalCount > 0 ? (
				<div className="mt-4">
					<UserSearchPaginationControls
						totalCount={totalCount}
						page={currentPage}
						pageSize={currentPageSize}
						onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
						onPageSizeChange={(pageSize) => setPagination({ page: 1, pageSize })}
						itemLabel="contracts"
						nextButtonLoading={isRefreshing}
					/>
				</div>
			) : null}
		</Container>
	)
}
