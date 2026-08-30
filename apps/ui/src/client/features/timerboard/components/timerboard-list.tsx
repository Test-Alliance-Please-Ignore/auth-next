import { TimerboardEntryCard } from './timerboard-entry-card'

import type { TimerboardEntry } from '../types'

interface TimerboardListProps {
	entries: TimerboardEntry[]
	nowMs: number
	isLoading?: boolean
	error?: string | null
	onSelect?: (entry: TimerboardEntry) => void
}

export function TimerboardList({
	entries,
	nowMs,
	isLoading = false,
	error,
	onSelect,
}: TimerboardListProps) {
	if (isLoading) {
		return (
			<div
				className="rounded-lg border border-border p-8 text-center text-muted-foreground"
				role="status"
			>
				Loading timers…
			</div>
		)
	}

	if (error) {
		return (
			<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6" role="alert">
				<p className="font-medium text-destructive">{error}</p>
				<p className="mt-1 text-sm text-muted-foreground">Try again or refresh the page.</p>
			</div>
		)
	}

	if (entries.length === 0) {
		return (
			<div className="rounded-lg border border-dashed border-border p-10 text-center">
				<p className="font-medium text-foreground">No timers match these filters</p>
				<p className="mt-1 text-sm text-muted-foreground">
					Try a wider time range or create a new timer.
				</p>
			</div>
		)
	}

	return (
		<div className="space-y-3" aria-label="Timerboard entries">
			{entries.map((entry) =>
				onSelect ? (
					<button
						key={entry.id}
						type="button"
						className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => onSelect(entry)}
						aria-label={`Open ${entry.title}`}
					>
						<TimerboardEntryCard entry={entry} nowMs={nowMs} />
					</button>
				) : (
					<TimerboardEntryCard key={entry.id} entry={entry} nowMs={nowMs} />
				)
			)}
		</div>
	)
}
