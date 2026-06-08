import { Loader2, RefreshCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Button } from '@/components/ui/button'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import { typeIconUrl } from '@/lib/eve-images'

import { RequestStatusBadge } from '../components/RequestStatusBadge'
import { CharacterRoleBadge } from '../components/CharacterRoleBadge'
import {
	setReviewQueueActiveTab,
	setReviewQueuePage,
	setReviewQueuePageSize,
	setReviewQueueSnapshot,
	toggleReviewQueueSort,
	useReviewQueueEntityMap,
	useReviewQueueUiState,
	updateReviewQueueFilters,
} from '../state/review-queue-snapshot-store'
import { formatISKShort, formatRelativeTime, getRequestCharacterRole } from '../utils'

import type { RequestStatus, SRPRequestResponse } from '../types'

const TABS: Array<{ value: RequestStatus; label: string }> = [
	{ value: 'pending', label: 'Pending' },
	{ value: 'needs_context', label: 'Needs Context' },
	{ value: 'rejected', label: 'Rejected' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'paid', label: 'Paid' },
]

type ReviewQueueSortBy = 'submitted' | 'loss'

type ReviewQueueFilters = {
	characterName?: string
	shipTypeName?: string
	solarSystemName?: string
	dateFrom?: string
	dateTo?: string
}

function toTimestamp(value: string | null | undefined): number {
	if (!value) return 0
	const parsed = Date.parse(value)
	return Number.isNaN(parsed) ? 0 : parsed
}

export default function ReviewQueue() {
	usePageTitle('SRP - Review Queue')

	const { hasPermission, isAdmin } = useUserPermissions()
	const activeTab = useReviewQueueUiState((state) => state.activeTab)
	const filters = useReviewQueueUiState((state) => state.filters)
	const page = useReviewQueueUiState((state) => state.page)
	const pageSize = useReviewQueueUiState((state) => state.pageSize)

	const canAccessReviewQueue =
		isAdmin ||
		hasPermission('urn:srp:reviewer') ||
		hasPermission('urn:srp:payer') ||
		hasPermission('urn:srp:manager')

	if (!canAccessReviewQueue) {
		return <Navigate to="/srp" replace />
	}

	const handleTabChange = (value: string) => {
		setReviewQueueActiveTab(value as RequestStatus)
	}
	const reviewQueueContentKey = [
		activeTab,
		filters.characterName ?? '',
		filters.shipTypeName ?? '',
		filters.solarSystemName ?? '',
		filters.dateFrom ?? '',
		filters.dateTo ?? '',
	].join(':')

	return (
		<Container>
			<PageHeader title="Review Queue" description="Review and process ship replacement requests" />

			<Card className="mt-section">
				<CardContent className="space-y-4 p-4">
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<Select
							options={[]}
							value={filters.characterName ?? ''}
							onValueChange={(value) =>
								updateReviewQueueFilters({ characterName: value || undefined })
							}
							searchable
							searchDelegate={async (query) => {
								const values = await api.searchCharacters(query)
								const seen = new Set<string>()
								return values
									.map((entry) => entry.characterName)
									.filter((name) => {
										const key = name.trim().toLowerCase()
										if (!key || seen.has(key)) return false
										seen.add(key)
										return true
									})
									.map((name) => ({
										value: name,
										label: name,
									}))
							}}
							placeholder="Character"
							minQueryLength={2}
							queryHintText="Type at least 2 characters"
							emptyText="No character names found"
							selectAllOption={{ value: '', label: 'All Characters' }}
						/>
						<Select
							options={[]}
							value={filters.shipTypeName ?? ''}
							onValueChange={(value) =>
								updateReviewQueueFilters({ shipTypeName: value || undefined })
							}
							searchable
							searchDelegate={async (query) => {
								const values = await api.searchShipTypes(query)
								return values.map((entry) => ({
									value: entry.typeName,
									label: entry.typeName,
									description: entry.typeId,
								}))
							}}
							placeholder="Ship"
							minQueryLength={2}
							queryHintText="Type at least 2 characters"
							emptyText="No ships found"
							selectAllOption={{ value: '', label: 'All Ships' }}
						/>
						<Select
							options={[]}
							value={filters.solarSystemName ?? ''}
							onValueChange={(value) =>
								updateReviewQueueFilters({ solarSystemName: value || undefined })
							}
							searchable
							searchDelegate={async (query) => {
								const values = await api.searchUniverseSystems(query)
								return values.map((entry) => ({
									value: entry.systemName,
									label: entry.systemName,
									description: entry.systemId,
								}))
							}}
							placeholder="System"
							minQueryLength={2}
							queryHintText="Type at least 2 characters"
							emptyText="No systems found"
							selectAllOption={{ value: '', label: 'All Systems' }}
						/>
						<DateRangeInput
							value={{
								fromDate: filters.dateFrom ?? '',
								toDate: filters.dateTo ?? '',
							}}
							onChange={({ fromDate, toDate }) =>
								updateReviewQueueFilters({
									dateFrom: fromDate || undefined,
									dateTo: toDate || undefined,
								})
							}
							placeholder="Loss date range"
							className="[&_.themed-date-picker__input]:h-10"
						/>
					</div>

					<Tabs value={activeTab} onValueChange={handleTabChange}>
						<TabsList className="w-full">
							{TABS.map((tab) => (
								<TabsTrigger key={tab.value} value={tab.value}>
									{tab.label}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>

					<ReviewTabContent
						key={reviewQueueContentKey}
						status={activeTab}
						filters={filters}
						page={page}
						pageSize={pageSize}
						onPageChange={setReviewQueuePage}
						onPageSizeChange={(nextPageSize) => {
							setReviewQueuePageSize(nextPageSize)
						}}
					/>
				</CardContent>
			</Card>
		</Container>
	)
}

function ReviewTabContent({
	status,
	filters,
	page,
	pageSize,
	onPageChange,
	onPageSizeChange,
}: {
	status: RequestStatus
	filters: ReviewQueueFilters
	page: number
	pageSize: number
	onPageChange: (page: number) => void
	onPageSizeChange: (pageSize: number) => void
}) {
	const sortBy = useReviewQueueUiState((state) => state.sortBy)
	const sortDirection = useReviewQueueUiState((state) => state.sortDirection)
	const toggleSort = (nextSortBy: ReviewQueueSortBy) => {
		toggleReviewQueueSort(nextSortBy)
	}
	const sortIndicator = (field: ReviewQueueSortBy) => {
		if (sortBy !== field) return '↕'
		return sortDirection === 'asc' ? '↑' : '↓'
	}

	const offset = (page - 1) * pageSize
	const searchParams = new URLSearchParams()
	searchParams.set('status', status)
	searchParams.set('limit', String(pageSize))
	searchParams.set('offset', String(offset))
	if (filters.characterName) searchParams.set('characterName', filters.characterName)
	if (filters.shipTypeName) searchParams.set('shipTypeName', filters.shipTypeName)
	if (filters.solarSystemName) searchParams.set('solarSystemName', filters.solarSystemName)
	if (filters.dateFrom) searchParams.set('dateFrom', filters.dateFrom)
	if (filters.dateTo) searchParams.set('dateTo', filters.dateTo)
	const requestPath = `/srp/requests/by-status?${searchParams.toString()}`
	const queryKey = [
		'srp',
		'requests',
		'review-by-status',
		status,
		pageSize,
		offset,
		filters.characterName ?? '',
		filters.shipTypeName ?? '',
		filters.solarSystemName ?? '',
		filters.dateFrom ?? '',
		filters.dateTo ?? '',
	] as const
	const { data, isLoading, isFetching, error, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			return api.get<{
				requests: SRPRequestResponse[]
				total: number
				limit: number
				offset: number
			}>(requestPath)
		},
		placeholderData: (previousData) => previousData,
		staleTime: 1000 * 60 * 5,
		gcTime: 1000 * 60 * 5,
	})
	const [showLoadWarning, setShowLoadWarning] = useState(false)

	useEffect(() => {
		if (!data) return
		if (data.limit !== pageSize || data.offset !== offset) return
		setReviewQueueSnapshot(status, { limit: pageSize, offset, ...filters }, data)
	}, [data, status, pageSize, offset, filters])

	useEffect(() => {
		if (!isLoading && !isFetching) {
			setShowLoadWarning(false)
			return
		}
		const timeout = window.setTimeout(() => {
			setShowLoadWarning(true)
		}, 30000)
		return () => window.clearTimeout(timeout)
	}, [isFetching, isLoading])
	const hasActiveFilters = Boolean(
		filters.characterName ||
			filters.shipTypeName ||
			filters.solarSystemName ||
			filters.dateFrom ||
			filters.dateTo
	)
	const effectiveData = data
	const baseRequests = effectiveData?.requests ?? []
	const entities = useReviewQueueEntityMap()
	const requestEntities = useMemo(
		() =>
			baseRequests
				.map((request) => entities[request.id] ?? request)
				.filter((request): request is SRPRequestResponse => Boolean(request)),
		[baseRequests, entities]
	)
	const totalCount = effectiveData?.total ?? 0
	const hasPagination = Math.ceil(totalCount / pageSize) > 1
	const isSoftLoading = Boolean(effectiveData) && (isLoading || isFetching)
	const refreshButton = (
		<Button
			type="button"
			variant="secondary"
			size="sm"
			className="h-8"
			onClick={() => void refetch()}
			disabled={isFetching}
		>
			{isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
			<span className="ml-2">Refresh</span>
		</Button>
	)

	if (!effectiveData && (isLoading || isFetching)) {
		if (showLoadWarning) {
			return (
				<div className="rounded-lg border border-muted p-6 text-center">
					<div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-muted bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span>Loading requests...</span>
					</div>
					<p className="mt-3 text-sm text-muted-foreground">
						Queue is taking longer than expected.
					</p>
					<Button
						variant="secondary"
						size="sm"
						className="mt-3"
						onClick={() => void refetch()}
						disabled={isFetching}
						loading={isFetching}
					>
						Retry loading queue
					</Button>
				</div>
			)
		}
		return (
			<div className="rounded-lg border border-dashed p-12 text-center">
				<div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-muted bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span>Loading requests...</span>
				</div>
			</div>
		)
	}

	if (error && !effectiveData) {
		return (
			<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
				<p className="text-sm text-red-500">Failed to load requests</p>
				<Button
					variant="secondary"
					size="sm"
					className="mt-3"
					onClick={() => void refetch()}
					disabled={isFetching}
					loading={isFetching}
				>
					Retry loading queue
				</Button>
			</div>
		)
	}

	const visibleRequests: SRPRequestResponse[] = [...requestEntities].sort((a, b) => {
		const left = sortBy === 'submitted' ? toTimestamp(a.createdAt) : toTimestamp(a.lossDate)
		const right = sortBy === 'submitted' ? toTimestamp(b.createdAt) : toTimestamp(b.lossDate)
		return sortDirection === 'asc' ? left - right : right - left
	})

	if (visibleRequests.length === 0) {
		return (
			<div className="rounded-lg border border-dashed p-12 text-center">
				<p className="text-muted-foreground">
					{hasActiveFilters
						? 'No requests match the current filters'
						: `No ${status.replace('_', ' ')} requests`}
				</p>
				<div className="mt-4 flex justify-center">{refreshButton}</div>
			</div>
		)
	}

	return (
		<div>
			{error && effectiveData && (
				<div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
					<div className="flex items-center justify-between gap-3">
						<span>Latest refresh failed. Showing last loaded results.</span>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void refetch()}
							disabled={isFetching}
							loading={isFetching}
						>
							Retry
						</Button>
					</div>
				</div>
			)}
			<div className="relative">
				{isSoftLoading && (
					<div className="pointer-events-none absolute inset-0 z-10 rounded-md bg-background/60 backdrop-blur-[1px]" />
				)}
				<div className={isSoftLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
					<div className="mb-3 rounded-md border p-3">
						<UserSearchPaginationControls
							totalCount={totalCount}
							page={page}
							pageSize={pageSize}
							onPageChange={onPageChange}
							onPageSizeChange={onPageSizeChange}
							pageSizeOptions={[10, 25, 50, 100]}
							itemLabel="requests"
							nextButtonLoading={isFetching}
							summaryAction={refreshButton}
						/>
					</div>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-14" />
									<TableHead>Ship</TableHead>
									<TableHead>Pilot</TableHead>
									<TableHead className="text-right">Payout / Value</TableHead>
									<TableHead>System</TableHead>
									<TableHead>
										<button
											type="button"
											className="inline-flex items-center gap-1 text-left hover:text-foreground"
											onClick={() => toggleSort('loss')}
										>
											Lost
											<span className="text-xs text-muted-foreground">{sortIndicator('loss')}</span>
										</button>
									</TableHead>
									<TableHead>
										<button
											type="button"
											className="inline-flex items-center gap-1 text-left hover:text-foreground"
											onClick={() => toggleSort('submitted')}
										>
											Submitted
											<span className="text-xs text-muted-foreground">
												{sortIndicator('submitted')}
											</span>
										</button>
									</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{visibleRequests.map((req) => (
									<TableRow key={req.id}>
										<TableCell className="py-2">
											{req.shipTypeId && (
												<div className="h-10 w-10 overflow-hidden rounded border border-border/50">
													<img
														src={typeIconUrl(req.shipTypeId, 32)}
														alt={req.shipTypeName ?? ''}
														className="h-full w-full object-contain"
														loading="lazy"
													/>
												</div>
											)}
										</TableCell>
										<TableCell className="font-semibold">
											<Link
												to={`/srp/review/${req.id}`}
												className="underline-offset-4 hover:underline focus-visible:underline"
											>
												{req.shipTypeName ?? '—'}
											</Link>
										</TableCell>
										<TableCell className="text-sm">
											<div className="inline-flex items-center gap-2">
												<span>{req.characterName}</span>
												<CharacterRoleBadge
													role={getRequestCharacterRole(req)}
													mainCharacterName={req.mainCharacterName}
													mainCharacterId={req.mainCharacterId}
												/>
											</div>
											{req.corporationName && req.corporationName !== 'Unknown' && (
												<div className="text-xs text-muted-foreground">{req.corporationName}</div>
											)}
										</TableCell>
										<TableCell className="text-right font-mono text-sm tabular-nums">
											{formatISKShort(
												req.approvedAmount ?? req.srpEquipmentValue ?? req.shipValue,
												{ showDecimals: false }
											)}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											<div>{req.solarSystemName ?? '—'}</div>
											{req.solarSystemRegionName ? (
												<div className="text-xs text-muted-foreground/80">
													{req.solarSystemRegionName}
												</div>
											) : null}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{req.lossDate ? (
												<EveTimeDisplay
													dateStr={req.lossDate}
													format="compact"
													className="whitespace-nowrap text-sm text-muted-foreground"
												/>
											) : (
												'—'
											)}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{formatRelativeTime(req.createdAt)}
										</TableCell>
										<TableCell>
											<RequestStatusBadge status={req.requestStatus as any} />
										</TableCell>
										<TableCell className="text-right">
											<Button size="sm" variant="secondary" asChild>
												<Link to={`/srp/review/${req.id}`}>View</Link>
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</div>
			</div>
		</div>
	)
}
