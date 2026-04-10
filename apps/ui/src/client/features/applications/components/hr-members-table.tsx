/**
 * HR Members Table Component
 *
 * Account-grouped member table built with MantineReactTable.
 * Rows navigate to the member profile page.
 */

import { Link2, ShieldAlert, XCircle } from 'lucide-react'
import { MantineReactTable, createMRTColumnHelper, useMantineReactTable } from 'mantine-react-table'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { MRT_ColumnDef } from 'mantine-react-table'
import type { CorporationMember } from '../../corporations/api'

// ============================================================================
// Types
// ============================================================================

/** A group of members belonging to the same auth account (or a single unlinked member) */
export interface AccountGroup {
	/** authUserId for linked accounts, or `unlinked-{characterId}` for unlinked */
	accountId: string
	/** The account's main character name (from mainCharacterName field) */
	mainName: string
	/** The first corp member on this account (used for avatar fallback) */
	representative: CorporationMember
	/** All characters in this account that are in this corporation */
	characters: CorporationMember[]
	/** Whether this is a linked auth account */
	isLinked: boolean
	/** Highest role across all characters */
	highestRole: 'CEO' | 'Director' | 'Member'
	/** Any character is blacklisted */
	hasBlacklisted: boolean
}

interface HrMembersTableProps {
	members: CorporationMember[]
	corporationId: string
}

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeDate(dateString?: string): string {
	if (!dateString) return 'Never'
	const date = new Date(dateString)
	const now = new Date()
	const diffMs = now.getTime() - date.getTime()
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

	if (diffDays === 0) return 'Today'
	if (diffDays === 1) return 'Yesterday'
	if (diffDays < 7) return `${diffDays}d ago`
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
	if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
	return `${Math.floor(diffDays / 365)}y ago`
}

const ROLE_RANK: Record<string, number> = { CEO: 0, Director: 1, Member: 2 }

function highestRole(members: CorporationMember[]): 'CEO' | 'Director' | 'Member' {
	let best: 'CEO' | 'Director' | 'Member' = 'Member'
	for (const m of members) {
		if (ROLE_RANK[m.role] < ROLE_RANK[best]) best = m.role
	}
	return best
}

/** Group flat member list into accounts */
export function groupByAccount(members: CorporationMember[]): AccountGroup[] {
	const linked = new Map<string, CorporationMember[]>()
	const unlinked: CorporationMember[] = []

	for (const m of members) {
		if (m.hasAuthAccount && m.authUserId) {
			const existing = linked.get(m.authUserId)
			if (existing) existing.push(m)
			else linked.set(m.authUserId, [m])
		} else {
			unlinked.push(m)
		}
	}

	const groups: AccountGroup[] = []

	for (const [userId, chars] of linked) {
		const mainName =
			chars.find((c) => c.mainCharacterName)?.mainCharacterName ??
			chars[0].characterName

		const mainInCorp = chars.find((c) => c.characterName === mainName)
		const representative = mainInCorp ?? chars[0]

		groups.push({
			accountId: userId,
			mainName,
			representative,
			characters: chars.sort((a, b) => {
				if (a.characterName === mainName) return -1
				if (b.characterName === mainName) return 1
				return a.characterName.localeCompare(b.characterName)
			}),
			isLinked: true,
			highestRole: highestRole(chars),
			hasBlacklisted: chars.some((c) => c.isBlacklisted),
		})
	}

	for (const m of unlinked) {
		groups.push({
			accountId: `unlinked-${m.characterId}`,
			mainName: m.characterName,
			representative: m,
			characters: [m],
			isLinked: false,
			highestRole: m.role,
			hasBlacklisted: m.isBlacklisted,
		})
	}

	return groups
}

// ============================================================================
// Column Definitions
// ============================================================================

const col = createMRTColumnHelper<AccountGroup>()

const columns: MRT_ColumnDef<AccountGroup>[] = [
	col.accessor('mainName', {
		header: 'Account',
		size: 280,
		filterFn: (row, _columnId, filterValue) => {
			if (!filterValue) return true
			const q = (filterValue as string).toLowerCase()
			const group = row.original
			return (
				group.mainName.toLowerCase().includes(q) ||
				group.characters.some((c) => c.characterName.toLowerCase().includes(q))
			)
		},
		Cell: ({ row }) => {
			const group = row.original
			return (
				<div className="flex items-center gap-3">
					<MemberAvatar
						characterId={group.representative.characterId}
						characterName={group.mainName}
						size="sm"
					/>
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="font-medium truncate">{group.mainName}</span>
							{group.hasBlacklisted && (
								<ShieldAlert className="h-3.5 w-3.5 text-destructive shrink-0" />
							)}
						</div>
						{group.characters.length > 1 && (
							<p className="text-xs text-muted-foreground truncate max-w-[250px]">
								{group.characters
									.filter((c) => c.characterName !== group.mainName)
									.map((c) => c.characterName)
									.join(', ')}
							</p>
						)}
					</div>
				</div>
			)
		},
	}),
	col.accessor('highestRole', {
		header: 'Role',
		size: 100,
		sortingFn: (rowA, rowB) =>
			(ROLE_RANK[rowA.original.highestRole] ?? 2) - (ROLE_RANK[rowB.original.highestRole] ?? 2),
		Cell: ({ row }) => {
			const role = row.original.highestRole
			return (
				<span
					className={cn(
						'text-xs',
						role === 'CEO' && 'font-bold text-yellow-500',
						role === 'Director' && 'font-semibold text-blue-400',
						role === 'Member' && 'text-muted-foreground',
					)}
				>
					{role}
				</span>
			)
		},
	}),
	col.accessor('isLinked', {
		header: 'Auth',
		size: 90,
		Cell: ({ row }) =>
			row.original.isLinked ? (
				<Badge variant="success" className="gap-1 text-[10px]">
					<Link2 className="h-3 w-3" />
					Registered
				</Badge>
			) : (
				<Badge variant="destructive" className="gap-1 text-[10px]">
					<XCircle className="h-3 w-3" />
					No
				</Badge>
			),
	}),
	col.display({
		id: 'activity',
		header: 'Activity',
		size: 90,
		sortingFn: (rowA, rowB) => {
			const aActive = rowA.original.characters.some((c) => c.activityStatus === 'active') ? 0 : 1
			const bActive = rowB.original.characters.some((c) => c.activityStatus === 'active') ? 0 : 1
			return aActive - bActive
		},
		Cell: ({ row }) => {
			const isActive = row.original.characters.some((c) => c.activityStatus === 'active')
			return (
				<Badge variant={isActive ? 'success' : 'destructive'} className="text-[10px]">
					{isActive ? 'active' : 'inactive'}
				</Badge>
			)
		},
	}),
	col.display({
		id: 'chars',
		header: 'Chars',
		size: 70,
		sortingFn: (rowA, rowB) => rowA.original.characters.length - rowB.original.characters.length,
		Cell: ({ row }) => (
			<span className="text-muted-foreground">{row.original.characters.length}</span>
		),
	}),
	col.display({
		id: 'joinDate',
		header: 'Joined',
		size: 90,
		sortingFn: (rowA, rowB) =>
			rowA.original.representative.joinDate.localeCompare(rowB.original.representative.joinDate),
		Cell: ({ row }) => (
			<span className="text-muted-foreground whitespace-nowrap">
				{formatRelativeDate(row.original.representative.joinDate)}
			</span>
		),
	}),
]

// ============================================================================
// Component
// ============================================================================

export function HrMembersTable({ members, corporationId }: HrMembersTableProps) {
	const navigate = useNavigate()
	const rows = useMemo(() => groupByAccount(members), [members])

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
		globalFilterFn: ((row: any, _columnId: string, filterValue: string) => {
			if (!filterValue) return true
			const q = (filterValue as string).toLowerCase()
			const group = row.original
			return (
				group.mainName.toLowerCase().includes(q) ||
				group.characters.some((c: any) => c.characterName.toLowerCase().includes(q))
			)
		}) as any,
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
			onClick: () =>
				navigate(
					`/corporations/${corporationId}/members/${row.original.accountId}?name=${encodeURIComponent(row.original.mainName)}`,
				),
			style: { cursor: 'pointer' },
		}),
		mantineSearchTextInputProps: {
			placeholder: 'Search characters...',
			style: {
				minWidth: '240px',
			},
		},
		renderEmptyRowsFallback: () => (
			<div className="flex min-h-40 items-center justify-center px-6 py-8 text-center text-sm text-muted-foreground">
				No members match the current filters
			</div>
		),
		initialState: {
			sorting: [{ id: 'mainName', desc: false }],
		},
	})

	return <MantineReactTable table={table} />
}
