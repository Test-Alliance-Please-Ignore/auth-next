/**
 * My Corporations List Page
 *
 * Main page showing all corporations where the user has CEO/director access.
 */

import { AlertCircle, Building2, ChevronRight, Shield, Star, Users } from 'lucide-react'
import { useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useCorporationAccess, useCorporationManager, useMyCorporations } from '../hooks'

/**
 * Loading skeleton for corporation cards
 */
function CorporationCardSkeleton() {
	return (
		<Card>
			<CardHeader>
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-4 w-32 mt-2" />
			</CardHeader>
			<CardContent className="space-y-4">
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-10 w-full" />
			</CardContent>
		</Card>
	)
}

/**
 * Corporation card component
 */
function CorporationCard({ corporation }: { corporation: any }) {
	const linkPercentage = Math.round(
		(corporation.linkedMemberCount / corporation.memberCount) * 100
	)

	return (
		<Card className="hover:shadow-lg transition-shadow">
			<CardHeader>
				<div className="flex items-start justify-between">
					<div>
						<CardTitle className="text-xl">
							<span className="flex items-center gap-2">
								<Building2 className="h-5 w-5" />
								{corporation.name} [{corporation.ticker}]
							</span>
						</CardTitle>
						{corporation.allianceName && (
							<CardDescription className="mt-1">
								Alliance: {corporation.allianceName}
							</CardDescription>
						)}
					</div>
					<div>
						{corporation.userRole === 'CEO' && (
							<Badge variant="default" className="bg-yellow-500">
								<Star className="mr-1 h-3 w-3" />
								CEO
							</Badge>
						)}
						{corporation.userRole === 'Director' && (
							<Badge variant="secondary">
								<Shield className="mr-1 h-3 w-3" />
								Director
							</Badge>
						)}
						{corporation.userRole === 'Both' && (
							<div className="space-y-1">
								<Badge variant="default" className="bg-yellow-500">
									<Star className="mr-1 h-3 w-3" />
									CEO
								</Badge>
								<Badge variant="secondary" className="ml-1">
									<Shield className="mr-1 h-3 w-3" />
									Director
								</Badge>
							</div>
						)}
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Member Statistics */}
				<div className="grid grid-cols-2 gap-4">
					<div>
						<div className="text-sm text-muted-foreground">Total Members</div>
						<div className="text-2xl font-bold flex items-center gap-2">
							<Users className="h-5 w-5" />
							{corporation.memberCount}
						</div>
					</div>
					<div>
						<div className="text-sm text-muted-foreground">Auth Status</div>
						<div className="text-sm">
							<span className="text-green-500">{corporation.linkedMemberCount}</span>
							<span className="text-muted-foreground"> / </span>
							<span className="text-yellow-500">{corporation.unlinkedMemberCount}</span>
						</div>
						<Progress value={linkPercentage} className="mt-1 h-2" />
						<div className="text-xs text-muted-foreground mt-1">{linkPercentage}% linked</div>
					</div>
				</div>

				{/* Warning for low link rate */}
				{linkPercentage < 50 && (
					<div className="flex items-center gap-2 p-2 bg-yellow-500/10 rounded-md">
						<AlertCircle className="h-4 w-4 text-yellow-500" />
						<span className="text-sm text-yellow-600 dark:text-yellow-400">
							{corporation.unlinkedMemberCount} members need auth accounts linked
						</span>
					</div>
				)}

				{/* View Members Button */}
				<Link to={`/my-corporations/${corporation.corporationId}/members`}>
					<Button className="w-full" variant="default">
						View Members
						<ChevronRight className="ml-2 h-4 w-4" />
					</Button>
				</Link>
			</CardContent>
		</Card>
	)
}

/**
 * Main My Corporations List Component
 */
export default function MyCorporationsList() {
	usePageTitle('My Corporations')

	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { data: access, isLoading: accessLoading } = useCorporationAccess()
	const { data: corporations, isLoading: corporationsLoading, error } = useMyCorporations()
	const { prefetchMembers } = useCorporationManager()

	// Prefetch member data for all corporations
	useEffect(() => {
		if (corporations && corporations.length > 0) {
			// Prefetch the first corporation's members for faster navigation
			prefetchMembers(corporations[0].corporationId)
		}
	}, [corporations, prefetchMembers])

	// Check authentication
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	// Check if user has access
	if (!accessLoading && access && !access.hasAccess) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto">
					<CardHeader className="text-center">
						<Building2 className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
						<CardTitle className="text-2xl">No Corporation Access</CardTitle>
						<CardDescription className="mt-2">
							You don't have CEO or director access to any managed corporations. This feature is
							only available to corporation leadership.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-center">
						<p className="text-sm text-muted-foreground mb-4">
							If you believe you should have access, please ensure:
						</p>
						<ul className="text-sm text-left max-w-md mx-auto space-y-2">
							<li className="flex items-start gap-2">
								<span className="text-muted-foreground">•</span>
								<span>Your CEO/director character is linked to your account</span>
							</li>
							<li className="flex items-start gap-2">
								<span className="text-muted-foreground">•</span>
								<span>Your corporation is registered in the management system</span>
							</li>
							<li className="flex items-start gap-2">
								<span className="text-muted-foreground">•</span>
								<span>Your director status has been verified recently</span>
							</li>
						</ul>
						<div className="mt-6">
							<Link to="/dashboard">
								<Button variant="outline">Return to Dashboard</Button>
							</Link>
						</div>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Loading state
	if (accessLoading || corporationsLoading) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<div className="mb-8">
					<h1 className="text-3xl font-bold flex items-center gap-3">
						<Building2 className="h-8 w-8" />
						My Corporations
					</h1>
					<p className="text-muted-foreground mt-2">Loading your corporation data...</p>
				</div>
				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
					<CorporationCardSkeleton />
					<CorporationCardSkeleton />
					<CorporationCardSkeleton />
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
							Failed to Load Corporations
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

	// No corporations (shouldn't happen if access check passed, but just in case)
	if (!corporations || corporations.length === 0) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto">
					<CardHeader className="text-center">
						<Building2 className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
						<CardTitle className="text-2xl">No Corporations Found</CardTitle>
						<CardDescription className="mt-2">
							We couldn't find any corporations where you have leadership access.
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		)
	}

	// Main content
	return (
		<div className="container mx-auto max-w-6xl px-4 py-8">
			{/* Header */}
			<div className="mb-8">
				<h1 className="text-3xl font-bold flex items-center gap-3">
					<Building2 className="h-8 w-8" />
					My Corporations
				</h1>
				<p className="text-muted-foreground mt-2">
					Manage corporations where you have CEO or director access
				</p>
			</div>

			{/* Summary Statistics */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
				<Card className="p-4">
					<div className="text-sm text-muted-foreground">Corporations</div>
					<div className="text-2xl font-bold">{corporations.length}</div>
				</Card>
				<Card className="p-4">
					<div className="text-sm text-muted-foreground">Total Members</div>
					<div className="text-2xl font-bold">
						{corporations.reduce((sum, corp) => sum + corp.memberCount, 0)}
					</div>
				</Card>
				<Card className="p-4">
					<div className="text-sm text-muted-foreground">Linked Members</div>
					<div className="text-2xl font-bold text-green-500">
						{corporations.reduce((sum, corp) => sum + corp.linkedMemberCount, 0)}
					</div>
				</Card>
				<Card className="p-4">
					<div className="text-sm text-muted-foreground">Unlinked Members</div>
					<div className="text-2xl font-bold text-yellow-500">
						{corporations.reduce((sum, corp) => sum + corp.unlinkedMemberCount, 0)}
					</div>
				</Card>
			</div>

			{/* Corporation Cards Grid */}
			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
				{corporations.map((corporation) => (
					<CorporationCard key={corporation.corporationId} corporation={corporation} />
				))}
			</div>

			{/* Help Text */}
			<div className="mt-8 text-center">
				<p className="text-sm text-muted-foreground">
					Only showing managed corporations where you have CEO or director roles.
				</p>
				<p className="text-sm text-muted-foreground mt-1">
					Click "View Members" to see all corporation members and their auth status.
				</p>
			</div>
		</div>
	)
}