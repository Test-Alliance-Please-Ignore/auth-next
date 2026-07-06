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
import { buildCorporationMembersExportUrl, myCorporationsApi } from '../api'
import {
	useCanAccessCorporation,
	formatCorporationRoleLabel,
	useCorporationManager,
	useCorporationMembers,
	useMyCorporation,
} from '../hooks'

import type { CorporationMember, CorporationMembersQuery } from '../api'
import { Button } from '@/components/ui/button'

// Lazy load the members table for code splitting
const CorporationMembersTable = lazy(() => import('../components/corporation-members-table'))
const MEMBERS_SEARCH_DEBOUNCE_MS = 400

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
	const {
		canAccess: hasCorpAccess,
		isLoading: accessLoading,
		userRole,
		corporation: accessCorp,
	} = useCanAccessCorporation(corporationId!)
	const canAccess = hasCorpAccess || isAuditor
	const { data: corporation, isLoading: corpLoading } = useMyCorporation(corporationId!)
	const { invalidateMembers } = useCorporationManager()
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [isExporting, setIsExporting] = useState(false)
	const [membersQuery, setMembersQuery] = useState<CorporationMembersQuery>({
		page: 1,
		limit: 25,
		search: '',
		authFilter: 'all',
		activityFilter: 'all',
		roleFilter: 'all',
		sortField: 'role',
		sortOrder: 'asc',
	})
	const debouncedSearch = useDebounce(membersQuery.search ?? '', MEMBERS_SEARCH_DEBOUNCE_MS)
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
		error,
	} = useCorporationMembers(corporationId!, effectiveMembersQuery, { enabled: canAccess })

	// Determine capability flags based on user role
	const isLeadership = userRole === 'CEO' || userRole === 'Director' || userRole === 'admin'
	const isHrAdmin = userRole === 'hr_admin'
	const isHrOnly =
		userRole === 'hr_admin' || userRole === 'hr_reviewer' || userRole === 'hr_viewer' || isAuditor
	const isMemberCorporation = corporation?.isMemberCorporation ?? accessCorp?.isMemberCorporation ?? false

	// Can refresh data: CEO/Director/admin only
	const canRefresh = isLeadership

	// Can export CSV: site admins or member corporations only, for leadership or HR admin
	const canExport = user?.is_admin === true || (isMemberCorporation && (isLeadership || isHrAdmin))

	// Can manage HR roles: member corp only, with CEO/admin/hr_admin access
	const canManageHrRoles = useMemo(() => {
		return (
			isMemberCorporation &&
			(userRole === 'CEO' || userRole === 'admin' || userRole === 'hr_admin')
		)
	}, [isMemberCorporation, userRole])
	const { data: hrRoles, isLoading: hrRolesLoading } = useHrRoles(corporationId!, {
		enabled: canManageHrRoles,
	})
	const grantableHrRoles = useMemo(
		() =>
			!isMemberCorporation
				? ([] as const)
				: userRole === 'CEO'
					? (['hr_admin', 'hr_reviewer', 'hr_viewer'] as const)
					: (['hr_reviewer', 'hr_viewer'] as const),
		[isMemberCorporation, userRole]
	)
	const canRevokeHrAdmin = useMemo(
		() => isMemberCorporation && (userRole === 'CEO' || userRole === 'admin'),
		[isMemberCorporation, userRole]
	)

	// Can manage emeritus status: site admins or member corporations only, CEO/site admin
	const canManageEmeritus = user?.is_admin === true || (isMemberCorporation && (userRole === 'CEO' || userRole === 'admin'))

	// Can access settings: site admins or member corporations only
	const canAccessSettings = user?.is_admin === true || (isMemberCorporation && (isLeadership || isHrAdmin))
	const canUseHrTools = isMemberCorporation

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
	const corpTypeLabel = accessCorp?.isAltCorp
		? 'Alt'
		: accessCorp?.isSpecialPurpose
			? 'Special-purpose'
			: 'Corporation'
	const esiCoverage = membersResponse?.summary?.esiCoverage ?? {
		full: 0,
		partial: 0,
		none: 0,
		unlinked: 0,
		linkedUsers: 0,
	}
	const esiCoverageTotal =
		esiCoverage.full + esiCoverage.partial + esiCoverage.none + esiCoverage.unlinked
	const esiCoveragePercentage = (value: number) =>
		esiCoverageTotal > 0 ? Math.round((value / esiCoverageTotal) * 100) : 0

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
				navigate(`/corporations/${corporationId}/members/${member.authUserId}`)
			} else {
				navigate(`/character/${member.characterId}`, {
					state: {
						source: 'corporation-members',
						backTo: `/corporations/${corporationId}/members`,
						backLabel: 'Back to Members',
					},
				})
			}
		},
		[navigate, corporationId]
	)

	const handleLinkAccount = useCallback(
		(member: CorporationMember) => {
			// This would open a modal or navigate to a linking flow
			// For now, just show a message
			showError('Account linking not yet implemented')
		},
		[showError]
	)

	const handleExport = useCallback(async () => {
		if (!corporationId || isExporting) return

		setIsExporting(true)
		try {
			const url = buildCorporationMembersExportUrl(corporationId, effectiveMembersQuery)
			const response = await fetch(url, {
				credentials: 'include',
				headers: {
					'X-Requested-With': 'XMLHttpRequest',
				},
			})

			if (!response.ok) {
				const message = await response.text()
				throw new Error(message || 'Failed to export corporation members')
			}

			const blob = await response.blob()
			const downloadUrl = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = downloadUrl

			const contentDisposition = response.headers.get('content-disposition') ?? ''
			const match = contentDisposition.match(/filename=\"?([^\";]+)\"?/i)
			a.download = match?.[1] ?? `${corpName}-members-${new Date().toISOString().split('T')[0]}.csv`
			a.click()
			URL.revokeObjectURL(downloadUrl)

			showSuccess('Member list exported')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to export corporation members')
		} finally {
			setIsExporting(false)
		}
	}, [corporationId, corpName, effectiveMembersQuery, isExporting, showError, showSuccess])

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check if corporation ID is provided
	if (!corporationId) {
		return <Navigate to="/corporations" replace />
	}

	// Loading state
	if (accessLoading || corpLoading || hrRolesLoading || (membersLoading && !membersResponse)) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	// Access denied
	if (!accessLoading && !canAccess) {
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
								Your role: <span className="font-medium">{formatCorporationRoleLabel(userRole)}</span>
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
							<Button variant="ghost" onClick={handleExport} disabled={isExporting}>
								<Download className="h-4 w-4" />
								{isExporting ? 'Exporting...' : 'Export CSV'}
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

			{/* HR Navigation - Show for any access-capable viewer */}
			<div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-stretch">
				<Card className="h-full bg-primary/5 border-primary/20">
					<CardHeader>
						<CardTitle className="text-lg flex items-center gap-2">
							<Settings className="h-5 w-5" />
							HR Management
						</CardTitle>
						{canUseHrTools ? (
							<CardDescription>
								{isHrOnly && !isLeadership
									? `You have ${formatCorporationRoleLabel(userRole ?? 'hr_viewer')} access for this corporation`
									: userRole === 'CEO'
										? 'You have CEO access to all HR features'
										: 'You have site admin access to all HR features'}
							</CardDescription>
						) : null}
					</CardHeader>
					<CardContent>
						{canUseHrTools ? (
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
						) : (
							<div className="flex min-h-[7rem] items-center justify-center rounded-lg border border-dashed border-border/60 bg-background/40 px-4 py-6 text-center">
								<div className="max-w-sm space-y-2">
									<div className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
										<AlertCircle className="h-4 w-4" />
										HR tools unavailable
									</div>
									<p className="text-sm text-muted-foreground">
										{corpTypeLabel} corporations do not expose HR management tools. You can still review
										member details and ESI coverage here.
									</p>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				<Card className="h-full w-full max-w-sm justify-self-end bg-primary/5 border-primary/20">
					<CardHeader className="pb-3">
						<CardTitle className="text-lg">ESI Coverage</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3 pt-0">
						<div className="grid grid-cols-2 gap-2">
							<div className="rounded-md border bg-background/80 px-2 py-2 text-center">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Full</div>
								<div className="text-base font-bold text-success leading-none">
									{esiCoverage.full}
								</div>
								<div className="text-[10px] text-muted-foreground">
									{esiCoveragePercentage(esiCoverage.full)}%
								</div>
							</div>
							<div className="rounded-md border bg-background/80 px-2 py-2 text-center">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Partial</div>
								<div className="text-base font-bold text-warning leading-none">
									{esiCoverage.partial}
								</div>
								<div className="text-[10px] text-muted-foreground">
									{esiCoveragePercentage(esiCoverage.partial)}%
								</div>
							</div>
							<div className="rounded-md border bg-background/80 px-2 py-2 text-center">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">None</div>
								<div className="text-base font-bold text-destructive leading-none">
									{esiCoverage.none}
								</div>
								<div className="text-[10px] text-muted-foreground">
									{esiCoveragePercentage(esiCoverage.none)}%
								</div>
							</div>
							<div className="rounded-md border bg-background/80 px-2 py-2 text-center">
								<div className="text-[11px] uppercase tracking-wide text-muted-foreground">Unlinked</div>
								<div className="text-base font-bold text-muted-foreground leading-none">
									{esiCoverage.unlinked}
								</div>
								<div className="text-[10px] text-muted-foreground">
									{esiCoveragePercentage(esiCoverage.unlinked)}%
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>

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
					loading={membersLoading && !membersResponse}
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

		</Container>
	)
}
