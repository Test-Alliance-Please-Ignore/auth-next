import { ArrowLeft } from 'lucide-react'
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
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

import { useMemberShipHistory, useTrackingSession } from '../hooks'
import { formatDurationBetween } from '../utils/format'

export default function MemberShipHistory() {
	const { t } = useAppTranslation()

	usePageTitle(t('fleetTracking.pilotShipHistory'))
	const { sessionId, characterId } = useParams<{ sessionId: string; characterId: string }>()

	const { data: session } = useTrackingSession(sessionId)
	const { data, isLoading, isFetching } = useMemberShipHistory(sessionId, characterId)

	if (!sessionId || !characterId) return <Navigate to="/fleet-tracking" replace />
	if (isLoading || isFetching) return <LoadingPage />

	const rows = data?.items ?? []
	const characterName = data?.characterName ?? t('fleetTracking.pilotShipHistory')
	const totalMs = rows.reduce((sum, r) => {
		const start = new Date(r.startedAt).getTime()
		const end = r.endedAt ? new Date(r.endedAt).getTime() : Date.now()
		return sum + (end - start)
	}, 0)

	return (
		<Container>
			<PageHeader
				title={characterName}
				description={t('fleetTracking.shipHistory')}
				action={
					<Button asChild variant="ghost" size="sm">
						<Link to={`/fleet-tracking/${sessionId}`}>
							<ArrowLeft className="h-4 w-4" />
							{t('fleetTracking.session')}
						</Link>
					</Button>
				}
			/>
			<div className="mb-6">
				{session && (
					<p className="text-sm text-muted-foreground">
						{t('fleetTracking.session2')}
						{session.name}
					</p>
				)}
				<p className="text-sm pt-2">
					{t('fleetTracking.timeInFleet2')}
					<span className="font-medium">{formatDuration(totalMs)}</span>
					{' • '}
					{t('fleetTracking.shipsFlown2')}
					<span className="font-medium">{data?.shipsFlown ?? 0}</span>
				</p>
			</div>

			<Card>
				<CardContent className="p-0">
					{rows.length === 0 ? (
						<div className="py-8 text-center text-sm text-muted-foreground">
							{t('fleetTracking.noShipHistoryRecordedForThisPilotInThisSession')}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t('fleetTracking.ship')}</TableHead>
									<TableHead>{t('fleetTracking.boardedInSystem')}</TableHead>
									<TableHead>{t('fleetTracking.from')}</TableHead>
									<TableHead>{t('fleetTracking.to')}</TableHead>
									<TableHead>{t('fleetTracking.duration')}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((r, idx) => (
									<TableRow key={`${r.shipTypeId}-${r.startedAt}-${idx}`}>
										<TableCell>{r.shipTypeName ?? `type #${r.shipTypeId}`}</TableCell>
										<TableCell>
											{r.systemName ?? `system #${r.solarSystemId}`}
											{r.stationId ? ` / ${r.stationName ?? `station #${r.stationId}`}` : ''}
										</TableCell>
										<TableCell>
											<EveTimeDisplay dateStr={r.startedAt} />
										</TableCell>
										<TableCell>
											{r.endedAt ? <EveTimeDisplay dateStr={r.endedAt} /> : 'current'}
										</TableCell>
										<TableCell>{formatDurationBetween(r.startedAt, r.endedAt)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<p className="text-xs text-muted-foreground mt-3">
				{t('fleetTracking.noteLocationShownIsWhereThePilotWasWhenThey')}
			</p>
		</Container>
	)
}

function formatDuration(ms: number): string {
	if (ms < 0) ms = 0
	const totalSeconds = Math.floor(ms / 1000)
	const days = Math.floor(totalSeconds / 86_400)
	const hours = Math.floor((totalSeconds % 86_400) / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	if (days > 0) return `${days}d ${hours}h`
	if (hours > 0) return `${hours}h ${minutes}m`
	if (minutes > 0) return `${minutes}m ${seconds}s`
	return `${seconds}s`
}
