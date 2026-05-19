import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { LoadingPage } from '@/components/ui/loading'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { SessionStatsGrid } from '../components/session-stats-grid'
import { ShipDistributionChart } from '../components/ship-distribution-chart'
import { StatsRangePicker, useRangeFromSearchParams } from '../components/stats-range-picker'
import { useCharacterStats } from '../hooks'
import { formatDuration } from '../utils/format'

export default function CharacterStats() {
	const { characterId } = useParams<{ characterId: string }>()
	usePageTitle('Character Stats')
	const { range } = useRangeFromSearchParams()

	const { data, isLoading } = useCharacterStats(characterId, range)

	if (!characterId) return <Navigate to="/fleet-tracking/stats" replace />

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
					<h1 className="text-2xl font-semibold">{data?.characterName ?? characterId}</h1>
					<p className="text-sm text-muted-foreground mt-1">
						{data?.corporationName ? (
							<>
								Corp:{' '}
								<Link
									to={`/fleet-tracking/stats/corporations/${data.corporationId}`}
									className="hover:underline"
								>
									{data.corporationName}
								</Link>
							</>
						) : (
							<>Corp: —</>
						)}
					</p>
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
							{ label: 'Fleets joined', value: data.totals.fleetsJoined },
							{
								label: 'Time in fleet',
								value: formatDuration(data.totals.minutesInFleet * 60_000),
							},
							{ label: "Times FC'd", value: data.totals.timesFC },
							{
								label: 'Avg fleet duration',
								value:
									data.totals.avgFleetDurationMinutes != null
										? `${data.totals.avgFleetDurationMinutes}m`
										: '—',
							},
						]}
					/>

					<ShipDistributionChart
						title="Most-flown ships"
						items={data.shipsFlown.map((s) => ({
							shipTypeId: s.shipTypeId,
							shipTypeName: s.shipTypeName,
							totalMinutes: s.totalMinutes,
						}))}
					/>

					<Card>
						<CardContent className="p-0">
							{data.recentSessions.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">
									No recent fleets for this character in range.
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Date</TableHead>
											<TableHead>Fleet name</TableHead>
											<TableHead>Role</TableHead>
											<TableHead>Ships flown</TableHead>
											<TableHead>Duration</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.recentSessions.map((s) => (
											<TableRow key={s.sessionId}>
												<TableCell>
													{new Date(s.startedAt).toLocaleDateString()}
												</TableCell>
												<TableCell>
													<Link to={`/fleet-tracking/${s.sessionId}`} className="hover:underline">
														{s.sessionName}
													</Link>
												</TableCell>
												<TableCell>{s.wasFC ? 'FC' : 'Member'}</TableCell>
												<TableCell>{s.shipsFlown}</TableCell>
												<TableCell>{formatDuration(s.totalMinutes * 60_000)}</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</Container>
	)
}
