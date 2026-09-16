/**
 * HR Roles Management Page
 *
 * Dedicated page for managing HR roles for a corporation.
 * Requires HR Admin role to access.
 */

import { AlertCircle, ArrowLeft, Shield } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { MemberAvatar } from '@/components/member-avatar'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	HrRoleBadge,
	RevokeHrRoleDialog,
	useGrantHrRole,
	useHrRoles,
	useRevokeHrRole,
} from '@/features/hr'
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { getActiveLocale, useAppTranslation } from '@/i18n'

import {
	formatCorporationRoleLabel,
	useCanAccessCorporation,
	useCorporationMembers,
	useMyCorporation,
} from '../../corporations/hooks'

import type {
	GrantHrRoleRequest,
	HrRoleGrant,
	HrRoleType,
	RevokeHrRoleRequest,
} from '@/features/hr'
import type { CorporationMember } from '../../corporations'

/**
 * Main HR Roles Management Component
 */
export default function HrRolesManagement() {
	const { t } = useAppTranslation()

	const { corporationId } = useParams<{ corporationId: string }>()
	const { showSuccess, showError } = useMessage()

	const { isAuthenticated, isLoading: authLoading } = useAuth()
	const {
		canAccess,
		isLoading: accessLoading,
		userRole,
		hrRole,
		corporation: accessCorp,
	} = useCanAccessCorporation(corporationId!)
	const { data: corporation, isLoading: corpLoading } = useMyCorporation(corporationId!)
	const { data: membersResponse, isLoading: membersLoading } = useCorporationMembers(
		corporationId!,
		{}
	)
	const members = membersResponse?.items ?? []
	const corp = corporation ?? accessCorp
	const isMemberCorporation = corp?.isMemberCorporation ?? false
	const {
		data: hrRoles,
		isLoading: hrRolesLoading,
		error,
	} = useHrRoles(corporationId!, {
		enabled: isMemberCorporation && canAccess,
	})

	const [revokeDialogMember, setRevokeDialogMember] = useState<CorporationMember | null>(null)
	const [assignUserDialogOpen, setAssignUserDialogOpen] = useState(false)
	const [assignUserId, setAssignUserId] = useState('')
	const [assignRole, setAssignRole] = useState<'hr_admin' | 'hr_reviewer' | 'hr_viewer'>(
		'hr_viewer'
	)
	const [changeRoleTarget, setChangeRoleTarget] = useState<HrRoleGrant | null>(null)
	const [changeRoleValue, setChangeRoleValue] = useState<HrRoleType>('hr_viewer')

	// Mutations
	const grantMutation = useGrantHrRole()
	const revokeMutation = useRevokeHrRole()

	// Check if current user can manage HR roles (CEO, site admin, or HR admin)
	const canManageHrRoles = useMemo(() => {
		return (
			isMemberCorporation && (userRole === 'CEO' || userRole === 'admin' || hrRole === 'hr_admin')
		)
	}, [isMemberCorporation, hrRole, userRole, t])
	const canRevokeHrAdmin = useMemo(
		() => isMemberCorporation && (userRole === 'CEO' || userRole === 'admin'),
		[isMemberCorporation, userRole, t]
	)

	const memberByUserId = useMemo(() => {
		const map = new Map<string, CorporationMember>()
		for (const member of members) {
			if (!member.authUserId) continue
			const existing = map.get(member.authUserId)
			if (!existing) {
				map.set(member.authUserId, member)
				continue
			}
			if (member.mainCharacterName && !existing.mainCharacterName) {
				map.set(member.authUserId, member)
			}
		}
		return map
	}, [members, t])

	const activeRoleByUserId = useMemo(() => {
		const map = new Map<string, HrRoleGrant>()
		for (const role of hrRoles ?? []) {
			if (!role.isActive) continue
			if (!map.has(role.userId)) map.set(role.userId, role)
		}
		return map
	}, [hrRoles, t])

	const assignableMembers = useMemo(
		() =>
			members.filter((member) => {
				if (!member.authUserId) return false
				if (member.isBlacklisted) return false
				const existingRole = activeRoleByUserId.get(member.authUserId)
				if (!existingRole) return true
				return existingRole.role !== 'hr_admin' || canRevokeHrAdmin
			}),
		[members, activeRoleByUserId, canRevokeHrAdmin, t]
	)

	const assignableUsers = useMemo(() => {
		const map = new Map<string, CorporationMember>()
		for (const member of assignableMembers) {
			if (!member.authUserId) continue
			const existing = map.get(member.authUserId)
			if (!existing) {
				map.set(member.authUserId, member)
				continue
			}
			const existingName = existing.mainCharacterName || existing.characterName
			const candidateName = member.mainCharacterName || member.characterName
			if (member.mainCharacterName && !existing.mainCharacterName) {
				map.set(member.authUserId, member)
				continue
			}
			if (candidateName.localeCompare(existingName) < 0) {
				map.set(member.authUserId, member)
			}
		}
		return [...map.values()]
	}, [assignableMembers, t])

	const assignUserOptions = useMemo(
		() =>
			assignableUsers
				.map((member) => {
					const existing = member.authUserId ? activeRoleByUserId.get(member.authUserId) : undefined
					const roleHint = existing
						? t('hrpages.currentValue1', { value1: formatCorporationRoleLabel(existing.role) })
						: t('hrpages.noHrRole')
					return {
						value: member.authUserId!,
						label: member.mainCharacterName || member.characterName,
						description: roleHint,
					}
				})
				.sort((a, b) => a.label.localeCompare(b.label)),
		[assignableUsers, activeRoleByUserId, t]
	)
	const allowedRoleOptions = useMemo(
		() =>
			[
				{ value: 'hr_admin', label: t('hrpages.hrAdmin') },
				{ value: 'hr_reviewer', label: t('hrpages.hrReviewer') },
				{ value: 'hr_viewer', label: t('hrpages.hrViewer') },
			].filter((entry) => (canRevokeHrAdmin ? true : entry.value !== 'hr_admin')),
		[canRevokeHrAdmin, t]
	)

	// Set page title
	usePageTitle(
		corp
			? t('hrpages.value1HrRolesHrManagement', { value1: corp.name })
			: t('hrpages.hrRolesManagement')
	)

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check if corporation ID is provided
	if (!corporationId) {
		return <Navigate to="/corporations" replace />
	}

	// Loading state
	if (accessLoading || corpLoading || hrRolesLoading || membersLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	// Access denied
	if (!canAccess || !canManageHrRoles) {
		const accessMessage = isMemberCorporation
			? t('hrpages.youDonTHavePermissionToManageHrRolesFor')
			: t('hrpages.hrRolesCanOnlyBeManagedForMemberCorporations')
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							{t('hrpages.accessDenied')}
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{accessMessage}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" asChild>
							<Link to="/corporations">
								<ArrowLeft className="h-4 w-4" />
								{t('hrpages.returnToCorporations')}
							</Link>
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	// Error state
	if (error) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							{t('hrpages.failedToLoadHrRoles')}
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{error instanceof Error ? error.message : t('hrpages.anUnexpectedErrorOccurred')}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" asChild>
							<Link to={`/corporations/${corporationId}/members`}>
								<ArrowLeft className="h-4 w-4" />
								{t('hrpages.returnToManageCorporation')}
							</Link>
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	// Handlers
	const handleGrantHrRole = async (request: GrantHrRoleRequest) => {
		try {
			await grantMutation.mutateAsync(request)
			showSuccess(t('hrpages.hrRoleGrantedSuccessfully'))
		} catch (error) {
			showError(error instanceof Error ? error.message : t('hrpages.failedToGrantHrRole'))
		}
	}

	const handleAssignUserRole = async () => {
		if (!assignUserId) {
			showError(t('hrpages.selectAUserToAssign'))
			return
		}
		const member = assignableMembers.find((entry) => entry.authUserId === assignUserId)
		if (!member || !member.authUserId) {
			showError(t('hrpages.selectedUserIsInvalid'))
			return
		}

		await handleGrantHrRole({
			corporationId: corporationId!,
			userId: member.authUserId,
			characterId: member.characterId,
			characterName: member.mainCharacterName || member.characterName,
			role: assignRole,
		})

		setAssignUserDialogOpen(false)
		setAssignUserId('')
		setAssignRole('hr_viewer')
	}

	const handleRevokeHrRole = async (request: RevokeHrRoleRequest) => {
		try {
			await revokeMutation.mutateAsync(request)
			showSuccess(t('hrpages.hrRoleRevokedSuccessfully'))
			setRevokeDialogMember(null)
		} catch (error) {
			showError(error instanceof Error ? error.message : t('hrpages.failedToRevokeHrRole'))
		}
	}

	const handleRevokeClick = (role: HrRoleGrant) => {
		const linkedMember = memberByUserId.get(role.userId)
		if (linkedMember) {
			setRevokeDialogMember({
				...linkedMember,
				hrRole: role,
			})
			return
		}

		// Convert HrRoleGrant to CorporationMember format for the dialog
		const member: CorporationMember = {
			characterId: role.characterId,
			characterName: role.characterName || role.userId,
			corporationId: role.corporationId,
			corporationName: corporation?.name || '',
			authUserId: role.userId,
			mainCharacterName: undefined, // We don't have this in HrRoleGrant
			hasAuthAccount: true,
			role: 'Member', // Default role since we don't have this in HrRoleGrant
			joinDate: role.grantedAt,
			lastEsiUpdate: role.grantedAt,
			lastLogin: undefined,
			activityStatus: 'unknown' as const,
			hrRole: role,
			isBlacklisted: false, // Not available in HrRoleGrant context
		}
		setRevokeDialogMember(member)
	}

	const canEditRole = (role: HrRoleGrant): boolean => {
		if (!role.isActive) return false
		if (role.grantedBy === 'leadership-inference') return false
		if (role.role === 'hr_admin' && !canRevokeHrAdmin) return false
		const linkedMember = memberByUserId.get(role.userId)
		if (linkedMember?.role === 'CEO' && userRole !== 'admin') return false
		return true
	}

	const handleOpenChangeRole = (role: HrRoleGrant) => {
		setChangeRoleTarget(role)
		setChangeRoleValue(role.role)
	}

	const handleSubmitChangeRole = async () => {
		if (!changeRoleTarget) return
		if (changeRoleValue === changeRoleTarget.role) {
			setChangeRoleTarget(null)
			return
		}

		const linkedMember = memberByUserId.get(changeRoleTarget.userId)
		const characterId = linkedMember?.characterId || changeRoleTarget.characterId
		const characterName =
			linkedMember?.mainCharacterName ||
			linkedMember?.characterName ||
			changeRoleTarget.characterName ||
			changeRoleTarget.userId

		try {
			await revokeMutation.mutateAsync({
				roleId: changeRoleTarget.id,
				corporationId: changeRoleTarget.corporationId,
			})
			await grantMutation.mutateAsync({
				corporationId: changeRoleTarget.corporationId,
				userId: changeRoleTarget.userId,
				characterId,
				characterName,
				role: changeRoleValue,
			})
			showSuccess(t('hrpages.hrRoleUpdatedSuccessfully'))
			setChangeRoleTarget(null)
		} catch (error) {
			showError(error instanceof Error ? error.message : t('hrpages.failedToChangeHrRole'))
		}
	}

	// Main content
	return (
		<Container>
			{/* Breadcrumb Navigation */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink to="/corporations">{t('hrpages.corporations')}</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink to={`/corporations/${corporationId}/members`}>
							{corporation?.name || t('hrpages.manageCorporation')}
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>{t('hrpages.hrRoles')}</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			<PageHeader
				title={t('hrpages.hrRoleManagement')}
				description={
					<>
						<div>
							{t('hrpages.manageHrRolesFor')}
							{corp?.name || t('hrpages.thisCorporation')}
							{corp?.ticker && ` [${corp.ticker}]`}
						</div>
						{(userRole || hrRole) && (
							<div className="text-sm mt-1">
								{t('hrpages.yourRole2')}{' '}
								<span className="font-medium">
									{[userRole, hrRole]
										.filter((role, index, roles) => role !== null && roles.indexOf(role) === index)
										.map((role) => formatCorporationRoleLabel(role))
										.join(' / ')}
								</span>
							</div>
						)}
					</>
				}
				action={
					<div className="flex items-center gap-2">
						<Button onClick={() => setAssignUserDialogOpen(true)}>{t('hrpages.assignUser')}</Button>
						<Button variant="ghost" asChild>
							<Link to={`/corporations/${corporationId}/members`}>
								<ArrowLeft className="h-4 w-4" />
								{t('hrpages.backToManageCorporation')}
							</Link>
						</Button>
					</div>
				}
			/>

			{/* HR Roles Table */}
			<Card>
				<CardHeader>
					<CardTitle>{t('hrpages.hrRoles')}</CardTitle>
					<CardDescription>
						{t('hrpages.usersWithHrRolesCanAccessTheHrManagementSystem')}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{hrRoles && hrRoles.length > 0 ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t('hrpages.character')}</TableHead>
									<TableHead>{t('hrpages.role')}</TableHead>
									<TableHead>{t('hrpages.grantedBy')}</TableHead>
									<TableHead>{t('hrpages.grantedAt')}</TableHead>
									<TableHead>{t('hrpages.status')}</TableHead>
									<TableHead className="text-right">{t('hrpages.actions')}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{hrRoles.map((role) => (
									<TableRow key={role.id}>
										{(() => {
											const linkedMember = memberByUserId.get(role.userId)
											const resolvedName =
												linkedMember?.mainCharacterName ||
												linkedMember?.characterName ||
												role.characterName ||
												role.userId
											const resolvedCharacterId = linkedMember?.characterId
											return (
												<TableCell>
													<div className="flex items-center gap-3">
														<MemberAvatar
															characterId={resolvedCharacterId}
															characterName={resolvedName}
															size="sm"
														/>
														<div>
															<div className="font-medium">{resolvedName}</div>
															{resolvedCharacterId ? (
																<div className="text-xs text-muted-foreground">
																	{t('hrpages.id')}
																	{resolvedCharacterId}
																</div>
															) : (
																<div className="text-xs text-muted-foreground">
																	{t('hrpages.characterNotResolvedFromCorporationMembers')}
																</div>
															)}
														</div>
													</div>
												</TableCell>
											)
										})()}
										<TableCell>
											<HrRoleBadge role={role.role} />
										</TableCell>
										<TableCell className="text-sm">{role.grantedBy}</TableCell>
										<TableCell className="text-sm">
											{new Date(role.grantedAt).toLocaleDateString(getActiveLocale())}
										</TableCell>
										<TableCell>
											{role.isActive ? (
												<span className="text-sm text-green-600 dark:text-green-400">
													{t('hrpages.active')}
												</span>
											) : (
												<span className="text-sm text-muted-foreground">
													{t('hrpages.inactive')}
												</span>
											)}
										</TableCell>
										<TableCell className="text-right">
											<div className="inline-flex items-center gap-2">
												<Button
													variant="secondary"
													size="sm"
													onClick={() => handleOpenChangeRole(role)}
													disabled={!canEditRole(role)}
												>
													{t('hrpages.changeRole')}
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleRevokeClick(role)}
													disabled={!canEditRole(role)}
												>
													{t('hrpages.revokeHrRole')}
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<div className="text-center py-12">
							<Shield className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
							<p className="text-lg font-medium mb-2">{t('hrpages.noHrRolesGranted')}</p>
							<p className="text-sm text-muted-foreground mb-4">
								{t('hrpages.grantHrRolesToUsersFromTheCorporationMembersPage')}
							</p>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Help Text */}
			<div className="mt-8 space-y-2">
				<h3 className="text-sm font-semibold">{t('hrpages.hrRoleTypes')}</h3>
				<ul className="text-sm text-muted-foreground space-y-1">
					<li>
						<strong className="text-foreground">{t('hrpages.hrAdmin2')}</strong>
						{t('hrpages.fullHrSystemAccessCanManageApplicationsRecommendationsNotesAnd')}
					</li>
					<li>
						<strong className="text-foreground">{t('hrpages.hrReviewer2')}</strong>
						{t('hrpages.canReviewAndProcessApplicationsCanAddRecommendationsAndNotes')}
					</li>
					<li>
						<strong className="text-foreground">{t('hrpages.hrViewer2')}</strong>
						{t('hrpages.readOnlyAccessCanViewApplicationsAndRecommendationsCannotMake')}
					</li>
				</ul>
			</div>

			{/* Dialogs */}
			<Dialog open={assignUserDialogOpen} onOpenChange={setAssignUserDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('hrpages.assignHrRole')}</DialogTitle>
						<DialogDescription>
							{t('hrpages.searchForALinkedUserInThisCorporationAndAssign')}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="assign-hr-user">{t('hrpages.user')}</Label>
							<Select
								inputId="assign-hr-user"
								value={assignUserId}
								onValueChange={setAssignUserId}
								options={assignUserOptions}
								searchable
								placeholder={t('hrpages.searchUser')}
								className="w-full"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="assign-hr-role">{t('hrpages.hrRole')}</Label>
							<Select
								inputId="assign-hr-role"
								value={assignRole}
								onValueChange={(value) =>
									setAssignRole(value as 'hr_admin' | 'hr_reviewer' | 'hr_viewer')
								}
								options={[
									{ value: 'hr_admin', label: t('hrpages.hrAdmin') },
									{ value: 'hr_reviewer', label: t('hrpages.hrReviewer') },
									{ value: 'hr_viewer', label: t('hrpages.hrViewer') },
								]}
								searchable
								placeholder={t('hrpages.selectRole')}
								className="w-full"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setAssignUserDialogOpen(false)}>
							{t('hrpages.cancel')}
						</Button>
						<Button
							variant="confirm"
							onClick={handleAssignUserRole}
							disabled={!assignUserId || grantMutation.isPending}
						>
							{t('hrpages.assignRole')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{corporationId && revokeDialogMember && (
				<RevokeHrRoleDialog
					member={revokeDialogMember}
					hrRole={revokeDialogMember.hrRole || null}
					open={!!revokeDialogMember}
					onOpenChange={(open) => !open && setRevokeDialogMember(null)}
					onSubmit={handleRevokeHrRole}
					isSubmitting={revokeMutation.isPending}
				/>
			)}

			<Dialog open={!!changeRoleTarget} onOpenChange={(open) => !open && setChangeRoleTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('hrpages.changeHrRole')}</DialogTitle>
						<DialogDescription>
							{t('hrpages.updateRoleAssignmentFor')}{' '}
							{changeRoleTarget?.characterName || changeRoleTarget?.userId}.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="change-hr-role">{t('hrpages.hrRole')}</Label>
						<Select
							inputId="change-hr-role"
							value={changeRoleValue}
							onValueChange={(value) => setChangeRoleValue(value as HrRoleType)}
							options={allowedRoleOptions}
							searchable
							placeholder={t('hrpages.selectRole')}
							className="w-full"
						/>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setChangeRoleTarget(null)}>
							{t('hrpages.cancel')}
						</Button>
						<Button
							variant="confirm"
							onClick={handleSubmitChangeRole}
							disabled={!changeRoleTarget || grantMutation.isPending || revokeMutation.isPending}
						>
							{t('hrpages.saveRole')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Container>
	)
}
