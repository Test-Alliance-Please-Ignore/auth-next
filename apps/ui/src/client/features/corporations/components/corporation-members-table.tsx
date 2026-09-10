/**
 * Corporation Members Table Component
 *
 * Displays a comprehensive table of corporation members with filtering,
 * sorting, and actions for CEO/Director users.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Heart, Shield, ShieldBan, Star, User } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { Link } from 'react-router'

import { EsiStatusBadge, getEsiStatusBadgeState } from '@/components/esi-status-badge'
import { MemberAvatar } from '@/components/member-avatar'
import { TableRefreshFrame } from '@/components/table-refresh-frame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select } from '@/components/ui/select'
import {
	SortableTableHead,
	stickyTableActionCellClassName,
	stickyTableActionHeaderClassName,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useMessage } from '@/hooks/useMessage'
import {
	formatDate as formatLocalizedDate,
	formatNumber,
	formatRelativeTime,
	i18n,
	useAppTranslation,
} from '@/i18n'
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

import type { KeyboardEvent, MouseEvent, SetStateAction } from 'react'
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
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(false)
	const visible = items.filter((item) => !item.hidden)

	if (visible.length === 0) return null

	const baseClass =
		'w-full cursor-pointer px-3 py-2 text-left text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 first:rounded-t last:rounded-b'

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm">
					{t('corporations.members.actions')} <ChevronDown className="ml-1 h-3 w-3" />
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
						{item.loading ? t('common.loading') : item.label}
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
	const { t } = useAppTranslation()
	const filterId = useId()

	const searchQuery = query.search ?? ''
	const mainsOnly = query.mainsOnly ?? false
	const authFilter = query.authFilter ?? 'all'
	const activityFilter = query.activityFilter ?? 'all'
	const roleFilter = query.roleFilter ?? 'all'
	const sortField: SortField = query.sortField ?? 'role'
	const sortOrder = query.sortOrder ?? 'asc'
	const currentPage = pagination?.page ?? 1
	const paginatedMembers = members

	const getMemberHref = (member: CorporationMember): string =>
		member.hasAuthAccount && member.authUserId
			? `/corporations/${corporationId}/members/${member.authUserId}`
			: `/character/${member.characterId}`

	const handleMemberRowClick = (
		event: MouseEvent<HTMLTableRowElement>,
		member: CorporationMember
	) => {
		if ((event.target as HTMLElement).closest('a, button, input, [role="button"]')) return

		const href = getMemberHref(member)
		if (event.ctrlKey || event.metaKey || event.button === 1) {
			event.preventDefault()
			window.open(href, '_blank', 'noopener,noreferrer')
			return
		}

		onMemberClick?.(member)
	}

	const handleMemberRowKeyDown = (
		event: KeyboardEvent<HTMLTableRowElement>,
		member: CorporationMember
	) => {
		if (event.key !== 'Enter' && event.key !== ' ') return
		if ((event.target as HTMLElement).closest('button, input, [role="button"]')) return
		event.preventDefault()
		onMemberClick?.(member)
	}

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
			void queryClient.invalidateQueries({
				queryKey: ['my-corporations', 'members', corporationId],
			})
			void queryClient.invalidateQueries({ queryKey: ['my-corporations'] })
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
				showSuccess(i18n.t('corporations.members.hrRoleGranted'))
				setGrantDialogMember(null)
			} catch (error) {
				showError(i18n.t('corporations.members.hrRoleGrantFailed'))
				throw error
			}
		},
		[grantMutation, showSuccess, showError]
	)

	const handleRevokeHrRole = useCallback(
		async (request: Parameters<typeof revokeMutation.mutateAsync>[0]) => {
			try {
				await revokeMutation.mutateAsync(request)
				showSuccess(i18n.t('corporations.members.hrRoleRevoked'))
				setRevokeDialogMember(null)
			} catch (error) {
				showError(i18n.t('corporations.members.hrRoleRevokeFailed'))
				throw error
			}
		},
		[revokeMutation, showSuccess, showError]
	)

	const handleEmeritusStatusUpdate = useCallback(
		async (characterId: string, status: 'active' | 'emeritus') => {
			try {
				await emeritusMutation.mutateAsync({ characterId, status })
				showSuccess(
					status === 'emeritus'
						? i18n.t('corporations.members.emeritusMarked')
						: i18n.t('corporations.members.emeritusRemoved')
				)
				setEmeritusDialogMember(null)
			} catch (error) {
				showError(i18n.t('corporations.members.statusUpdateFailed'))
				throw error
			}
		},
		[emeritusMutation, showSuccess, showError]
	)

	const formatMemberDate = (dateString?: string) => {
		if (!dateString) return t('corporations.members.never')
		const date = new Date(dateString)
		const now = new Date()
		const diffMs = now.getTime() - date.getTime()
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

		if (diffDays < 7) return formatRelativeTime(-diffDays, 'day')
		if (diffDays < 30) return formatRelativeTime(-Math.floor(diffDays / 7), 'week')
		if (diffDays < 365) return formatRelativeTime(-Math.floor(diffDays / 30), 'month')

		return formatLocalizedDate(date)
	}

	const getSortDirection = (field: SortField) => {
		return sortField === field ? sortOrder : undefined
	}

	const SortableHead = ({ field, label }: { field: SortField; label: string }) => (
		<SortableTableHead onSort={() => handleSort(field)} direction={getSortDirection(field)}>
			{label}
		</SortableTableHead>
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
				itemLabel={t('corporations.members.membersLower', { count: totalItems })}
			/>
		</div>
	)

	if (loading) {
		return (
			<Card className="p-6">
				<div className="flex items-center justify-center">
					<div className="animate-pulse text-muted-foreground">
						{t('corporations.members.loading')}
					</div>
				</div>
			</Card>
		)
	}

	return (
		<div className="space-y-4">
			{/* Statistics Bar */}
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">
						{t('corporations.members.totalMembers')}
					</div>
					<div className="text-2xl font-bold">{formatNumber(stats.total)}</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{t('corporations.members.linkedUsers', {
							count: stats.linkedUsers,
							value: formatNumber(stats.linkedUsers),
						})}
					</div>
				</Card>
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">{t('corporations.members.linked')}</div>
					<div className="text-2xl font-bold text-success">{formatNumber(stats.linked)}</div>
				</Card>
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">{t('corporations.members.active')}</div>
					<div className="text-2xl font-bold text-primary">{formatNumber(stats.active)}</div>
				</Card>
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">{t('corporations.members.inactive')}</div>
					<div className="text-2xl font-bold text-warning">{formatNumber(stats.inactive)}</div>
				</Card>
				<Card className="p-3">
					<div className="text-sm text-muted-foreground">{t('corporations.members.directors')}</div>
					<div className="text-2xl font-bold text-purple-500">{formatNumber(stats.directors)}</div>
				</Card>
			</div>

			{/* Filters */}
			<Card className="p-4">
				<div className="flex flex-col sm:flex-row gap-4">
					<Input
						placeholder={t('corporations.members.searchPlaceholder')}
						aria-label={t('corporations.members.searchPlaceholder')}
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

					<label htmlFor={`${filterId}-auth`} className="sr-only">
						{t('corporations.members.authAccount')}
					</label>
					<Select
						inputId={`${filterId}-auth`}
						value={authFilter}
						onValueChange={(v) =>
							onQueryChange((prev) => ({
								...prev,
								page: 1,
								authFilter: v as typeof authFilter,
							}))
						}
						options={[
							{ value: 'all', label: t('corporations.members.allAuth') },
							{ value: 'linked_valid', label: t('common.esiStatus.valid') },
							{ value: 'linked_invalid', label: t('common.esiStatus.invalid') },
							{ value: 'linked_unknown', label: t('common.esiStatus.unknown') },
							{ value: 'unlinked', label: t('common.esiStatus.unlinked') },
						]}
						className="w-[140px]"
					/>

					<label htmlFor={`${filterId}-activity`} className="sr-only">
						{t('corporations.members.activity')}
					</label>
					<Select
						inputId={`${filterId}-activity`}
						value={activityFilter}
						onValueChange={(v) =>
							onQueryChange((prev) => ({
								...prev,
								page: 1,
								activityFilter: v as typeof activityFilter,
							}))
						}
						options={[
							{ value: 'all', label: t('corporations.members.allActivity') },
							{ value: 'active', label: t('corporations.members.active') },
							{ value: 'inactive', label: t('corporations.members.inactive') },
							{ value: 'unknown', label: t('corporations.members.unknown') },
						]}
						className="w-[140px]"
					/>

					<label htmlFor={`${filterId}-role`} className="sr-only">
						{t('corporations.members.role')}
					</label>
					<Select
						inputId={`${filterId}-role`}
						value={roleFilter}
						onValueChange={(v) =>
							onQueryChange((prev) => ({
								...prev,
								page: 1,
								roleFilter: v as typeof roleFilter,
							}))
						}
						options={[
							{ value: 'all', label: t('corporations.members.allRoles') },
							{ value: 'CEO', label: t('corporations.roles.ceos') },
							{ value: 'Director', label: t('corporations.roles.directors') },
							{ value: 'Member', label: t('corporations.roles.members') },
						]}
						className="w-[140px]"
					/>

					<label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm">
						<Checkbox
							checked={mainsOnly}
							onCheckedChange={(checked) =>
								onQueryChange((prev) => ({
									...prev,
									page: 1,
									mainsOnly: checked === true,
								}))
							}
						/>
						<span>{t('corporations.members.showMainsOnly')}</span>
					</label>
				</div>
			</Card>

			{/* Table */}
			<TableRefreshFrame
				isRefreshing={isRefreshing}
				refreshMessage={t('corporations.members.loading')}
			>
				<Card>
					{renderPaginationControls()}
					<Table className="whitespace-nowrap">
						<TableHeader>
							<TableRow>
								<SortableHead field="name" label={t('corporations.members.member')} />
								<SortableHead field="role" label={t('corporations.members.role')} />
								{canManageHrRoles && (
									<SortableHead field="hrRole" label={t('corporations.members.hrRole')} />
								)}
								<SortableHead field="auth" label={t('corporations.members.authAccount')} />
								<SortableHead field="activity" label={t('corporations.members.activity')} />
								<SortableHead field="lastLogin" label={t('corporations.members.lastLogin')} />
								<SortableHead field="joinDate" label={t('corporations.members.joinDate')} />
								{showActions && (
									<TableHead className={`${stickyTableActionHeaderClassName} text-right`}>
										{t('corporations.members.actions')}
									</TableHead>
								)}
							</TableRow>
						</TableHeader>
						<TableBody>
							{paginatedMembers.map((member) => (
								<TableRow
									key={member.characterId}
									className={cn(
										'cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
										!member.hasAuthAccount && 'bg-yellow-500/5'
									)}
									role="link"
									tabIndex={0}
									onClick={(event) => handleMemberRowClick(event, member)}
									onAuxClick={(event) => handleMemberRowClick(event, member)}
									onKeyDown={(event) => handleMemberRowKeyDown(event, member)}
								>
									<TableCell>
										<div className="flex items-center gap-3">
											<MemberAvatar
												characterId={member.characterId}
												characterName={member.characterName}
												isBlacklisted={member.isBlacklisted}
												size="sm"
												className="rounded-full border border-border"
											/>
											<div>
												<Link
													to={getMemberHref(member)}
													onClick={(event) => event.stopPropagation()}
													className={cn(
														'font-medium hover:underline',
														member.isBlacklisted && 'text-red-500'
													)}
												>
													{member.characterName}
												</Link>
												{member.locationSystem && (
													<div className="text-xs text-muted-foreground">
														{member.locationSystem}
													</div>
												)}
											</div>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex flex-nowrap gap-2">
											{member.role === 'CEO' && (
												<Badge variant="destructive" icon={Star}>
													CEO
												</Badge>
											)}
											{member.role === 'Director' && (
												<Badge variant="warning" icon={Shield}>
													{t('corporations.roles.director')}
												</Badge>
											)}
											{member.role === 'Member' && (
												<Badge variant="default" icon={User}>
													{t('corporations.roles.member')}
												</Badge>
											)}
											{member.status === 'emeritus' && (
												<Badge variant="special" icon={Heart}>
													{t('corporations.members.emeritus')}
												</Badge>
											)}
											{member.isBlacklisted && (
												<Badge variant="destructive" icon={ShieldBan}>
													{t('corporations.members.blocklisted')}
												</Badge>
											)}
										</div>
									</TableCell>
									{canManageHrRoles && (
										<TableCell>
											{member.hrRole ? (
												<HrRoleBadge role={member.hrRole} />
											) : (
												<span className="text-xs text-muted-foreground">
													{t('corporations.members.none')}
												</span>
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
										{member.activityStatus === 'active' && (
											<Badge variant="success">{t('corporations.members.active')}</Badge>
										)}
										{member.activityStatus === 'inactive' && (
											<Badge variant="warning">{t('corporations.members.inactive')}</Badge>
										)}
										{member.activityStatus === 'unknown' && (
											<Badge variant="ghost">{t('corporations.members.unknown')}</Badge>
										)}
									</TableCell>
									<TableCell>
										<div className="text-sm">{formatMemberDate(member.lastLogin)}</div>
									</TableCell>
									<TableCell>
										<div className="text-sm">{formatMemberDate(member.joinDate)}</div>
									</TableCell>
									{showActions && (
										<TableCell
											className={`${stickyTableActionCellClassName} text-right`}
											onClick={(e) => e.stopPropagation()}
										>
											<ActionsMenu
												items={[
													{
														label: t('corporations.members.viewProfile'),
														intent: 'muted',
														onClick: () => onMemberClick?.(member),
													},
													{
														label: t('corporations.members.grantHrRole'),
														intent: 'confirm',
														hidden: !canManageHrRoles || !member.hasAuthAccount || !!member.hrRole,
														onClick: () => setGrantDialogMember(member),
													},
													{
														label: t('corporations.members.revokeHrRole'),
														intent: 'destructive',
														hidden:
															!canManageHrRoles ||
															!member.hrRole ||
															(!canRevokeHrAdmin && member.hrRole.role === 'hr_admin'),
														onClick: () => setRevokeDialogMember(member),
													},
													{
														label: t('corporations.emeritus.markAction'),
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
														label: t('corporations.members.removeEmeritus'),
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
										{t('corporations.members.empty')}
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
