import { useEffect, useMemo, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { TableRefreshFrame } from '@/components/table-refresh-frame'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { usePageTitle } from '@/hooks/usePageTitle'

import {
	LossTable,
	RecentLossRefreshButton,
	RecentLossesStatusAlerts,
} from '../components/LossTable'
import { RequestTable } from '../components/RequestTable'
import {
	useDismissRecentLoss,
	useMyRequests,
	useRecentLosses,
	useRecentLossRefreshStatus,
	useRefreshKillmails,
	useSRPConfig,
} from '../hooks'
import {
	setRecentLossesPage,
	setRecentLossesPageSize,
	setRecentLossesSnapshot,
	useRecentLossesUiState,
} from '../state/recent-losses-store'
import {
	setMyRequestsPage,
	setMyRequestsPageSize,
	setMyRequestsSnapshot,
	useMyRequestsUiState,
} from '../state/my-requests-store'

import type { LossWithSRPStatus, RecentLossesResponse } from '../types'

export default function SRPIndex() {
	usePageTitle('SRP')
	const { data: config } = useSRPConfig()
	const [activeTab, setActiveTab] = useState<'losses' | 'requests'>('losses')
	const lossPage = useRecentLossesUiState((state) => state.page)
	const lossPageSize = useRecentLossesUiState((state) => state.pageSize)
	const requestPage = useMyRequestsUiState((state) => state.page)
	const requestPageSize = useMyRequestsUiState((state) => state.pageSize)

	const {
		data: lossesData,
		isLoading: lossesLoading,
		isFetching: lossesFetching,
		error: lossesError,
		failedCharacters: loadFailures,
		refetch: refetchLosses,
	} = useRecentLosses(
		{
			limit: lossPageSize,
			offset: (lossPage - 1) * lossPageSize,
		},
		{
			enabled: activeTab === 'losses',
		}
	)
	const lossOffset = (lossPage - 1) * lossPageSize
	const currentLossesData = useMemo<RecentLossesResponse | undefined>(() => {
		if (!lossesData) return undefined
		if (lossesData.limit !== lossPageSize || lossesData.offset !== lossOffset) return undefined
		return {
			...lossesData,
			losses: lossesData.losses ?? [],
			failedCharacters: lossesData.failedCharacters ?? [],
		}
	}, [lossesData, lossOffset, lossPageSize])
	const cachedLossesData = useRecentLossesUiState(
		(state) => state.pages[`${lossPageSize}:${lossOffset}`]
	)
	const effectiveLossesData = cachedLossesData ?? currentLossesData

	useEffect(() => {
		if (!currentLossesData) return
		setRecentLossesSnapshot(lossPageSize, lossOffset, currentLossesData)
	}, [currentLossesData, lossOffset, lossPageSize])

	const refreshStatusQuery = useRecentLossRefreshStatus()
	const refreshMutation = useRefreshKillmails()
	const dismissLossMutation = useDismissRecentLoss()
	const {
		data: requestsData,
		isLoading: requestsLoading,
		isFetching: requestsFetching,
		error: requestsError,
	} = useMyRequests(
		{
			limit: requestPageSize,
			offset: (requestPage - 1) * requestPageSize,
		},
		{
			enabled: activeTab === 'requests',
		}
	)
	const requestOffset = (requestPage - 1) * requestPageSize
	const currentRequestsData =
		requestsData?.limit === requestPageSize && requestsData.offset === requestOffset
			? requestsData
			: undefined
	const cachedRequestsData = useMyRequestsUiState(
		(state) => state.pages[`${requestPageSize}:${requestOffset}`]
	)
	const effectiveRequestsData = cachedRequestsData ?? currentRequestsData

	useEffect(() => {
		if (!currentRequestsData) return
		setMyRequestsSnapshot(requestPageSize, requestOffset, currentRequestsData)
	}, [currentRequestsData, requestOffset, requestPageSize])

	const requestLoadError = !effectiveRequestsData ? requestsError : null
	const requestGrid = effectiveRequestsData?.requests ?? []
	const requestGridLoading = !effectiveRequestsData && requestsLoading
	const requestGridRefreshing = Boolean(effectiveRequestsData) && requestsFetching
	const lossLoadError = !effectiveLossesData ? lossesError : null
	const lossGrid = effectiveLossesData?.losses ?? []
	const lossGridLoading = !effectiveLossesData && lossesLoading
	const lossGridRefreshing = Boolean(effectiveLossesData) && lossesFetching
	const lossRefreshErrorMessage =
		lossesError && effectiveLossesData
			? lossesError instanceof Error
				? lossesError.message
				: 'Failed to refresh recent losses.'
			: null
	const lossRefreshAction = (
		<RecentLossRefreshButton
			isRefreshing={refreshMutation.isPending || lossesFetching}
			onRefresh={() => refreshMutation.mutate()}
			refreshStatus={refreshStatusQuery.data?.status ?? null}
			refreshCooldownUntil={refreshStatusQuery.data?.cooldownUntil ?? null}
		/>
	)
	const lossPaginationControls = (
		<div className="mb-3 rounded-md border p-3">
			<UserSearchPaginationControls
				totalCount={effectiveLossesData?.total ?? 0}
				page={lossPage}
				pageSize={lossPageSize}
				onPageChange={setRecentLossesPage}
				onPageSizeChange={setRecentLossesPageSize}
				itemLabel="losses"
				nextButtonLoading={lossesFetching}
				pageSizeOptions={[10, 25, 50]}
				leadingAction={lossRefreshAction}
			/>
		</div>
	)

	return (
		<Container>
			<PageHeader
				title="Ship Replacement Program"
				description="Request reimbursement for ship losses"
			/>

			<Card className="mt-section">
				<CardContent className="p-0">
					<Tabs
						value={activeTab}
						onValueChange={(value) => setActiveTab(value as 'losses' | 'requests')}
					>
						<TabsList className="w-full rounded-b-none border-b">
							<TabsTrigger value="losses">Recent Losses</TabsTrigger>
							<TabsTrigger value="requests">My Requests</TabsTrigger>
						</TabsList>

						<div className="p-4">
							<TabsContent value="losses" className="mt-0 space-y-4">
								{lossLoadError && !lossGridLoading ? (
									<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-center">
										<p className="text-sm text-red-500">Failed to load losses</p>
										<p className="text-xs text-muted-foreground">
											{lossLoadError instanceof Error ? lossLoadError.message : 'Unknown error'}
										</p>
									</div>
								) : (
									<>
										<RecentLossesStatusAlerts
											refreshStatus={refreshStatusQuery.data?.status ?? null}
											refreshErrorMessage={lossRefreshErrorMessage}
											loadFailures={effectiveLossesData?.failedCharacters ?? loadFailures}
										/>
										<TableRefreshFrame
											isRefreshing={lossGridRefreshing || refreshMutation.isPending}
											refreshMessage="Refreshing recent losses..."
											onRetry={() => void refetchLosses()}
											retryDisabled={lossesFetching}
										>
											{lossPaginationControls}
											{!effectiveLossesData && lossGridLoading ? (
												<LossTable
													losses={[]}
													isLoading
													config={config}
													onDismissLoss={async (killmailId) => {
														await dismissLossMutation.mutateAsync({ killmailId })
													}}
													dismissingKillmailId={
														dismissLossMutation.isPending
															? dismissLossMutation.variables?.killmailId ?? null
															: null
													}
												/>
											) : (
												<LossTable
													losses={(lossGrid || []) as LossWithSRPStatus[]}
													isLoading={false}
													config={config}
													onDismissLoss={async (killmailId) => {
														await dismissLossMutation.mutateAsync({ killmailId })
													}}
													dismissingKillmailId={
														dismissLossMutation.isPending
															? dismissLossMutation.variables?.killmailId ?? null
															: null
													}
												/>
											)}
										</TableRefreshFrame>
									</>
								)}
							</TabsContent>

							<TabsContent value="requests" className="mt-0 space-y-4">
								{requestLoadError && !requestGridLoading ? (
									<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-center">
										<p className="text-sm text-red-500">Failed to load requests</p>
										<p className="text-xs text-muted-foreground">
											{requestLoadError instanceof Error ? requestLoadError.message : 'Unknown error'}
										</p>
									</div>
								) : !effectiveRequestsData && requestGridLoading ? (
									<div className="rounded-lg border border-muted p-6 text-center">
										<div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-muted bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground">
											<span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
											<span>Loading requests...</span>
										</div>
									</div>
								) : (
									<TableRefreshFrame
										isRefreshing={requestGridRefreshing}
										refreshMessage="Refreshing requests..."
										errorMessage={
											requestsError && effectiveRequestsData
												? requestsError instanceof Error
													? requestsError.message
													: 'Failed to refresh requests.'
												: null
										}
									>
										<div className="mb-3 rounded-md border p-3">
											<UserSearchPaginationControls
												totalCount={effectiveRequestsData?.total ?? 0}
												page={requestPage}
												pageSize={requestPageSize}
												onPageChange={setMyRequestsPage}
												onPageSizeChange={setMyRequestsPageSize}
												itemLabel="requests"
												nextButtonLoading={requestsFetching}
												pageSizeOptions={[10, 25, 50]}
											/>
										</div>
										<RequestTable requests={requestGrid} isLoading={false} />
									</TableRefreshFrame>
								)}
							</TabsContent>
						</div>
					</Tabs>
				</CardContent>
			</Card>
		</Container>
	)
}
