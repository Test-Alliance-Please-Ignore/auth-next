/**
 * My Applications List Page
 *
 * Dashboard showing the current user's job applications across all corporations.
 * Features statistics cards, status filtering, and application cards grid.
 */

import { AlertCircle, Briefcase } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/utils'

import { ApplicationCard } from '../components/application-card'
import { ApplicationStatsCard } from '../components/application-stats-card'
import { useApplications } from '../hooks'

import type { ApplicationStatus } from '../api'

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
	{ label: 'Withdrawn', value: 'withdrawn' },
]

// ============================================================================
// Component
// ============================================================================

/**
 * Main My Applications List Component
 */
export default function MyApplicationsList() {
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const [activeFilter, setActiveFilter] = useState<FilterTab>('all')

	// Fetch all user's applications
	const {
		data: applications,
		isLoading: applicationsLoading,
		error,
	} = useApplications({ userId: user?.id })

	// Set page title
	usePageTitle('My Applications')

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

	// Filter applications based on active filter
	const filteredApplications = useMemo(() => {
		if (!applications) return []
		if (activeFilter === 'all') return applications
		return applications.filter((a) => a.status === activeFilter)
	}, [applications, activeFilter])

	// Handlers
	const handleApplicationClick = (applicationId: string) => {
		navigate(`/my-applications/${applicationId}`)
	}

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Loading state
	if (authLoading || applicationsLoading) {
		return (
			<div className="container mx-auto max-w-7xl px-4 py-8">
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
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
							Failed to Load Applications
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{error instanceof Error ? error.message : 'An unexpected error occurred'}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="outline" onClick={() => window.location.reload()}>
							Try Again
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Main content
	return (
		<div className="container mx-auto max-w-7xl px-4 py-8">
			{/* Header */}
			<div className="mb-8">
				<h1 className="text-3xl font-bold flex items-center gap-3">
					<Briefcase className="h-8 w-8" />
					My Applications
				</h1>
				<p className="text-muted-foreground mt-2">
					Track and manage your job applications to corporations
				</p>
			</div>

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

			{/* Applications Grid */}
			{filteredApplications.length > 0 ? (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{filteredApplications.map((application) => (
						<ApplicationCard
							key={application.id}
							application={application}
							onClick={() => handleApplicationClick(application.id)}
						/>
					))}
				</div>
			) : (
				// Empty State
				<Card>
					<CardHeader className="text-center">
						<Briefcase className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
						<CardTitle>
							{activeFilter === 'all'
								? 'No Applications Yet'
								: `No ${FILTER_TABS.find((t) => t.value === activeFilter)?.label} Applications`}
						</CardTitle>
						<CardDescription>
							{activeFilter === 'all'
								? "You haven't submitted any applications to corporations yet."
								: `You don't have any applications with this status.`}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<p className="text-sm text-muted-foreground mb-4">
							{activeFilter === 'all'
								? 'Browse corporations and submit an application to get started.'
								: 'Try selecting a different filter to view other applications.'}
						</p>
						{activeFilter !== 'all' && (
							<Button variant="outline" onClick={() => setActiveFilter('all')}>
								View All Applications
							</Button>
						)}
					</CardContent>
				</Card>
			)}

			{/* Help Text */}
			{applications && applications.length > 0 && (
				<div className="mt-8 text-center">
					<p className="text-sm text-muted-foreground">
						Click on any application to view details and track its progress.
					</p>
				</div>
			)}
		</div>
	)
}
