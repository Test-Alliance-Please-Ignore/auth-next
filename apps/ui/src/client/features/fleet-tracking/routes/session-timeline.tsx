import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { LoadingPage } from '@/components/ui/loading'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSessionTimeline, useTrackingSession } from '../hooks'

type Filter = 'all' | 'join' | 'leave' | 'ship_change'

export default function SessionTimeline() {
	usePageTitle('Fleet Tracking Timeline')
	const { sessionId } = useParams<{ sessionId: string }>()
	const [filter, setFilter] = useState<Filter>('all')
	const [characterId, setCharacterId] = useState('')
	const [offset, setOffset] = useState(0)
	const limit = 100

	const { data: session } = useTrackingSession(sessionId)
	const { data: timeline, isLoading } = useSessionTimeline(sessionId, {
		eventType: filter === 'all' ? undefined : filter,
		characterId: characterId.trim() || undefined,
		limit,
		offset,
	})

	if (!sessionId) return <Navigate to="/fleet-tracking" replace />

	return (
		<Container>
			<div className="mb-4">
				<Button asChild variant="ghost" size="sm">
					<Link to={`/fleet-tracking/${sessionId}`}>
						<ArrowLeft className="h-4 w-4" />
						Session
					</Link>
				</Button>
			</div>

			<div className="mb-6">
				<h1 className="text-2xl font-semibold">Timeline</h1>
				{session && (
					<p className="text-sm text-muted-foreground mt-1">Session: {session.name}</p>
				)}
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Filters</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap items-center gap-3">
						<Tabs
							value={filter}
							onValueChange={(v) => {
								setFilter(v as Filter)
								setOffset(0)
							}}
						>
							<TabsList>
								<TabsTrigger value="all">All events</TabsTrigger>
								<TabsTrigger value="join">Joins</TabsTrigger>
								<TabsTrigger value="leave">Leaves</TabsTrigger>
								<TabsTrigger value="ship_change">Ship changes</TabsTrigger>
							</TabsList>
						</Tabs>
						<Input
							value={characterId}
							onChange={(e) => {
								setCharacterId(e.target.value)
								setOffset(0)
							}}
							placeholder="Filter by character ID"
							className="max-w-xs"
						/>
					</div>
				</CardContent>
			</Card>

			<Card className="mt-4">
				<CardContent className="p-0">
					{isLoading ? (
						<LoadingPage />
					) : !timeline || timeline.items.length === 0 ? (
						<div className="py-8 text-center text-sm text-muted-foreground">
							No events found for the selected filters.
						</div>
					) : (
						<ul className="divide-y">
							{timeline.items.map((ev) => (
								<li key={ev.id} className="p-4 flex items-baseline gap-3">
									<time className="font-mono text-xs text-muted-foreground w-32 shrink-0">
										{new Date(ev.eventTimestamp).toLocaleString()}
									</time>
									<span className="font-medium">
										{ev.eventType === 'join' ? '→' : ev.eventType === 'leave' ? '←' : '⟶'}{' '}
										<Link
											to={`/fleet-tracking/${sessionId}/members/${ev.characterId}`}
											className="hover:underline"
										>
											{ev.characterName || ev.characterId}
										</Link>
									</span>
									<span className="text-sm text-muted-foreground">
										{ev.eventType === 'ship_change' ? (
											<>
												re-shipped:{' '}
												{ev.previousShipTypeName || `type #${ev.previousShipTypeId ?? '?'}`} →{' '}
												{ev.shipTypeName || `type #${ev.shipTypeId}`} (in{' '}
												{ev.systemName || `system #${ev.solarSystemId}`})
											</>
										) : (
											<>
												{ev.eventType === 'join' ? 'joined' : 'left'} in{' '}
												{ev.shipTypeName || `type #${ev.shipTypeId}`} at{' '}
												{ev.systemName || `system #${ev.solarSystemId}`}
											</>
										)}
									</span>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>

			{timeline && timeline.total > limit && (
				<div className="mt-4 flex items-center justify-between text-sm">
					<div className="text-muted-foreground">
						Showing {offset + 1}–{Math.min(offset + timeline.items.length, timeline.total)} of{' '}
						{timeline.total}
					</div>
					<div className="flex gap-2">
						<Button
							variant="ghost"
							size="sm"
							disabled={offset === 0}
							onClick={() => setOffset(Math.max(0, offset - limit))}
						>
							Previous
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={offset + limit >= timeline.total}
							onClick={() => setOffset(offset + limit)}
						>
							Next
						</Button>
					</div>
				</div>
			)}
		</Container>
	)
}
