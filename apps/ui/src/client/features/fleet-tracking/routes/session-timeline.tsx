import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

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
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { usePageTitle } from '@/hooks/usePageTitle'
import { i18n, useAppTranslation } from '@/i18n'
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
			return i18n.t('fleetTracking.join')
		case 'leave':
			return i18n.t('fleetTracking.leave')
		case 'ship_change':
			return i18n.t('fleetTracking.shipChange')
		case 'fleet_boss_initial':
			return i18n.t('fleetTracking.initialFleetBoss')
		case 'fleet_boss_change':
			return i18n.t('fleetTracking.fleetBossChange')
		case 'tracking_started':
			return i18n.t('fleetTracking.trackingStarted')
		case 'tracking_resumed':
			return i18n.t('fleetTracking.trackingResumed')
		case 'tracking_ended':
			return i18n.t('fleetTracking.trackingEnded')
	}
}

function renderTimelineEventDetails(ev: SessionTimelineRow) {
	if (ev.eventType === 'fleet_boss_initial') {
		return (
			<>
				{i18n.t('fleetTracking.initialBoss')}
				{formatTimelineCharacterRef(ev.characterName, ev.characterId)}
			</>
		)
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
		return (
			<>
				{i18n.t('fleetTracking.trackingStartedWith')}
				{formatTimelineCharacterRef(ev.characterName, ev.characterId)}
			</>
		)
	}

	if (ev.eventType === 'tracking_resumed') {
		const isTakeover =
			!!ev.previousFleetBossCharacterId && ev.previousFleetBossCharacterId !== ev.characterId

		return isTakeover ? (
			<>
				{i18n.t('fleetTracking.takenOverFrom')}{' '}
				{formatTimelineCharacterRef(
					ev.previousFleetBossCharacterName,
					ev.previousFleetBossCharacterId
				)}{' '}
				→ {formatTimelineCharacterRef(ev.characterName, ev.characterId)}
			</>
		) : (
			<>
				{i18n.t('fleetTracking.trackingResumedBy')}
				{formatTimelineCharacterRef(ev.characterName, ev.characterId)}
			</>
		)
	}

	if (ev.eventType === 'tracking_ended') {
		return (
			<>
				{i18n.t('fleetTracking.trackingEndedBy')}
				{formatTimelineCharacterRef(ev.characterName, ev.characterId)}
			</>
		)
	}

	if (ev.eventType === 'ship_change') {
		return (
			<>
				{ev.previousShipTypeName ||
					i18n.t('fleetTracking.typeFallback', { id: ev.previousShipTypeId ?? '?' })}{' '}
				→ {ev.shipTypeName || i18n.t('fleetTracking.typeFallback', { id: ev.shipTypeId })}
				{i18n.t('fleetTracking.in')}{' '}
				{ev.systemName || i18n.t('fleetTracking.systemFallback', { id: ev.solarSystemId })}
			</>
		)
	}

	return (
		<>
			{ev.shipTypeName || i18n.t('fleetTracking.typeFallback', { id: ev.shipTypeId })}
			{i18n.t('fleetTracking.at')}
			{ev.systemName || i18n.t('fleetTracking.systemFallback', { id: ev.solarSystemId })}
		</>
	)
}

export default function SessionTimeline() {
	const { t } = useAppTranslation()

	usePageTitle(t('fleetTracking.fleetTrackingTimeline'))
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
				title={t('fleetTracking.timeline')}
				description={
					session ? t('fleetTracking.sessionValue1', { value1: session.name }) : undefined
				}
				action={
					<Button asChild variant="ghost" size="sm">
						<Link to={`/fleet-tracking/${sessionId}`}>
							<ArrowLeft className="h-4 w-4" />
							{t('fleetTracking.session')}
						</Link>
					</Button>
				}
			/>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">{t('fleetTracking.filters')}</CardTitle>
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
								<TabsTrigger value="all">{t('fleetTracking.allEvents')}</TabsTrigger>
								<TabsTrigger value="join">{t('fleetTracking.joins')}</TabsTrigger>
								<TabsTrigger value="leave">{t('fleetTracking.leaves')}</TabsTrigger>
								<TabsTrigger value="ship_change">{t('fleetTracking.shipChanges')}</TabsTrigger>
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
								placeholder={t('fleetTracking.filterByCharacterName')}
								minQueryLength={2}
								queryHintText={t('fleetTracking.typeAtLeast2Characters')}
								emptyText={t('fleetTracking.noCharacterNamesFound')}
								selectAllOption={{ value: '', label: t('fleetTracking.allCharacters') }}
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
								itemLabel={t('fleetTracking.events')}
							/>
						</div>
					)}
					{isLoading ? (
						<LoadingPage />
					) : !timeline || timeline.items.length === 0 ? (
						<div className="py-8 text-center text-sm text-muted-foreground">
							{t('fleetTracking.noEventsFoundForTheSelectedFilters')}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t('fleetTracking.timestamp')}</TableHead>
									<TableHead>{t('fleetTracking.event')}</TableHead>
									<TableHead>{t('fleetTracking.character')}</TableHead>
									<TableHead>{t('fleetTracking.details')}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{timeline.items.map((ev) => (
									<TableRow key={ev.id}>
										<TableCell className="text-muted-foreground">
											<EveTimeDisplay dateStr={ev.eventTimestamp} />
										</TableCell>
										<TableCell className="font-medium">
											{getTimelineEventLabel(ev.eventType)}
										</TableCell>
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
						itemLabel={t('fleetTracking.events')}
					/>
				</div>
			)}
		</Container>
	)
}
