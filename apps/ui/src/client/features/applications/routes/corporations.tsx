import { AlertCircle, Building2, FileText, Settings2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Progress } from '@/components/ui/progress'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useHrAccessibleCorporations } from '@/features/hr'
import { HrRoleBadge } from '@/features/hr/components/hr-role-badge'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { corporationLogoUrl } from '@/lib/eve-images'

import { useCorporationAccess, useCorporationCoverage } from '../../corporations/hooks'
import { useCorporationApplicationCounts } from '../hooks'

import type { CorporationCoverageStats } from '../../corporations/api'

type CorporationTypeFilter = 'member' | 'alt' | 'special'

const CORPORATION_TYPE_OPTIONS: Array<{
	value: CorporationTypeFilter
	label: string
}> = [
	{ value: 'member', label: 'Member Corps' },
	{ value: 'alt', label: 'Alt Corps' },
	{ value: 'special', label: 'Special Purpose Corps' },
]

function matchesCorporationType(
	corporation: {
		isMemberCorporation: boolean
		isAltCorp: boolean
		isSpecialPurpose: boolean
	},
	filter: CorporationTypeFilter
): boolean {
	if (filter === 'member') return corporation.isMemberCorporation
	if (filter === 'alt') return corporation.isAltCorp
	return corporation.isSpecialPurpose
}

function CorporationCoverageBars({ coverage }: { coverage: CorporationCoverageStats }) {
	const authLinkedUnits = coverage.linkedMemberCount + coverage.unlinkedMemberCount
	const authLinkedPercentage =
		authLinkedUnits > 0 ? Math.round((coverage.linkedMemberCount / authLinkedUnits) * 100) : 0
	const esiCoveragePercentage =
		coverage.memberCount > 0
			? Math.round((coverage.validEsiKeyMemberCount / coverage.memberCount) * 100)
			: 0

	return (
		<div className="w-44 space-y-2">
			<div className="space-y-1">
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span>Auth-linked users</span>
					<span>
						{coverage.linkedMemberCount}/{authLinkedUnits}
					</span>
				</div>
				<Progress
					value={authLinkedPercentage}
					className="h-1.5 bg-red-500/35 [&>div]:bg-green-500"
				/>
			</div>
			<div className="space-y-1">
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span>Characters with valid ESI</span>
					<span>
						{coverage.validEsiKeyMemberCount}/{coverage.memberCount}
					</span>
				</div>
				<Progress
					value={esiCoveragePercentage}
					className="h-1.5 bg-red-500/35 [&>div]:bg-green-500"
				/>
			</div>
		</div>
	)
}

function CorporationCoverageBarsSkeleton() {
	return (
		<div className="w-44 space-y-2" aria-label="Loading ESI coverage">
			{Array.from({ length: 2 }, (_, index) => (
				<div className="space-y-1" key={index}>
					<div className="flex items-center justify-between gap-2">
						<Skeleton className="h-3 w-28" />
						<Skeleton className="h-3 w-10" />
					</div>
					<Skeleton className="h-1.5 w-full" />
				</div>
			))}
		</div>
	)
}

export default function CorporationsPage() {
	const { user, isAuthenticated, isLoading: authLoading, permissions } = useAuth()
	const isAuditor = useMemo(
		() => permissions.some((permission) => permission.urn === 'urn:hr:auditor'),
		[permissions]
	)
	const [corporationTypeFilter, setCorporationTypeFilter] = useState<CorporationTypeFilter | null>(
		null
	)
	const {
		data: corporations = [],
		isLoading: corporationsLoading,
		error,
	} = useHrAccessibleCorporations()
	const { data: corporationAccess } = useCorporationAccess()
	const { data: corporationCoverage, isLoading: corporationCoverageLoading } =
		useCorporationCoverage()
	const { data: applicationCounts = [], isLoading: applicationCountsLoading } =
		useCorporationApplicationCounts()
	const availableCorporationTypes = useMemo(() => {
		const types = new Set<CorporationTypeFilter>()
		for (const corporation of corporations) {
			if (corporation.isMemberCorporation) types.add('member')
			if (corporation.isAltCorp) types.add('alt')
			if (corporation.isSpecialPurpose) types.add('special')
		}
		return [...types]
	}, [corporations])
	const defaultCorporationTypeFilter = useMemo(() => {
		return (
			CORPORATION_TYPE_OPTIONS.find((option) => availableCorporationTypes.includes(option.value))
				?.value ?? null
		)
	}, [availableCorporationTypes])
	const canFilterCorporations =
		user?.is_admin === true || isAuditor || availableCorporationTypes.length > 1
	const accessibleCorporationIds = useMemo(
		() => new Set((corporationAccess?.corporations ?? []).map((corp) => corp.corporationId)),
		[corporationAccess]
	)
	const coverageByCorporationId = useMemo(
		() =>
			new Map(
				(corporationCoverage?.corporations ?? []).map((coverage) => [
					coverage.corporationId,
					coverage,
				])
			),
		[corporationCoverage]
	)

	useEffect(() => {
		if (!canFilterCorporations) return
		if (!defaultCorporationTypeFilter) return
		if (corporationTypeFilter && availableCorporationTypes.includes(corporationTypeFilter)) return

		setCorporationTypeFilter(defaultCorporationTypeFilter)
	}, [
		availableCorporationTypes,
		canFilterCorporations,
		corporationTypeFilter,
		defaultCorporationTypeFilter,
	])

	const activeCorporationTypeFilter = canFilterCorporations
		? (corporationTypeFilter ?? defaultCorporationTypeFilter)
		: null

	const visibleCorporations = useMemo(() => {
		if (!canFilterCorporations) {
			return corporations
		}
		if (!activeCorporationTypeFilter) {
			return corporations
		}
		return corporations.filter((corporation) =>
			matchesCorporationType(corporation, activeCorporationTypeFilter)
		)
	}, [activeCorporationTypeFilter, canFilterCorporations, corporations])
	const applicationCountsByCorporationId = useMemo(
		() => new Map(applicationCounts.map((counts) => [counts.corporationId, counts])),
		[applicationCounts]
	)

	usePageTitle('Corporations')

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (authLoading || corporationsLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[320px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	if (error) {
		return (
			<Container>
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
						<Button variant="ghost" onClick={() => window.location.reload()}>
							Try Again
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	if (corporations.length === 0) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto">
					<CardHeader className="text-center">
						<Building2 className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
						<CardTitle className="text-2xl">No Corporation Access</CardTitle>
						<CardDescription className="mt-2">
							You do not currently have HR Viewer/Reviewer/Admin access for any corporation.
						</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="Corporations"
				description="Select a corporation to access members and application review tools"
			/>

			{canFilterCorporations && (
				<Card className="mt-6">
					<CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
						<Label htmlFor="corporation-type-filter" className="shrink-0">
							Show corporations
						</Label>
						<Select
							inputId="corporation-type-filter"
							value={activeCorporationTypeFilter ?? CORPORATION_TYPE_OPTIONS[0].value}
							onValueChange={(value) => setCorporationTypeFilter(value as CorporationTypeFilter)}
							options={CORPORATION_TYPE_OPTIONS.filter((option) =>
								availableCorporationTypes.includes(option.value)
							)}
							className="sm:w-72"
							contentClassName="sm:w-72"
						/>
					</CardContent>
				</Card>
			)}

			{canFilterCorporations && visibleCorporations.length === 0 ? (
				<Card className="mt-6">
					<CardContent className="py-10 text-center text-muted-foreground">
						No corporations match the selected type.
					</CardContent>
				</Card>
			) : null}

			<div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
				{visibleCorporations.map((corporation) => {
					const corporationAccessEntry = (corporationAccess?.corporations ?? []).find(
						(corp) => corp.corporationId === corporation.corporationId
					)
					const coverageStats = coverageByCorporationId.get(corporation.corporationId) ?? null
					const canAccessMembers =
						user?.is_admin === true ||
						isAuditor ||
						accessibleCorporationIds.has(corporation.corporationId)
					const canViewApplications =
						corporation.isMemberCorporation &&
						(user?.is_admin === true ||
							isAuditor ||
							accessibleCorporationIds.has(corporation.corporationId))
					const canConfigureCorporation =
						user?.is_admin === true || corporationAccessEntry?.userRole === 'CEO'
					const applicationCounts = applicationCountsByCorporationId.get(corporation.corporationId)
					const pendingCount = canViewApplications ? (applicationCounts?.pending ?? 0) : 0
					const underReviewCount = canViewApplications ? (applicationCounts?.underReview ?? 0) : 0
					const hasVisibleCounts = canViewApplications && (pendingCount > 0 || underReviewCount > 0)

					return (
						<Card key={corporation.corporationId} className="h-full">
							<CardContent className="grid min-h-44 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] gap-x-3 gap-y-4 p-6">
								<div className="min-w-0 self-start">
									<CardTitle className="flex items-center gap-2">
										<img
											src={corporationLogoUrl(corporation.corporationId, 64)}
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
									<div className="flex flex-wrap gap-2">
										{canAccessMembers && (
											<Button variant="ghost" asChild className="w-full sm:w-auto">
												<Link to={`/corporations/${corporation.corporationId}/members`}>
													<Users className="h-4 w-4" />
													Members
												</Link>
											</Button>
										)}
										{canViewApplications && (
											<Button
												variant={canAccessMembers ? 'ghost' : 'primary'}
												asChild
												className="w-full sm:w-auto"
											>
												<Link to={`/corporations/${corporation.corporationId}/applications`}>
													<FileText className="h-4 w-4" />
													Applications
												</Link>
											</Button>
										)}
										{canConfigureCorporation && (
											<Button variant="ghost" asChild className="w-full sm:w-auto">
												<Link to={`/corporations/${corporation.corporationId}/settings`}>
													<Settings2 className="h-4 w-4" />
													Configure
												</Link>
											</Button>
										)}
									</div>
								</div>
								<div className="justify-self-end self-end">
									{coverageStats ||
									corporationCoverageLoading ||
									hasVisibleCounts ||
									(canViewApplications && applicationCountsLoading) ? (
										<div className="flex flex-col items-end gap-2">
											{coverageStats ? (
												<CorporationCoverageBars coverage={coverageStats} />
											) : corporationCoverageLoading ? (
												<CorporationCoverageBarsSkeleton />
											) : null}
											<div className="flex flex-wrap items-center justify-end gap-2">
												{canViewApplications && applicationCountsLoading && (
													<Skeleton className="h-5 w-20" />
												)}
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
		</Container>
	)
}
