/**
 * Applications Table Component
 *
 * Data table for displaying applications built with MantineReactTable.
 * Status filtering is handled externally by the parent (tab bar).
 */

import { formatDistanceToNow } from 'date-fns'
import { MessageSquare } from 'lucide-react'
import { MantineReactTable, createMRTColumnHelper, useMantineReactTable } from 'mantine-react-table'
import { useMemo } from 'react'

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
					<span className="font-medium">{row.original.characterName}</span>
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
				Cell: ({ row }) => (
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
				),
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
		() => buildColumns(onApplicationClick, canManage),
		[onApplicationClick, canManage],
	)

	const table = useMantineReactTable({
		columns,
		data: rows,
		enableColumnActions: false,
		enableColumnFilters: false,
		enableDensityToggle: false,
		enableFullScreenToggle: false,
		enableGlobalFilter: true,
		enableGlobalFilterModes: false,
		enableHiding: false,
		enablePagination: true,
		enableStickyHeader: true,
		enableTopToolbar: true,
		enableToolbarInternalActions: false,
		globalFilterFn: (row, _columnId, filterValue) => {
			if (!filterValue) return true
			const q = (filterValue as string).toLowerCase()
			return row.original.characterName.toLowerCase().includes(q)
		},
		paginationDisplayMode: 'pages',
		mantinePaginationProps: {
			showRowsPerPage: true,
			rowsPerPageOptions: ['25', '50', '100', '200'],
		},
		mantinePaperProps: {
			shadow: 'none',
			radius: 'md',
			withBorder: true,
			style: {
				background: 'hsl(var(--card))',
				borderColor: 'hsl(var(--border))',
				color: 'hsl(var(--foreground))',
				overflow: 'hidden',
			},
		},
		mantineTableContainerProps: {
			style: {
				maxHeight: 'calc(100vh - 16rem)',
			},
		},
		mantineTableProps: {
			striped: false,
			highlightOnHover: false,
			withColumnBorders: false,
			withRowBorders: true,
			style: {
				background: 'transparent',
				color: 'hsl(var(--foreground))',
			},
		},
		mantineTableHeadProps: {
			style: {
				background: 'hsl(var(--background-elevated))',
			},
		},
		mantineTableHeadCellProps: {
			style: {
				background: 'hsl(var(--background-elevated))',
				borderBottom: '1px solid hsl(var(--border))',
				color: 'hsl(var(--muted-foreground))',
				fontSize: '0.75rem',
				fontWeight: 700,
				letterSpacing: '0.03em',
				textTransform: 'uppercase' as const,
			},
		},
		mantineTableBodyCellProps: {
			style: {
				borderBottom: '1px solid hsl(var(--border) / 0.7)',
				color: 'hsl(var(--foreground))',
			},
		},
		mantineTableBodyRowProps: ({ row }) => ({
			onClick: onApplicationClick ? () => onApplicationClick(row.original) : undefined,
			style: onApplicationClick ? { cursor: 'pointer' } : undefined,
		}),
		mantineSearchTextInputProps: {
			placeholder: 'Search by character name...',
			style: {
				minWidth: '240px',
			},
		},
		renderEmptyRowsFallback: () => (
			<div className="flex min-h-40 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
				No applications match the current filters
			</div>
		),
		state: {
			isLoading: loading,
			showProgressBars: loading,
			globalFilter: filters?.search || '',
		},
		onGlobalFilterChange: (value) => {
			onFilterChange?.({
				...filters,
				search: typeof value === 'string' ? value : '',
			})
		},
		initialState: {
			sorting: [{ id: 'createdAt', desc: true }],
		},
	})

	return <MantineReactTable table={table} />
}
