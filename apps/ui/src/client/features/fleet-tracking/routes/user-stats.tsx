import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { SessionStatsGrid } from '../components/session-stats-grid'
import { ShipDistributionChart } from '../components/ship-distribution-chart'
import { StatsRangePicker, useRangeFromSearchParams } from '../components/stats-range-picker'
import { useUserStats } from '../hooks'
import { formatDuration } from '../utils/format'

export default function UserStats() {
	const { userId } = useParams<{ userId: string }>()
	usePageTitle('User Stats')
	const { range } = useRangeFromSearchParams()
	const { user } = useAuth()
	const { isAdmin, hasPermission } = useUserPermissions()
	const canViewAll = isAdmin || hasPermission('urn:fleet-tracking:view-all')
	const isSelf = !!user && user.id === userId
	const canView = canViewAll || isSelf
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	useEffect(() => {
		setPage(1)
	}, [userId, range.from, range.to])

	const { data, isFetching, isLoading } = useUserStats(canView ? userId : undefined, range, {
		limit: pageSize,
		offset: (page - 1) * pageSize,
	})

	if (!userId) return <Navigate to="/fleet-tracking/stats" replace />

	if (!canView) {
		return (
			<Container>
				<PageHeader
					title="User Stats"
					action={
						<Button asChild variant="ghost" size="sm">
							<Link to="/fleet-tracking">
								<ArrowLeft className="h-4 w-4" />
								Fleet Tracking
							</Link>
						</Button>
					}
				/>
				<div className="py-12 text-center text-muted-foreground">
					You do not have permission to view this user's fleet tracking stats.
				</div>
			</Container>
		)
	}

	const mainName =
		data?.perCharacter.find((p) => p.is_primary)?.characterName ??
		data?.perCharacter[0]?.characterName ??
		userId

	return (
		<Container>
			<PageHeader
				title={mainName}
				action={
					<Button asChild variant="ghost" size="sm">
						<Link to="/fleet-tracking/stats">
							<ArrowLeft className="h-4 w-4" />
							Stats
						</Link>
					</Button>
				}
			/>
			<div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
				<div>
					<p className="text-sm text-muted-foreground mt-1">
						{data?.perCharacter.length ?? 0} character
						{(data?.perCharacter.length ?? 0) === 1 ? '' : 's'}
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
							{
								label: 'FC time',
								value: formatDuration(data.totals.minutesAsFC * 60_000),
								sublabel: `${data.totals.timesFC} periods`,
							},
							{
								label: 'Avg fleet duration',
								value:
									data.totals.avgFleetDurationMinutes != null
										? `${data.totals.avgFleetDurationMinutes}m`
										: '—',
							},
						]}
					/>

					<Card>
						<CardContent className="p-0">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Character</TableHead>
										<TableHead>Fleets</TableHead>
										<TableHead>Time in fleet</TableHead>
										<TableHead>FC'd</TableHead>
										<TableHead className="w-12" />
									</TableRow>
								</TableHeader>
								<TableBody>
									{data.perCharacter.map((c) => (
										<TableRow key={c.characterId}>
											<TableCell>
												{c.characterName}{' '}
												{c.is_primary && (
													<span className="text-xs text-muted-foreground">(main)</span>
												)}
											</TableCell>
											<TableCell>{c.stats.totals.fleetsJoined}</TableCell>
											<TableCell>
												{formatDuration(c.stats.totals.minutesInFleet * 60_000)}
											</TableCell>
											<TableCell>{c.stats.totals.timesFC}</TableCell>
											<TableCell>
												<Button asChild variant="ghost" size="sm">
													<Link to={`/fleet-tracking/stats/characters/${c.characterId}`}>
														<ArrowRight className="h-4 w-4" />
													</Link>
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>

					<ShipDistributionChart
						title="Most-flown ships (all characters)"
						items={data.shipsFlown.map((s) => ({
							shipTypeId: s.shipTypeId,
							shipTypeName: s.shipTypeName,
							totalMinutes: s.totalMinutes,
						}))}
					/>

					<Card>
						<CardContent className="p-0">
							{data.recentSessionsTotal > 0 && (
								<div className="border-b p-4">
									<UserSearchPaginationControls
										totalCount={data.recentSessionsTotal}
										page={page}
										pageSize={pageSize}
										onPageChange={setPage}
										onPageSizeChange={(nextPageSize) => {
											setPageSize(nextPageSize)
											setPage(1)
										}}
										pageSizeOptions={[10, 25, 50, 100]}
										itemLabel="fleet sessions"
										nextButtonLoading={isFetching}
									/>
								</div>
							)}
							{data.recentSessions.length === 0 ? (
								<div className="py-8 text-center text-sm text-muted-foreground">
									No recent fleets in range.
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Date</TableHead>
											<TableHead>Character</TableHead>
											<TableHead>Fleet name</TableHead>
											<TableHead>Role</TableHead>
											<TableHead>Duration</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data.recentSessions.map((s) => (
											<TableRow key={`${s.sessionId}-${s.characterId}`}>
												<TableCell>
													<EveTimeDisplay dateStr={s.startedAt} />
												</TableCell>
												<TableCell>
													<Link
														to={`/fleet-tracking/stats/characters/${s.characterId}`}
														className="hover:underline font-mono"
													>
														{s.characterId}
													</Link>
												</TableCell>
												<TableCell>
													<Link to={`/fleet-tracking/${s.sessionId}`} className="hover:underline">
														{s.sessionName}
													</Link>
												</TableCell>
												<TableCell>{s.wasFC ? 'FC' : 'Member'}</TableCell>
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
