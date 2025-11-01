/**
 * Corporation Members Detail Page
 *
 * Shows all members of a specific corporation with comprehensive data.
 */

import { AlertCircle, ArrowLeft, Building2, Download, RefreshCw, LayoutDashboard, FileText, Settings } from 'lucide-react'
import { lazy, Suspense, useCallback, useMemo } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

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
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useHrRoles } from '../../hr'
import {
	useCanAccessCorporation,
	useCorporationManager,
	useCorporationMembers,
	useMyCorporation,
} from '../hooks'

import type { CorporationMember } from '../api'

// Lazy load the members table for code splitting
const CorporationMembersTable = lazy(() => import('../components/corporation-members-table'))

/**
 * Main Corporation Members Component
 */
export default function CorporationMembers() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const { showSuccess, showError } = useMessage()

	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { canAccess, userRole } = useCanAccessCorporation(corporationId!)
	const { data: corporation, isLoading: corpLoading } = useMyCorporation(corporationId!)
	const { data: members, isLoading: membersLoading, error } = useCorporationMembers(corporationId!)
	const { data: hrRoles, isLoading: hrRolesLoading } = useHrRoles(corporationId!)
	const { invalidateMembers } = useCorporationManager()

	// Check if current user can manage HR roles (CEOs and site admins)
	const canManageHrRoles = useMemo(() => {
		return userRole === 'CEO' || userRole === 'admin'
	}, [userRole])

	// Check if current user has HR role
	const currentUserHrRole = useMemo(() => {
		if (!hrRoles || !user) return null
		return hrRoles.find((role) => role.userId === user.id)
	}, [hrRoles, user])

	// Enhance members with HR role data
	const membersWithHrRoles = useMemo(() => {
		if (!members || !hrRoles) return members

		return members.map((member) => {
			const hrRole = hrRoles.find((role) => role.userId === member.authUserId)
			return {
				...member,
				hrRole,
			}
		})
	}, [members, hrRoles])

	// Set page title
	usePageTitle(
		corporation ? `${corporation.name} Members | My Corporations` : 'Corporation Members'
	)

	// Handlers
	const handleRefresh = useCallback(async () => {
		try {
			await invalidateMembers(corporationId!)
			showSuccess('Member list refreshed')
		} catch (error) {
			showError('Failed to refresh member list')
		}
	}, [corporationId, invalidateMembers, showSuccess, showError])

	const handleMemberClick = useCallback(
		(member: CorporationMember) => {
			// Navigate to character detail page
			navigate(`/character/${member.characterId}`)
		},
		[navigate]
	)

	const handleLinkAccount = useCallback(
		(member: CorporationMember) => {
			// This would open a modal or navigate to a linking flow
			// For now, just show a message
			showError('Account linking not yet implemented')
		},
		[showError]
	)

	const handleExport = useCallback(() => {
		if (!membersWithHrRoles) return

		// Create CSV content
		const headers = [
			'Character Name',
			'Character ID',
			'Role',
			'HR Role',
			'Auth Account',
			'Activity Status',
			'Last Login',
			'Join Date',
			'Alliance',
			'Location',
		]

		const rows = membersWithHrRoles.map((m) => [
			m.characterName,
			m.characterId,
			m.role,
			m.hrRole?.role || '',
			m.hasAuthAccount ? 'Yes' : 'No',
			m.activityStatus,
			m.lastLogin || 'Never',
			m.joinDate,
			m.allianceName || '',
			m.locationSystem || '',
		])

		const csvContent = [headers, ...rows].map((row) => row.join(',')).join('\n')

		// Download CSV
		const blob = new Blob([csvContent], { type: 'text/csv' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `${corporation?.name || 'corporation'}-members-${new Date().toISOString().split('T')[0]}.csv`
		a.click()
		URL.revokeObjectURL(url)

		showSuccess('Member list exported')
	}, [membersWithHrRoles, corporation, showSuccess])

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check if corporation ID is provided
	if (!corporationId) {
		return <Navigate to="/my-corporations" replace />
	}

	// Loading state
	if (corpLoading || membersLoading || hrRolesLoading) {
		return (
			<div className="container mx-auto max-w-7xl px-4 py-8">
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</div>
		)
	}

	// Access denied
	if (!canAccess) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">Access Denied</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							You don't have permission to view members of this corporation. CEO or director access
							is required.
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
							Failed to Load Members
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{error instanceof Error ? error.message : 'An unexpected error occurred'}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center space-y-4">
						<Button variant="outline" onClick={handleRefresh}>
							<RefreshCw className="mr-2 h-4 w-4" />
							Try Again
						</Button>
						<div>
							<Link to="/my-corporations">
								<Button variant="ghost">Return to My Corporations</Button>
							</Link>
						</div>
					</CardContent>
				</Card>
			</div>
		)
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
						<BreadcrumbPage>{corporation?.name || 'Corporation'}</BreadcrumbPage>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>Members</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* Header */}
			<div className="mb-6">
				<div className="flex items-start justify-between">
					<div>
						<h1 className="text-3xl font-bold flex items-center gap-3">
							<Building2 className="h-8 w-8" />
							{corporation?.name || 'Corporation'} Members
						</h1>
						<p className="text-muted-foreground mt-2">
							View and manage all members of {corporation?.ticker ? `[${corporation.ticker}]` : 'this corporation'}
							{corporation?.allianceName && ` • Alliance: ${corporation.allianceName}`}
						</p>
						{userRole && (
							<p className="text-sm text-muted-foreground mt-1">
								Your role: <span className="font-medium">{userRole}</span>
							</p>
						)}
					</div>
					<div className="flex gap-2">
						<Button variant="outline" onClick={handleRefresh}>
							<RefreshCw className="mr-2 h-4 w-4" />
							Refresh
						</Button>
						<Button variant="outline" onClick={handleExport} disabled={!membersWithHrRoles || membersWithHrRoles.length === 0}>
							<Download className="mr-2 h-4 w-4" />
							Export CSV
						</Button>
						<Link to="/my-corporations">
							<Button variant="ghost">
								<ArrowLeft className="mr-2 h-4 w-4" />
								Back
							</Button>
						</Link>
					</div>
				</div>
			</div>

			{/* HR Navigation - Show if user has HR role or is site admin */}
			{(currentUserHrRole || user?.is_admin) && (
				<Card className="mb-6 bg-primary/5 border-primary/20">
					<CardHeader>
						<CardTitle className="text-lg flex items-center gap-2">
							<Settings className="h-5 w-5" />
							HR Management
						</CardTitle>
						<CardDescription>
							{currentUserHrRole
								? `You have ${currentUserHrRole.role} access for this corporation`
								: 'You have site admin access to all HR features'}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="flex flex-wrap gap-2">
							<Link to={`/corporations/${corporationId}/hr/dashboard`}>
								<Button variant="default">
									<LayoutDashboard className="mr-2 h-4 w-4" />
									HR Dashboard
								</Button>
							</Link>
							<Link to={`/corporations/${corporationId}/hr/applications`}>
								<Button variant="default">
									<FileText className="mr-2 h-4 w-4" />
									Review Applications
								</Button>
							</Link>
							<Link to={`/corporations/${corporationId}/hr/roles`}>
								<Button variant="outline">
									<Settings className="mr-2 h-4 w-4" />
									Manage HR Roles
								</Button>
							</Link>
						{canManageHrRoles && (
							<Link to={`/my-corporations/${corporationId}/settings`}>
								<Button variant="outline">
									<Settings className="mr-2 h-4 w-4" />
									Corporation Settings
								</Button>
							</Link>
						)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Members Table */}
			<Suspense
				fallback={
					<Card className="p-6">
						<div className="flex items-center justify-center">
							<LoadingSpinner size="lg" />
						</div>
					</Card>
				}
			>
				{membersWithHrRoles && membersWithHrRoles.length > 0 ? (
					<CorporationMembersTable
						members={membersWithHrRoles}
						loading={membersLoading}
						onMemberClick={handleMemberClick}
						onLinkAccount={handleLinkAccount}
						showActions={true}
						canManageHrRoles={canManageHrRoles}
						corporationId={corporationId!}
					/>
				) : (
					<Card>
						<CardHeader className="text-center">
							<Building2 className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
							<CardTitle>No Members Found</CardTitle>
							<CardDescription>
								This corporation doesn't have any members in the system yet.
							</CardDescription>
						</CardHeader>
						<CardContent className="text-center">
							<p className="text-sm text-muted-foreground mb-4">
								Member data may need to be fetched from ESI.
							</p>
							<Button onClick={handleRefresh}>
								<RefreshCw className="mr-2 h-4 w-4" />
								Refresh Data
							</Button>
						</CardContent>
					</Card>
				)}
			</Suspense>

			{/* Help Text */}
			<div className="mt-8 text-center">
				<p className="text-sm text-muted-foreground">
					This view shows all members of the corporation with their current auth status.
				</p>
				<p className="text-sm text-muted-foreground mt-1">
					Members highlighted in yellow need their auth accounts linked.
				</p>
			</div>
		</div>
	)
}