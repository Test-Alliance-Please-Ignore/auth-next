import { ChevronDown, Filter } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { JsonViewer } from '@/components/json-viewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useActivityLogs } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, useAppTranslation } from '@/i18n'
import { getActivityActionLabel } from '@/lib/admin-activity'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

export default function ActivityLogPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.activityLog.pageTitle'))
	const [searchParams, setSearchParams] = useSearchParams()

	// State from URL params
	const initialUserId = searchParams.get('userId') || ''
	const initialCharacterId = searchParams.get('characterId') || ''
	const initialAction = searchParams.get('action') || ''

	const [userId, setUserId] = useState(initialUserId)
	const [characterId, setCharacterId] = useState(initialCharacterId)
	const [action, setAction] = useState(initialAction)
	const [startDate, setStartDate] = useState('')
	const [endDate, setEndDate] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(50)
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

	// Build filters
	const filters = {
		userId: userId || undefined,
		characterId: characterId || undefined,
		action: action || undefined,
		startDate: startDate || undefined,
		endDate: endDate || undefined,
		page,
		pageSize,
	}

	const { data, isLoading, error } = useActivityLogs(filters)

	const logs = data?.data || []
	const pagination = data?.pagination

	const handleApplyFilters = () => {
		setPage(1)
		// Update URL params
		const params = new URLSearchParams()
		if (userId) params.set('userId', userId)
		if (characterId) params.set('characterId', characterId)
		if (action) params.set('action', action)
		setSearchParams(params)
	}

	const handleClearFilters = () => {
		setUserId('')
		setCharacterId('')
		setAction('')
		setStartDate('')
		setEndDate('')
		setPage(1)
		setSearchParams({})
	}

	const handlePageSizeChange = (newSize: number) => {
		setPageSize(newSize)
		setPage(1)
	}

	const toggleRowExpanded = (logId: string) => {
		const newExpanded = new Set(expandedRows)
		if (newExpanded.has(logId)) {
			newExpanded.delete(logId)
		} else {
			newExpanded.add(logId)
		}
		setExpandedRows(newExpanded)
	}

	const getActionBadgeClass = (action: string) => {
		if (action.includes('login') || action.includes('auth')) {
			return 'border-green-500 text-green-500'
		}
		if (action.includes('create') || action.includes('add')) {
			return 'border-blue-500 text-blue-500'
		}
		if (action.includes('delete') || action.includes('remove')) {
			return 'border-red-500 text-red-500'
		}
		if (action.includes('update') || action.includes('edit')) {
			return 'border-yellow-500 text-yellow-500'
		}
		return ''
	}

	const hasActiveFilters = userId || characterId || action || startDate || endDate

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">{t('admin.activityLog.title')}</h1>
				<p className="text-muted-foreground mt-1">{t('admin.activityLog.description')}</p>
			</div>

			{/* Filters */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>{t('admin.activityLog.filters')}</CardTitle>
							<CardDescription>{t('admin.activityLog.filtersDescription')}</CardDescription>
						</div>
						{hasActiveFilters && (
							<Button variant="ghost" size="sm" onClick={handleClearFilters}>
								{t('admin.blocklist.clearFilters')}
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{/* User ID */}
						<div>
							<label htmlFor="activity-user" className="text-sm font-medium mb-1 block">
								{t('admin.blocklist.create.user.label')}
							</label>
							<Input
								placeholder={t('admin.activityLog.userPlaceholder')}
								id="activity-user"
								value={userId}
								onChange={(e) => setUserId(e.target.value)}
							/>
						</div>

						{/* Character ID */}
						<div>
							<label htmlFor="activity-character" className="text-sm font-medium mb-1 block">
								{t('admin.blocklist.targets.character_id')}
							</label>
							<Input
								placeholder={t('admin.activityLog.characterPlaceholder')}
								id="activity-character"
								value={characterId}
								onChange={(e) => setCharacterId(e.target.value)}
							/>
						</div>

						{/* Action */}
						<div>
							<label htmlFor="activity-action" className="text-sm font-medium mb-1 block">
								{t('admin.activityLog.action')}
							</label>
							<Input
								placeholder={t('admin.activityLog.actionPlaceholder')}
								id="activity-action"
								value={action}
								onChange={(e) => setAction(e.target.value)}
							/>
						</div>

						{/* Start Date */}
						<div>
							<label htmlFor="activity-start-date" className="text-sm font-medium mb-1 block">
								{t('admin.activityLog.startDate')}
							</label>
							<DateInput id="activity-start-date" value={startDate} onChange={setStartDate} />
						</div>

						{/* End Date */}
						<div>
							<label htmlFor="activity-end-date" className="text-sm font-medium mb-1 block">
								{t('admin.activityLog.endDate')}
							</label>
							<DateInput id="activity-end-date" value={endDate} onChange={setEndDate} />
						</div>
					</div>

					<div className="flex justify-end">
						<Button onClick={handleApplyFilters}>
							<Filter className="h-4 w-4" />
							{t('admin.activityLog.apply')}
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Activity Logs Table */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>{t('admin.activityLog.logs')}</CardTitle>
							<CardDescription>
								{pagination
									? t('admin.activityLog.range', {
											start:
												pagination.totalCount === 0
													? 0
													: (pagination.page - 1) * pagination.pageSize + 1,
											end: Math.min(pagination.page * pagination.pageSize, pagination.totalCount),
											count: pagination.totalCount,
										})
									: error
										? t('admin.activityLog.loadError')
										: t('admin.activityLog.loading')}
							</CardDescription>
						</div>

						{/* Page Size Selector */}
						<div className="flex items-center gap-2">
							<label htmlFor="activity-page-size" className="text-sm text-muted-foreground">
								{t('admin.activityLog.pageSize')}
							</label>
							<Select
								inputId="activity-page-size"
								value={String(pageSize)}
								onValueChange={(value) => handlePageSizeChange(Number(value))}
								options={[25, 50, 100].map((size) => ({
									value: String(size),
									label: formatNumber(size),
								}))}
								className="h-9 w-20"
								inputClassName="h-9"
							/>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="text-center py-8 text-muted-foreground">
							{t('admin.activityLog.loading')}
						</div>
					) : error ? (
						<p role="alert" className="py-8 text-center text-destructive">
							{error instanceof Error ? error.message : t('admin.activityLog.loadError')}
						</p>
					) : logs.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							{t('admin.activityLog.empty')}
						</div>
					) : (
						<>
							<div className="space-y-2">
								{logs.map((log) => {
									const isExpanded = expandedRows.has(log.id)

									return (
										<div key={log.id} className="border border-border rounded-md overflow-hidden">
											<div className="p-4 bg-muted/30">
												<div className="flex items-start justify-between gap-4">
													<div className="flex-1 min-w-0">
														<div className="flex items-center gap-2 mb-2">
															<Badge
																variant="ghost"
																className={cn(getActionBadgeClass(log.action))}
																title={log.action}
															>
																{getActivityActionLabel(log.action, t)}
															</Badge>
															<span
																className="text-sm text-muted-foreground"
																title={formatDateTime(log.createdAt)}
															>
																{formatRelativeTime(log.createdAt)}
															</span>
														</div>

														<div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
															{log.userName && (
																<div>
																	<span className="text-muted-foreground">
																		{t('admin.activityLog.userLabel')}
																	</span>
																	<Link
																		to={`/admin/users/${log.userId}`}
																		className="text-primary hover:underline"
																	>
																		{log.userName}
																	</Link>
																</div>
															)}
															{log.characterName && (
																<div>
																	<span className="text-muted-foreground">
																		{t('admin.activityLog.characterLabel')}
																	</span>
																	<Link
																		to={`/character/${log.characterId}`}
																		state={{
																			source: 'admin-activity-log',
																			backTo: '/admin/activity-log',
																			backLabel: t('characterDetail.back.activityLog'),
																		}}
																		className="text-primary hover:underline"
																	>
																		{log.characterName}
																	</Link>
																</div>
															)}
															{log.ipAddress && (
																<div>
																	<span className="text-muted-foreground">
																		{t('admin.activityLog.ipLabel')}
																	</span>
																	<span className="font-mono">{log.ipAddress}</span>
																</div>
															)}
															{log.userAgent && (
																<div className="md:col-span-2">
																	<span className="text-muted-foreground">
																		{t('admin.activityLog.agentLabel')}
																	</span>
																	<span className="text-xs break-all">{log.userAgent}</span>
																</div>
															)}
														</div>
													</div>

													{log.metadata && Object.keys(log.metadata).length > 0 && (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => toggleRowExpanded(log.id)}
															aria-expanded={isExpanded}
															aria-label={t(
																isExpanded ? 'common.table.collapseRow' : 'common.table.expandRow'
															)}
															className="flex-shrink-0"
														>
															<ChevronDown
																className={cn(
																	'h-4 w-4 transition-transform',
																	isExpanded && 'transform rotate-180'
																)}
															/>
														</Button>
													)}
												</div>
											</div>

											{/* Expanded Metadata */}
											{isExpanded && log.metadata && (
												<div className="p-4 border-t border-border bg-background">
													<div className="text-sm font-medium mb-2">
														{t('admin.activityLog.metadata')}
													</div>
													<JsonViewer
														data={log.metadata}
														defaultExpanded={false}
														maxHeight="300px"
													/>
												</div>
											)}
										</div>
									)
								})}
							</div>

							{/* Pagination */}
							{pagination && pagination.totalPages > 1 && (
								<div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
									<div className="text-sm text-muted-foreground">
										{t('admin.activityLog.page', {
											page: pagination.page,
											pages: pagination.totalPages,
										})}
									</div>
									<div className="flex gap-2">
										<Button
											variant="ghost"
											size="sm"
											disabled={pagination.page === 1}
											onClick={() => setPage(page - 1)}
										>
											{t('admin.activityLog.previous')}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											disabled={pagination.page === pagination.totalPages}
											onClick={() => setPage(page + 1)}
										>
											{t('pagination.next')}
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
