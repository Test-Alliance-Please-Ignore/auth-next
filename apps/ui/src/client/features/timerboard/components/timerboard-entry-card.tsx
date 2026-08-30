import { DurationDisplay } from '@/components/ui/duration-display'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { formatDurationBetween } from '@/lib/duration-utils'
import { cn } from '@/lib/utils'

import type { TimerboardEntry } from '../types'

const priorityStyles: Record<TimerboardEntry['priority'], string> = {
	critical: 'bg-destructive',
	high: 'bg-orange-500',
	normal: 'bg-primary',
	low: 'bg-muted-foreground',
}

function eveClock(instant: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'UTC',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(new Date(instant))
}

function eveDate(instant: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'UTC',
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	}).format(new Date(instant))
}

export function TimerboardEntryCard({ entry, nowMs }: { entry: TimerboardEntry; nowMs: number }) {
	const priorityLabel = `${entry.priority[0]?.toUpperCase()}${entry.priority.slice(1)} priority`
	const location = [entry.systemName, entry.entityName].filter(Boolean).join(' · ')
	const isOverdue =
		Date.parse(entry.startsAt) < nowMs && ['planned', 'covered'].includes(entry.state)

	return (
		<article
			className="rounded-lg border border-border bg-card p-4 shadow-sm"
			aria-label={entry.title}
		>
			<div className="flex gap-3">
				<span
					className={cn('mt-1 h-3 w-3 shrink-0 rounded-full', priorityStyles[entry.priority])}
					aria-hidden="true"
				/>
				<div className="min-w-0 flex-1 space-y-2">
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div>
							<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
								{entry.kind} · {entry.side} · <span>{priorityLabel}</span>
							</p>
							<h2 className="text-base font-semibold text-foreground">{entry.title}</h2>
						</div>
						<span className="text-xs font-medium text-muted-foreground">
							{isOverdue ? (
								<>Overdue · {formatDurationBetween(entry.startsAt, nowMs, { maxUnits: 2 })}</>
							) : (
								<>
									In{' '}
									<DurationDisplay endDate={entry.startsAt} referenceTimeMs={nowMs} maxUnits={2} />
								</>
							)}
						</span>
					</div>

					{location ? <p className="text-sm text-muted-foreground">{location}</p> : null}
					<p className="text-sm text-foreground">
						{entry.endsAt ? (
							<>
								Starts {eveDate(entry.startsAt)}, {eveClock(entry.startsAt)}–
								{eveDate(entry.endsAt) === eveDate(entry.startsAt)
									? eveClock(entry.endsAt)
									: `${eveDate(entry.endsAt)}, ${eveClock(entry.endsAt)}`}{' '}
								EVE
							</>
						) : (
							<>
								Starts <EveTimeDisplay dateStr={entry.startsAt} format="compact" />
							</>
						)}
					</p>
					<p className="text-xs text-muted-foreground">
						{entry.assignedCharacterName
							? `Response owner: ${entry.assignedCharacterName}`
							: 'Response owner: Unassigned'}
					</p>
				</div>
			</div>
		</article>
	)
}
