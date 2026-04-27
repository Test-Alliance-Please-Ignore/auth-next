/**
 * Corporation Members Detail Page
 *
 * Shows all members of a specific corporation with comprehensive data.
 */

import {
	AlertCircle,
	ArrowLeft,
	Building2,
	Download,
	FileText,
	RefreshCw,
	Settings,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { useDebounce } from '@/hooks/useDebounce'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useHrRoles } from '../../hr'
import { myCorporationsApi } from '../api'
import {
	useCanAccessCorporation,
	useCorporationManager,
	useCorporationMembers,
	useMyCorporation,
} from '../hooks'

import type { CorporationMember, CorporationMembersQuery } from '../api'
import { Button } from '@/components/ui/button'

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
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const { canAccess: hasCorpAccess, userRole, corporation: accessCorp } = useCanAccessCorporation(corporationId!)
	const canAccess = hasCorpAccess || isAuditor
	const { data: corporation, isLoading: corpLoading } = useMyCorporation(corporationId!)
	const { data: hrRoles, isLoading: hrRolesLoading } = useHrRoles(corporationId!)
	const { invalidateMembers } = useCorporationManager()
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [membersQuery, setMembersQuery] = useState<CorporationMembersQuery>({
		page: 1,
		limit: 50,
		search: '',
		authFilter: 'all',
		activityFilter: 'all',
		roleFilter: 'all',
		sortField: 'role',
		sortOrder: 'asc',
	})
	const debouncedSearch = useDebounce(membersQuery.search ?? '', 300)
	const effectiveMembersQuery = useMemo(
		() => ({
			...membersQuery,
			search: debouncedSearch,
		}),
		[membersQuery, debouncedSearch]
	)
	const {
		data: membersResponse,
		isLoading: membersLoading,
		isFetching: membersFetching,
		error,
	} = useCorporationMembers(corporationId!, effectiveMembersQuery)

	// Determine capability flags based on user role
	const isLeadership = userRole === 'CEO' || userRole === 'Director' || userRole === 'admin'
	const isHrAdmin = userRole === 'hr_admin'
	const isHrOnly =
		userRole === 'hr_admin' || userRole === 'hr_reviewer' || userRole === 'hr_viewer' || isAuditor

	// Can refresh data: CEO/Director/admin only
	const canRefresh = isLeadership

	// Can export CSV: CEO/Director/admin/hr_admin
	const canExport = isLeadership || isHrAdmin

	// Can manage HR roles: CEO/admin/hr_admin
	const canManageHrRoles = useMemo(() => {
		return userRole === 'CEO' || userRole === 'admin' || userRole === 'hr_admin'
	}, [userRole])
	const grantableHrRoles = useMemo(
		() =>
			userRole === 'CEO'
				? (['hr_admin', 'hr_reviewer', 'hr_viewer'] as const)
				: (['hr_reviewer', 'hr_viewer'] as const),
		[userRole]
	)
	const canRevokeHrAdmin = useMemo(() => userRole === 'CEO' || userRole === 'admin', [userRole])

	// Can manage emeritus status: CEO/site admin
	const canManageEmeritus = userRole === 'CEO' || userRole === 'admin'

	// Can access settings: CEO/Director/admin/hr_admin
	const canAccessSettings = isLeadership || isHrAdmin

	// Check if current user has HR role
	const currentUserHrRole = useMemo(() => {
		if (!hrRoles || !user) return null
		return hrRoles.find((role) => role.userId === user.id)
	}, [hrRoles, user])

	// Enhance members with HR role data
	const membersWithHrRoles = useMemo(() => {
		const items = membersResponse?.items
		if (!items) return items
		if (!hrRoles) return items

		return items.map((member) => {
			const hrRole = hrRoles.find((role) => role.userId === member.authUserId)
			return {
				...member,
				hrRole,
			}
		})
	}, [membersResponse?.items, hrRoles])

	// Corporation info - use Corporations data with access data as fallback (for HR-only users)
	const corpName = corporation?.name ?? accessCorp?.name ?? 'Corporation'
	const corpTicker = corporation?.ticker ?? accessCorp?.ticker
	const corpAllianceName = corporation?.allianceName

	// Set page title
	usePageTitle(
		corporation || accessCorp ? `${corpName} Members | Corporations` : 'Corporation Members'
	)

	// Handlers
	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true)
		try {
			await myCorporationsApi.refreshCorporationMembers(corporationId!)
			await invalidateMembers(corporationId!)
			showSuccess('Member data refreshed')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to refresh member list')
		} finally {
			setIsRefreshing(false)
		}
	}, [corporationId, invalidateMembers, showSuccess, showError])

	const handleMemberClick = useCallback(
		(member: CorporationMember) => {
			// Navigate to HR member profile if user has an auth account
			if (member.hasAuthAccount && member.authUserId) {
				if (isAuditor && !hasCorpAccess && !user?.is_admin) {
					navigate(`/hr/auditor/users/${member.authUserId}`, {
						state: {
							source: 'members',
							returnTo: `/corporations/${corporationId}/members`,
							corporationId,
						},
					})
					return
				}
				navigate(`/corporations/${corporationId}/members/${member.authUserId}`)
			} else {
				navigate(`/character/${member.characterId}`)
			}
		},
		[navigate, corporationId, isAuditor, hasCorpAccess, user]
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
		a.download = `${corpName}-members-${new Date().toISOString().split('T')[0]}.csv`
		a.click()
		URL.revokeObjectURL(url)

		showSuccess('Member list exported')
	}, [membersWithHrRoles, corpName, showSuccess])

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check if corporation ID is provided
	if (!corporationId) {
		return <Navigate to="/corporations" replace />
	}

	// Loading state
	if (corpLoading || hrRolesLoading || (membersLoading && !membersResponse)) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	// Access denied
	if (!canAccess) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">Access Denied</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							You don't have permission to view members of this corporation. CEO, director, or
							HR role access is required.
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
							Failed to Load Members
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{error instanceof Error ? error.message : 'An unexpected error occurred'}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center space-y-4">
						<Button variant="ghost" onClick={handleRefresh} disabled={isRefreshing}>
							<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
							{isRefreshing ? 'Refreshing...' : 'Try Again'}
						</Button>
						<div>
							<Button variant="ghost" asChild>
								<Link to="/corporations">
									<ArrowLeft className="h-4 w-4" />
									Return to Corporations
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</Container>
		)
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
						<BreadcrumbPage>{corpName}</BreadcrumbPage>
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
							{corpName} Members
						</h1>
						<p className="text-muted-foreground mt-2">
							View and manage all members of{' '}
							{corpTicker ? `[${corpTicker}]` : 'this corporation'}
							{corpAllianceName && ` • Alliance: ${corpAllianceName}`}
						</p>
						{userRole && (
							<p className="text-sm text-muted-foreground mt-1">
								Your role: <span className="font-medium">{userRole}</span>
							</p>
						)}
					</div>
					<div className="flex gap-2">
						{canRefresh && (
							<Button variant="ghost" onClick={handleRefresh} disabled={isRefreshing}>
								<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
								{isRefreshing ? 'Refreshing...' : 'Refresh'}
							</Button>
						)}
						{canExport && (
							<Button variant="ghost"
								onClick={handleExport}
								disabled={!membersWithHrRoles || membersWithHrRoles.length === 0}
							>
								<Download className="h-4 w-4" />
								Export CSV
							</Button>
						)}
						<Button variant="ghost" asChild>
							<Link to="/corporations">
								<ArrowLeft className="h-4 w-4" />
								Back
							</Link>
						</Button>
					</div>
				</div>
			</div>

			{/* HR Navigation - Show if user has HR role, is CEO, or is site admin */}
			{(currentUserHrRole || canManageHrRoles || user?.is_admin) && (
				<Card className="mb-6 bg-primary/5 border-primary/20">
					<CardHeader>
						<CardTitle className="text-lg flex items-center gap-2">
							<Settings className="h-5 w-5" />
							HR Management
						</CardTitle>
							<CardDescription>
								{isHrOnly && !isLeadership
									? `You have ${(userRole ?? 'hr_auditor').replace('_', ' ')} access for this corporation`
									: userRole === 'CEO'
										? 'You have CEO access to all HR features'
										: 'You have site admin access to all HR features'}
							</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="flex flex-wrap gap-2">
							<Button variant="primary" asChild>
								<Link to={`/corporations/${corporationId}/applications`}>
									<FileText className="h-4 w-4" />
									Review Applications
								</Link>
							</Button>
							{canManageHrRoles && (
								<Button variant="ghost" asChild>
									<Link to={`/corporations/${corporationId}/hr/roles`}>
										<Settings className="h-4 w-4" />
										Manage HR Roles
									</Link>
								</Button>
							)}
							{canAccessSettings && (
								<Button variant="ghost" asChild>
									<Link to={`/corporations/${corporationId}/settings`}>
										<Settings className="h-4 w-4" />
										Corporation Settings
									</Link>
								</Button>
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
				<CorporationMembersTable
					members={membersWithHrRoles ?? []}
					loading={membersLoading || membersFetching}
					onMemberClick={handleMemberClick}
					onLinkAccount={handleLinkAccount}
					showActions={true}
					canManageHrRoles={canManageHrRoles}
					grantableHrRoles={[...grantableHrRoles]}
					canRevokeHrAdmin={canRevokeHrAdmin}
					canManageEmeritus={canManageEmeritus}
					corporationId={corporationId!}
					query={membersQuery}
					onQueryChange={setMembersQuery}
					pagination={membersResponse?.pagination}
					summary={membersResponse?.summary}
				/>
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
		</Container>
	)
}
