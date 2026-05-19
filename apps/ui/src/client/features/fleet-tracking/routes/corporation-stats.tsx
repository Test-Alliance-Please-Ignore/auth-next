import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { LoadingPage } from '@/components/ui/loading'
import { usePageTitle } from '@/hooks/usePageTitle'
import { RankingList } from '../components/ranking-list'
import { SessionStatsGrid } from '../components/session-stats-grid'
import { ShipDistributionChart } from '../components/ship-distribution-chart'
import { StatsRangePicker, useRangeFromSearchParams } from '../components/stats-range-picker'
import { useCorporationStats } from '../hooks'
import { formatDuration } from '../utils/format'

export default function CorporationStats() {
	const { corpId } = useParams<{ corpId: string }>()
	usePageTitle('Corporation Stats')
	const { range } = useRangeFromSearchParams()
	const { data, isLoading } = useCorporationStats(corpId, range)

	if (!corpId) return <Navigate to="/fleet-tracking/stats" replace />

	return (
		<Container>
			<div className="mb-4">
				<Button asChild variant="ghost" size="sm">
					<Link to="/fleet-tracking/stats">
						<ArrowLeft className="h-4 w-4" />
						Stats
					</Link>
				</Button>
			</div>

			<div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
				<div>
					<h1 className="text-2xl font-semibold">
						{data?.corporationName ?? <span className="font-mono">Corp {corpId}</span>}
					</h1>
				</div>
				<StatsRangePicker />
			</div>

			{isLoading ? (
				<LoadingPage />
			) : !data ? (
				<div className="py-12 text-center text-sm text-muted-foreground">No data.</div>
			) : (
				<div className="space-y-6">
					<SessionStatsGrid
						stats={[
							{ label: 'Pilots active', value: data.totals.pilotsActive },
							{ label: 'Pilot hours', value: data.totals.pilotHours },
							{ label: 'Fleets with presence', value: data.totals.sessionsWithPresence },
							{ label: 'Avg pilots / fleet', value: data.totals.avgPilotsPerSession },
						]}
					/>

					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						<RankingList
							title="Top participating members"
							items={data.topMembers}
							emptyText="No members in this range."
							renderItem={(r) => (
								<div className="flex items-center justify-between">
									<Link
										to={`/fleet-tracking/stats/characters/${r.characterId}`}
										className="hover:underline"
									>
										{r.characterName}
									</Link>
									<span className="text-muted-foreground">
										{r.fleetsJoined} fleets • {formatDuration(r.minutesInFleet * 60_000)}
									</span>
								</div>
							)}
						/>
						<RankingList
							title="Top FCs from this corp"
							items={data.topFCs}
							emptyText="No FCs in this range."
							renderItem={(r) => (
								<div className="flex items-center justify-between">
									<Link
										to={`/fleet-tracking/stats/characters/${r.characterId}`}
										className="hover:underline"
									>
										{r.characterName}
									</Link>
									<span className="text-muted-foreground">{r.sessions} fleets</span>
								</div>
							)}
						/>
					</div>

					<ShipDistributionChart
						title="Ships flown by this corp's members"
						items={data.shipsFlown.map((s) => ({
							shipTypeId: s.shipTypeId,
							shipTypeName: s.shipTypeName,
							totalMinutes: s.totalMinutes,
						}))}
					/>
				</div>
			)}
		</Container>
	)
}
