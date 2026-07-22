import { AlertTriangle, ArrowLeft, Clock, Lock, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

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
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { error as toastError, success as toastSuccess } from '@/lib/toast'
import { useDoctrine, useDoctrines } from '@/features/doctrines/hooks'
import { CurrentMembersPanel } from '../components/current-members-panel'
import { SessionRosterPanel } from '../components/session-roster-panel'
import { SessionStatusPill } from '../components/session-status-pill'
import { SessionStatsGrid } from '../components/session-stats-grid'
import {
	useSessionCurrentMembers,
	useSessionLiveMemberLocations,
	useSessionLiveSnapshot,
	useSessionRoster,
	useSessionSummary,
	useSessionTimeline,
	useKickTrackingMembers,
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

export default function TrackingSessionDetail() {
	const { sessionId } = useParams<{ sessionId: string }>()
	const { user } = useAuth()
	const { hasPermission, isAdmin } = useUserPermissions()

	const { data: session, isLoading } = useTrackingSession(sessionId, {
		refetchInterval: 5_000,
	})
	usePageTitle(session?.name ?? 'Fleet Tracking Session')

	if (!sessionId) return <Navigate to="/fleet-tracking" replace />
	if (isLoading) return <LoadingPage />
	if (!session) {
		return (
			<Container>
				<div className="py-12 text-center text-muted-foreground">Session not found.</div>
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
		currentFleetBossCharacterId ??
		session.currentCommanderCharacterId ??
		session.characterId
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
							Back
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
	const stop = useStopTracking()
	const [dialogOpen, setDialogOpen] = useState(false)

	const handleConfirmStop = async () => {
		try {
			await stop.mutateAsync(session.id)
			toastSuccess('Tracking stopped')
			setDialogOpen(false)
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to stop tracking')
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
						<span className="text-muted-foreground">Initial FC:</span>{' '}
						<span className="font-semibold text-foreground">
							{initialFleetBossCharacterName ?? (
								<span className="font-mono">{initialFleetBossCharacterId}</span>
							)}
						</span>
						<span className="text-muted-foreground">•</span>
						<span className="text-muted-foreground">Tracked FC:</span>{' '}
						<span className="font-semibold text-foreground">
							{currentFleetBossCharacterName ?? (
								<span className="font-mono">{currentFleetBossCharacterId}</span>
							)}
						</span>
						<span className="text-muted-foreground">•</span>
						<span className="font-medium text-foreground">
							{session.status === 'active' ? (
								<>Running {formatDurationBetween(session.startedAt, null)}</>
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
							Reason: {formatEndReason(session.endedReason)}
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
						Stop Tracking
					</Button>
				)}
			</div>
			<ConfirmationDialog
				open={dialogOpen}
				title="Stop tracking this fleet?"
				description={`This ends the "${session.name}" session. Members in fleet will be marked as left and the session will be archived. This cannot be undone.`}
				confirmLabel="Stop tracking"
				cancelLabel="Cancel"
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
				return 'Blanket'
			case 'military':
				return 'Military'
			case 'coalition':
				return 'Coalition'
			case 'disabled':
				return 'No SRP'
			default:
				return 'None'
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
		stats.push({ label: 'Members', value: snapshot.memberCount })
		stats.push({ label: 'Peak', value: snapshot.peakMemberCount })
		stats.push({ label: 'Joins / Leaves', value: `${joinCount} / ${leaveCount}` })
		stats.push({
			label: 'Duration',
			value: formatDurationBetween(startedAt, null),
		})
	} else if (summary) {
		stats.push({ label: 'Peak members', value: summary.peakMemberCount })
		stats.push({ label: 'Final members', value: summary.finalMemberCount })
		stats.push({
			label: 'Duration',
			value: summary.durationMinutes != null ? `${summary.durationMinutes}m` : '—',
		})
		stats.push({
			label: 'Joins / Leaves',
			value: `${joinCount} / ${leaveCount}`,
		})
	}

	return (
		<div className="space-y-6">
			{liveResp && liveResp.state !== 'ready' && (
				<div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
					<div className="flex items-start gap-3">
						<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
						<div className="space-y-1 text-sm">
							<p className="font-medium text-warning">Live fleet snapshot unavailable</p>
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
								<CardTitle className="text-base">Doctrine</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="max-w-md">
									<Select
										value={selectedDoctrineId}
										onValueChange={(value) => setSelectedDoctrineId(value || '')}
										options={[
											{ value: '', label: 'No Doctrine Selected' },
											...doctrines.map((d) => ({ value: d.id, label: d.name })),
										]}
										placeholder="Select doctrine"
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
										<span className="text-muted-foreground">Mode:</span>{' '}
										<span className="font-medium text-foreground">{srpModeLabel}</span>
									</div>
									<div>
										<span className="text-muted-foreground">Token:</span>{' '}
										<span className="font-mono text-foreground">
											{broadcastLink.srpToken ?? 'N/A'}
										</span>
									</div>
								</>
							) : (
								<div className="text-muted-foreground">No linked broadcast found for this session.</div>
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
										if (!text) return 'Unable to remove this member.'
										if (text.includes('permission') || text.includes('unauthorized') || text.includes('forbidden')) {
											return 'You may not have the required permissions to remove this member.'
										}
										if (text.includes('not found') || text.includes('already left')) {
											return 'That member is no longer in this fleet.'
										}
										if (text.includes('not active')) {
											return 'This fleet session is no longer active.'
										}
										return 'Unable to remove this member.'
									}
									console.error('[Fleet Tracking] Kick member(s) had failures', {
										sessionId,
										memberCharacterIds,
										results: result.results,
									})
									toastError(
										result.summary.total === 1
											? `Could not remove this member from fleet. ${mapKickFailureReason(firstFailure?.error)}`
											: `Removed ${result.summary.success}/${result.summary.total} members. Some members could not be removed.`
									)
									return
								}
								toastSuccess(
									`Removed ${result.summary.success} member${result.summary.success === 1 ? '' : 's'} from fleet.`
								)
							}}
						/>
					)
				: roster && (
						<SessionRosterPanel sessionId={sessionId} roster={roster.items} />
					)}

			<TimelinePanel sessionId={sessionId} timeline={timeline?.items ?? []} />

			{snapshot?.motd && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">MOTD</CardTitle>
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
					Fleet data updates every 10 seconds.
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
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle className="text-base">Recent events</CardTitle>
					<Button asChild variant="ghost" size="sm">
						<Link to={`/fleet-tracking/${sessionId}/timeline`}>View full timeline</Link>
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{timeline.length === 0 ? (
					<div className="text-sm text-muted-foreground py-4">No events recorded yet.</div>
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
							{timeline.map((ev) => (
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
	)
}

function SummaryOnlyView({ sessionId }: { sessionId: string }) {
	const { data: summaryResp, isLoading } = useSessionSummary(sessionId)
	const summary = summaryResp?.summary ?? null

	if (isLoading) return <LoadingPage />

	return (
		<div className="space-y-6">
			{summary ? (
				<SessionStatsGrid
					stats={[
						{ label: 'Peak members', value: summary.peakMemberCount },
						{ label: 'Final members', value: summary.finalMemberCount },
						{
							label: 'Duration',
							value: summary.durationMinutes != null ? `${summary.durationMinutes}m` : '—',
						},
						{ label: 'Started', value: new Date(summary.startedAt).toLocaleString() },
					]}
				/>
			) : (
				<Card>
					<CardContent className="py-6 text-sm text-muted-foreground text-center">
						No summary recorded for this session yet.
					</CardContent>
				</Card>
			)}

			<Card>
				<CardContent className="p-6 flex items-start gap-3">
					<Lock className="h-5 w-5 mt-0.5 text-muted-foreground" />
					<div className="text-sm">
						<p className="font-medium">Detailed history is restricted</p>
						<p className="text-muted-foreground mt-1">
							Viewing the member roster, full timeline, and ship-change events for ended sessions
							requires the <code>urn:fleet-tracking:view-fleets</code> permission. Contact your
							alliance leadership if you need access.
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
