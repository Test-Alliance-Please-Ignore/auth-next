import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { TableRefreshFrame } from '@/components/table-refresh-frame'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { HoverPopover } from '@/components/ui/hover-popover'
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
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'
import { typeIconUrl } from '@/lib/eve-images'

import { CharacterRoleBadge } from '../components/CharacterRoleBadge'
import { RequestStatusBadge } from '../components/RequestStatusBadge'
import {
	clearReviewQueueFilters,
	setReviewQueueActiveTab,
	setReviewQueuePage,
	setReviewQueuePageSize,
	setReviewQueueSnapshot,
	toggleReviewQueueSort,
	updateReviewQueueFilters,
	useReviewQueueEntityMap,
	useReviewQueueUiState,
} from '../state/review-queue-snapshot-store'
import {
	formatISKShort,
	formatRelativeTime,
	getRequestCharacterRole,
	getRequestStatusText,
	isDateRangeWithinOneYear,
} from '../utils'

import type { AppTranslationKey } from '@/i18n'
import type { RequestStatus, SRPRequestResponse } from '../types'

const TABS: Array<{ value: RequestStatus; label: AppTranslationKey }> = [
	{ value: 'pending', label: 'srp.status.pending' },
	{ value: 'needs_context', label: 'srp.status.needs_context' },
	{ value: 'rejected', label: 'srp.status.rejected' },
	{ value: 'approved', label: 'srp.status.approved' },
	{ value: 'paid', label: 'srp.status.paid' },
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
	const { t } = useAppTranslation()
	usePageTitle(t('srp.queue.pageTitle'))

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
			<PageHeader title={t('srp.queue.title')} description={t('srp.queue.description')} />

			<Card className="mt-section">
				<CardContent className="space-y-4 p-4">
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
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
							placeholder={t('srp.common.character')}
							minQueryLength={2}
							queryHintText={t('srp.common.searchHint')}
							emptyText={t('srp.queue.noCharacters')}
							selectAllOption={{ value: '', label: t('srp.queue.allCharacters') }}
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
							placeholder={t('srp.common.ship')}
							minQueryLength={2}
							queryHintText={t('srp.common.searchHint')}
							emptyText={t('srp.queue.noShips')}
							selectAllOption={{ value: '', label: t('srp.queue.allShips') }}
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
							placeholder={t('srp.common.system')}
							minQueryLength={2}
							queryHintText={t('srp.common.searchHint')}
							emptyText={t('srp.queue.noSystems')}
							selectAllOption={{ value: '', label: t('srp.queue.allSystems') }}
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
							placeholder={t('srp.queue.dateRange')}
							className="[&_.themed-date-picker__input]:h-10"
						/>
						<div className="flex items-end justify-end">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={clearReviewQueueFilters}
								disabled={
									!filters.characterName &&
									!filters.shipTypeName &&
									!filters.solarSystemName &&
									!filters.dateFrom &&
									!filters.dateTo
								}
							>
								{t('srp.common.clearFilters')}
							</Button>
						</div>
					</div>

					<Tabs value={activeTab} onValueChange={handleTabChange}>
						<TabsList className="w-full">
							{TABS.map((tab) => (
								<TabsTrigger key={tab.value} value={tab.value}>
									{t(tab.label)}
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
	const { t } = useAppTranslation()
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
	const [pendingExport, setPendingExport] = useState<{
		workflowInstanceId: string
		fileName: string
	} | null>(null)
	const [isExporting, setIsExporting] = useState(false)

	const exportStatusQuery = useQuery({
		queryKey: [
			'srp',
			'requests',
			'paid',
			'export-status',
			pendingExport?.workflowInstanceId ?? null,
		],
		queryFn: () => api.getSrpPaidRequestsCsvExportStatus(pendingExport!.workflowInstanceId),
		enabled: Boolean(pendingExport?.workflowInstanceId),
		refetchInterval: (query) => {
			const status = query.state.data?.status
			return status === 'queued' || status === 'running' ? 5000 : false
		},
		refetchOnWindowFocus: false,
	})
	const exportStatus = exportStatusQuery.data?.status
	const isExportPolling =
		Boolean(pendingExport) &&
		(exportStatus === undefined || exportStatus === 'queued' || exportStatus === 'running')
	const isExportBusy = isExporting || isExportPolling

	useEffect(() => {
		if (!pendingExport) return
		if (!exportStatusQuery.data) return
		if (exportStatusQuery.data.status === 'completed') {
			void (async () => {
				try {
					await api.downloadSrpPaidRequestsCsv(
						pendingExport.workflowInstanceId,
						pendingExport.fileName
					)
				} finally {
					setPendingExport(null)
					setIsExporting(false)
				}
			})()
			return
		}
		if (exportStatusQuery.data.status === 'failed' || exportStatusQuery.data.status === 'unknown') {
			setPendingExport(null)
			setIsExporting(false)
		}
	}, [exportStatusQuery.data, pendingExport])

	const handleExportPaidRequests = useCallback(async () => {
		if (status !== 'paid' || isExporting) {
			return
		}
		const dateFrom = filters.dateFrom
		const dateTo = filters.dateTo
		if (!dateFrom || !dateTo || !isDateRangeWithinOneYear(dateFrom, dateTo)) {
			return
		}

		setIsExporting(true)
		try {
			const exportResult = await api.requestSrpPaidRequestsCsvExport({
				characterName: filters.characterName?.trim() || undefined,
				shipTypeName: filters.shipTypeName?.trim() || undefined,
				solarSystemName: filters.solarSystemName?.trim() || undefined,
				dateFrom,
				dateTo,
			})
			setPendingExport({
				workflowInstanceId: exportResult.workflowInstanceId,
				fileName: exportResult.fileName,
			})
		} catch {
			setIsExporting(false)
		}
	}, [
		filters.characterName,
		filters.dateFrom,
		filters.dateTo,
		filters.shipTypeName,
		filters.solarSystemName,
		isExporting,
		status,
	])

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
			{isFetching ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : (
				<RefreshCw className="h-4 w-4" />
			)}
			<span className="ml-2">{t('srp.common.refresh')}</span>
		</Button>
	)
	const actionButtons =
		status === 'paid' ? (
			<div className="flex items-center gap-2">
				{refreshButton}
				<div className="flex items-center gap-3">
					{isExportPolling && (
						<span className="text-xs text-muted-foreground">{t('srp.common.exportWaiting')}</span>
					)}
					{!isExportBusy &&
					(!filters.dateFrom ||
						!filters.dateTo ||
						!isDateRangeWithinOneYear(filters.dateFrom, filters.dateTo)) ? (
						<HoverPopover
							align="end"
							side="bottom"
							className="w-72 border border-border bg-popover p-3 text-popover-foreground shadow-lg"
							trigger={
								<span className="inline-block cursor-help">
									<Button type="button" variant="secondary" size="sm" className="h-8" disabled>
										{t('srp.common.exportCsv')}
									</Button>
								</span>
							}
						>
							<div className="text-sm font-medium">{t('srp.queue.dateRequired')}</div>
							<div className="text-sm text-muted-foreground">{t('srp.queue.dateHint')}</div>
						</HoverPopover>
					) : (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="h-8"
							onClick={() => {
								void handleExportPaidRequests()
							}}
							disabled={
								isFetching ||
								isExportBusy ||
								!filters.dateFrom ||
								!filters.dateTo ||
								!isDateRangeWithinOneYear(filters.dateFrom, filters.dateTo)
							}
							loading={isExportBusy}
							loadingText={isExporting ? t('srp.common.exporting') : t('srp.common.generating')}
						>
							{t('srp.common.exportCsv')}
						</Button>
					)}
				</div>
			</div>
		) : (
			refreshButton
		)

	if (!effectiveData && (isLoading || isFetching)) {
		if (showLoadWarning) {
			return (
				<div className="rounded-lg border border-muted p-6 text-center">
					<div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-muted bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						<span>{t('srp.common.loadingRequests')}</span>
					</div>
					<p className="mt-3 text-sm text-muted-foreground">{t('srp.queue.slow')}</p>
					<Button
						variant="secondary"
						size="sm"
						className="mt-3"
						onClick={() => void refetch()}
						disabled={isFetching}
						loading={isFetching}
					>
						{t('srp.common.retryQueue')}
					</Button>
				</div>
			)
		}
		return (
			<div className="rounded-lg border border-dashed p-12 text-center">
				<div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-muted bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span>{t('srp.common.loadingRequests')}</span>
				</div>
			</div>
		)
	}

	if (error && !effectiveData) {
		return (
			<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
				<p className="text-sm text-red-500">{t('srp.common.loadRequestsFailed')}</p>
				<Button
					variant="secondary"
					size="sm"
					className="mt-3"
					onClick={() => void refetch()}
					disabled={isFetching}
					loading={isFetching}
				>
					{t('srp.common.retryQueue')}
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
						? t('srp.queue.emptyFiltered')
						: t('srp.queue.emptyStatus', { status: getRequestStatusText(status, t) })}
				</p>
				<div className="mt-4 flex justify-center">{actionButtons}</div>
			</div>
		)
	}

	return (
		<div>
			<TableRefreshFrame
				isRefreshing={isSoftLoading}
				refreshMessage={t('srp.dashboard.refreshingLosses')}
				errorMessage={
					error && effectiveData
						? error instanceof Error
							? error.message
							: t('srp.common.refreshRequestsFailed')
						: null
				}
				onRetry={error && effectiveData ? () => void refetch() : undefined}
				retryDisabled={isFetching}
			>
				<div className="mb-3 rounded-md border p-3">
					<UserSearchPaginationControls
						totalCount={totalCount}
						page={page}
						pageSize={pageSize}
						onPageChange={onPageChange}
						onPageSizeChange={onPageSizeChange}
						pageSizeOptions={[10, 25, 50, 100]}
						itemLabel={t('srp.common.requestItem', { count: totalCount })}
						nextButtonLoading={isFetching}
						trailingAction={actionButtons}
					/>
				</div>
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-14" />
								<TableHead>{t('srp.common.ship')}</TableHead>
								<TableHead>{t('srp.queue.pilot')}</TableHead>
								<TableHead className="text-right">{t('srp.queue.payoutValue')}</TableHead>
								<TableHead>{t('srp.common.system')}</TableHead>
								<TableHead>
									<button
										type="button"
										className="inline-flex items-center gap-1 text-left hover:text-foreground"
										onClick={() => toggleSort('loss')}
									>
										{t('srp.queue.lost')}
										<span className="text-xs text-muted-foreground">{sortIndicator('loss')}</span>
									</button>
								</TableHead>
								<TableHead>
									<button
										type="button"
										className="inline-flex items-center gap-1 text-left hover:text-foreground"
										onClick={() => toggleSort('submitted')}
									>
										{t('srp.queue.submitted')}
										<span className="text-xs text-muted-foreground">
											{sortIndicator('submitted')}
										</span>
									</button>
								</TableHead>
								<TableHead>{t('srp.common.status')}</TableHead>
								<TableHead className="text-right">{t('srp.common.actions')}</TableHead>
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
										{req.corporationName && req.corporationName !== t('srp.common.unknown') && (
											<div className="text-xs text-muted-foreground">{req.corporationName}</div>
										)}
									</TableCell>
									<TableCell className="text-right font-mono text-sm tabular-nums">
										{formatISKShort(req.approvedAmount ?? req.srpEquipmentValue ?? req.shipValue, {
											showDecimals: false,
										})}
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
											<Link to={`/srp/review/${req.id}`}>{t('srp.common.view')}</Link>
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</TableRefreshFrame>
		</div>
	)
}
