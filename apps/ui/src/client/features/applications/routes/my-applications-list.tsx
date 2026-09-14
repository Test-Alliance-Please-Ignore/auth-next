/**
 * My Applications List Page
 *
 * Dashboard showing the current user's job applications across all corporations.
 * Features statistics cards, status filtering, and application cards grid.
 */

import { AlertCircle, Briefcase } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import { ApplicationCard } from '../components/application-card'
import { ApplicationStatsCard } from '../components/application-stats-card'
import { useMyApplications } from '../hooks'

import type { ApplicationStatus } from '../api'

// ============================================================================
// Types
// ============================================================================

type FilterTab = 'all' | ApplicationStatus

// ============================================================================
// Constants
// ============================================================================

const FILTER_TABS: FilterTab[] = [
	'all',
	'pending',
	'under_review',
	'accepted',
	'completed',
	'rejected',
	'withdrawn',
]

// ============================================================================
// Component
// ============================================================================

/**
 * Main My Applications List Component
 */
export default function MyApplicationsList() {
	const { t } = useAppTranslation()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const [activeFilter, setActiveFilter] = useState<FilterTab>('all')

	// Fetch all user's applications
	const {
		data: applications,
		isLoading: applicationsLoading,
		error,
	} = useMyApplications({ enabled: !!user?.id })

	// Set page title
	usePageTitle(t('applications.list.title'))

	// Calculate statistics
	const stats = useMemo(() => {
		if (!applications) {
			return {
				total: 0,
				pending: 0,
				under_review: 0,
				accepted: 0,
				completed: 0,
				rejected: 0,
				withdrawn: 0,
			}
		}

		return {
			total: applications.length,
			pending: applications.filter((a) => a.status === 'pending').length,
			under_review: applications.filter((a) => a.status === 'under_review').length,
			accepted: applications.filter((a) => a.status === 'accepted').length,
			completed: applications.filter((a) => a.status === 'completed').length,
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
		void navigate(`/my-applications/${applicationId}`)
	}

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Loading state
	if (authLoading || applicationsLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
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
							{t('applications.list.loadFailed')}
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{error instanceof Error ? error.message : t('applications.list.unexpectedError')}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="ghost" onClick={() => window.location.reload()}>
							{t('appError.tryAgain')}
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	// Main content
	return (
		<Container>
			<PageHeader
				title={t('applications.list.title')}
				description={t('applications.list.description')}
			/>

			{/* Statistics Cards */}
			<div className="grid grid-cols-3 md:grid-cols-6 gap-4 mb-6">
				<ApplicationStatsCard
					label={t('applications.status.pending')}
					value={stats.pending}
					variant="pending"
				/>
				<ApplicationStatsCard
					label={t('applications.status.under_review')}
					value={stats.under_review}
					variant="under_review"
				/>
				<ApplicationStatsCard
					label={t('applications.status.accepted')}
					value={stats.accepted}
					variant="accepted"
				/>
				<ApplicationStatsCard
					label={t('applications.status.completed')}
					value={stats.completed}
					variant="completed"
				/>
				<ApplicationStatsCard
					label={t('applications.status.rejected')}
					value={stats.rejected}
					variant="rejected"
				/>
				<ApplicationStatsCard
					label={t('applications.status.withdrawn')}
					value={stats.withdrawn}
					variant="withdrawn"
				/>
			</div>

			{/* Filter Tabs */}
			<div className="mb-6 overflow-x-auto">
				<div className="inline-flex items-center gap-2 p-1 bg-muted rounded-lg min-w-full sm:min-w-0">
					{FILTER_TABS.map((tab) => (
						<button
							key={tab}
							onClick={() => setActiveFilter(tab)}
							aria-pressed={activeFilter === tab}
							className={cn(
								'px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
								'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
								activeFilter === tab
									? 'bg-background text-foreground shadow-sm'
									: 'text-muted-foreground hover:text-foreground hover:bg-background/50'
							)}
						>
							{tab === 'all' ? t('applications.list.all') : t(`applications.status.${tab}`)}
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
								? t('applications.list.emptyTitle')
								: t('applications.list.emptyFilteredTitle', {
										status: t(`applications.status.${activeFilter}`),
									})}
						</CardTitle>
						<CardDescription>
							{activeFilter === 'all'
								? t('applications.list.emptyDescription')
								: t('applications.list.emptyFilteredDescription')}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<p className="text-sm text-muted-foreground mb-4">
							{activeFilter === 'all'
								? t('applications.list.emptyHint')
								: t('applications.list.emptyFilteredHint')}
						</p>
						{activeFilter !== 'all' && (
							<Button variant="ghost" onClick={() => setActiveFilter('all')}>
								{t('applications.list.viewAll')}
							</Button>
						)}
					</CardContent>
				</Card>
			)}

			{/* Help Text */}
			{applications && applications.length > 0 && (
				<div className="mt-8 text-center">
					<p className="text-sm text-muted-foreground">{t('applications.list.hint')}</p>
				</div>
			)}
		</Container>
	)
}
