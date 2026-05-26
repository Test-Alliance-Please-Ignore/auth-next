import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
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
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'

import { useSrpWalletHistory } from '../hooks'
import { formatISK } from '../utils'

type WalletHistoryFilters = {
	reason?: string
	recipientId?: string
	alertsOnly?: boolean
	dateFrom?: string
	dateTo?: string
}

export default function SRPWalletHistoryPage() {
	usePageTitle('SRP - Wallet History')
	const { hasAnyPermission } = useUserPermissions()
	const [filters, setFilters] = useState<WalletHistoryFilters>({})
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(50)

	const canAccess = hasAnyPermission('urn:srp:payer', 'urn:srp:manager')
	if (!canAccess) return <Navigate to="/srp" replace />

	const offset = (page - 1) * pageSize
	const { data, isLoading, error } = useSrpWalletHistory({
		...filters,
		limit: pageSize,
		offset,
	})

	const items = data?.items ?? []
	const total = data?.total ?? 0
	const hasPagination = Math.ceil(total / pageSize) > 1

	const getAlertReasonLines = (item: (typeof items)[number]): string[] => {
		const lines: string[] = []
		const expectedRecipient =
			item.alertDetail?.expectedRecipientCharacterName && item.alertDetail?.expectedRecipientCharacterId
				? `${item.alertDetail.expectedRecipientCharacterName} (${item.alertDetail.expectedRecipientCharacterId})`
				: item.alertDetail?.expectedRecipientCharacterName ??
					item.alertDetail?.expectedRecipientCharacterId ??
					'unknown'
		const actualRecipient =
			item.alertDetail?.actualRecipientCharacterName && item.alertDetail?.actualRecipientCharacterId
				? `${item.alertDetail.actualRecipientCharacterName} (${item.alertDetail.actualRecipientCharacterId})`
				: item.alertDetail?.actualRecipientCharacterName ??
					item.recipientName ??
					item.alertDetail?.actualRecipientCharacterId ??
					item.recipientId ??
					'unknown'
		if (item.hasRecipientMismatch) {
			lines.push(`Recipient mismatch (expected ${expectedRecipient}, actual ${actualRecipient})`)
		}
		if ((item.matchingAlertKinds ?? []).includes('payment_mismatch')) {
			lines.push(
				`Amount mismatch (expected ${item.alertDetail?.expectedAmount ?? 'unknown'}, actual ${item.alertDetail?.observedAmount ?? item.amount})`
			)
		}
		if ((item.matchingAlertKinds ?? []).includes('payment_missing')) {
			lines.push(`Missing payment (>24h) (expected ${item.alertDetail?.expectedAmount ?? 'unknown'})`)
		}
		return [...new Set(lines)]
	}
	const hasMissingReasonWarning = (item: (typeof items)[number]): boolean =>
		Boolean(item.hasMissingReasonWarning)

	const renderPagination = () => (
		<UserSearchPaginationControls
			page={page}
			totalCount={total}
			pageSize={pageSize}
			onPageChange={setPage}
			onPageSizeChange={(next) => {
				setPageSize(next)
				setPage(1)
			}}
			pageSizeOptions={[25, 50, 100, 200]}
		/>
	)

	return (
		<Container>
			<PageHeader
				title="SRP Wallet History"
				description="Wallet journal for the configured SRP payment processor corporation"
			/>

			<Card className="mt-section">
				<CardContent className="space-y-4 p-4">
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<Select
							options={[]}
							value={filters.reason ?? ''}
							onValueChange={(value) => {
								setFilters((prev) => ({ ...prev, reason: value || undefined }))
								setPage(1)
							}}
							searchable
							searchDelegate={(query) =>
								api.searchSrpWalletHistoryValues({ field: 'reason', query })
							}
							placeholder="Reason"
							minQueryLength={2}
							queryHintText="Type at least 2 characters"
							emptyText="No reasons found"
							selectAllOption={{ value: '', label: 'All Reasons' }}
						/>
						<Select
							options={[]}
							value={filters.recipientId ?? ''}
							onValueChange={(value) => {
								setFilters((prev) => ({ ...prev, recipientId: value || undefined }))
								setPage(1)
							}}
							searchable
							searchDelegate={(query) =>
								api.searchSrpWalletHistoryValues({ field: 'recipient', query })
							}
							placeholder="Recipient"
							minQueryLength={2}
							queryHintText="Type at least 2 characters"
							emptyText="No recipients found"
							selectAllOption={{ value: '', label: 'All Recipients' }}
						/>
						<div className="xl:col-span-2">
							<DateRangeInput
								value={{
									fromDate: filters.dateFrom ?? '',
									toDate: filters.dateTo ?? '',
								}}
								onChange={({ fromDate, toDate }) => {
									setFilters((prev) => ({
										...prev,
										dateFrom: fromDate || undefined,
										dateTo: toDate || undefined,
									}))
									setPage(1)
								}}
								placeholder="Entry date range"
								className="[&_.themed-date-picker__input]:h-10"
							/>
						</div>
						<div className="flex items-center gap-2 md:col-span-2 xl:col-span-4">
							<Switch
								checked={Boolean(filters.alertsOnly)}
								onCheckedChange={(checked) => {
									setFilters((prev) => ({
										...prev,
										alertsOnly: checked ? true : undefined,
									}))
									setPage(1)
								}}
							/>
							<span className="text-sm text-muted-foreground">Alerts only</span>
						</div>
					</div>

					{hasPagination && <div className="border-y py-3">{renderPagination()}</div>}

					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Date</TableHead>
									<TableHead>Reason</TableHead>
									<TableHead>Recipient</TableHead>
									<TableHead className="text-right">Amount</TableHead>
									<TableHead>Journal</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{error ? (
									<TableRow>
										<TableCell colSpan={6} className="py-8 text-center text-red-500">
											{error instanceof Error ? error.message : 'Failed to load wallet history'}
										</TableCell>
									</TableRow>
								) : isLoading ? (
									<TableRow>
										<TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
											Loading wallet history...
										</TableCell>
									</TableRow>
								) : items.length === 0 ? (
									<TableRow>
										<TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
											No wallet transactions found
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
															trigger={<AlertTriangle className="h-3.5 w-3.5 cursor-help text-red-400" />}
															align="start"
															side="top"
															className="w-64 p-3"
														>
															<div className="space-y-1">
																<p className="text-xs font-semibold text-red-300">Alert Details</p>
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
															trigger={<AlertTriangle className="h-3.5 w-3.5 cursor-help text-yellow-400" />}
															align="start"
															side="top"
															className="w-64 p-3"
														>
															<div className="space-y-1">
																<p className="text-xs font-semibold text-yellow-300">Warning</p>
																<p className="text-xs text-muted-foreground">
																	Corporation withdrawal to a user character with an empty reason.
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

					{hasPagination && <div className="border-t pt-3">{renderPagination()}</div>}
				</CardContent>
			</Card>
		</Container>
	)
}
