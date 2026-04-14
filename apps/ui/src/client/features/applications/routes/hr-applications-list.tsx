/**
 * HR Applications List Page
 *
 * Full list of applications for a corporation with filtering and search.
 * Requires HR Viewer role minimum.
 */

import { AlertCircle, ArrowLeft, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

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
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/utils'

import { useHrPermissionCheck } from '../../hr/hooks'
import { useCanAccessCorporation } from '../../corporations/hooks'
import { ApplicationStatsCard } from '../components/application-stats-card'
import { ApplicationsTable } from '../components/applications-table'
import { useApplications } from '../hooks'

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

	// Check HR permission (userId derived from authenticated session)
	const { data: permission, isLoading: permissionLoading } = useHrPermissionCheck(
		corporationId ? { corporationId } : null
	)

	// Fetch applications for this corporation
	const {
		data: applications,
		isLoading: applicationsLoading,
		error: applicationsError,
	} = useApplications({ corporationId })

	// Set page title
	usePageTitle('HR Applications')

	// Calculate statistics
	const stats = useMemo(() => {
		if (!applications) {
			return {
				total: 0,
				pending: 0,
				under_review: 0,
				accepted: 0,
				rejected: 0,
				withdrawn: 0,
			}
		}

		return {
			total: applications.length,
			pending: applications.filter((a) => a.status === 'pending').length,
			under_review: applications.filter((a) => a.status === 'under_review').length,
			accepted: applications.filter((a) => a.status === 'accepted').length,
			rejected: applications.filter((a) => a.status === 'rejected').length,
			withdrawn: applications.filter((a) => a.status === 'withdrawn').length,
		}
	}, [applications])

	// Prepare filter for table
	const tableFilters = useMemo(() => {
		return {
			status: activeFilter === 'all' ? undefined : [activeFilter as ApplicationStatus],
			search: searchTerm || undefined,
		}
	}, [activeFilter, searchTerm])

	// Handlers
	const handleApplicationClick = (applicationId: string) => {
		navigate(`/corporations/${corporationId}/applications/${applicationId}`)
	}

	const handleFilterChange = (filters?: { status?: ApplicationStatus[]; search?: string }) => {
		if (filters?.search !== undefined) {
			setSearchTerm(filters.search)
		}
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
						<Button variant="ghost" onClick={() => navigate(rootCorporationsPath)}>
							<ArrowLeft className="h-4 w-4" />
							Back to {rootCorporationsLabel}
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
					<Button
						variant="ghost"
						onClick={() => navigate(showMembersNavigation ? membersPath : '/corporations')}
					>
						<ArrowLeft className="h-4 w-4" />
						{showMembersNavigation ? 'Back to Members' : 'Back to Corporations'}
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

			{/* Filter Tabs */}
			<div className="mb-6 overflow-x-auto">
				<div className="inline-flex items-center gap-2 p-1 bg-muted rounded-lg min-w-full sm:min-w-0">
					{FILTER_TABS.map((tab) => (
						<button
							key={tab.value}
							onClick={() => setActiveFilter(tab.value)}
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

			{/* Applications Table */}
			<ApplicationsTable
				applications={applications || []}
				loading={applicationsLoading}
				onApplicationClick={(app) => handleApplicationClick(app.id)}
				filters={tableFilters}
				onFilterChange={handleFilterChange}
				canManage={permission?.hasPermission || false}
			/>

			{/* Help Text */}
			{applications && applications.length > 0 && (
				<div className="mt-8 text-center">
					<p className="text-sm text-muted-foreground">
						Click on any application to view full details and take action.
					</p>
				</div>
			)}
		</Container>
	)
}
