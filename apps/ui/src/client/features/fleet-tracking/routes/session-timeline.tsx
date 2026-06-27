import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import { useSessionTimeline, useTrackingSession } from '../hooks'

import type { SessionTimelineRow } from '../types'

type Filter = 'all' | 'join' | 'leave' | 'ship_change'

function formatTimelineCharacterRef(
	name: string | null | undefined,
	id: string | null | undefined
) {
	return name ?? (id ? <span className="font-mono">{id}</span> : '—')
}

function getTimelineEventLabel(eventType: SessionTimelineRow['eventType']): string {
	switch (eventType) {
		case 'join':
			return 'Join'
		case 'leave':
			return 'Leave'
		case 'ship_change':
			return 'Ship Change'
		case 'fleet_boss_initial':
			return 'Initial Fleet Boss'
		case 'fleet_boss_change':
			return 'Fleet Boss Change'
		case 'tracking_started':
			return 'Tracking Started'
		case 'tracking_resumed':
			return 'Tracking Resumed'
		case 'tracking_ended':
			return 'Tracking Ended'
	}
}

function renderTimelineEventDetails(ev: SessionTimelineRow) {
	if (ev.eventType === 'fleet_boss_initial') {
		return <>Initial boss: {formatTimelineCharacterRef(ev.characterName, ev.characterId)}</>
	}

	if (ev.eventType === 'fleet_boss_change') {
		return (
			<>
				{formatTimelineCharacterRef(
					ev.previousFleetBossCharacterName,
					ev.previousFleetBossCharacterId
				)}{' '}
				→ {formatTimelineCharacterRef(ev.characterName, ev.characterId)}
			</>
		)
	}

	if (ev.eventType === 'tracking_started') {
		return <>Tracking started with {formatTimelineCharacterRef(ev.characterName, ev.characterId)}</>
	}

	if (ev.eventType === 'tracking_resumed') {
		const isTakeover =
			!!ev.previousFleetBossCharacterId &&
			ev.previousFleetBossCharacterId !== ev.characterId

		return isTakeover ? (
			<>
				Taken over from{' '}
				{formatTimelineCharacterRef(
					ev.previousFleetBossCharacterName,
					ev.previousFleetBossCharacterId
				)}{' '}
				→ {formatTimelineCharacterRef(ev.characterName, ev.characterId)}
			</>
		) : (
			<>Tracking resumed by {formatTimelineCharacterRef(ev.characterName, ev.characterId)}</>
		)
	}

	if (ev.eventType === 'tracking_ended') {
		return <>Tracking ended by {formatTimelineCharacterRef(ev.characterName, ev.characterId)}</>
	}

	if (ev.eventType === 'ship_change') {
		return (
			<>
				{ev.previousShipTypeName || `type #${ev.previousShipTypeId ?? '?'}`} →{' '}
				{ev.shipTypeName || `type #${ev.shipTypeId}`} in{' '}
				{ev.systemName || `system #${ev.solarSystemId}`}
			</>
		)
	}

	return (
		<>
			{ev.shipTypeName || `type #${ev.shipTypeId}`} at {ev.systemName || `system #${ev.solarSystemId}`}
		</>
	)
}

export default function SessionTimeline() {
	usePageTitle('Fleet Tracking Timeline')
	const { sessionId } = useParams<{ sessionId: string }>()
	const [filter, setFilter] = useState<Filter>('all')
	const [characterId, setCharacterId] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	const limit = pageSize

	const { data: session } = useTrackingSession(sessionId)
	const { data: timeline, isLoading } = useSessionTimeline(sessionId, {
		eventType: filter === 'all' ? undefined : filter,
		characterId: characterId.trim() || undefined,
		limit,
		offset: (page - 1) * pageSize,
	})

	if (!sessionId) return <Navigate to="/fleet-tracking" replace />

	return (
		<Container>
			<PageHeader
				title="Timeline"
				description={session ? `Session: ${session.name}` : undefined}
				action={
					<Button asChild variant="ghost" size="sm">
						<Link to={`/fleet-tracking/${sessionId}`}>
							<ArrowLeft className="h-4 w-4" />
							Session
						</Link>
					</Button>
				}
			/>

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
								setPage(1)
							}}
						>
							<TabsList>
								<TabsTrigger value="all">All events</TabsTrigger>
								<TabsTrigger value="join">Joins</TabsTrigger>
								<TabsTrigger value="leave">Leaves</TabsTrigger>
								<TabsTrigger value="ship_change">Ship changes</TabsTrigger>
							</TabsList>
						</Tabs>
						<div className="w-full max-w-sm">
							<Select
								options={[]}
								value={characterId}
								onValueChange={(value) => {
									setCharacterId(value || '')
									setPage(1)
								}}
								searchable
								searchDelegate={async (query) => {
									const values = await api.searchCharacters(query)
									return values.map((entry) => ({
										value: entry.characterId,
										label: entry.characterName,
										description: entry.characterId,
									}))
								}}
								placeholder="Filter by character name"
								minQueryLength={2}
								queryHintText="Type at least 2 characters"
								emptyText="No character names found"
								selectAllOption={{ value: '', label: 'All Characters' }}
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card className="mt-4">
				<CardContent className="p-0">
					{timeline && timeline.total > 0 && (
						<div className="p-3 border-b">
							<UserSearchPaginationControls
								totalCount={timeline.total}
								page={page}
								pageSize={pageSize}
								onPageChange={setPage}
								onPageSizeChange={(nextPageSize) => {
									setPageSize(nextPageSize)
									setPage(1)
								}}
								pageSizeOptions={[10, 25, 50]}
								itemLabel="events"
							/>
						</div>
					)}
					{isLoading ? (
						<LoadingPage />
					) : !timeline || timeline.items.length === 0 ? (
						<div className="py-8 text-center text-sm text-muted-foreground">
							No events found for the selected filters.
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Timestamp</TableHead>
									<TableHead>Event</TableHead>
									<TableHead>Character</TableHead>
									<TableHead>Details</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{timeline.items.map((ev) => (
								<TableRow key={ev.id}>
									<TableCell className="text-muted-foreground">
										<EveTimeDisplay dateStr={ev.eventTimestamp} />
									</TableCell>
									<TableCell className="font-medium">{getTimelineEventLabel(ev.eventType)}</TableCell>
									<TableCell>
										<Link
											to={`/fleet-tracking/${sessionId}/members/${ev.characterId}`}
											className="hover:underline"
										>
											{ev.characterName || ev.characterId}
										</Link>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{renderTimelineEventDetails(ev)}
									</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{timeline && timeline.total > 0 && (
				<div className="mt-4 border-t pt-3">
					<UserSearchPaginationControls
						totalCount={timeline.total}
						page={page}
						pageSize={pageSize}
						onPageChange={setPage}
						onPageSizeChange={(nextPageSize) => {
							setPageSize(nextPageSize)
							setPage(1)
						}}
						pageSizeOptions={[10, 25, 50]}
						itemLabel="events"
					/>
				</div>
			)}
		</Container>
	)
}
