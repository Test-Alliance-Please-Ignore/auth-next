import { Link } from 'react-router'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { useCorporationAccess } from '@/features/corporations'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
import { corporationLogoUrl } from '@/lib/eve-images'

import { FleetsPerDayChart } from '../components/fleets-per-day-chart'
import { RankingList } from '../components/ranking-list'
import { SessionStatsGrid } from '../components/session-stats-grid'
import { ShipDistributionChart } from '../components/ship-distribution-chart'
import { StatsEntitySearch } from '../components/stats-entity-search'
import { StatsRangePicker, useRangeFromSearchParams } from '../components/stats-range-picker'
import { useStatsOverview } from '../hooks'
import { formatDuration } from '../utils/format'

export default function StatsOverview() {
	const { t } = useAppTranslation()

	usePageTitle(t('fleetTracking.fleetTrackingStats'))
	const { isAdmin, hasPermission } = useUserPermissions()
	const canView = isAdmin || hasPermission('urn:fleet-tracking:view-all')
	const { data: corporationAccess, isLoading: corporationAccessLoading } = useCorporationAccess()
	const { range } = useRangeFromSearchParams()
	const memberCorporations =
		corporationAccess?.corporations.filter(
			(corp) =>
				corp.isMemberCorporation &&
				(corp.userRole === 'CEO' || corp.userRole === 'Director' || corp.userRole === 'admin')
		) ?? []
	const canViewMemberCorporationStats = !canView && memberCorporations.length > 0

	const { data, isLoading, isError } = useStatsOverview(range, { enabled: canView })

	if (!canView && corporationAccessLoading) {
		return <LoadingPage />
	}

	if (!canView && !canViewMemberCorporationStats) {
		return (
			<Container>
				<div className="py-12 text-center text-muted-foreground">
					{t('fleetTracking.youDoNotHavePermissionToViewFleetTrackingStatistics')}
				</div>
			</Container>
		)
	}

	if (canViewMemberCorporationStats) {
		return (
			<Container>
				<PageHeader
					title={t('fleetTracking.fleetTrackingStatistics')}
					description={t('fleetTracking.chooseOneOfYourCorporationsToViewFleetStats')}
				/>

				<Section>
					<Card>
						<CardHeader className="pb-3">
							<CardTitle>{t('fleetTracking.yourCorporations')}</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{memberCorporations.map((corp) => (
									<Link
										key={corp.corporationId}
										to={`/fleet-tracking/stats/corporations/${corp.corporationId}`}
										className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 transition-colors hover:bg-muted/40"
									>
										<img
											src={corporationLogoUrl(corp.corporationId, 32)}
											alt={corp.name}
											className="h-8 w-8 rounded-sm border border-border/60 shrink-0"
											loading="lazy"
										/>
										<div className="min-w-0">
											<div className="truncate font-medium">{corp.name}</div>
											<div className="text-xs text-muted-foreground">{corp.ticker}</div>
										</div>
									</Link>
								))}
							</div>
						</CardContent>
					</Card>
				</Section>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title={t('fleetTracking.fleetTrackingStatistics')}
				description={t('fleetTracking.summaryAndTrendsAcrossTrackedFleets')}
			/>

			<Section>
				<Card>
					<CardHeader className="pb-3">
						<CardTitle>{t('fleetTracking.statistics')}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-6">
						<div className="space-y-4">
							<StatsEntitySearch />
							<StatsRangePicker />
						</div>

						{isLoading ? (
							<LoadingPage />
						) : isError || !data ? (
							<div className="py-12 text-center text-sm text-muted-foreground">
								{t('fleetTracking.failedToLoadStatistics')}
							</div>
						) : (
							<div className="space-y-6">
								<SessionStatsGrid
									stats={[
										{ label: t('fleetTracking.fleets2'), value: data.totals.sessions },
										{
											label: t('fleetTracking.totalHours'),
											value: Math.round(data.totals.totalMinutes / 60),
										},
										{ label: t('fleetTracking.uniquePilots'), value: data.totals.uniquePilots },
										{ label: t('fleetTracking.totalJoins'), value: data.totals.totalJoins },
									]}
								/>
								<SessionStatsGrid
									stats={[
										{
											label: t('fleetTracking.avgFleetDuration'),
											value:
												data.totals.avgDurationMinutes != null
													? t('duration.compact.minute', {
															count: Math.round(data.totals.avgDurationMinutes),
														})
													: '—',
										},
										{
											label: t('fleetTracking.avgPeakMembers'),
											value:
												data.totals.avgPeakMembers != null
													? Math.round(data.totals.avgPeakMembers)
													: '—',
										},
										{
											label: t('fleetTracking.largestFleetEver'),
											value: data.totals.largestFleetPeak ?? '—',
										},
										{
											label: t('fleetTracking.fleetsPerDay'),
											value:
												data.sessionsPerDay.length > 0
													? (
															data.sessionsPerDay.reduce((sum, d) => sum + d.count, 0) /
															data.sessionsPerDay.length
														).toFixed(1)
													: '0',
										},
									]}
								/>

								<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
									<RankingList
										title={t('fleetTracking.topFleetCommanders')}
										items={data.topFCs}
										emptyText={t('fleetTracking.noFcsInThisRange')}
										renderItem={(r) => (
											<div className="flex items-center justify-between gap-3">
												<div className="min-w-0">
													<Link
														to={`/fleet-tracking/stats/characters/${r.characterId}`}
														className="hover:underline"
													>
														{r.characterName ?? r.characterId}
													</Link>
													<div className="text-xs text-muted-foreground">
														{formatDuration((r.minutesAsFC ?? 0) * 60_000)}
														{t('fleetTracking.active2')}
													</div>
												</div>
												<span className="text-muted-foreground">
													{r.count}
													{t('fleetTracking.sessions')}
												</span>
											</div>
										)}
									/>
									<RankingList
										title={t('fleetTracking.topPilotsByHoursInFleet')}
										items={data.topPilots}
										emptyText={t('fleetTracking.noPilotsInThisRange')}
										renderItem={(r) => (
											<div className="flex items-center justify-between">
												<Link
													to={`/fleet-tracking/stats/characters/${r.characterId}`}
													className="hover:underline"
												>
													{r.characterName ?? r.characterId}
												</Link>
												<span className="text-muted-foreground">
													{Math.round(r.minutesInFleet / 60)}
													{t('fleetTracking.h')}
													{r.minutesInFleet % 60}
													{t('fleetTracking.m')}
												</span>
											</div>
										)}
									/>
									<RankingList
										title={t('fleetTracking.topCorporations')}
										items={data.topCorps}
										emptyText={t('fleetTracking.noCorporationData')}
										renderItem={(r) => (
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-2 min-w-0">
													<img
														src={corporationLogoUrl(r.corporationId, 32)}
														alt={r.corporationName ?? r.corporationId}
														className="h-5 w-5 rounded-sm border border-border/60 shrink-0"
														loading="lazy"
													/>
													<Link
														to={`/fleet-tracking/stats/corporations/${r.corporationId}`}
														className="hover:underline truncate"
													>
														{r.corporationName ?? r.corporationId}
													</Link>
												</div>
												<span className="text-muted-foreground">
													{r.pilots}
													{t('fleetTracking.pilots')}
												</span>
											</div>
										)}
									/>
									<ShipDistributionChart
										title={t('fleetTracking.mostFlownShips')}
										items={data.topShips.map((s) => ({
											shipTypeId: s.shipTypeId,
											shipTypeName: s.shipTypeName,
											totalMinutes: s.totalMinutes,
										}))}
									/>
								</div>

								<FleetsPerDayChart data={data.sessionsPerDay} />
							</div>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
