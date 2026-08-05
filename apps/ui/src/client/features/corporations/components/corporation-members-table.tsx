/**
 * Corporation Members Table Component
 *
 * Displays a comprehensive table of corporation members with filtering,
 * sorting, and actions for CEO/Director users.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronDown,
	Heart,
	Shield,
	ShieldBan,
	Star,
	User,
} from 'lucide-react'
import { useCallback, useState } from 'react'

import { EsiStatusBadge, getEsiStatusBadgeState } from '@/components/esi-status-badge'
import { TableRefreshFrame } from '@/components/table-refresh-frame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useMessage } from '@/hooks/useMessage'
import { characterPortraitUrl } from '@/lib/eve-images'
import { cn } from '@/lib/utils'

import {
	GrantHrRoleDialog,
	HrRoleBadge,
	RevokeHrRoleDialog,
	useGrantHrRole,
	useRevokeHrRole,
} from '../../hr'
import { myCorporationsApi } from '../api'
import { EmeritusConfirmationDialog } from './emeritus-confirmation-dialog'

import type { SetStateAction } from 'react'
import type { HrRoleType } from '../../hr'
import type {
	CorporationMember,
	CorporationMembersQuery,
	CorporationMembersResponse,
	CorporationMembersSortField,
} from '../api'

interface CorporationMembersTableProps {
	members: CorporationMember[]
	loading?: boolean
	isRefreshing?: boolean
	onMemberClick?: (member: CorporationMember) => void
	showActions?: boolean
	canManageHrRoles?: boolean
	grantableHrRoles?: HrRoleType[]
	canRevokeHrAdmin?: boolean
	canManageEmeritus?: boolean
	corporationId?: string
	query: CorporationMembersQuery
	onQueryChange: (value: SetStateAction<CorporationMembersQuery>) => void
	pagination?: {
		page: number
		limit: number
		totalItems: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
	summary?: CorporationMembersResponse['summary']
}

type SortField = CorporationMembersSortField

export function getAuthStatusBadge(
	member: Pick<CorporationMember, 'hasAuthAccount' | 'hasValidToken'>
): {
	variant: 'success' | 'destructive' | 'warning'
	label: 'ESI Valid' | 'ESI Invalid' | 'ESI Unknown' | 'Unlinked'
} {
	return getEsiStatusBadgeState({
		hasAuthAccount: member.hasAuthAccount,
		hasValidToken: member.hasValidToken ?? null,
	})
}

// ─── Actions popover (same pattern as bills page) ────────────────────────────

type ActionIntent = 'confirm' | 'secondary' | 'muted' | 'destructive' | 'primary'

interface ActionItem {
	label: string
	intent: ActionIntent
	hidden?: boolean
	loading?: boolean
	onClick?: () => void
}

const intentBg: Record<ActionIntent, string> = {
	confirm: 'bg-[hsl(var(--confirm))]/45 hover:bg-[hsl(var(--confirm))]/65',
	destructive: 'bg-[hsl(var(--destructive-alt))]/45 hover:bg-[hsl(var(--destructive-alt))]/65',
	muted: 'bg-white/15 hover:bg-[hsl(var(--cancel-hover))]/65',
	secondary: 'bg-[hsl(var(--secondary))]/45 hover:bg-[hsl(var(--secondary))]/65',
	primary: 'bg-[hsl(var(--primary))]/45 hover:bg-[hsl(var(--primary))]/65',
}

function ActionsMenu({ items }: { items: ActionItem[] }) {
	const [open, setOpen] = useState(false)
	const visible = items.filter((item) => !item.hidden)

	if (visible.length === 0) return null

	const baseClass =
		'w-full cursor-pointer px-3 py-2 text-left text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 first:rounded-t last:rounded-b'

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm">
					Actions <ChevronDown className="ml-1 h-3 w-3" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-48 p-1">
				{visible.map((item) => (
					<button
						key={item.label}
						type="button"
						disabled={item.loading}
						className={cn(baseClass, intentBg[item.intent])}
						onClick={() => {
							setOpen(false)
							item.onClick?.()
						}}
					>
						{item.loading ? 'Loading…' : item.label}
					</button>
				))}
			</PopoverContent>
		</Popover>
	)
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CorporationMembersTable({
	members,
	loading,
	isRefreshing = false,
	onMemberClick,
	showActions = true,
	canManageHrRoles = false,
	grantableHrRoles = ['hr_admin', 'hr_reviewer', 'hr_viewer'],
	canRevokeHrAdmin = true,
	canManageEmeritus = false,
	corporationId,
	query,
	onQueryChange,
	pagination,
	summary,
}: CorporationMembersTableProps) {
	const { showSuccess, showError } = useMessage()

	const searchQuery = query.search ?? ''
	const authFilter = query.authFilter ?? 'all'
	const activityFilter = query.activityFilter ?? 'all'
	const roleFilter = query.roleFilter ?? 'all'
	const sortField: SortField = query.sortField ?? 'role'
	const sortOrder = query.sortOrder ?? 'asc'
	const currentPage = pagination?.page ?? 1
	const paginatedMembers = members

	// HR dialog states
	const [grantDialogMember, setGrantDialogMember] = useState<CorporationMember | null>(null)
	const [revokeDialogMember, setRevokeDialogMember] = useState<CorporationMember | null>(null)

	// Emeritus dialog states
	const [emeritusDialogMember, setEmeritusDialogMember] = useState<CorporationMember | null>(null)
	const [emeritusAction, setEmeritusAction] = useState<'mark' | 'remove'>('mark')

	// HR mutations
	const grantMutation = useGrantHrRole()
	const revokeMutation = useRevokeHrRole()

	// Emeritus mutation
	const queryClient = useQueryClient()
	const emeritusMutation = useMutation({
		mutationFn: async ({
			characterId,
			status,
		}: {
			characterId: string
			status: 'active' | 'emeritus'
		}) => {
			if (!corporationId) throw new Error('Corporation ID is required')
			return myCorporationsApi.updateMemberStatus(corporationId, characterId, status)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['my-corporations', 'members', corporationId] })
			queryClient.invalidateQueries({ queryKey: ['my-corporations'] })
		},
	})

	const handleSort = useCallback(
		(field: SortField) => {
			onQueryChange((prev) => ({
				...prev,
				page: 1,
				sortField: field,
				sortOrder: prev.sortField === field && prev.sortOrder === 'asc' ? 'desc' : 'asc',
			}))
		},
		[onQueryChange]
	)

	const handleGrantHrRole = useCallback(
		async (request: Parameters<typeof grantMutation.mutateAsync>[0]) => {
			try {
				await grantMutation.mutateAsync(request)
				showSuccess('HR role granted successfully')
				setGrantDialogMember(null)
			} catch (error) {
				showError('Failed to grant HR role')
				throw error
			}
		},
		[grantMutation, showSuccess, showError]
	)

	const handleRevokeHrRole = useCallback(
		async (request: Parameters<typeof revokeMutation.mutateAsync>[0]) => {
			try {
				await revokeMutation.mutateAsync(request)
				showSuccess('HR role revoked successfully')
				setRevokeDialogMember(null)
			} catch (error) {
				showError('Failed to revoke HR role')
				throw error
			}
		},
		[revokeMutation, showSuccess, showError]
	)

	const handleEmeritusStatusUpdate = useCallback(
		async (characterId: string, status: 'active' | 'emeritus') => {
			try {
				await emeritusMutation.mutateAsync({ characterId, status })
				const action = status === 'emeritus' ? 'marked as emeritus' : 'emeritus status removed'
				showSuccess(`Member ${action} successfully`)
				setEmeritusDialogMember(null)
			} catch (error) {
				showError('Failed to update member status')
				throw error
			}
		},
		[emeritusMutation, showSuccess, showError]
	)

	const formatDate = (dateString?: string) => {
		if (!dateString) return 'Never'
		const date = new Date(dateString)
		const now = new Date()
		const diffMs = now.getTime() - date.getTime()
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

		if (diffDays === 0) return 'Today'
		if (diffDays === 1) return 'Yesterday'
		if (diffDays < 7) return `${diffDays} days ago`
		if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
		if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`

		return date.toLocaleDateString()
	}

	const SortIcon = ({ field }: { field: SortField }) => {
		if (sortField !== field) {
			return <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
		}

		return sortOrder === 'asc' ? (
			<ArrowUp className="h-3.5 w-3.5" />
		) : (
			<ArrowDown className="h-3.5 w-3.5" />
		)
	}

	const SortableHead = ({ field, label }: { field: SortField; label: string }) => (
		<TableHead>
			<button
				type="button"
				onClick={() => handleSort(field)}
				className="inline-flex items-center gap-1 text-left text-muted-foreground hover:text-foreground"
			>
				<span>{label}</span>
				<SortIcon field={field} />
			</button>
		</TableHead>
	)

	const stats = summary ?? {
		total: members.length,
		linked: members.filter((m) => m.hasAuthAccount).length,
		linkedUsers: new Set(
			members
				.map((member) => member.authUserId)
				.filter((authUserId): authUserId is string => Boolean(authUserId))
		).size,
		active: members.filter((m) => m.activityStatus === 'active').length,
		inactive: members.filter((m) => m.activityStatus === 'inactive').length,
		directors: members.filter((m) => m.role === 'Director').length,
	}
	const pageLimit = pagination?.limit ?? query.limit ?? 50
	const totalItems = pagination?.totalItems ?? 0

	const renderPaginationControls = () => (
		<div className="border-b p-4">
			<UserSearchPaginationControls
				totalCount={totalItems}
				page={currentPage}
				pageSize={pageLimit}
				onPageChange={(page) => onQueryChange((prev) => ({ ...prev, page }))}
				onPageSizeChange={(limit) => onQueryChange((prev) => ({ ...prev, page: 1, limit }))}
				pageSizeOptions={[10, 25, 50, 100]}
				itemLabel="members"
			/>
		</div>
	)

	if (loading) {
		return (
			<Card className="p-6">
				<div className="flex items-center justify-center">
					<div className="animate-pulse text-muted-foreground">Loading members...</div>
				</div>
			</Card>
		)
	}

	return (
		<div className="space-y-4">
			{/* Statistics Bar */}
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">Total Members</div>
					<div className="text-2xl font-bold">{stats.total}</div>
					<div className="mt-1 text-xs text-muted-foreground">
						({stats.linkedUsers} linked users)
					</div>
				</Card>
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">Linked</div>
					<div className="text-2xl font-bold text-success">{stats.linked}</div>
				</Card>
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">Active</div>
					<div className="text-2xl font-bold text-primary">{stats.active}</div>
				</Card>
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">Inactive</div>
					<div className="text-2xl font-bold text-warning">{stats.inactive}</div>
				</Card>
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">Directors</div>
					<div className="text-2xl font-bold text-purple-500">{stats.directors}</div>
				</Card>
			</div>

			{/* Filters */}
			<Card className="p-4">
				<div className="flex flex-col sm:flex-row gap-4">
					<Input
						placeholder="Search members..."
						value={searchQuery}
						onChange={(e) =>
							onQueryChange((prev) => ({
								...prev,
								page: 1,
								search: e.target.value,
							}))
						}
						className="flex-1"
					/>

					<Select
						value={authFilter}
						onValueChange={(v) =>
							onQueryChange((prev) => ({
								...prev,
								page: 1,
								authFilter: v as typeof authFilter,
							}))
						}
						options={[
							{ value: 'all', label: 'All Auth' },
							{ value: 'linked_valid', label: 'ESI Valid' },
							{ value: 'linked_invalid', label: 'ESI Invalid' },
							{ value: 'linked_unknown', label: 'ESI Unknown' },
							{ value: 'unlinked', label: 'Unlinked' },
						]}
						className="w-[140px]"
					/>

					<Select
						value={activityFilter}
						onValueChange={(v) =>
							onQueryChange((prev) => ({
								...prev,
								page: 1,
								activityFilter: v as typeof activityFilter,
							}))
						}
						options={[
							{ value: 'all', label: 'All Activity' },
							{ value: 'active', label: 'Active' },
							{ value: 'inactive', label: 'Inactive' },
							{ value: 'unknown', label: 'Unknown' },
						]}
						className="w-[140px]"
					/>

					<Select
						value={roleFilter}
						onValueChange={(v) =>
							onQueryChange((prev) => ({
								...prev,
								page: 1,
								roleFilter: v as typeof roleFilter,
							}))
						}
						options={[
							{ value: 'all', label: 'All Roles' },
							{ value: 'CEO', label: 'CEOs' },
							{ value: 'Director', label: 'Directors' },
							{ value: 'Member', label: 'Members' },
						]}
						className="w-[140px]"
					/>
				</div>
			</Card>

			{/* Table */}
			<TableRefreshFrame isRefreshing={isRefreshing} refreshMessage="Loading members...">
				<Card>
					{renderPaginationControls()}
					<Table>
						<TableHeader>
							<TableRow>
								<SortableHead field="name" label="Member" />
								<SortableHead field="role" label="Role" />
								{canManageHrRoles && <SortableHead field="hrRole" label="HR Role" />}
								<SortableHead field="auth" label="Auth Account" />
								<SortableHead field="activity" label="Activity" />
								<SortableHead field="lastLogin" label="Last Login" />
								<SortableHead field="joinDate" label="Join Date" />
								{showActions && (
									<TableHead className="sticky right-0 z-20 bg-card text-right">Actions</TableHead>
								)}
							</TableRow>
						</TableHeader>
						<TableBody>
							{paginatedMembers.map((member) => (
								<TableRow
									key={member.characterId}
									className={cn(
										'hover:bg-muted/50 cursor-pointer',
										!member.hasAuthAccount && 'bg-yellow-500/5'
									)}
									onClick={() => onMemberClick?.(member)}
								>
									<TableCell>
										<div className="flex items-center gap-3">
											<img
												src={characterPortraitUrl(member.characterId, 64)}
												alt={`${member.characterName}'s portrait`}
												loading="lazy"
												onError={(e) => {
													;(e.currentTarget as HTMLImageElement).src =
														'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"%3E%3Crect fill="%23404040" width="64" height="64"/%3E%3Ctext x="50%25" y="50%25" font-family="Arial" font-size="24" fill="%23bfbfbf" text-anchor="middle" dominant-baseline="middle"%3E?%3C/text%3E%3C/svg%3E'
												}}
												className="w-8 h-8 rounded-full border border-border"
											/>
											<div>
												<div className="font-medium">{member.characterName}</div>
												{member.locationSystem && (
													<div className="text-xs text-muted-foreground">
														{member.locationSystem}
													</div>
												)}
											</div>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex gap-2 flex-wrap">
											{member.role === 'CEO' && (
												<Badge variant="destructive" icon={Star}>
													CEO
												</Badge>
											)}
											{member.role === 'Director' && (
												<Badge variant="warning" icon={Shield}>
													Director
												</Badge>
											)}
											{member.role === 'Member' && (
												<Badge variant="default" icon={User}>
													Member
												</Badge>
											)}
											{member.status === 'emeritus' && (
												<Badge variant="special" icon={Heart}>
													Emeritus
												</Badge>
											)}
											{member.isBlacklisted && (
												<Badge variant="destructive" icon={ShieldBan}>
													Blocklisted
												</Badge>
											)}
										</div>
									</TableCell>
									{canManageHrRoles && (
										<TableCell>
											{member.hrRole ? (
												<HrRoleBadge role={member.hrRole} />
											) : (
												<span className="text-xs text-muted-foreground">None</span>
											)}
										</TableCell>
									)}
									<TableCell>
										<div className="space-y-1">
											<EsiStatusBadge
												hasAuthAccount={member.hasAuthAccount}
												hasValidToken={member.hasValidToken}
												className="text-[10px]"
											/>
											{member.mainCharacterName && (
												<div className="text-xs text-muted-foreground">
													{member.mainCharacterName}
												</div>
											)}
										</div>
									</TableCell>
									<TableCell>
										{member.activityStatus === 'active' && <Badge variant="success">Active</Badge>}
										{member.activityStatus === 'inactive' && (
											<Badge variant="warning">Inactive</Badge>
										)}
										{member.activityStatus === 'unknown' && <Badge variant="ghost">Unknown</Badge>}
									</TableCell>
									<TableCell>
										<div className="text-sm">{formatDate(member.lastLogin)}</div>
									</TableCell>
									<TableCell>
										<div className="text-sm">{formatDate(member.joinDate)}</div>
									</TableCell>
									{showActions && (
										<TableCell
											className="sticky right-0 z-10 bg-card text-right"
											onClick={(e) => e.stopPropagation()}
										>
											<ActionsMenu
												items={[
													{
														label: 'View Profile',
														intent: 'muted',
														onClick: () => onMemberClick?.(member),
													},
													{
														label: 'Grant HR Role',
														intent: 'confirm',
														hidden: !canManageHrRoles || !member.hasAuthAccount || !!member.hrRole,
														onClick: () => setGrantDialogMember(member),
													},
													{
														label: 'Revoke HR Role',
														intent: 'destructive',
														hidden:
															!canManageHrRoles ||
															!member.hrRole ||
															(!canRevokeHrAdmin && member.hrRole.role === 'hr_admin'),
														onClick: () => setRevokeDialogMember(member),
													},
													{
														label: 'Mark as Emeritus',
														intent: 'secondary',
														hidden:
															!canManageEmeritus ||
															!member.hasAuthAccount ||
															member.role === 'CEO' ||
															member.status === 'emeritus',
														onClick: () => {
															setEmeritusAction('mark')
															setEmeritusDialogMember(member)
														},
													},
													{
														label: 'Remove Emeritus',
														intent: 'secondary',
														hidden: !canManageEmeritus || member.status !== 'emeritus',
														onClick: () => {
															setEmeritusAction('remove')
															setEmeritusDialogMember(member)
														},
													},
												]}
											/>
										</TableCell>
									)}
								</TableRow>
							))}
							{paginatedMembers.length === 0 && (
								<TableRow>
									<TableCell
										colSpan={showActions ? (canManageHrRoles ? 8 : 7) : canManageHrRoles ? 7 : 6}
										className="py-8 text-center text-sm text-muted-foreground"
									>
										No members found for the current filters.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>

					{/* Pagination */}
					{renderPaginationControls()}
				</Card>
			</TableRefreshFrame>

			{/* HR Role Dialogs */}
			{canManageHrRoles && corporationId && (
				<>
					<GrantHrRoleDialog
						member={grantDialogMember}
						corporationId={corporationId}
						open={!!grantDialogMember}
						onOpenChange={(open) => !open && setGrantDialogMember(null)}
						onSubmit={handleGrantHrRole}
						isSubmitting={grantMutation.isPending}
						allowedRoles={grantableHrRoles}
					/>
					<RevokeHrRoleDialog
						member={revokeDialogMember}
						hrRole={revokeDialogMember?.hrRole || null}
						open={!!revokeDialogMember}
						onOpenChange={(open) => !open && setRevokeDialogMember(null)}
						onSubmit={handleRevokeHrRole}
						isSubmitting={revokeMutation.isPending}
					/>
				</>
			)}

			{/* Emeritus Status Dialog */}
			{canManageEmeritus && (
				<EmeritusConfirmationDialog
					member={emeritusDialogMember}
					action={emeritusAction}
					open={!!emeritusDialogMember}
					onOpenChange={(open) => !open && setEmeritusDialogMember(null)}
					onSubmit={handleEmeritusStatusUpdate}
					isSubmitting={emeritusMutation.isPending}
				/>
			)}
		</div>
	)
}
