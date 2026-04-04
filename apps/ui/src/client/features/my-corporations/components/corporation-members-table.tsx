/**
 * Corporation Members Table Component
 *
 * Displays a comprehensive table of corporation members with filtering,
 * sorting, and actions for CEO/Director users.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
	AlertCircle,
	CheckCircle,
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Heart,
	Link2,
	Shield,
	ShieldBan,
	ShieldOff,
	Star,
	User,
	Users,
	XCircle,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
import { useMessage } from '@/hooks/useMessage'
import { cn } from '@/lib/utils'

import {
	GrantHrRoleDialog,
	HrRoleBadge,
	RevokeHrRoleDialog,
	useGrantHrRole,
	useRevokeHrRole,
} from '../../hr'
import {
	filterMembersByActivity,
	filterMembersByAuthStatus,
	myCorporationsApi,
	sortMembers,
} from '../api'
import { EmeritusConfirmationDialog } from './emeritus-confirmation-dialog'

import type { CorporationMember } from '../api'

interface CorporationMembersTableProps {
	members: CorporationMember[]
	loading?: boolean
	onMemberClick?: (member: CorporationMember) => void
	onLinkAccount?: (member: CorporationMember) => void
	showActions?: boolean
	canManageHrRoles?: boolean
	corporationId?: string
}

type SortField = 'name' | 'role' | 'auth' | 'activity' | 'lastLogin' | 'joinDate'
type SortOrder = 'asc' | 'desc'

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
	onMemberClick,
	onLinkAccount,
	showActions = true,
	canManageHrRoles = false,
	corporationId,
}: CorporationMembersTableProps) {
	const { showSuccess, showError } = useMessage()

	// Filter states
	const [searchQuery, setSearchQuery] = useState('')
	const [authFilter, setAuthFilter] = useState<'all' | 'linked' | 'unlinked'>('all')
	const [activityFilter, setActivityFilter] = useState<'all' | 'active' | 'inactive' | 'unknown'>(
		'all'
	)
	const [roleFilter, setRoleFilter] = useState<'all' | 'CEO' | 'Director' | 'Member'>('all')

	// Sort states
	const [sortField, setSortField] = useState<SortField>('role')
	const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

	// Pagination
	const [currentPage, setCurrentPage] = useState(1)
	const itemsPerPage = 50

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
			queryClient.invalidateQueries({ queryKey: ['corporation-members', corporationId] })
			queryClient.invalidateQueries({ queryKey: ['my-corporations'] })
		},
	})

	// Filter and sort members
	const filteredAndSortedMembers = useMemo(() => {
		let filtered = [...members]

		if (searchQuery) {
			const query = searchQuery.toLowerCase()
			filtered = filtered.filter(
				(m) =>
					m.characterName.toLowerCase().includes(query) ||
					m.mainCharacterName?.toLowerCase().includes(query) ||
					m.locationSystem?.toLowerCase().includes(query)
			)
		}

		filtered = filterMembersByAuthStatus(filtered, authFilter)
		filtered = filterMembersByActivity(filtered, activityFilter)

		if (roleFilter !== 'all') {
			filtered = filtered.filter((m) => m.role === roleFilter)
		}

		filtered.sort((a, b) => {
			let comparison = 0

			switch (sortField) {
				case 'name':
					comparison = a.characterName.localeCompare(b.characterName)
					break
				case 'role': {
					const roleOrder = { CEO: 0, Director: 1, Member: 2 }
					comparison = roleOrder[a.role] - roleOrder[b.role]
					break
				}
				case 'auth':
					comparison = (a.hasAuthAccount ? 0 : 1) - (b.hasAuthAccount ? 0 : 1)
					break
				case 'activity': {
					const activityOrder = { active: 0, inactive: 1, unknown: 2 }
					comparison = activityOrder[a.activityStatus] - activityOrder[b.activityStatus]
					break
				}
				case 'lastLogin':
					comparison = (b.lastLogin || '').localeCompare(a.lastLogin || '')
					break
				case 'joinDate':
					comparison = a.joinDate.localeCompare(b.joinDate)
					break
			}

			return sortOrder === 'asc' ? comparison : -comparison
		})

		return filtered
	}, [members, searchQuery, authFilter, activityFilter, roleFilter, sortField, sortOrder])

	const paginatedMembers = useMemo(() => {
		const startIndex = (currentPage - 1) * itemsPerPage
		return filteredAndSortedMembers.slice(startIndex, startIndex + itemsPerPage)
	}, [filteredAndSortedMembers, currentPage])

	const totalPages = Math.ceil(filteredAndSortedMembers.length / itemsPerPage)

	const handleSort = useCallback(
		(field: SortField) => {
			if (sortField === field) {
				setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
			} else {
				setSortField(field)
				setSortOrder('asc')
			}
		},
		[sortField, sortOrder]
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
		if (sortField !== field) return null
		return sortOrder === 'asc' ? (
			<ChevronUp className="ml-1 h-3 w-3 inline" />
		) : (
			<ChevronDown className="ml-1 h-3 w-3 inline" />
		)
	}

	const stats = useMemo(() => {
		return {
			total: filteredAndSortedMembers.length,
			linked: filteredAndSortedMembers.filter((m) => m.hasAuthAccount).length,
			active: filteredAndSortedMembers.filter((m) => m.activityStatus === 'active').length,
			inactive: filteredAndSortedMembers.filter((m) => m.activityStatus === 'inactive').length,
			directors: filteredAndSortedMembers.filter((m) => m.role === 'Director').length,
		}
	}, [filteredAndSortedMembers])

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
			<div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">Total Members</div>
					<div className="text-2xl font-bold">{stats.total}</div>
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
						onChange={(e) => setSearchQuery(e.target.value)}
						className="flex-1"
					/>

					<Select
						value={authFilter}
						onValueChange={(v) => setAuthFilter(v as typeof authFilter)}
						options={[
							{ value: 'all', label: 'All Auth' },
							{ value: 'linked', label: 'Linked' },
							{ value: 'unlinked', label: 'Unlinked' },
						]}
						className="w-[140px]"
					/>

					<Select
						value={activityFilter}
						onValueChange={(v) => setActivityFilter(v as typeof activityFilter)}
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
						onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}
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
			<Card>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead
								className="cursor-pointer hover:bg-muted/50"
								onClick={() => handleSort('name')}
							>
								Member
								<SortIcon field="name" />
							</TableHead>
							<TableHead
								className="cursor-pointer hover:bg-muted/50"
								onClick={() => handleSort('role')}
							>
								Role
								<SortIcon field="role" />
							</TableHead>
							{canManageHrRoles && <TableHead>HR Role</TableHead>}
							<TableHead
								className="cursor-pointer hover:bg-muted/50"
								onClick={() => handleSort('auth')}
							>
								Auth Account
								<SortIcon field="auth" />
							</TableHead>
							<TableHead
								className="cursor-pointer hover:bg-muted/50"
								onClick={() => handleSort('activity')}
							>
								Activity
								<SortIcon field="activity" />
							</TableHead>
							<TableHead
								className="cursor-pointer hover:bg-muted/50"
								onClick={() => handleSort('lastLogin')}
							>
								Last Login
								<SortIcon field="lastLogin" />
							</TableHead>
							<TableHead
								className="cursor-pointer hover:bg-muted/50"
								onClick={() => handleSort('joinDate')}
							>
								Join Date
								<SortIcon field="joinDate" />
							</TableHead>
							{showActions && (
								<TableHead className="sticky right-0 z-20 bg-card text-right">
									Actions
								</TableHead>
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
											src={`/images/characters/${member.characterId}/portrait?size=64`}
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
												<div className="text-xs text-muted-foreground">{member.locationSystem}</div>
											)}
										</div>
									</div>
								</TableCell>
								<TableCell>
									<div className="flex gap-2 flex-wrap">
										{member.role === 'CEO' && (
											<Badge variant="destructive" icon={Star}>CEO</Badge>
										)}
										{member.role === 'Director' && (
											<Badge variant="warning" icon={Shield}>Director</Badge>
										)}
										{member.role === 'Member' && (
											<Badge variant="ghost" icon={User}>Member</Badge>
										)}
										{member.status === 'emeritus' && (
											<Badge variant="special" icon={Heart}>Emeritus</Badge>
										)}
										{member.isBlacklisted && (
											<Badge variant="destructive" icon={ShieldBan}>Blacklisted</Badge>
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
									{member.hasAuthAccount ? (
										<div className="space-y-1">
											<Badge variant="success" icon={CheckCircle}>Linked</Badge>
											{member.mainCharacterName && (
												<div className="text-xs text-muted-foreground">
													{member.mainCharacterName}
												</div>
											)}
										</div>
									) : (
										<Badge variant="warning" icon={AlertCircle}>Not Linked</Badge>
									)}
								</TableCell>
								<TableCell>
									{member.activityStatus === 'active' && (
										<Badge variant="success">Active</Badge>
									)}
									{member.activityStatus === 'inactive' && (
										<Badge variant="warning">Inactive</Badge>
									)}
									{member.activityStatus === 'unknown' && (
										<Badge variant="ghost">Unknown</Badge>
									)}
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
													label: 'Link Account',
													intent: 'primary',
													hidden: member.hasAuthAccount || !onLinkAccount,
													onClick: () => onLinkAccount?.(member),
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
													hidden: !canManageHrRoles || !member.hrRole,
													onClick: () => setRevokeDialogMember(member),
												},
												{
													label: 'Mark as Emeritus',
													intent: 'secondary',
													hidden:
														!canManageHrRoles ||
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
													hidden: !canManageHrRoles || member.status !== 'emeritus',
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
					</TableBody>
				</Table>

				{/* Pagination */}
				{totalPages > 1 && (
					<div className="flex items-center justify-between p-4 border-t">
						<div className="text-sm text-muted-foreground">
							Showing {(currentPage - 1) * itemsPerPage + 1}-
							{Math.min(currentPage * itemsPerPage, filteredAndSortedMembers.length)} of{' '}
							{filteredAndSortedMembers.length} members
						</div>
						<div className="flex gap-2">
							<Button
								size="sm"
								variant="ghost"
								disabled={currentPage === 1}
								onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
							>
								Previous
							</Button>
							<div className="flex items-center gap-1">
								{Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
									const pageNum = i + 1
									return (
										<Button
											key={pageNum}
											size="sm"
											variant={currentPage === pageNum ? 'primary' : 'ghost'}
											onClick={() => setCurrentPage(pageNum)}
										>
											{pageNum}
										</Button>
									)
								})}
								{totalPages > 5 && <span className="px-2">...</span>}
								{totalPages > 5 && (
									<Button
										size="sm"
										variant={currentPage === totalPages ? 'primary' : 'ghost'}
										onClick={() => setCurrentPage(totalPages)}
									>
										{totalPages}
									</Button>
								)}
							</div>
							<Button
								size="sm"
								variant="ghost"
								disabled={currentPage === totalPages}
								onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
							>
								Next
							</Button>
						</div>
					</div>
				)}
			</Card>

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
			{canManageHrRoles && (
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
