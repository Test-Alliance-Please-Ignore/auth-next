import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useMemberShipHistory, useTrackingSession } from '../hooks'
import { formatDurationBetween } from '../utils/format'

export default function MemberShipHistory() {
	usePageTitle('Pilot Ship History')
	const { sessionId, characterId } = useParams<{ sessionId: string; characterId: string }>()

	const { data: session } = useTrackingSession(sessionId)
	const { data, isLoading, isFetching } = useMemberShipHistory(sessionId, characterId)

	if (!sessionId || !characterId) return <Navigate to="/fleet-tracking" replace />
	if (isLoading || isFetching) return <LoadingPage />

	const rows = data?.items ?? []
	const characterName = data?.characterName ?? 'Pilot Ship History'
	const totalMs = rows.reduce((sum, r) => {
		const start = new Date(r.startedAt).getTime()
		const end = r.endedAt ? new Date(r.endedAt).getTime() : Date.now()
		return sum + (end - start)
	}, 0)

	return (
		<Container>
			<PageHeader
				title={characterName}
				description="Ship history"
				action={
					<Button asChild variant="ghost" size="sm">
						<Link to={`/fleet-tracking/${sessionId}`}>
							<ArrowLeft className="h-4 w-4" />
							Session
						</Link>
					</Button>
				}
			/>
			<div className="mb-6">
				{session && <p className="text-sm text-muted-foreground">Session: {session.name}</p>}
				<p className="text-sm pt-2">
					Time in fleet: <span className="font-medium">{formatDuration(totalMs)}</span>
					{' • '}
					Ships flown: <span className="font-medium">{rows.length}</span>
				</p>
			</div>

			<Card>
				<CardContent className="p-0">
					{rows.length === 0 ? (
						<div className="py-8 text-center text-sm text-muted-foreground">
							No ship history recorded for this pilot in this session.
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Ship</TableHead>
									<TableHead>Boarded in (system)</TableHead>
									<TableHead>From</TableHead>
									<TableHead>To</TableHead>
									<TableHead>Duration</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((r, idx) => (
									<TableRow key={`${r.shipTypeId}-${r.startedAt}-${idx}`}>
										<TableCell>{r.shipTypeName ?? `type #${r.shipTypeId}`}</TableCell>
										<TableCell>
											{r.systemName ?? `system #${r.solarSystemId}`}
											{r.stationId
												? ` / ${r.stationName ?? `station #${r.stationId}`}`
												: ''}
										</TableCell>
										<TableCell><EveTimeDisplay dateStr={r.startedAt} /></TableCell>
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
				Note: location shown is where the pilot was when they boarded each ship. Movement within
				the same ship is not tracked.
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
