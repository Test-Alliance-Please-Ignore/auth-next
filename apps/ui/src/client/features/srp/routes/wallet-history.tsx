import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { HoverPopover } from '@/components/ui/hover-popover'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'

import { useSrpWalletHistory } from '../hooks'
import {
	setWalletHistoryPage,
	setWalletHistoryPageSize,
	updateWalletHistoryFilters,
	useWalletHistoryUiState,
} from '../state/wallet-history-store'
import { formatISK, isDateRangeWithinOneYear } from '../utils'

export default function SRPWalletHistoryPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('srp.wallet.pageTitle'))
	const { hasAnyPermission } = useUserPermissions()
	const filters = useWalletHistoryUiState((state) => state.filters)
	const page = useWalletHistoryUiState((state) => state.page)
	const pageSize = useWalletHistoryUiState((state) => state.pageSize)
	const [pendingExport, setPendingExport] = useState<{
		workflowInstanceId: string
		fileName: string
	} | null>(null)
	const [isExporting, setIsExporting] = useState(false)

	const exportStatusQuery = useQuery({
		queryKey: [
			'srp',
			'payments',
			'wallet-history',
			'export-status',
			pendingExport?.workflowInstanceId ?? null,
		],
		queryFn: () => api.getSrpWalletHistoryCsvExportStatus(pendingExport!.workflowInstanceId),
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
					await api.downloadSrpWalletHistoryCsv(
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

	const canAccess = hasAnyPermission('urn:srp:payer', 'urn:srp:manager')
	if (!canAccess) return <Navigate to="/srp" replace />

	const offset = (page - 1) * pageSize
	const { data, isLoading, isFetching, error } = useSrpWalletHistory({
		...filters,
		limit: pageSize,
		offset,
	})
	const [lastSuccessfulData, setLastSuccessfulData] = useState<typeof data | null>(null)

	useEffect(() => {
		if (data) setLastSuccessfulData(data)
	}, [data])

	const effectiveData = data ?? lastSuccessfulData
	const items = effectiveData?.items ?? []
	const total = effectiveData?.total ?? 0
	const hasPagination = Math.ceil(total / pageSize) > 1
	const isSoftLoading = Boolean(effectiveData) && (isLoading || isFetching)
	const canExportCsv = Boolean(
		filters.dateFrom && filters.dateTo && isDateRangeWithinOneYear(filters.dateFrom, filters.dateTo)
	)

	const handleExport = useCallback(async () => {
		if (!canExportCsv || isExporting) {
			return
		}

		setIsExporting(true)
		try {
			const exportResult = await api.requestSrpWalletHistoryCsvExport({
				reason: filters.reason,
				recipientId: filters.recipientId,
				alertsOnly: filters.alertsOnly,
				dateFrom: filters.dateFrom,
				dateTo: filters.dateTo,
			})
			setPendingExport({
				workflowInstanceId: exportResult.workflowInstanceId,
				fileName: exportResult.fileName,
			})
		} catch {
			setIsExporting(false)
		}
	}, [canExportCsv, filters, isExporting])

	const getAlertReasonLines = (item: (typeof items)[number]): string[] => {
		const lines: string[] = []
		const expectedRecipient =
			item.alertDetail?.expectedRecipientCharacterName &&
			item.alertDetail?.expectedRecipientCharacterId
				? `${item.alertDetail.expectedRecipientCharacterName} (${item.alertDetail.expectedRecipientCharacterId})`
				: (item.alertDetail?.expectedRecipientCharacterName ??
					item.alertDetail?.expectedRecipientCharacterId ??
					t('srp.common.unknown'))
		const actualRecipient =
			item.alertDetail?.actualRecipientCharacterName && item.alertDetail?.actualRecipientCharacterId
				? `${item.alertDetail.actualRecipientCharacterName} (${item.alertDetail.actualRecipientCharacterId})`
				: (item.alertDetail?.actualRecipientCharacterName ??
					item.recipientName ??
					item.alertDetail?.actualRecipientCharacterId ??
					item.recipientId ??
					t('srp.common.unknown'))
		if (item.hasRecipientMismatch) {
			lines.push(
				t('srp.wallet.recipientMismatch', { expected: expectedRecipient, actual: actualRecipient })
			)
		}
		if ((item.matchingAlertKinds ?? []).includes('payment_mismatch')) {
			lines.push(
				t('srp.wallet.amountMismatch', {
					expected: item.alertDetail?.expectedAmount
						? formatISK(item.alertDetail.expectedAmount)
						: t('srp.common.unknown'),
					actual: formatISK(item.alertDetail?.observedAmount ?? item.amount),
				})
			)
		}
		if ((item.matchingAlertKinds ?? []).includes('payment_missing')) {
			lines.push(
				t('srp.wallet.missingPayment', {
					expected: item.alertDetail?.expectedAmount
						? formatISK(item.alertDetail.expectedAmount)
						: t('srp.common.unknown'),
				})
			)
		}
		return [...new Set(lines)]
	}
	const hasMissingReasonWarning = (item: (typeof items)[number]): boolean =>
		Boolean(item.hasMissingReasonWarning)

	const renderPagination = () => (
		<UserSearchPaginationControls
			page={page}
			totalCount={total}
			itemLabel={t('srp.wallet.entryItem', { count: total })}
			pageSize={pageSize}
			onPageChange={setWalletHistoryPage}
			onPageSizeChange={(next) => {
				setWalletHistoryPageSize(next)
			}}
			pageSizeOptions={[25, 50, 100, 200]}
		/>
	)

	return (
		<Container>
			<PageHeader title={t('srp.wallet.title')} description={t('srp.wallet.description')} />

			<Card className="mt-section">
				<CardContent className="space-y-4 p-4">
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<Select
							options={[]}
							value={filters.reason ?? ''}
							onValueChange={(value) => {
								updateWalletHistoryFilters({ reason: value || undefined })
							}}
							searchable
							searchDelegate={(query) =>
								api.searchSrpWalletHistoryValues({ field: 'reason', query })
							}
							placeholder={t('srp.common.reason')}
							minQueryLength={2}
							queryHintText={t('srp.common.searchHint')}
							emptyText={t('srp.wallet.noReasons')}
							selectAllOption={{ value: '', label: t('srp.wallet.allReasons') }}
						/>
						<Select
							options={[]}
							value={filters.recipientId ?? ''}
							onValueChange={(value) => {
								updateWalletHistoryFilters({ recipientId: value || undefined })
							}}
							searchable
							searchDelegate={(query) =>
								api.searchSrpWalletHistoryValues({ field: 'recipient', query })
							}
							placeholder={t('srp.common.recipient')}
							minQueryLength={2}
							queryHintText={t('srp.common.searchHint')}
							emptyText={t('srp.wallet.noRecipients')}
							selectAllOption={{ value: '', label: t('srp.wallet.allRecipients') }}
						/>
						<div className="xl:col-span-2">
							<DateRangeInput
								value={{
									fromDate: filters.dateFrom ?? '',
									toDate: filters.dateTo ?? '',
								}}
								onChange={({ fromDate, toDate }) => {
									updateWalletHistoryFilters({
										dateFrom: fromDate || undefined,
										dateTo: toDate || undefined,
									})
								}}
								placeholder={t('srp.wallet.dateRange')}
								className="[&_.themed-date-picker__input]:h-10"
							/>
						</div>
						<div className="flex items-center gap-2 md:col-span-2 xl:col-span-4">
							<Switch
								checked={Boolean(filters.alertsOnly)}
								onCheckedChange={(checked) => {
									updateWalletHistoryFilters({ alertsOnly: checked ? true : undefined })
								}}
							/>
							<span className="text-sm text-muted-foreground">{t('srp.wallet.alertsOnly')}</span>
						</div>
					</div>

					<div className="flex items-center justify-end">
						<div className="flex items-center gap-3">
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									void handleExport()
								}}
								disabled={!canExportCsv || isExportBusy}
								loading={isExportBusy}
								loadingText={isExporting ? t('srp.common.exporting') : t('srp.common.generating')}
							>
								{t('srp.common.exportCsv')}
							</Button>
							{isExportPolling && (
								<span className="text-xs text-muted-foreground">
									{t('srp.common.exportWaiting')}
								</span>
							)}
						</div>
					</div>

					<div className="relative">
						{isSoftLoading && (
							<div className="pointer-events-none absolute inset-0 z-10 rounded-md bg-background/60 backdrop-blur-[1px]" />
						)}
						<div className={isSoftLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
							{hasPagination && <div className="border-y py-3">{renderPagination()}</div>}

							<div className="rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t('srp.common.date')}</TableHead>
											<TableHead>{t('srp.common.reason')}</TableHead>
											<TableHead>{t('srp.common.recipient')}</TableHead>
											<TableHead className="text-right">{t('srp.common.amount')}</TableHead>
											<TableHead>{t('srp.common.journal')}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{error && !effectiveData ? (
											<TableRow>
												<TableCell colSpan={6} className="py-8 text-center text-red-500">
													{error instanceof Error ? error.message : t('srp.wallet.loadFailed')}
												</TableCell>
											</TableRow>
										) : !effectiveData && (isLoading || isFetching) ? (
											<TableRow>
												<TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
													{t('srp.wallet.loading')}
												</TableCell>
											</TableRow>
										) : items.length === 0 ? (
											<TableRow>
												<TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
													{t('srp.wallet.empty')}
												</TableCell>
											</TableRow>
										) : (
											items.map((item) => (
												<TableRow
													key={`${item.journalId}-${item.entryDate}`}
													className={
														item.hasOpenAlert
															? 'odd:!bg-red-900/25 even:!bg-red-900/25 hover:!bg-red-900/30 border-l-2 border-l-red-500'
															: hasMissingReasonWarning(item)
																? 'odd:!bg-yellow-900/20 even:!bg-yellow-900/20 hover:!bg-yellow-900/25 border-l-2 border-l-yellow-500'
																: undefined
													}
												>
													<TableCell className="text-sm">
														<EveTimeDisplay dateStr={item.entryDate} />
													</TableCell>
													<TableCell className="max-w-[380px] truncate text-sm">
														<div className="flex items-center gap-2">
															{item.hasOpenAlert && (
																<HoverPopover
																	trigger={
																		<AlertTriangle className="h-3.5 w-3.5 cursor-help text-red-400" />
																	}
																	align="start"
																	side="top"
																	className="w-64 p-3"
																>
																	<div className="space-y-1">
																		<p className="text-xs font-semibold text-red-300">
																			{t('srp.wallet.alertDetails')}
																		</p>
																		<ul className="list-disc pl-4 text-xs text-muted-foreground">
																			{getAlertReasonLines(item).map((reason) => (
																				<li key={reason}>{reason}</li>
																			))}
																		</ul>
																	</div>
																</HoverPopover>
															)}
															{hasMissingReasonWarning(item) && (
																<HoverPopover
																	trigger={
																		<AlertTriangle className="h-3.5 w-3.5 cursor-help text-yellow-400" />
																	}
																	align="start"
																	side="top"
																	className="w-64 p-3"
																>
																	<div className="space-y-1">
																		<p className="text-xs font-semibold text-yellow-300">
																			{t('srp.common.warning')}
																		</p>
																		<p className="text-xs text-muted-foreground">
																			{t('srp.wallet.missingReason')}
																		</p>
																	</div>
																</HoverPopover>
															)}
															{item.linkedRequestId ? (
																<Link
																	to={`/srp/request/${item.linkedRequestId}`}
																	target="_blank"
																	rel="noopener noreferrer"
																	className="text-primary hover:underline"
																>
																	{item.reason ?? '—'}
																</Link>
															) : (
																<span>{item.reason ?? '—'}</span>
															)}
														</div>
													</TableCell>
													<TableCell className="text-xs">
														{item.recipientName ?? item.recipientId ?? '—'}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{formatISK(item.amount)}
													</TableCell>
													<TableCell className="font-mono text-xs text-muted-foreground">
														{item.journalId}
													</TableCell>
												</TableRow>
											))
										)}
									</TableBody>
								</Table>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</Container>
	)
}
