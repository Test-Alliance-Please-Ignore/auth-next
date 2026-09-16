import { AlertTriangle, ArrowLeft, Clock, Lock, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
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
import { useDoctrine, useDoctrines } from '@/features/doctrines/hooks'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { getActiveLocale, i18n, useAppTranslation } from '@/i18n'
import { error as toastError, success as toastSuccess } from '@/lib/toast'

import { CurrentMembersPanel } from '../components/current-members-panel'
import { SessionRosterPanel } from '../components/session-roster-panel'
import { SessionStatsGrid } from '../components/session-stats-grid'
import { SessionStatusPill } from '../components/session-status-pill'
import {
	useKickTrackingMembers,
	useSessionCurrentMembers,
	useSessionLiveMemberLocations,
	useSessionLiveSnapshot,
	useSessionRoster,
	useSessionSummary,
	useSessionTimeline,
	useStopTracking,
	useTrackingSession,
} from '../hooks'
import { formatDurationBetween, formatEndReason } from '../utils/format'
import { motdToPlainText } from '../utils/motd'

import type { SessionTimelineRow } from '../types'

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

export default function TrackingSessionDetail() {
	const { t } = useAppTranslation()

	const { sessionId } = useParams<{ sessionId: string }>()
	const { user } = useAuth()
	const { hasPermission, isAdmin } = useUserPermissions()

	const { data: session, isLoading } = useTrackingSession(sessionId, {
		refetchInterval: 5_000,
	})
	usePageTitle(session?.name ?? t('fleetTracking.fleetTrackingSession'))

	if (!sessionId) return <Navigate to="/fleet-tracking" replace />
	if (isLoading) return <LoadingPage />
	if (!session) {
		return (
			<Container>
				<div className="py-12 text-center text-muted-foreground">
					{t('fleetTracking.sessionNotFound')}
				</div>
			</Container>
		)
	}

	const canCreate = hasPermission('urn:fleet-tracking:create')
	const isOwner = !!user && session.startedByUserId === user.id
	const fleetBossCharacterIds = session.fleetBossCharacterIds?.length
		? session.fleetBossCharacterIds
		: session.commanderCharacterIds?.length
			? session.commanderCharacterIds
			: [session.currentCommanderCharacterId ?? session.characterId]
	const isCommander =
		!!user &&
		canCreate &&
		user.characters.some((char) => fleetBossCharacterIds.includes(char.characterId))
	const canViewAll = isAdmin || hasPermission('urn:fleet-tracking:view-all')
	const canViewFleets = canViewAll || hasPermission('urn:fleet-tracking:view-fleets')
	const canViewDetail = canViewFleets || isOwner || isCommander
	const currentFleetBossCharacterId = session.currentFleetBossCharacterId ?? null
	const trackedFleetBossCharacterId =
		currentFleetBossCharacterId ?? session.currentCommanderCharacterId ?? session.characterId
	const currentFleetBossCharacterName =
		session.currentFleetBossCharacterName ??
		session.currentCommanderCharacterName ??
		session.characterName
	const isCurrentFleetBoss =
		!!user &&
		!!currentFleetBossCharacterId &&
		user.characters.some((char) => char.characterId === currentFleetBossCharacterId)
	const canStop = session.status === 'active' && (isAdmin || isCurrentFleetBoss)

	return (
		<Container>
			<PageHeader
				title={session.name}
				action={
					<Button asChild variant="ghost" size="sm">
						<Link to="/fleet-tracking">
							<ArrowLeft className="h-4 w-4" />
							{t('fleetTracking.back')}
						</Link>
					</Button>
				}
			/>

			<HeaderBlock
				session={session}
				canStop={canStop}
				initialFleetBossCharacterId={session.characterId}
				initialFleetBossCharacterName={session.characterName}
				currentFleetBossCharacterId={trackedFleetBossCharacterId}
				currentFleetBossCharacterName={currentFleetBossCharacterName}
			/>

			{canViewDetail ? (
				<DetailView
					sessionId={sessionId}
					status={session.status}
					startedAt={session.startedAt}
					broadcastLink={session.broadcast ?? null}
					canKickMembers={canStop}
				/>
			) : (
				<SummaryOnlyView sessionId={sessionId} />
			)}
		</Container>
	)
}

function HeaderBlock({
	session,
	canStop,
	initialFleetBossCharacterName,
	initialFleetBossCharacterId,
	currentFleetBossCharacterName,
	currentFleetBossCharacterId,
}: {
	session: NonNullable<ReturnType<typeof useTrackingSession>['data']>
	canStop: boolean
	initialFleetBossCharacterName: string | null | undefined
	initialFleetBossCharacterId: string
	currentFleetBossCharacterName: string | null | undefined
	currentFleetBossCharacterId: string
}) {
	const { t } = useAppTranslation()

	const stop = useStopTracking()
	const [dialogOpen, setDialogOpen] = useState(false)

	const handleConfirmStop = async () => {
		try {
			await stop.mutateAsync(session.id)
			toastSuccess(t('fleetTracking.trackingStopped'))
			setDialogOpen(false)
		} catch (err) {
			toastError(err instanceof Error ? err.message : t('fleetTracking.failedToStopTracking'))
		}
	}

	return (
		<div className="mb-6">
			<div className="flex items-start justify-between gap-4 flex-wrap">
				<div className="space-y-1.5">
					<div className="text-sm leading-6 flex items-center flex-wrap gap-x-2">
						<span className="inline-flex items-center">
							<SessionStatusPill status={session.status} />
						</span>
						<span className="text-muted-foreground">{t('fleetTracking.initialFc')}</span>{' '}
						<span className="font-semibold text-foreground">
							{initialFleetBossCharacterName ?? (
								<span className="font-mono">{initialFleetBossCharacterId}</span>
							)}
						</span>
						<span className="text-muted-foreground">•</span>
						<span className="text-muted-foreground">{t('fleetTracking.trackedFc')}</span>{' '}
						<span className="font-semibold text-foreground">
							{currentFleetBossCharacterName ?? (
								<span className="font-mono">{currentFleetBossCharacterId}</span>
							)}
						</span>
						<span className="text-muted-foreground">•</span>
						<span className="font-medium text-foreground">
							{session.status === 'active' ? (
								<>
									{t('fleetTracking.running')}
									{formatDurationBetween(session.startedAt, null)}
								</>
							) : (
								<>
									<EveTimeDisplay dateStr={session.startedAt} /> →{' '}
									{session.endedAt && <EveTimeDisplay dateStr={session.endedAt} />}
									<span className="text-muted-foreground">•</span>
									{formatDurationBetween(session.startedAt, session.endedAt)}
								</>
							)}
						</span>
					</div>
					{session.endedReason && (
						<div className="text-sm text-muted-foreground">
							{t('fleetTracking.reason')}
							{formatEndReason(session.endedReason)}
						</div>
					)}
				</div>
				{canStop && (
					<Button
						variant="destructive"
						onClick={() => setDialogOpen(true)}
						disabled={stop.isPending}
					>
						<Square className="h-4 w-4" />
						{t('fleetTracking.stopTracking')}
					</Button>
				)}
			</div>
			<ConfirmationDialog
				open={dialogOpen}
				title={t('fleetTracking.stopTrackingThisFleet')}
				description={t('fleetTracking.thisEndsTheValue1SessionMembersInFleetWillBe', {
					value1: session.name,
				})}
				confirmLabel={t('fleetTracking.stopTracking2')}
				cancelLabel={t('fleetTracking.cancel')}
				intent="destructive"
				pending={stop.isPending}
				onCancel={() => setDialogOpen(false)}
				onConfirm={handleConfirmStop}
			/>
		</div>
	)
}

function DetailView({
	sessionId,
	status,
	startedAt,
	broadcastLink,
	canKickMembers,
}: {
	sessionId: string
	status: 'active' | 'ended'
	startedAt: string
	broadcastLink: {
		id: string
		title: string
		status: string
		sentAt: string | null
		doctrineId: string | null
		doctrine: string | null
		srpMode?: 'blanket' | 'military' | 'coalition' | 'disabled' | null
		srpToken?: string | null
	} | null
	canKickMembers: boolean
}) {
	const { t } = useAppTranslation()

	const [selectedDoctrineId, setSelectedDoctrineId] = useState('')
	const { data: doctrines = [] } = useDoctrines()
	const { data: selectedDoctrine } = useDoctrine(selectedDoctrineId || undefined)

	const isLive = status === 'active'
	const LIVE_POLL_MS = 5_000
	const LIVE_LOCATION_POLL_MS = 15_000
	const { data: liveResp } = useSessionLiveSnapshot(sessionId, {
		refetchInterval: isLive ? LIVE_POLL_MS : false,
	})
	const { data: summaryResp } = useSessionSummary(sessionId)
	const pollInterval = isLive ? LIVE_POLL_MS : (false as const)
	const { data: timeline } = useSessionTimeline(
		sessionId,
		{ limit: 25 },
		{ refetchInterval: pollInterval }
	)
	// Lightweight totals — only the `total` field is used, not the rows.
	const { data: joinTotal } = useSessionTimeline(
		sessionId,
		{ eventType: 'join', limit: 1 },
		{ refetchInterval: pollInterval }
	)
	const { data: leaveTotal } = useSessionTimeline(
		sessionId,
		{ eventType: 'leave', limit: 1 },
		{ refetchInterval: pollInterval }
	)
	const { data: currentMembers } = useSessionCurrentMembers(sessionId, {
		refetchInterval: pollInterval,
	})
	const { data: liveLocations } = useSessionLiveMemberLocations(sessionId, {
		refetchInterval: isLive ? LIVE_LOCATION_POLL_MS : false,
	})
	const { data: roster } = useSessionRoster(isLive ? undefined : sessionId)
	const kickMembersMutation = useKickTrackingMembers()

	const snapshot = liveResp?.snapshot ?? null
	const summary = summaryResp?.summary ?? null
	const normalizeShipTypeId = (value: string | number | null | undefined): string | null => {
		if (value === null || value === undefined) return null
		const raw = String(value).trim()
		if (!raw) return null
		const asNumber = Number(raw)
		return Number.isFinite(asNumber) ? String(asNumber) : raw
	}
	const doctrineShipTypeIds = selectedDoctrine
		? new Set(
				selectedDoctrine.fittings
					.map((entry) => normalizeShipTypeId(entry.fitting.shipTypeId))
					.filter((id): id is string => Boolean(id))
			)
		: undefined
	const srpModeLabel = (() => {
		switch (broadcastLink?.srpMode) {
			case 'blanket':
				return t('fleetTracking.blanket')
			case 'military':
				return t('fleetTracking.military')
			case 'coalition':
				return t('fleetTracking.coalition')
			case 'disabled':
				return t('fleetTracking.noSrp')
			default:
				return t('fleetTracking.none')
		}
	})()

	useEffect(() => {
		if (selectedDoctrineId) return
		const doctrineIdFromBroadcast = broadcastLink?.doctrineId?.trim()
		if (doctrineIdFromBroadcast) {
			const matchedById = doctrines.find((doctrine) => doctrine.id === doctrineIdFromBroadcast)
			if (matchedById) {
				setSelectedDoctrineId(matchedById.id)
				return
			}
		}
		const doctrineFromBroadcast = broadcastLink?.doctrine?.trim()
		if (!doctrineFromBroadcast || doctrineFromBroadcast.toLowerCase() === 'read motd') return
		const matchedDoctrine = doctrines.find((doctrine) => doctrine.name === doctrineFromBroadcast)
		if (matchedDoctrine) {
			setSelectedDoctrineId(matchedDoctrine.id)
		}
	}, [broadcastLink?.doctrine, broadcastLink?.doctrineId, doctrines, selectedDoctrineId])

	// Headline stats
	const stats: Array<{ label: string; value: string | number; sublabel?: string }> = []
	const joinCount = joinTotal?.total ?? 0
	const leaveCount = leaveTotal?.total ?? 0

	if (isLive && snapshot) {
		stats.push({ label: t('fleetTracking.members'), value: snapshot.memberCount })
		stats.push({ label: t('fleetTracking.peak'), value: snapshot.peakMemberCount })
		stats.push({ label: t('fleetTracking.joinsLeaves'), value: `${joinCount} / ${leaveCount}` })
		stats.push({
			label: t('fleetTracking.duration'),
			value: formatDurationBetween(startedAt, null),
		})
	} else if (summary) {
		stats.push({ label: t('fleetTracking.peakMembers'), value: summary.peakMemberCount })
		stats.push({ label: t('fleetTracking.finalMembers'), value: summary.finalMemberCount })
		stats.push({
			label: t('fleetTracking.duration'),
			value:
				summary.durationMinutes != null
					? t('duration.compact.minute', { count: summary.durationMinutes })
					: '—',
		})
		stats.push({
			label: t('fleetTracking.joinsLeaves'),
			value: `${joinCount} / ${leaveCount}`,
		})
	}

	return (
		<div className="space-y-6">
			{isLive && liveResp && liveResp.state !== 'ready' && (
				<div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
					<div className="flex items-start gap-3">
						<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
						<div className="space-y-1 text-sm">
							<p className="font-medium text-warning">
								{t('fleetTracking.liveFleetSnapshotUnavailable')}
							</p>
							<p className="text-muted-foreground">{liveResp.message}</p>
						</div>
					</div>
				</div>
			)}

			{stats.length > 0 && <SessionStatsGrid stats={stats} />}
			{(isLive || broadcastLink) && (
				<div className="grid gap-4 lg:grid-cols-2">
					{isLive ? (
						<Card>
							<CardHeader>
								<CardTitle className="text-base">{t('fleetTracking.doctrine')}</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="max-w-md">
									<Select
										value={selectedDoctrineId}
										onValueChange={(value) => setSelectedDoctrineId(value || '')}
										options={[
											{ value: '', label: t('fleetTracking.noDoctrineSelected') },
											...doctrines.map((d) => ({ value: d.id, label: d.name })),
										]}
										placeholder={t('fleetTracking.selectDoctrine')}
										searchable
									/>
								</div>
							</CardContent>
						</Card>
					) : (
						<div />
					)}
					<Card>
						<CardHeader>
							<CardTitle className="text-base">SRP</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2 text-sm">
							{broadcastLink ? (
								<>
									<div>
										<span className="text-muted-foreground">{t('fleetTracking.mode')}</span>{' '}
										<span className="font-medium text-foreground">{srpModeLabel}</span>
									</div>
									<div>
										<span className="text-muted-foreground">{t('fleetTracking.token')}</span>{' '}
										<span className="font-mono text-foreground">
											{broadcastLink.srpToken ?? 'N/A'}
										</span>
									</div>
								</>
							) : (
								<div className="text-muted-foreground">
									{t('fleetTracking.noLinkedBroadcastFoundForThisSession')}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			)}

			{isLive
				? currentMembers && (
						<CurrentMembersPanel
							sessionId={sessionId}
							members={currentMembers.members}
							groupCounts={currentMembers.groupCounts}
							liveLocations={liveLocations?.members ?? []}
							doctrineShipTypeIds={doctrineShipTypeIds}
							canKickMembers={canKickMembers}
							isKickingMembers={kickMembersMutation.isPending}
							onKickMembers={async (memberCharacterIds) => {
								const result = await kickMembersMutation.mutateAsync({
									sessionId,
									memberCharacterIds,
								})
								if (result.summary.failed > 0) {
									const firstFailure = result.results.find((r) => !r.success)
									const mapKickFailureReason = (raw?: string): string => {
										const text = (raw ?? '').toLowerCase()
										if (!text) return t('fleetTracking.unableToRemoveThisMember')
										if (
											text.includes('permission') ||
											text.includes('unauthorized') ||
											text.includes('forbidden')
										) {
											return t('fleetTracking.youMayNotHaveTheRequiredPermissionsToRemoveThis')
										}
										if (text.includes('not found') || text.includes('already left')) {
											return t('fleetTracking.thatMemberIsNoLongerInThisFleet')
										}
										if (text.includes('not active')) {
											return t('fleetTracking.thisFleetSessionIsNoLongerActive')
										}
										return t('fleetTracking.unableToRemoveThisMember')
									}
									console.error('[Fleet Tracking] Kick member(s) had failures', {
										sessionId,
										memberCharacterIds,
										results: result.results,
									})
									toastError(
										result.summary.total === 1
											? t('fleetTracking.couldNotRemoveThisMemberFromFleet', {
													value1: mapKickFailureReason(firstFailure?.error),
												})
											: t('fleetTracking.removedMembersSomeMembersCouldNotBeRemoved', {
													value1: result.summary.success,
													value2: result.summary.total,
												})
									)
									return
								}
								toastSuccess(t('fleetTracking.removedMembers', { count: result.summary.success }))
							}}
						/>
					)
				: roster && <SessionRosterPanel sessionId={sessionId} roster={roster.items} />}

			<TimelinePanel sessionId={sessionId} timeline={timeline?.items ?? []} />

			{snapshot?.motd && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">{t('fleetTracking.motd')}</CardTitle>
					</CardHeader>
					<CardContent>
						<pre className="whitespace-pre-wrap text-sm font-sans">
							{motdToPlainText(snapshot.motd)}
						</pre>
					</CardContent>
				</Card>
			)}

			{isLive && (
				<div className="text-xs text-muted-foreground flex items-center gap-1">
					<Clock className="h-3 w-3" />
					{t('fleetTracking.fleetDataUpdatesEvery10Seconds')}
				</div>
			)}
		</div>
	)
}

function TimelinePanel({
	sessionId,
	timeline,
}: {
	sessionId: string
	timeline: SessionTimelineRow[]
}) {
	const { t } = useAppTranslation()

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="text-base">{t('fleetTracking.recentEvents')}</CardTitle>
					<Button asChild variant="ghost" size="sm">
						<Link to={`/fleet-tracking/${sessionId}/timeline`}>
							{t('fleetTracking.viewFullTimeline')}
						</Link>
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{timeline.length === 0 ? (
					<div className="text-sm text-muted-foreground py-4">
						{t('fleetTracking.noEventsRecordedYet')}
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
							{timeline.map((ev) => (
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
	)
}

function SummaryOnlyView({ sessionId }: { sessionId: string }) {
	const { t } = useAppTranslation()

	const { data: summaryResp, isLoading } = useSessionSummary(sessionId)
	const summary = summaryResp?.summary ?? null

	if (isLoading) return <LoadingPage />

	return (
		<div className="space-y-6">
			{summary ? (
				<SessionStatsGrid
					stats={[
						{ label: t('fleetTracking.peakMembers'), value: summary.peakMemberCount },
						{ label: t('fleetTracking.finalMembers'), value: summary.finalMemberCount },
						{
							label: t('fleetTracking.duration'),
							value:
								summary.durationMinutes != null
									? t('duration.compact.minute', { count: summary.durationMinutes })
									: '—',
						},
						{
							label: t('fleetTracking.started2'),
							value: new Date(summary.startedAt).toLocaleString(getActiveLocale()),
						},
					]}
				/>
			) : (
				<Card>
					<CardContent className="py-6 text-sm text-muted-foreground text-center">
						{t('fleetTracking.noSummaryRecordedForThisSessionYet')}
					</CardContent>
				</Card>
			)}

			<Card>
				<CardContent className="p-6 flex items-start gap-3">
					<Lock className="h-5 w-5 mt-0.5 text-muted-foreground" />
					<div className="text-sm">
						<p className="font-medium">{t('fleetTracking.detailedHistoryIsRestricted')}</p>
						<p className="text-muted-foreground mt-1">
							{t('fleetTracking.viewingTheMemberRosterFullTimelineAndShipChangeEvents')}
							<code>urn:fleet-tracking:view-fleets</code>
							{t('fleetTracking.permissionContactYourAllianceLeadershipIfYouNeedAccess')}
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
