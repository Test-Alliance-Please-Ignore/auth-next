import { ArrowLeft, Clock, Lock, Square } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Container } from '@/components/ui/container'
import { LoadingPage } from '@/components/ui/loading'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { error as toastError, success as toastSuccess } from '@/lib/toast'
import { CurrentMembersPanel } from '../components/current-members-panel'
import { SessionRosterPanel } from '../components/session-roster-panel'
import { SessionStatusPill } from '../components/session-status-pill'
import { SessionStatsGrid } from '../components/session-stats-grid'
import {
	useSessionCurrentMembers,
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

export default function TrackingSessionDetail() {
	const { sessionId } = useParams<{ sessionId: string }>()
	const { user } = useAuth()
	const { hasPermission, isAdmin } = useUserPermissions()

	const { data: session, isLoading } = useTrackingSession(sessionId)
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

	const isOwner = !!user && session.startedByUserId === user.id
	const canViewAll = isAdmin || hasPermission('urn:fleet-tracking:view-all')
	const canViewDetail = canViewAll || (isOwner && session.status === 'active')
	const canStop = session.status === 'active' && (isOwner || isAdmin)

	return (
		<Container>
			<div className="mb-4">
				<Button asChild variant="ghost" size="sm">
					<Link to="/fleet-tracking">
						<ArrowLeft className="h-4 w-4" />
						Back
					</Link>
				</Button>
			</div>

			<HeaderBlock session={session} canStop={canStop} />

			{canViewDetail ? (
				<DetailView
					sessionId={sessionId}
					status={session.status}
					startedAt={session.startedAt}
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
}: {
	session: NonNullable<ReturnType<typeof useTrackingSession>['data']>
	canStop: boolean
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
					<div className="flex items-center gap-2 flex-wrap">
						<SessionStatusPill status={session.status} />
						<h1 className="text-2xl font-semibold">{session.name}</h1>
					</div>
					<div className="text-sm text-muted-foreground">
						FC: {session.characterName ?? <span className="font-mono">{session.characterId}</span>}
						{' • '}
						{session.status === 'active' ? (
							<>Running {formatDurationBetween(session.startedAt, null)}</>
						) : (
							<>
								{new Date(session.startedAt).toLocaleString()} →{' '}
								{session.endedAt && new Date(session.endedAt).toLocaleString()}
								{' • '}
								{formatDurationBetween(session.startedAt, session.endedAt)}
							</>
						)}
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
}: {
	sessionId: string
	status: 'active' | 'ended'
	startedAt: string
}) {
	const isLive = status === 'active'
	// Backend tick is 30s; polling more often just burns requests for stale data.
	const LIVE_POLL_MS = 30_000
	const { data: liveResp } = useSessionLiveSnapshot(sessionId, {
		refetchInterval: isLive ? LIVE_POLL_MS : false,
	})
	const { data: summaryResp } = useSessionSummary(sessionId)
	const pollInterval = isLive ? LIVE_POLL_MS : (false as const)
	const { data: timeline } = useSessionTimeline(
		sessionId,
		{ limit: 15 },
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
	const { data: roster } = useSessionRoster(isLive ? undefined : sessionId)

	const snapshot = liveResp?.snapshot ?? null
	const summary = summaryResp?.summary ?? null

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
			{stats.length > 0 && <SessionStatsGrid stats={stats} />}

			{isLive
				? currentMembers && (
						<CurrentMembersPanel
							sessionId={sessionId}
							members={currentMembers.members}
							groupCounts={currentMembers.groupCounts}
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
					Fleet data updates every 30 seconds.
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
					<ul className="space-y-2">
						{timeline.slice(0, 15).map((ev) => (
							<li key={ev.id} className="text-sm flex items-baseline gap-3">
								<time className="font-mono text-xs text-muted-foreground">
									{new Date(ev.eventTimestamp).toLocaleTimeString()}
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
								<span className="text-muted-foreground">
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
							requires the <code>urn:fleet-tracking:view-all</code> permission. Contact your alliance
							leadership if you need access.
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
