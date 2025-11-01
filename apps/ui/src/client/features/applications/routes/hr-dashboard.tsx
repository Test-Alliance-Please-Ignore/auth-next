/**
 * HR Dashboard Page
 *
 * Overview dashboard for HR staff showing key metrics and recent applications.
 * Requires HR Viewer role minimum.
 */

import { AlertCircle, ArrowRight, Briefcase, Users } from 'lucide-react'
import { useMemo } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { ApplicationCard } from '../components/application-card'
import { ApplicationStatsCard } from '../components/application-stats-card'
import { useApplications } from '../hooks'
import { useHrPermissionCheck } from '../../hr/hooks'

// ============================================================================
// Component
// ============================================================================

/**
 * HR Dashboard showing metrics and recent applications
 */
export default function HrDashboard() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()

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
	usePageTitle('HR Dashboard')

	// Calculate statistics
	const stats = useMemo(() => {
		if (!applications) {
			return {
				total: 0,
				pending: 0,
				underReview: 0,
				accepted: 0,
				rejected: 0,
				acceptanceRate: 0,
			}
		}

		const pending = applications.filter((a) => a.status === 'pending').length
		const underReview = applications.filter((a) => a.status === 'under_review').length
		const accepted = applications.filter((a) => a.status === 'accepted').length
		const rejected = applications.filter((a) => a.status === 'rejected').length
		const total = applications.length

		// Calculate acceptance rate (accepted / total submitted, excluding withdrawn)
		const totalProcessed = accepted + rejected
		const acceptanceRate = totalProcessed > 0 ? Math.round((accepted / totalProcessed) * 100) : 0

		return {
			total,
			pending,
			underReview,
			accepted,
			rejected,
			acceptanceRate,
		}
	}, [applications])

	// Get recent applications (last 10, sorted by creation date)
	const recentApplications = useMemo(() => {
		if (!applications) return []

		return [...applications]
			.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
			.slice(0, 10)
	}, [applications])

	// Handlers
	const handleViewAllClick = () => {
		navigate(`/corporations/${corporationId}/hr/applications`)
	}

	const handleApplicationClick = (applicationId: string) => {
		navigate(`/corporations/${corporationId}/hr/applications/${applicationId}`)
	}

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check corporation ID
	if (!corporationId) {
		return <Navigate to="/my-corporations" replace />
	}

	// Loading state
	if (authLoading || permissionLoading || applicationsLoading) {
		return (
			<div className="container mx-auto max-w-7xl px-4 py-8">
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</div>
		)
	}

	// Access denied - no HR role
	// Check permission - site admins always have access
	if (!permission?.hasPermission && !user?.is_admin) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							Access Denied
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							You don't have HR permissions for this corporation. Contact an HR Admin to
							request access.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button variant="outline" onClick={() => navigate('/my-corporations')}>
							Back to My Corporations
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Error state
	if (applicationsError) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
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
			<PageHeader
				title="HR Dashboard"
				description="Overview of job applications and recruitment activity"
			/>

			{/* Key Metrics */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
				<ApplicationStatsCard label="Pending" value={stats.pending} variant="pending" />
				<ApplicationStatsCard
					label="Under Review"
					value={stats.underReview}
					variant="under_review"
				/>
				<ApplicationStatsCard label="Accepted" value={stats.accepted} variant="accepted" />
				<Card className="border-2 border-primary/50 bg-primary/5">
					<CardContent className="p-4">
						<div className="space-y-1">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Acceptance Rate
							</p>
							<p className="text-3xl font-bold text-primary">{stats.acceptanceRate}%</p>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Recent Applications Section */}
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-2xl font-bold text-foreground">Recent Applications</h2>
						<p className="text-muted-foreground">Latest submissions from applicants</p>
					</div>
					<Button variant="outline" onClick={handleViewAllClick}>
						View All
						<ArrowRight className="ml-2 h-4 w-4" />
					</Button>
				</div>

				{recentApplications.length > 0 ? (
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{recentApplications.map((application) => (
							<ApplicationCard
								key={application.id}
								application={application}
								onClick={() => handleApplicationClick(application.id)}
							/>
						))}
					</div>
				) : (
					<Card>
						<CardHeader className="text-center">
							<Briefcase className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
							<CardTitle>No Applications Yet</CardTitle>
							<CardDescription>
								No applications have been submitted to this corporation yet.
							</CardDescription>
						</CardHeader>
					</Card>
				)}
			</div>

			{/* Quick Actions */}
			{stats.pending > 0 && (
				<>
					<Separator className="my-8" />
					<Card className="bg-accent/5 border-accent/50">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<AlertCircle className="h-5 w-5 text-accent" />
								Action Required
							</CardTitle>
							<CardDescription>
								You have {stats.pending} pending application{stats.pending !== 1 ? 's' : ''}{' '}
								waiting for review
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button onClick={handleViewAllClick}>Review Pending Applications</Button>
						</CardContent>
					</Card>
				</>
			)}

			{/* Help Text */}
			<div className="mt-8 text-center">
				<p className="text-sm text-muted-foreground">
					Your Role: <strong>{permission.currentRole?.replace('hr_', 'HR ')}</strong>
				</p>
			</div>
		</div>
	)
}
