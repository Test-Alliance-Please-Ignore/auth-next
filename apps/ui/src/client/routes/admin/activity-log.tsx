import { ChevronDown, ExternalLink, Filter } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { JsonViewer } from '@/components/json-viewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useActivityLogs } from '@/hooks/useAdminUsers'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

export default function ActivityLogPage() {
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

	const { data, isLoading } = useActivityLogs(filters)

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
				<h1 className="text-3xl font-bold gradient-text">Activity Log</h1>
				<p className="text-muted-foreground mt-1">View and filter system activity logs</p>
			</div>

			{/* Filters */}
			<Card variant="interactive">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Filters</CardTitle>
							<CardDescription>
								Filter activity logs by user, character, action, or date range
							</CardDescription>
						</div>
						{hasActiveFilters && (
							<Button variant="outline" size="sm" onClick={handleClearFilters}>
								Clear Filters
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{/* User ID */}
						<div>
							<label className="text-sm font-medium mb-1 block">User ID</label>
							<Input
								placeholder="Filter by user ID..."
								value={userId}
								onChange={(e) => setUserId(e.target.value)}
							/>
						</div>

						{/* Character ID */}
						<div>
							<label className="text-sm font-medium mb-1 block">Character ID</label>
							<Input
								placeholder="Filter by character ID..."
								value={characterId}
								onChange={(e) => setCharacterId(e.target.value)}
							/>
						</div>

						{/* Action */}
						<div>
							<label className="text-sm font-medium mb-1 block">Action</label>
							<Input
								placeholder="Filter by action..."
								value={action}
								onChange={(e) => setAction(e.target.value)}
							/>
						</div>

						{/* Start Date */}
						<div>
							<label className="text-sm font-medium mb-1 block">Start Date</label>
							<Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
						</div>

						{/* End Date */}
						<div>
							<label className="text-sm font-medium mb-1 block">End Date</label>
							<Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
						</div>
					</div>

					<div className="flex justify-end">
						<Button onClick={handleApplyFilters}>
							<Filter className="h-4 w-4 mr-2" />
							Apply Filters
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Activity Logs Table */}
			<Card variant="interactive">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Activity Logs</CardTitle>
							<CardDescription>
								{pagination
									? `Showing ${(pagination.page - 1) * pagination.pageSize + 1}-${Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of ${pagination.totalCount} logs`
									: 'Loading activity logs...'}
							</CardDescription>
						</div>

						{/* Page Size Selector */}
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Show:</span>
							<select
								value={pageSize}
								onChange={(e) => handlePageSizeChange(Number(e.target.value))}
								className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm"
							>
								<option value={25}>25</option>
								<option value={50}>50</option>
								<option value={100}>100</option>
							</select>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="text-center py-8 text-muted-foreground">Loading activity logs...</div>
					) : logs.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">No activity logs found</div>
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
																variant="outline"
																className={cn(getActionBadgeClass(log.action))}
															>
																{log.action}
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
																	<span className="text-muted-foreground">User: </span>
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
																	<span className="text-muted-foreground">Character: </span>
																	<Link
																		to={`/character/${log.characterId}`}
																		className="text-primary hover:underline"
																	>
																		{log.characterName}
																	</Link>
																</div>
															)}
															{log.ipAddress && (
																<div>
																	<span className="text-muted-foreground">IP: </span>
																	<span className="font-mono">{log.ipAddress}</span>
																</div>
															)}
															{log.userAgent && (
																<div className="md:col-span-2">
																	<span className="text-muted-foreground">User Agent: </span>
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
													<div className="text-sm font-medium mb-2">Metadata:</div>
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
										Page {pagination.page} of {pagination.totalPages}
									</div>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={pagination.page === 1}
											onClick={() => setPage(page - 1)}
										>
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={pagination.page === pagination.totalPages}
											onClick={() => setPage(page + 1)}
										>
											Next
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
