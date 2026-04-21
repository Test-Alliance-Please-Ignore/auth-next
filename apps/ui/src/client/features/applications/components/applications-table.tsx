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
import { useMemo } from 'react'

import { Link } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
import { Button } from '@/components/ui/button'

import { ApplicationStatusBadge } from './application-status-badge'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { Application, ApplicationStatus } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface ApplicationsTableProps {
	applications: Application[]
	loading?: boolean
	/** Build the href for an application row. Enables right-click "Open in new tab". */
	getApplicationHref?: (app: Application) => string
	onApplicationClick?: (app: Application) => void
	filters?: {
		status?: ApplicationStatus[]
		search?: string
	}
	onFilterChange?: (filters: ApplicationsTableProps['filters']) => void
	canManage?: boolean
}

// ============================================================================
// Column Definitions
// ============================================================================

const col = createMRTColumnHelper<Application>()

function buildColumns(
	onApplicationClick?: (app: Application) => void,
	getApplicationHref?: (app: Application) => string,
	canManage?: boolean,
): MRT_ColumnDef<Application>[] {
	const base: MRT_ColumnDef<Application>[] = [
		col.accessor('characterName', {
			header: 'Character',
			size: 220,
			Cell: ({ row }) => (
				<div className="flex items-center gap-3">
					<MemberAvatar
						characterId={row.original.characterId}
						characterName={row.original.characterName}
						size="sm"
					/>
					<div className="flex flex-col min-w-0">
						<span className="font-medium truncate">{row.original.characterName}</span>
						{(row.original.altCharacterIds?.length ?? 0) > 0 && (
							<span className="text-xs text-muted-foreground">
								+{row.original.altCharacterIds!.length} {row.original.altCharacterIds!.length === 1 ? 'Alt' : 'Alts'}
							</span>
						)}
					</div>
				</div>
			),
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
					const href = getApplicationHref?.(row.original)
					if (href) {
						return (
							<Button asChild variant="ghost" size="sm">
								<Link to={href} onClick={(e) => e.stopPropagation()}>View</Link>
							</Button>
						)
					}
					return (
						<Button
							variant="ghost"
							size="sm"
							onClick={(e) => {
								e.stopPropagation()
								onApplicationClick?.(row.original)
							}}
						>
							View
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
	filters,
	onFilterChange,
	canManage = false,
}: ApplicationsTableProps) {
	// Pre-filter by status (controlled externally via tabs)
	const rows = useMemo(() => {
		if (!filters?.status || filters.status.length === 0) return applications
		return applications.filter((app) => filters.status?.includes(app.status))
	}, [applications, filters?.status])

	const columns = useMemo(
		() => buildColumns(onApplicationClick, getApplicationHref, canManage),
		[onApplicationClick, getApplicationHref, canManage],
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
		globalFilterFn: ((row: any, _columnId: string, filterValue: string) => {
			if (!filterValue) return true
			const q = (filterValue as string).toLowerCase()
			return row.original.characterName.toLowerCase().includes(q)
		}) as any,
		paginationDisplayMode: 'pages',
		mantinePaginationProps: {
			showRowsPerPage: true,
			rowsPerPageOptions: ['25', '50', '100', '200'],
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
		},
		initialState: {
			sorting: [{ id: 'createdAt', desc: true }],
		},
	})

	return <MantineReactTable table={table} />
}
