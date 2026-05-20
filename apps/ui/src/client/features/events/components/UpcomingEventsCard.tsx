import { CalendarDays } from 'lucide-react'
import { useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { EventDetailDialog } from './EventDetailDialog'
import { EventStatusBadge } from './EventStatusBadge'
import { formatEveTime, formatLocal } from '../format'
import { useUpcomingEvents } from '../hooks'

import type { DiscordScheduledEvent } from '../types'

/**
 * Dashboard card listing all upcoming Discord events. Each row opens a
 * detail popup; events are created and managed in the Discord server.
 */
export function UpcomingEventsCard() {
	const { data: events, isLoading } = useUpcomingEvents()
	const [selected, setSelected] = useState<DiscordScheduledEvent | null>(null)
	const [dialogOpen, setDialogOpen] = useState(false)

	const openEvent = (event: DiscordScheduledEvent) => {
		setSelected(event)
		setDialogOpen(true)
	}

	const list = events ?? []

	return (
		<>
			<Card variant="default">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-xl md:text-2xl">
						<CalendarDays className="h-5 w-5 text-primary" />
						Upcoming Events
					</CardTitle>
					<CardDescription>Fleets, ops, and community events</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-2">
							{Array.from({ length: 3 }).map((_, i) => (
								<Skeleton key={i} className="h-12 w-full" />
							))}
						</div>
					) : list.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No upcoming events. Events are scheduled in the Discord server.
						</p>
					) : (
						<ul className="space-y-2">
							{list.map((event) => (
								<li key={event.id}>
									<button
										type="button"
										onClick={() => openEvent(event)}
										className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border bg-card/50 px-3 py-2 text-left transition-colors hover:bg-muted/50"
									>
										<span className="flex min-w-0 items-center gap-2">
											<EventStatusBadge status={event.status} />
											<span className="truncate font-medium text-foreground">
												{event.name}
											</span>
										</span>
										<span className="whitespace-nowrap text-right">
											<span className="block text-sm text-muted-foreground">
												{formatLocal(event.scheduledStartTime, {
													weekday: 'short',
													month: 'short',
													day: 'numeric',
													hour: '2-digit',
													minute: '2-digit',
												})}
												{event.userCount !== null && event.userCount > 0 && (
													<span className="ml-2">· {event.userCount} going</span>
												)}
											</span>
											<span className="block text-xs text-muted-foreground/70">
												{formatEveTime(event.scheduledStartTime)}
											</span>
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>

			<EventDetailDialog event={selected} open={dialogOpen} onOpenChange={setDialogOpen} />
		</>
	)
}
