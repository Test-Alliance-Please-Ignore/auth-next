/**
 * HR Applications List Page
 *
 * Full list of applications for a corporation with filtering and search.
 * Requires HR Viewer role minimum.
 */

import { AlertCircle, ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/utils'

import { useHrPermissionCheck } from '../../hr/hooks'
import { useCanAccessCorporation } from '../../corporations/hooks'
import { ApplicationStatsCard } from '../components/application-stats-card'
import { ApplicationsTable } from '../components/applications-table'
import { useApplicationsPaged } from '../hooks'

import type { ApplicationStatus } from '../api'
import { Button } from '@/components/ui/button'

// ============================================================================
// Types
// ============================================================================

type FilterTab = 'all' | ApplicationStatus

interface FilterTabConfig {
	label: string
	value: FilterTab
}

// ============================================================================
// Constants
// ============================================================================

const FILTER_TABS: FilterTabConfig[] = [
	{ label: 'All', value: 'all' },
	{ label: 'Pending', value: 'pending' },
	{ label: 'Under Review', value: 'under_review' },
	{ label: 'Accepted', value: 'accepted' },
	{ label: 'Rejected', value: 'rejected' },
]

// ============================================================================
// Component
// ============================================================================

/**
 * HR Applications List with filtering and search
 */
export default function HrApplicationsList() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { canAccess: hasCorporationAccess, isLoading: corporationAccessLoading } =
		useCanAccessCorporation(corporationId ?? '')

	// Local state
	const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
	const [searchTerm, setSearchTerm] = useState('')
	const [debouncedSearch, setDebouncedSearch] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(10)

	// Check HR permission (userId derived from authenticated session)
	const { data: permission, isLoading: permissionLoading } = useHrPermissionCheck(
		corporationId ? { corporationId } : null
	)

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchTerm)
			setPage(1)
		}, 400)
		return () => clearTimeout(timer)
	}, [searchTerm])

	const offset = (page - 1) * pageSize

	// Fetch applications for this corporation (server-side paginated/filterable)
	const {
		data: applicationsResult,
		isLoading: applicationsLoading,
		error: applicationsError,
	} = useApplicationsPaged({
		corporationId,
		status: activeFilter === 'all' ? undefined : (activeFilter as ApplicationStatus),
		search: debouncedSearch.trim() || undefined,
		limit: pageSize,
		offset,
	})

	// Set page title
	usePageTitle('HR Applications')

	const applications = applicationsResult?.items ?? []
	const stats = useMemo(
		() => ({
			pending: applicationsResult?.counts.pending ?? 0,
			under_review: applicationsResult?.counts.under_review ?? 0,
			accepted: applicationsResult?.counts.accepted ?? 0,
			rejected: applicationsResult?.counts.rejected ?? 0,
			withdrawn: applicationsResult?.counts.withdrawn ?? 0,
		}),
		[applicationsResult]
	)

	// Handlers
	const handleApplicationClick = (applicationId: string) => {
		navigate(`/corporations/${corporationId}/applications/${applicationId}`)
	}

	const handleStatusFilterChange = (status: FilterTab) => {
		setActiveFilter(status)
		setPage(1)
	}

	const showMembersNavigation = user?.is_admin || hasCorporationAccess
	const rootCorporationsPath = '/corporations'
	const rootCorporationsLabel = 'Corporations'
	const membersPath = `/corporations/${corporationId}/members`

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check corporation ID
	if (!corporationId) {
		return <Navigate to="/corporations" replace />
	}

	// Loading state
	if (authLoading || permissionLoading || applicationsLoading || corporationAccessLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	// Access denied - no HR role
	// Check permission - site admins always have access
	if (!permission?.hasPermission && !user?.is_admin) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">Access Denied</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							You don't have HR permissions for this corporation. Contact an HR Admin to request
							access.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button asChild variant="ghost">
							<Link to={rootCorporationsPath}>
								<ArrowLeft className="h-4 w-4" />
								Back to {rootCorporationsLabel}
							</Link>
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	// Error state
	if (applicationsError) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							Failed to Load Applications
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{applicationsError instanceof Error
								? applicationsError.message
								: 'An unexpected error occurred'}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" onClick={() => window.location.reload()}>Try Again</Button>
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
						<BreadcrumbLink to={rootCorporationsPath}>{rootCorporationsLabel}</BreadcrumbLink>
					</BreadcrumbItem>
					{showMembersNavigation && (
						<>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbLink to={membersPath}>Members</BreadcrumbLink>
							</BreadcrumbItem>
						</>
					)}
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>Applications</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* Header */}
			<PageHeader
				title="HR Applications"
				description="Review and manage job applications to your corporation"
				action={
					<Button asChild variant="ghost">
						<Link to={showMembersNavigation ? membersPath : '/corporations'}>
							<ArrowLeft className="h-4 w-4" />
							{showMembersNavigation ? 'Back to Members' : 'Back to Corporations'}
						</Link>
					</Button>
				}
			/>

			{/* Statistics Cards */}
			<div className="grid grid-cols-3 md:grid-cols-5 gap-4 mb-6">
				<ApplicationStatsCard label="Pending" value={stats.pending} variant="pending" />
				<ApplicationStatsCard
					label="Under Review"
					value={stats.under_review}
					variant="under_review"
				/>
				<ApplicationStatsCard label="Accepted" value={stats.accepted} variant="accepted" />
				<ApplicationStatsCard label="Rejected" value={stats.rejected} variant="rejected" />
				<ApplicationStatsCard label="Withdrawn" value={stats.withdrawn} variant="withdrawn" />
			</div>

			<div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
				<div className="overflow-x-auto lg:flex-1">
					<div className="inline-flex items-center gap-2 rounded-lg bg-muted p-1 min-w-full sm:min-w-0">
						{FILTER_TABS.map((tab) => (
							<button
								key={tab.value}
								onClick={() => handleStatusFilterChange(tab.value)}
								className={cn(
									'px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
									'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
									activeFilter === tab.value
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground hover:bg-background/50'
								)}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>
				<Input
					value={searchTerm}
					onChange={(event) => setSearchTerm(event.target.value)}
					placeholder="Search character or attached alt name..."
					className="w-full lg:ml-auto lg:max-w-md"
				/>
			</div>

			{/* Applications Table */}
			<ApplicationsTable
				applications={applications}
				loading={applicationsLoading}
				getApplicationHref={(app) => `/corporations/${corporationId}/applications/${app.id}`}
				onApplicationClick={(app) => handleApplicationClick(app.id)}
				canManage={permission?.hasPermission || false}
				totalCount={applicationsResult?.total ?? 0}
				page={page}
				pageSize={pageSize}
				onPageChange={setPage}
				onPageSizeChange={(nextPageSize) => {
					setPageSize(nextPageSize)
					setPage(1)
				}}
			/>

			{/* Help Text */}
			{(applicationsResult?.total ?? 0) > 0 && (
				<div className="mt-8 text-center">
					<p className="text-sm text-muted-foreground">
						Click on any application to view full details and take action.
					</p>
				</div>
			)}
		</Container>
	)
}
