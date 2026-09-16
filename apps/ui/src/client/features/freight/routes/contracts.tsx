import { ExternalLink, Package } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import {
	SortableTableHead,
	stickyTableActionCellClassName,
	stickyTableActionHeaderClassName,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useFreightContracts, useOpenContractInGame } from '@/hooks/useFreightContracts'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import { formatISK, formatNumber, formatTimeRemaining } from '../utils'

import type { FreightContractSortDirection, FreightContractSortKey } from '@/lib/freight-api'

type AriaSort = 'none' | 'ascending' | 'descending'

function formatVolume(volume: string | null): string {
	if (!volume) return '—'
	return `${formatNumber(volume)} m³`
}

function sortLabel(direction: FreightContractSortDirection): Exclude<AriaSort, 'none'> {
	return direction === 'asc' ? 'ascending' : 'descending'
}

export default function FreightContractsPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('freight.contracts.title'))

	const [sorting, setSorting] = useState<{
		key: FreightContractSortKey
		direction: FreightContractSortDirection
	}>({
		key: 'expires',
		direction: 'asc',
	})
	const [pagination, setPagination] = useState({ page: 1, pageSize: 25 })

	const {
		data: contractsPage,
		isLoading,
		isFetching,
		error,
	} = useFreightContracts({
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
			<SortableTableHead
				className={cn('whitespace-nowrap', className)}
				aria-sort={(active ? sortLabel(sorting.direction) : 'none') as AriaSort}
				onSort={() => toggleSorting(key)}
				direction={active ? sorting.direction : undefined}
			>
				{label}
			</SortableTableHead>
		)
	}

	return (
		<Container size="wide">
			<div className="mb-section md:mb-10">
				<h1 className="text-3xl font-bold gradient-text">{t('freight.contracts.title')}</h1>
				<p className="mt-1 text-muted-foreground">{t('freight.contracts.description')}</p>
			</div>

			{!isLoading && totalCount > 0 ? (
				<div className="mb-4">
					<UserSearchPaginationControls
						totalCount={totalCount}
						page={currentPage}
						pageSize={currentPageSize}
						onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
						onPageSizeChange={(pageSize) => setPagination({ page: 1, pageSize })}
						itemLabel={t('freight.contracts.item', { count: totalCount })}
						nextButtonLoading={isRefreshing}
					/>
				</div>
			) : null}

			<div className="rounded-md border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							{renderSortHead(t('freight.common.pickup'), 'pickup')}
							{renderSortHead(t('freight.contracts.dropoff'), 'dropoff')}
							{renderSortHead(t('freight.common.volume'), 'volume', 'text-right font-mono')}
							{renderSortHead(t('freight.common.reward'), 'reward', 'text-right font-mono')}
							{renderSortHead(t('freight.common.collateral'), 'collateral', 'text-right font-mono')}
							{renderSortHead(
								t('freight.contracts.ttc'),
								'daysToComplete',
								'text-center font-mono'
							)}
							{renderSortHead(t('freight.contracts.expires'), 'expires')}
							<TableHead className={`${stickyTableActionHeaderClassName} text-right`}>
								{t('freight.common.actions')}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableRow>
								<TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
									{t('freight.contracts.loading')}
								</TableCell>
							</TableRow>
						) : error ? (
							<TableRow>
								<TableCell colSpan={8}>
									<p role="alert" className="text-destructive">
										{error instanceof Error && error.message
											? error.message
											: t('freight.contracts.loadFailed')}
									</p>
								</TableCell>
							</TableRow>
						) : pageContracts.length === 0 ? (
							<TableRow>
								<TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
									<div className="flex min-h-40 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
										<div>
											<Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
											<p>{t('freight.contracts.empty')}</p>
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
											{contract.daysToComplete === null
												? '—'
												: formatNumber(contract.daysToComplete)}
										</TableCell>
										<TableCell>{formatTimeRemaining(contract.dateExpired, t)}</TableCell>
										<TableCell className={`${stickyTableActionCellClassName} text-right`}>
											<Button
												variant="secondary"
												size="sm"
												disabled={openInGame.isPending}
												onClick={() => openInGame.mutate(contract.contractId)}
												title={t('freight.contracts.openHint')}
											>
												<ExternalLink className="mr-1.5 h-3.5 w-3.5" />
												{isPending ? t('freight.contracts.opening') : t('freight.contracts.inGame')}
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
						itemLabel={t('freight.contracts.item', { count: totalCount })}
						nextButtonLoading={isRefreshing}
					/>
				</div>
			) : null}
		</Container>
	)
}
