/**
 * HR Dashboard Page
 *
 * Member-focused dashboard for HR staff showing corporation member stats,
 * a searchable/filterable members table. Clicking a row navigates to
 * the member profile page. Requires HR Viewer role minimum.
 */

import { AlertCircle, ArrowLeft, FileText } from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

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
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useHrPermissionCheck } from '../../hr/hooks'
import {
	useCanAccessCorporation,
	useCorporationMembers,
	useCorporationMemberStats,
} from '../../my-corporations/hooks'
import { HrMembersTable } from '../components/hr-members-table'
import { useApplications } from '../hooks'

// ============================================================================
// Stats Card (matches ApplicationStatsCard style)
// ============================================================================

interface StatCardProps {
	label: string
	value: number | string
	borderClass?: string
	valueClass?: string
}

function StatCard({ label, value, borderClass, valueClass }: StatCardProps) {
	return (
		<Card className={cn('border-2', borderClass ?? 'border-border bg-card')}>
			<CardContent className="p-4">
				<div className="space-y-1">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
						{label}
					</p>
					<p className={cn('text-3xl font-bold', valueClass ?? 'text-foreground')}>
						{value}
					</p>
				</div>
			</CardContent>
		</Card>
	)
}

// ============================================================================
// Component
// ============================================================================

export default function HrDashboard() {
	const { corporationId } = useParams<{ corporationId: string }>()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { canAccess: hasCorporationAccess, isLoading: corporationAccessLoading } =
		useCanAccessCorporation(corporationId ?? '')

	// Permissions
	const { data: permission, isLoading: permissionLoading } = useHrPermissionCheck(
		corporationId ? { corporationId } : null,
	)

	// Members data
	const {
		data: members,
		isLoading: membersLoading,
		error: membersError,
	} = useCorporationMembers(corporationId ?? '')
	const { data: memberStats } = useCorporationMemberStats(corporationId ?? '')

	// Pending applications count
	const { data: applications } = useApplications(
		corporationId ? { corporationId, status: 'pending' } : undefined,
	)
	const pendingCount = applications?.length ?? 0

	usePageTitle('HR Dashboard')

	const useMyCorporationsRoot = user?.is_admin || hasCorporationAccess
	const rootCorporationsPath = useMyCorporationsRoot ? '/my-corporations' : '/hr'
	const rootCorporationsLabel = useMyCorporationsRoot ? 'My Corporations' : 'HR Corporations'

	// Auth check
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (!corporationId) {
		return <Navigate to="/hr" replace />
	}

	// Loading
	if (authLoading || permissionLoading || membersLoading || corporationAccessLoading) {
		return (
			<div className="container mx-auto max-w-7xl px-4 py-8">
				<div className="flex items-center justify-center min-h-[400px]">
					<LoadingSpinner size="lg" />
				</div>
			</div>
		)
	}

	// Access denied
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
							You don't have HR permissions for this corporation. Contact an HR Admin
							to request access.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button
							variant="ghost"
							onClick={() => navigate(rootCorporationsPath)}
						>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to {rootCorporationsLabel}
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Error
	if (membersError) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<AlertCircle className="h-16 w-16 mx-auto text-red-500 mb-4" />
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">
							Failed to Load Members
						</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							{membersError instanceof Error
								? membersError.message
								: 'An unexpected error occurred'}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<Button
							variant="ghost"
							onClick={() => window.location.reload()}
						>
							Try Again
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="container mx-auto max-w-7xl px-4 py-8">
			{/* Breadcrumbs */}
			<Breadcrumb className="mb-6">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink to={rootCorporationsPath}>
							{rootCorporationsLabel}
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>HR Dashboard</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			{/* Header */}
			<PageHeader
				title="HR Dashboard"
				description="Corporation member overview and HR management"
				action={
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							onClick={() =>
								navigate(`/corporations/${corporationId}/hr/applications`)
							}
						>
							<FileText className="mr-2 h-4 w-4" />
							Applications
							{pendingCount > 0 && (
								<span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
									{pendingCount}
								</span>
							)}
						</Button>
						<Button
							variant="ghost"
							onClick={() => navigate(rootCorporationsPath)}
						>
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back
						</Button>
					</div>
				}
			/>

			{/* Statistics Cards */}
			{memberStats && (
				<div className="grid grid-cols-3 md:grid-cols-6 gap-4 mb-6">
					<StatCard
						label="Total"
						value={memberStats.total}
					/>
					<StatCard
						label="Registered"
						value={memberStats.linked}
						borderClass="border-success/50 bg-success/5"
						valueClass="text-success"
					/>
					<StatCard
						label="Unregistered"
						value={memberStats.unlinked}
						borderClass={memberStats.unlinked > 0 ? 'border-destructive/50 bg-destructive/5' : undefined}
						valueClass={memberStats.unlinked > 0 ? 'text-destructive' : undefined}
					/>
					<StatCard
						label="Active"
						value={memberStats.active}
						borderClass="border-primary/50 bg-primary/5"
						valueClass="text-primary"
					/>
					<StatCard
						label="Inactive"
						value={memberStats.inactive}
						borderClass={memberStats.inactive > 0 ? 'border-destructive/50 bg-destructive/5' : undefined}
						valueClass={memberStats.inactive > 0 ? 'text-destructive' : undefined}
					/>
					<StatCard
						label="Pending Apps"
						value={pendingCount}
						borderClass={pendingCount > 0 ? 'border-accent/50 bg-accent/5' : undefined}
						valueClass={pendingCount > 0 ? 'text-accent-foreground' : undefined}
					/>
				</div>
			)}

			{/* Members Table */}
			<HrMembersTable
				members={members ?? []}
				corporationId={corporationId}
			/>

			{/* Footer */}
			<div className="mt-6 text-center">
				<p className="text-sm text-muted-foreground">
					Your Role:{' '}
					<strong>{permission?.currentRole?.replace('hr_', 'HR ')}</strong>
					{memberStats && (
						<>
							{' · '}
							{memberStats.linkPercentage}% registered · {memberStats.activePercentage}%
							active
						</>
					)}
				</p>
			</div>
		</div>
	)
}
