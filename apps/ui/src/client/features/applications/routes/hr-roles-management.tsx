/**
 * HR Roles Management Page
 *
 * Dedicated page for managing HR roles for a corporation.
 * Requires HR Admin role to access.
 */

import { AlertCircle, ArrowLeft, Shield } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

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
import { LoadingSpinner } from '@/components/ui/loading'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	GrantHrRoleDialog,
	HrRoleBadge,
	RevokeHrRoleDialog,
	useHrRoles,
	useGrantHrRole,
	useRevokeHrRole,
	type HrRoleGrant,
	type GrantHrRoleRequest,
	type RevokeHrRoleRequest,
} from '@/features/hr'
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useCanAccessCorporation, useMyCorporation } from '../../my-corporations/hooks'
import type { CorporationMember } from '../../my-corporations'

/**
 * Main HR Roles Management Component
 */
export default function HrRolesManagement() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const { showSuccess, showError } = useMessage()

	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { canAccess, userRole } = useCanAccessCorporation(corporationId!)
	const { data: corporation, isLoading: corpLoading } = useMyCorporation(corporationId!)
	const { data: hrRoles, isLoading: hrRolesLoading, error } = useHrRoles(corporationId!)

	const [grantDialogMember, setGrantDialogMember] = useState<CorporationMember | null>(null)
	const [revokeDialogMember, setRevokeDialogMember] = useState<CorporationMember | null>(null)

	// Mutations
	const grantMutation = useGrantHrRole()
	const revokeMutation = useRevokeHrRole()

	// Check if current user can manage HR roles (CEOs and site admins)
	const canManageHrRoles = useMemo(() => {
		return userRole === 'CEO' || userRole === 'admin'
	}, [userRole])

	// Set page title
	usePageTitle(corporation ? `${corporation.name} HR Roles | HR Management` : 'HR Roles Management')

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check if corporation ID is provided
	if (!corporationId) {
		return <Navigate to="/my-corporations" replace />
	}

	// Loading state
	if (corpLoading || hrRolesLoading) {
		return (
			<div className="container mx-auto max-w-7xl px-4 py-8">
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</div>
		)
	}

	// Access denied
	if (!canAccess || !canManageHrRoles) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">Access Denied</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							You don't have permission to manage HR roles for this corporation. CEO access or site
							admin privileges are required.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Link to="/my-corporations">
							<Button variant="outline">Return to My Corporations</Button>
						</Link>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Error state
	if (error) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
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
						<Link to={`/corporations/${corporationId}/hr/dashboard`}>
							<Button variant="outline">Return to HR Dashboard</Button>
						</Link>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Handlers
	const handleGrantHrRole = async (request: GrantHrRoleRequest) => {
		try {
			await grantMutation.mutateAsync(request)
			showSuccess(`HR role granted successfully`)
			setGrantDialogMember(null)
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to grant HR role')
		}
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
		// Convert HrRoleGrant to CorporationMember format for the dialog
		const member: CorporationMember = {
			characterId: role.characterId,
			characterName: role.characterName,
			corporationId: role.corporationId,
			corporationName: corporation?.name || '',
			authUserId: role.userId,
			authUserName: role.userId, // We don't have this in HrRoleGrant
			hasAuthAccount: true,
			role: 'Member', // Default role since we don't have this in HrRoleGrant
			joinDate: role.grantedAt,
			lastEsiUpdate: role.grantedAt,
			lastLogin: undefined,
			activityStatus: 'unknown' as const,
			hrRole: role,
		}
		setRevokeDialogMember(member)
	}

	// Main content
	return (
		<div className="container mx-auto max-w-7xl px-4 py-8">
			{/* Breadcrumb Navigation */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink to="/my-corporations">My Corporations</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbLink to={`/corporations/${corporationId}/hr/dashboard`}>
							HR Dashboard
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
							Manage HR roles for {corporation?.name || 'this corporation'}
							{corporation?.ticker && ` [${corporation.ticker}]`}
						</p>
						{userRole && (
							<p className="text-sm text-muted-foreground mt-1">
								Your role: <span className="font-medium">{userRole}</span>
							</p>
						)}
					</div>
					<Link to={`/corporations/${corporationId}/hr/dashboard`}>
						<Button variant="ghost">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back
						</Button>
					</Link>
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
										<TableCell>
											<div className="flex items-center gap-3">
												<img
													src={`https://images.evetech.net/characters/${role.characterId}/portrait?size=64`}
													alt={role.characterName}
													className="w-10 h-10 rounded-full border-2 border-border"
												/>
												<div>
													<div className="font-medium">{role.characterName}</div>
													<div className="text-xs text-muted-foreground">ID: {role.characterId}</div>
												</div>
											</div>
										</TableCell>
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
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleRevokeClick(role)}
												disabled={!role.isActive}
											>
												Revoke
											</Button>
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
		</div>
	)
}
