/**
 * Data table for displaying HR applications.
 * Status filtering is handled externally by the parent (tab bar).
 */

import { MessageSquare } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { DataTable } from '@/components/data-table'
import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRelativeTime as formatDistanceToNow } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import { ApplicationStatusBadge } from './application-status-badge'

import type {
	DataTableColumn,
	DataTablePagination,
	DataTableSortingState,
} from '@/components/data-table'
import type { ApplicationListItem } from '../api'

export interface ApplicationsTableProps {
	applications: ApplicationListItem[]
	loading?: boolean
	/** Build the href for an application row. Enables right-click "Open in new tab". */
	getApplicationHref: (app: ApplicationListItem) => string
	canManage?: boolean
	totalCount?: number
	page?: number
	pageSize?: number
	onPageChange?: (page: number) => void
	onPageSizeChange?: (pageSize: number) => void
}

function buildColumns(
	getApplicationHref: (app: ApplicationListItem) => string,
	canManage: boolean
): Array<DataTableColumn<ApplicationListItem>> {
	const columns: Array<DataTableColumn<ApplicationListItem>> = [
		{
			id: 'characterName',
			header: 'Character',
			sortable: true,
			cell: (application) => {
				return (
					<div className="flex items-center gap-3">
						<MemberAvatar
							characterId={application.characterId}
							characterName={application.characterName}
							size="sm"
							isBlacklisted={application.blacklistState?.effective === true}
						/>
						<div className="flex min-w-0 flex-col">
							<span className="inline-flex min-w-0 items-center gap-2">
								<span
									className={cn(
										'truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
										application.blacklistState?.effective ? 'text-red-500' : 'text-foreground'
									)}
								>
									{application.characterName}
								</span>
								{application.blacklistState?.effective && (
									<Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
										Blocklisted
									</Badge>
								)}
								{application.isFirstApplication !== undefined && (
									<span
										className={cn(
											'inline-flex h-5 w-fit items-center rounded-full border px-1.5 text-[10px] font-semibold leading-none',
											application.isFirstApplication
												? 'border-success/30 bg-success/20 text-success'
												: 'border-primary/30 bg-primary/20 text-primary'
										)}
									>
										{application.isFirstApplication ? 'First' : 'Repeat'}
									</span>
								)}
							</span>
							{(application.altCharacters?.length ?? 0) > 0 && (
								<span className="text-xs text-muted-foreground">
									+{application.altCharacters?.length ?? 0}{' '}
									{(application.altCharacters?.length ?? 0) === 1 ? 'Alt' : 'Alts'}
								</span>
							)}
						</div>
					</div>
				)
			},
		},
		{
			id: 'corporationName',
			header: 'Corporation',
			sortable: true,
			cell: (application) => (
				<span className="text-muted-foreground">{application.corporationName || 'Unknown'}</span>
			),
		},
		{
			id: 'status',
			header: 'Status',
			sortable: true,
			cell: (application) => <ApplicationStatusBadge status={application.status} size="sm" />,
		},
		{
			id: 'createdAt',
			header: 'Submitted',
			sortable: true,
			cell: (application) => (
				<span className="text-sm text-muted-foreground">
					{formatDistanceToNow(new Date(application.createdAt), { addSuffix: true })}
				</span>
			),
		},
		{
			id: 'lastStaffInteractionAt',
			header: 'Last HR Activity',
			sortable: true,
			cell: (application) => {
				const value = application.lastStaffInteractionAt
				return value ? (
					<span className="text-sm text-muted-foreground">
						{formatDistanceToNow(new Date(value), { addSuffix: true })}
					</span>
				) : (
					<span className="text-sm text-muted-foreground">-</span>
				)
			},
		},
		{
			id: 'recommendationCount',
			header: 'Recs',
			sortable: true,
			cell: (application) => {
				const count = application.recommendationCount
				return count !== undefined && count > 0 ? (
					<div className="inline-flex items-center gap-1.5 text-muted-foreground">
						<MessageSquare className="h-4 w-4" />
						<span className="font-medium">{count}</span>
					</div>
				) : (
					<span className="text-muted-foreground">-</span>
				)
			},
		},
	]

	if (canManage) {
		columns.push({
			id: 'actions',
			header: 'Actions',
			headerClassName: 'text-center',
			className: 'text-right',
			sticky: 'right',
			cell: (application) => {
				const href = getApplicationHref(application)
				return (
					<Button asChild variant="ghost" size="sm">
						<Link to={href} onClick={(event) => event.stopPropagation()}>
							View
						</Link>
					</Button>
				)
			},
		})
	}

	return columns
}

function compareApplicationValues(
	left: ApplicationListItem,
	right: ApplicationListItem,
	columnId: string
): number {
	const value = (application: ApplicationListItem): string | number => {
		switch (columnId) {
			case 'createdAt':
				return new Date(application.createdAt).getTime()
			case 'lastStaffInteractionAt':
				return application.lastStaffInteractionAt
					? new Date(application.lastStaffInteractionAt).getTime()
					: 0
			case 'recommendationCount':
				return application.recommendationCount ?? 0
			case 'characterName':
				return application.characterName
			case 'corporationName':
				return application.corporationName ?? ''
			case 'status':
				return application.status
			default:
				return ''
		}
	}

	const leftValue = value(left)
	const rightValue = value(right)
	if (typeof leftValue === 'number' && typeof rightValue === 'number') {
		return leftValue - rightValue
	}
	return String(leftValue).localeCompare(String(rightValue), undefined, {
		numeric: true,
		sensitivity: 'base',
	})
}

export function ApplicationsTable({
	applications,
	loading = false,
	getApplicationHref,
	canManage = false,
	totalCount,
	page = 1,
	pageSize = 10,
	onPageChange,
	onPageSizeChange,
}: ApplicationsTableProps) {
	const [pagination, setPagination] = useState<DataTablePagination>({
		pageIndex: Math.max(page - 1, 0),
		pageSize,
	})
	const [sorting, setSorting] = useState<DataTableSortingState>([{ id: 'createdAt', desc: true }])

	useEffect(() => {
		setPagination({ pageIndex: Math.max(page - 1, 0), pageSize })
	}, [page, pageSize])

	const columns = useMemo(
		() => buildColumns(getApplicationHref, canManage),
		[getApplicationHref, canManage]
	)
	const sortedApplications = useMemo(() => {
		const activeSort = sorting[0]
		if (!activeSort) return applications
		return [...applications].sort((left, right) => {
			const result = compareApplicationValues(left, right, activeSort.id)
			return activeSort.desc ? -result : result
		})
	}, [applications, sorting])
	const isServerPaginated = typeof totalCount === 'number'
	const visibleApplications = isServerPaginated
		? sortedApplications
		: sortedApplications.slice(
				pagination.pageIndex * pagination.pageSize,
				(pagination.pageIndex + 1) * pagination.pageSize
			)
	const rowCount = totalCount ?? sortedApplications.length

	const handlePaginationChange = (next: DataTablePagination) => {
		setPagination(next)
		if (next.pageIndex !== pagination.pageIndex) onPageChange?.(next.pageIndex + 1)
		if (next.pageSize !== pagination.pageSize) onPageSizeChange?.(next.pageSize)
	}

	return (
		<DataTable
			columns={columns}
			rows={visibleApplications}
			loading={loading}
			emptyMessage="No applications match the current filters"
			sorting={sorting}
			onSortingChange={(next) => {
				setSorting(next)
				setPagination((current) => ({ ...current, pageIndex: 0 }))
			}}
			pagination={pagination}
			onPaginationChange={handlePaginationChange}
			rowCount={rowCount}
			itemLabel="applications"
			pageSizeOptions={[10, 25, 50, 100, 200]}
			paginationPosition="both"
			getRowKey={(application) => application.id}
			rowInteraction={{ type: 'link', getHref: getApplicationHref }}
		/>
	)
}
