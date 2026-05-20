import { CalendarClock, ExternalLink, MapPin, User, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { EventStatusBadge } from './EventStatusBadge'
import { formatDuration, formatEveTime, formatLocal, formatRelative } from '../format'
import { discordEventUrl } from '../types'

import type { DiscordScheduledEvent } from '../types'

interface EventDetailDialogProps {
	event: DiscordScheduledEvent | null
	open: boolean
	onOpenChange: (open: boolean) => void
}

/** A small labelled detail row. */
function DetailRow({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
	return (
		<div className="flex items-start gap-2 text-sm">
			<Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
			<span className="text-foreground">{children}</span>
		</div>
	)
}

/**
 * Detailed read-only popup for a single Discord scheduled event.
 * The primary action links out to Discord, where users can RSVP.
 */
export function EventDetailDialog({ event, open, onOpenChange }: EventDetailDialogProps) {
	if (!event) return null

	const duration = event.scheduledEndTime
		? formatDuration(event.scheduledStartTime, event.scheduledEndTime)
		: null
	// Prefer the resolved EVE main character; never show the raw Discord name.
	const creatorName = event.creatorMainCharacter

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg overflow-hidden p-0">
				{event.imageUrl && (
					<img
						src={event.imageUrl}
						alt=""
						className="h-40 w-full object-cover"
					/>
				)}

				<div className="space-y-4 p-6">
					<DialogHeader>
						<div className="flex flex-wrap items-center gap-2">
							<DialogTitle>{event.name}</DialogTitle>
							<EventStatusBadge status={event.status} />
						</div>
					</DialogHeader>

					{event.description && (
						<p className="whitespace-pre-line text-sm text-muted-foreground">
							{event.description}
						</p>
					)}

					<div className="space-y-2 border-t pt-4">
						<DetailRow icon={CalendarClock}>
							<span>
								{formatLocal(event.scheduledStartTime, {
									dateStyle: 'full',
									timeStyle: 'short',
								})}
								{event.scheduledEndTime && (
									<span className="text-muted-foreground">
										{' – '}
										{formatLocal(event.scheduledEndTime, { timeStyle: 'short' })}
										{duration ? ` (${duration})` : ''}
									</span>
								)}
							</span>
							{/* EVE (UTC) time + countdown — EVE runs on UTC. */}
							<span className="mt-0.5 block text-xs text-muted-foreground">
								{formatEveTime(event.scheduledStartTime)}
								{event.scheduledEndTime
									? ` – ${formatEveTime(event.scheduledEndTime)}`
									: ''}{' '}
								· {formatRelative(event.scheduledStartTime)}
							</span>
						</DetailRow>

						{event.location && <DetailRow icon={MapPin}>{event.location}</DetailRow>}

						{event.userCount !== null && event.userCount > 0 && (
							<DetailRow icon={Users}>
								{event.userCount} interested
							</DetailRow>
						)}

						{creatorName && (
							<DetailRow icon={User}>
								Created by <span className="font-medium">{creatorName}</span>
							</DetailRow>
						)}
					</div>

					<Button asChild className="w-full">
						<a href={discordEventUrl(event)} target="_blank" rel="noopener noreferrer">
							<ExternalLink className="h-4 w-4" />
							Open in Discord
						</a>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
