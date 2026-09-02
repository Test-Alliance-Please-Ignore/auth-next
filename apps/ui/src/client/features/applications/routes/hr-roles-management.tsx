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
	}, [isMemberCorporation, hrRole, userRole])
	const canRevokeHrAdmin = useMemo(
		() => isMemberCorporation && (userRole === 'CEO' || userRole === 'admin'),
		[isMemberCorporation, userRole]
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
	}, [members])

	const activeRoleByUserId = useMemo(() => {
		const map = new Map<string, HrRoleGrant>()
		for (const role of hrRoles ?? []) {
			if (!role.isActive) continue
			if (!map.has(role.userId)) map.set(role.userId, role)
		}
		return map
	}, [hrRoles])

	const assignableMembers = useMemo(
		() =>
			members.filter((member) => {
				if (!member.authUserId) return false
				if (member.isBlacklisted) return false
				const existingRole = activeRoleByUserId.get(member.authUserId)
				if (!existingRole) return true
				return existingRole.role !== 'hr_admin' || canRevokeHrAdmin
			}),
		[members, activeRoleByUserId, canRevokeHrAdmin]
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
	}, [assignableMembers])

	const assignUserOptions = useMemo(
		() =>
			assignableUsers
				.map((member) => {
					const existing = member.authUserId ? activeRoleByUserId.get(member.authUserId) : undefined
					const roleHint = existing
						? `Current: ${formatCorporationRoleLabel(existing.role)}`
						: 'No HR role'
					return {
						value: member.authUserId!,
						label: member.mainCharacterName || member.characterName,
						description: roleHint,
					}
				})
				.sort((a, b) => a.label.localeCompare(b.label)),
		[assignableUsers, activeRoleByUserId]
	)
	const allowedRoleOptions = useMemo(
		() =>
			[
				{ value: 'hr_admin', label: 'HR Admin' },
				{ value: 'hr_reviewer', label: 'HR Reviewer' },
				{ value: 'hr_viewer', label: 'HR Viewer' },
			].filter((entry) => (canRevokeHrAdmin ? true : entry.value !== 'hr_admin')),
		[canRevokeHrAdmin]
	)

	// Set page title
	usePageTitle(corp ? `${corp.name} HR Roles | HR Management` : 'HR Roles Management')

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
			? "You don't have permission to manage HR roles for this corporation. CEO, HR admin, or site admin access is required."
			: 'HR roles can only be managed for member corporations.'
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">Access Denied</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{accessMessage}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" asChild>
							<Link to="/corporations">
								<ArrowLeft className="h-4 w-4" />
								Return to Corporations
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
							Failed to Load HR Roles
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{error instanceof Error ? error.message : 'An unexpected error occurred'}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" asChild>
							<Link to={`/corporations/${corporationId}/members`}>
								<ArrowLeft className="h-4 w-4" />
								Return to Manage Corporation
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
			showSuccess(`HR role granted successfully`)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to grant HR role')
		}
	}

	const handleAssignUserRole = async () => {
		if (!assignUserId) {
			showError('Select a user to assign')
			return
		}
		const member = assignableMembers.find((entry) => entry.authUserId === assignUserId)
		if (!member || !member.authUserId) {
			showError('Selected user is invalid')
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
			showSuccess(`HR role revoked successfully`)
			setRevokeDialogMember(null)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to revoke HR role')
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
			showSuccess('HR role updated successfully')
			setChangeRoleTarget(null)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to change HR role')
		}
	}

	// Main content
	return (
		<Container>
			{/* Breadcrumb Navigation */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink to="/corporations">Corporations</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink to={`/corporations/${corporationId}/members`}>
							{corporation?.name || 'Manage Corporation'}
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>HR Roles</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* Header */}
			<div className="mb-6">
				<div className="flex items-start justify-between">
					<div>
						<h1 className="text-3xl font-bold flex items-center gap-3">
							<Shield className="h-8 w-8" />
							HR Role Management
						</h1>
						<p className="text-muted-foreground mt-2">
							Manage HR roles for {corp?.name || 'this corporation'}
							{corp?.ticker && ` [${corp.ticker}]`}
						</p>
						{(userRole || hrRole) && (
							<p className="text-sm text-muted-foreground mt-1">
								Your role:{' '}
								<span className="font-medium">
									{[userRole, hrRole]
										.filter((role, index, roles) => role !== null && roles.indexOf(role) === index)
										.map((role) => formatCorporationRoleLabel(role))
										.join(' / ')}
								</span>
							</p>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Button onClick={() => setAssignUserDialogOpen(true)}>Assign User</Button>
						<Button variant="ghost" asChild>
							<Link to={`/corporations/${corporationId}/members`}>
								<ArrowLeft className="h-4 w-4" />
								Back to Manage Corporation
							</Link>
						</Button>
					</div>
				</div>
			</div>

			{/* HR Roles Table */}
			<Card>
				<CardHeader>
					<CardTitle>HR Roles</CardTitle>
					<CardDescription>
						Users with HR roles can access the HR management system for this corporation.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{hrRoles && hrRoles.length > 0 ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Character</TableHead>
									<TableHead>Role</TableHead>
									<TableHead>Granted By</TableHead>
									<TableHead>Granted At</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Actions</TableHead>
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
																	ID: {resolvedCharacterId}
																</div>
															) : (
																<div className="text-xs text-muted-foreground">
																	Character not resolved from corporation members
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
											{new Date(role.grantedAt).toLocaleDateString()}
										</TableCell>
										<TableCell>
											{role.isActive ? (
												<span className="text-sm text-green-600 dark:text-green-400">Active</span>
											) : (
												<span className="text-sm text-muted-foreground">Inactive</span>
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
													Change Role
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleRevokeClick(role)}
													disabled={!canEditRole(role)}
												>
													Revoke HR Role
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
							<p className="text-lg font-medium mb-2">No HR Roles Granted</p>
							<p className="text-sm text-muted-foreground mb-4">
								Grant HR roles to users from the corporation members page.
							</p>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Help Text */}
			<div className="mt-8 space-y-2">
				<h3 className="text-sm font-semibold">HR Role Types:</h3>
				<ul className="text-sm text-muted-foreground space-y-1">
					<li>
						<strong className="text-foreground">HR Admin:</strong> Full HR system access. Can manage
						applications, recommendations, notes, and HR roles.
					</li>
					<li>
						<strong className="text-foreground">HR Reviewer:</strong> Can review and process
						applications. Can add recommendations and notes. Cannot manage HR roles.
					</li>
					<li>
						<strong className="text-foreground">HR Viewer:</strong> Read-only access. Can view
						applications and recommendations. Cannot make changes.
					</li>
				</ul>
			</div>

			{/* Dialogs */}
			<Dialog open={assignUserDialogOpen} onOpenChange={setAssignUserDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Assign HR Role</DialogTitle>
						<DialogDescription>
							Search for a linked user in this corporation and assign an HR role.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="assign-hr-user">User</Label>
							<Select
								inputId="assign-hr-user"
								value={assignUserId}
								onValueChange={setAssignUserId}
								options={assignUserOptions}
								searchable
								placeholder="Search user..."
								className="w-full"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="assign-hr-role">HR Role</Label>
							<Select
								inputId="assign-hr-role"
								value={assignRole}
								onValueChange={(value) =>
									setAssignRole(value as 'hr_admin' | 'hr_reviewer' | 'hr_viewer')
								}
								options={[
									{ value: 'hr_admin', label: 'HR Admin' },
									{ value: 'hr_reviewer', label: 'HR Reviewer' },
									{ value: 'hr_viewer', label: 'HR Viewer' },
								]}
								searchable
								placeholder="Select role..."
								className="w-full"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setAssignUserDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="confirm"
							onClick={handleAssignUserRole}
							disabled={!assignUserId || grantMutation.isPending}
						>
							Assign Role
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
						<DialogTitle>Change HR Role</DialogTitle>
						<DialogDescription>
							Update role assignment for{' '}
							{changeRoleTarget?.characterName || changeRoleTarget?.userId}.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="change-hr-role">HR Role</Label>
						<Select
							inputId="change-hr-role"
							value={changeRoleValue}
							onValueChange={(value) => setChangeRoleValue(value as HrRoleType)}
							options={allowedRoleOptions}
							searchable
							placeholder="Select role..."
							className="w-full"
						/>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setChangeRoleTarget(null)}>
							Cancel
						</Button>
						<Button
							variant="confirm"
							onClick={handleSubmitChangeRole}
							disabled={!changeRoleTarget || grantMutation.isPending || revokeMutation.isPending}
						>
							Save Role
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Container>
	)
}
