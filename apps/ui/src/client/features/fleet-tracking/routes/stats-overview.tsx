import { Link } from 'react-router-dom'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { corporationLogoUrl } from '@/lib/eve-images'
import { RankingList } from '../components/ranking-list'
import { FleetsPerDayChart } from '../components/fleets-per-day-chart'
import { SessionStatsGrid } from '../components/session-stats-grid'
import { StatsEntitySearch } from '../components/stats-entity-search'
import { ShipDistributionChart } from '../components/ship-distribution-chart'
import { StatsRangePicker, useRangeFromSearchParams } from '../components/stats-range-picker'
import { useStatsOverview } from '../hooks'

export default function StatsOverview() {
	usePageTitle('Fleet Tracking — Stats')
	const { isAdmin, hasPermission } = useUserPermissions()
	const canView = isAdmin || hasPermission('urn:fleet-tracking:view-all')
	const { range } = useRangeFromSearchParams()

	const { data, isLoading, isError } = useStatsOverview(range)

	if (!canView) {
		return (
			<Container>
				<div className="py-12 text-center text-muted-foreground">
					You do not have permission to view fleet tracking statistics.
				</div>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader title="Fleet Tracking — Statistics" description="Summary and trends across tracked fleets." />

			<Section>
				<Card>
					<CardHeader className="pb-3">
						<CardTitle>Statistics</CardTitle>
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
								Failed to load statistics.
							</div>
						) : (
							<div className="space-y-6">
								<SessionStatsGrid
									stats={[
										{ label: 'Fleets', value: data.totals.sessions },
										{ label: 'Total hours', value: Math.round(data.totals.totalMinutes / 60) },
										{ label: 'Unique pilots', value: data.totals.uniquePilots },
										{ label: 'Total joins', value: data.totals.totalJoins },
									]}
								/>
								<SessionStatsGrid
									stats={[
										{
											label: 'Avg fleet duration',
											value:
												data.totals.avgDurationMinutes != null
													? `${Math.round(data.totals.avgDurationMinutes)}m`
													: '—',
										},
										{
											label: 'Avg peak members',
											value:
												data.totals.avgPeakMembers != null
													? Math.round(data.totals.avgPeakMembers)
													: '—',
										},
										{ label: 'Largest fleet ever', value: data.totals.largestFleetPeak ?? '—' },
										{
											label: 'Fleets per day',
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
										title="Top Fleet Commanders"
										items={data.topFCs}
										emptyText="No FCs in this range."
										renderItem={(r) => (
											<div className="flex items-center justify-between">
												<Link
													to={`/fleet-tracking/stats/characters/${r.characterId}`}
													className="hover:underline"
												>
													{r.characterName ?? r.characterId}
												</Link>
												<span className="text-muted-foreground">{r.count} fleets</span>
											</div>
										)}
									/>
									<RankingList
										title="Top Pilots (by hours in fleet)"
										items={data.topPilots}
										emptyText="No pilots in this range."
										renderItem={(r) => (
											<div className="flex items-center justify-between">
												<Link
													to={`/fleet-tracking/stats/characters/${r.characterId}`}
													className="hover:underline"
												>
													{r.characterName ?? r.characterId}
												</Link>
												<span className="text-muted-foreground">
													{Math.round(r.minutesInFleet / 60)}h {r.minutesInFleet % 60}m
												</span>
											</div>
										)}
									/>
									<RankingList
										title="Top Corporations"
										items={data.topCorps}
										emptyText="No corporation data."
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
												<span className="text-muted-foreground">{r.pilots} pilots</span>
											</div>
										)}
									/>
									<ShipDistributionChart
										title="Most-flown ships"
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
