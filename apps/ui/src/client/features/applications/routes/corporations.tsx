import { useQueries } from '@tanstack/react-query'
import { AlertCircle, Building2, FileText, Users } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useHrAccessibleCorporations } from '@/features/hr'
import { HrRoleBadge } from '@/features/hr/components/hr-role-badge'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { applicationsApi } from '../api'
import { Button } from '@/components/ui/button'
import { useCorporationAccess, useMyCorporations } from '../../corporations/hooks'

export default function CorporationsPage() {
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const {
		data: corporations = [],
		isLoading: corporationsLoading,
		error,
	} = useHrAccessibleCorporations()
	const { data: corporationAccess } = useCorporationAccess()
	const { data: myCorporations = [] } = useMyCorporations()
	const applicationQueries = useQueries({
		queries: corporations.map((corporation) => ({
			queryKey: ['hr', 'corporation-application-counts', corporation.corporationId],
			queryFn: () => applicationsApi.getApplications({ corporationId: corporation.corporationId }),
			staleTime: 1000 * 30, // 30s
			gcTime: 1000 * 60 * 2, // 2m
			enabled: !!corporation.corporationId,
		})),
	})

	usePageTitle('Corporations')

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (authLoading || corporationsLoading) {
		return (
			<div className="container mx-auto max-w-7xl px-4 py-8">
				<div className="flex items-center justify-center min-h-[320px]">
					<LoadingSpinner size="lg" />
				</div>
			</div>
		)
	}

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
						<Button variant="ghost" onClick={() => window.location.reload()}>Try Again</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (corporations.length === 0) {
		return (
			<div className="container mx-auto max-w-6xl px-4 py-8">
				<Card className="max-w-2xl mx-auto">
					<CardHeader className="text-center">
						<Building2 className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
						<CardTitle className="text-2xl">No Corporation Access</CardTitle>
						<CardDescription className="mt-2">
							You do not currently have HR Viewer/Reviewer/Admin access for any corporation.
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		)
	}

	const accessibleCorporationIds = new Set(
		(corporationAccess?.corporations ?? []).map((corp) => corp.corporationId)
	)

	return (
		<div className="container mx-auto max-w-7xl px-4 py-8">
			<PageHeader
				title="Corporations"
				description="Select a corporation to access members and application review tools"
			/>

			<div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
				{corporations.map((corporation, index) => {
					const applicationQuery = applicationQueries[index]
					const applications = applicationQuery?.data ?? []
					const myCorporation = myCorporations.find((c) => c.corporationId === corporation.corporationId)
					const corporationAccessEntry = (corporationAccess?.corporations ?? []).find(
						(corp) => corp.corporationId === corporation.corporationId
					)
					const canAccessMembers =
						user?.is_admin === true || accessibleCorporationIds.has(corporation.corporationId)
					const pendingCount = applications.filter(
						(application) => application.status === 'pending'
					).length
					const underReviewCount = applications.filter(
						(application) => application.status === 'under_review'
					).length
					const hasVisibleCounts = pendingCount > 0 || underReviewCount > 0

					return (
						<Card key={corporation.corporationId} className="h-full">
							<CardContent className="grid min-h-44 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] gap-x-3 gap-y-4 p-6">
								<div className="min-w-0 self-start">
									<CardTitle className="flex items-center gap-2">
										<img
											src={`https://images.evetech.net/corporations/${corporation.corporationId}/logo?size=64`}
											alt={corporation.name}
											className="h-5 w-5 shrink-0 rounded"
										/>
										<span className="truncate">
											{corporation.name}
											{corporation.ticker ? ` [${corporation.ticker}]` : ''}
										</span>
									</CardTitle>
									<CardDescription className="mt-1">
										Corporation ID: {corporation.corporationId}
									</CardDescription>
								</div>
								<div className="justify-self-end self-start">
									{corporationAccessEntry?.userRole === 'CEO' ? (
										<Badge variant="warning">CEO</Badge>
									) : corporationAccessEntry?.userRole === 'Director' ? (
										<Badge variant="secondary">Director</Badge>
									) : (
										<HrRoleBadge role={corporation.currentRole} showTooltip={false} />
									)}
								</div>
								<div className="self-end">
									<div className="flex flex-nowrap gap-2">
										{canAccessMembers && (
											<Button variant="ghost" asChild>
												<Link to={`/corporations/${corporation.corporationId}/members`}>
													<Users className="mr-2 h-4 w-4" />
													Members
												</Link>
											</Button>
										)}
										<Button variant={canAccessMembers ? 'ghost' : 'primary'} asChild>
											<Link to={`/corporations/${corporation.corporationId}/applications`}>
												<FileText className="mr-2 h-4 w-4" />
												Applications
											</Link>
										</Button>
									</div>
								</div>
								<div className="justify-self-end self-end">
									{applicationQuery?.isLoading ? (
										<div className="flex gap-2">
											<Skeleton className="h-5 w-20" />
										</div>
									) : hasVisibleCounts || myCorporation ? (
										<div className="flex flex-col items-end gap-2">
											{myCorporation && (
												<div className="w-44 space-y-1">
													<div className="flex items-center justify-between text-xs text-muted-foreground">
														<span>Authed Users</span>
														<span>
															{myCorporation.linkedMemberCount}/{myCorporation.memberCount}
														</span>
													</div>
													<Progress
														value={
															myCorporation.memberCount > 0
																? Math.round(
																		(myCorporation.linkedMemberCount / myCorporation.memberCount) * 100
																	)
																: 0
														}
														className="h-1.5"
													/>
												</div>
											)}
											<div className="flex flex-wrap items-center justify-end gap-2">
												{pendingCount > 0 && (
													<Badge variant="warning">Pending: {pendingCount}</Badge>
												)}
												{underReviewCount > 0 && (
													<Badge variant="secondary">Under Review: {underReviewCount}</Badge>
												)}
											</div>
										</div>
									) : null}
								</div>
							</CardContent>
						</Card>
					)
				})}
			</div>
		</div>
	)
}
