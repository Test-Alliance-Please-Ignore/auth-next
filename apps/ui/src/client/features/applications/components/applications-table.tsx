/**
 * Applications Table Component
 *
 * Data table for displaying applications built with MantineReactTable.
 * Status filtering is handled externally by the parent (tab bar).
 */

import { formatDistanceToNow } from 'date-fns'
import { MessageSquare } from 'lucide-react'
import { MantineReactTable, createMRTColumnHelper, useMantineReactTable } from 'mantine-react-table'

import {
	mrtPaperProps,
	mrtPaginationProps,
	mrtRowStyle,
	mrtTableBodyCellProps,
	mrtTableHeadCellProps,
	mrtTableHeadProps,
	mrtTableProps,
} from '@/lib/mrt-theme'
import { useEffect, useMemo, useState } from 'react'

import { Link } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { ApplicationStatusBadge } from './application-status-badge'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { Application } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface ApplicationsTableProps {
	applications: Application[]
	loading?: boolean
	/** Build the href for an application row. Enables right-click "Open in new tab". */
	getApplicationHref: (app: Application) => string
	onApplicationClick?: (app: Application) => void
	canManage?: boolean
	totalCount?: number
	page?: number
	pageSize?: number
	onPageChange?: (page: number) => void
	onPageSizeChange?: (pageSize: number) => void
}

// ============================================================================
// Column Definitions
// ============================================================================

const col = createMRTColumnHelper<Application>()

function buildColumns(
	getApplicationHref: (app: Application) => string,
	onApplicationClick?: (app: Application) => void,
	canManage?: boolean,
): MRT_ColumnDef<Application>[] {
	const base: MRT_ColumnDef<Application>[] = [
		col.accessor('characterName', {
			header: 'Character',
			size: 220,
			Cell: ({ row }) => {
				const href = getApplicationHref(row.original)

				return (
					<div className="flex items-center gap-3">
						<MemberAvatar
							characterId={row.original.characterId}
							characterName={row.original.characterName}
							size="sm"
						/>
						<div className="flex flex-col min-w-0">
							<span className="inline-flex min-w-0 items-center gap-2">
								<Link
									to={href}
									onClick={(event) => event.stopPropagation()}
									className="truncate text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
								>
									{row.original.characterName}
								</Link>
								{row.original.isFirstApplication !== undefined && (
									<span
										className={cn(
											'inline-flex h-5 w-fit items-center rounded-full border px-1.5 text-[10px] font-semibold leading-none',
											row.original.isFirstApplication
												? 'border-success/30 bg-success/20 text-success'
												: 'border-primary/30 bg-primary/20 text-primary'
										)}
									>
										{row.original.isFirstApplication ? 'First' : 'Repeat'}
									</span>
								)}
							</span>
							{(row.original.altCharacterIds?.length ?? 0) > 0 && (
								<span className="text-xs text-muted-foreground">
									+{row.original.altCharacterIds!.length} {row.original.altCharacterIds!.length === 1 ? 'Alt' : 'Alts'}
								</span>
							)}
						</div>
					</div>
				)
			},
		}),
		col.accessor('corporationName', {
			header: 'Corporation',
			size: 160,
			Cell: ({ row }) => (
				<span className="text-muted-foreground">
					{row.original.corporationName || 'Unknown'}
				</span>
			),
		}),
		col.accessor('status', {
			header: 'Status',
			size: 120,
			Cell: ({ row }) => <ApplicationStatusBadge status={row.original.status} size="sm" />,
		}),
		col.accessor('createdAt', {
			header: 'Submitted',
			size: 140,
			sortingFn: (rowA, rowB) =>
				new Date(rowA.original.createdAt).getTime() - new Date(rowB.original.createdAt).getTime(),
			Cell: ({ row }) => (
				<span className="text-sm text-muted-foreground">
					{formatDistanceToNow(new Date(row.original.createdAt), { addSuffix: true })}
				</span>
			),
		}),
		col.accessor('lastStaffInteractionAt', {
			header: 'Last HR Activity',
			size: 160,
			Cell: ({ row }) => {
				const value = row.original.lastStaffInteractionAt
				if (!value) {
					return <span className="text-sm text-muted-foreground">-</span>
				}
				return (
					<span className="text-sm text-muted-foreground">
						{formatDistanceToNow(new Date(value), { addSuffix: true })}
					</span>
				)
			},
		}),
		col.accessor('recommendationCount', {
			header: 'Recs',
			size: 80,
			Cell: ({ row }) => {
				const count = row.original.recommendationCount
				return count !== undefined && count > 0 ? (
					<div className="inline-flex items-center gap-1.5 text-muted-foreground">
						<MessageSquare className="h-4 w-4" />
						<span className="font-medium">{count}</span>
					</div>
				) : (
					<span className="text-muted-foreground">-</span>
				)
			},
		}),
	]

	if (canManage) {
		base.push(
			col.display({
				id: 'actions',
				header: 'Actions',
				size: 80,
				Cell: ({ row }) => {
					const href = getApplicationHref(row.original)
					return (
						<Button asChild variant="ghost" size="sm">
							<Link to={href} onClick={(e) => e.stopPropagation()}>View</Link>
						</Button>
					)
				},
			}),
		)
	}

	return base
}

// ============================================================================
// Component
// ============================================================================

export function ApplicationsTable({
	applications,
	loading = false,
	getApplicationHref,
	onApplicationClick,
	canManage = false,
	totalCount,
	page = 1,
	pageSize = 10,
	onPageChange,
	onPageSizeChange,
}: ApplicationsTableProps) {
	const [pagination, setPagination] = useState({
		pageIndex: Math.max(page - 1, 0),
		pageSize,
	})

	useEffect(() => {
		setPagination((prev) => ({
			pageIndex: Math.max(page - 1, 0),
			pageSize: pageSize ?? prev.pageSize,
		}))
	}, [page, pageSize])

	const rows = applications

	const columns = useMemo(
		() => buildColumns(getApplicationHref, onApplicationClick, canManage),
		[getApplicationHref, onApplicationClick, canManage],
	)

	const table = useMantineReactTable({
		columns,
		data: rows,
		enableColumnActions: false,
		enableColumnFilters: false,
		enableDensityToggle: false,
		enableFullScreenToggle: false,
		enableGlobalFilter: false,
		enableGlobalFilterModes: false,
		enableHiding: false,
		enablePagination: true,
		enableStickyHeader: true,
		enableTopToolbar: false,
		enableToolbarInternalActions: false,
		paginationDisplayMode: 'pages',
		mantinePaginationProps: {
			showRowsPerPage: true,
			rowsPerPageOptions: ['10', '25', '50', '100', '200'],
		},
		manualPagination: typeof totalCount === 'number',
		rowCount: totalCount,
		onPaginationChange: (updater) => {
			setPagination((prev) => {
				const next = typeof updater === 'function' ? updater(prev) : updater
				if (next.pageIndex !== prev.pageIndex) {
					onPageChange?.(next.pageIndex + 1)
				}
				if (next.pageSize !== prev.pageSize) {
					onPageSizeChange?.(next.pageSize)
				}
				return next
			})
		},
		mantinePaperProps: mrtPaperProps,
		mantineTableContainerProps: { style: { maxHeight: 'calc(100vh - 16rem)' } },
		mantineTableProps: mrtTableProps,
		mantineTableHeadProps: mrtTableHeadProps,
		mantineTableHeadCellProps: mrtTableHeadCellProps,
		mantineTableBodyCellProps: mrtTableBodyCellProps,
		mantineTableBodyRowProps: ({ row }) => {
			const href = getApplicationHref?.(row.original)
			const isClickable = href || onApplicationClick
			return {
				className: 'mrt-grid__row',
				onClick: isClickable
					? (e: React.MouseEvent) => {
							if (href && (e.ctrlKey || e.metaKey || e.button === 1)) {
								window.open(href, '_blank')
								return
							}
							onApplicationClick?.(row.original)
						}
					: undefined,
				onAuxClick: href
					? (e: React.MouseEvent) => {
							if (e.button === 1) {
								e.preventDefault()
								window.open(href, '_blank')
							}
						}
					: undefined,
				style: { ...mrtRowStyle(row.index), ...(isClickable ? { cursor: 'pointer' } : {}) },
			}
		},
		renderEmptyRowsFallback: () => (
			<div className="flex min-h-40 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
				No applications match the current filters
			</div>
		),
		state: {
			isLoading: loading,
			showProgressBars: loading,
			pagination,
		},
		initialState: {
			sorting: [{ id: 'createdAt', desc: true }],
			pagination: { pageIndex: 0, pageSize: 10 },
		},
	})

	return <MantineReactTable table={table} />
}
