import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'

import { Card, CardContent } from '@/components/ui/card'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { formatRelativeTime } from '@/lib/date-utils'
import { formatDurationBetween, formatEndReason } from '../utils/format'
import { SessionStatusPill } from './session-status-pill'

import type { TrackingSession } from '../types'

interface SessionCardProps {
	session: TrackingSession
}

export function SessionCard({ session }: SessionCardProps) {
	const isActive = session.status === 'active'
	const trackedFleetBossName =
		session.currentFleetBossCharacterName ?? session.currentCommanderCharacterName ?? session.characterName
	const trackedFleetBossId =
		session.currentFleetBossCharacterId ?? session.currentCommanderCharacterId ?? session.characterId

	return (
		<Link
			to={`/fleet-tracking/${session.id}`}
			className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
		>
			<Card className="transition-colors group-hover:bg-accent/40 cursor-pointer">
				<CardContent className="p-4">
					<div className="flex items-center justify-between gap-4">
						<div className="space-y-1.5 min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<SessionStatusPill status={session.status} />
								<h3 className="font-semibold truncate">{session.name}</h3>
							</div>
							<div className="text-sm text-muted-foreground">
								Tracked FC:{' '}
								{trackedFleetBossName ?? <span className="font-mono">{trackedFleetBossId}</span>}
								{' • '}
								{isActive ? (
									<>Running {formatDurationBetween(session.startedAt, null)}</>
								) : (
									<>
										<EveTimeDisplay dateStr={session.startedAt} /> →{' '}
										{session.endedAt && <EveTimeDisplay dateStr={session.endedAt} />}
										{' • '}
										{formatDurationBetween(session.startedAt, session.endedAt)}
										{session.endedReason && (
											<>
												{' • '}
												{formatEndReason(session.endedReason)}
											</>
										)}
									</>
								)}
							</div>
							{trackedFleetBossId !== session.characterId ? (
								<div className="text-xs text-muted-foreground">
									Initial FC:{' '}
									{session.characterName ?? <span className="font-mono">{session.characterId}</span>}
								</div>
							) : null}
							{isActive && (
								<div className="text-xs text-muted-foreground">
									Started {formatRelativeTime(session.startedAt)}
								</div>
							)}
						</div>
						<ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
					</div>
				</CardContent>
			</Card>
		</Link>
	)
}
