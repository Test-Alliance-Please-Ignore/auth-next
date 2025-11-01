/**
 * Application Timeline Component
 *
 * Vertical timeline showing application status history and activity.
 * Displays with colored dots matching status colors, timestamps, and actors.
 */

import { formatDistanceToNow } from 'date-fns'
import { CheckCircle, Clock, Eye, Minus, User, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

import type { ApplicationActivityLogEntry } from '../api'
import type { LucideIcon } from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

export interface ApplicationTimelineProps {
	activityLog: ApplicationActivityLogEntry[]
	showActors?: boolean
	className?: string
}

// ============================================================================
// Activity Configuration
// ============================================================================

/**
 * Maps action types to display configuration
 */
const actionConfig: Record<
	string,
	{
		label: string
		icon: LucideIcon
		colorClasses: string
	}
> = {
	created: {
		label: 'Application Submitted',
		icon: Clock,
		colorClasses: 'bg-accent text-accent-foreground',
	},
	status_changed_pending: {
		label: 'Status: Pending',
		icon: Clock,
		colorClasses: 'bg-accent text-accent-foreground',
	},
	status_changed_under_review: {
		label: 'Status: Under Review',
		icon: Eye,
		colorClasses: 'bg-primary text-primary-foreground',
	},
	status_changed_accepted: {
		label: 'Status: Accepted',
		icon: CheckCircle,
		colorClasses: 'bg-success text-success-foreground',
	},
	status_changed_rejected: {
		label: 'Status: Rejected',
		icon: XCircle,
		colorClasses: 'bg-destructive text-destructive-foreground',
	},
	status_changed_withdrawn: {
		label: 'Status: Withdrawn',
		icon: Minus,
		colorClasses: 'bg-muted text-muted-foreground',
	},
	recommendation_added: {
		label: 'Recommendation Added',
		icon: User,
		colorClasses: 'bg-primary text-primary-foreground',
	},
	recommendation_updated: {
		label: 'Recommendation Updated',
		icon: User,
		colorClasses: 'bg-primary text-primary-foreground',
	},
	recommendation_deleted: {
		label: 'Recommendation Deleted',
		icon: User,
		colorClasses: 'bg-muted text-muted-foreground',
	},
	note_added: {
		label: 'Note Added',
		icon: User,
		colorClasses: 'bg-primary text-primary-foreground',
	},
}

/**
 * Get configuration for an activity log entry
 * Falls back to generic defaults if action not in config
 */
function getActionConfig(action: string) {
	// Try exact match first
	if (actionConfig[action]) {
		return actionConfig[action]
	}

	// Try with status change prefix
	if (action.startsWith('status_changed_')) {
		return actionConfig[action] || actionConfig.status_changed_pending
	}

	// Default fallback
	return {
		label: action.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
		icon: User,
		colorClasses: 'bg-muted text-muted-foreground',
	}
}

// ============================================================================
// Component
// ============================================================================

/**
 * Timeline component showing application activity history
 *
 * @example
 * ```tsx
 * <ApplicationTimeline
 *   activityLog={activityLog}
 *   showActors={true}
 * />
 * ```
 */
export function ApplicationTimeline({
	activityLog,
	showActors = true,
	className,
}: ApplicationTimelineProps) {
	if (!activityLog || activityLog.length === 0) {
		return (
			<div className={cn('text-center py-8 text-muted-foreground', className)}>
				<p>No activity to display</p>
			</div>
		)
	}

	// Sort by timestamp descending (most recent first)
	const sortedLog = [...activityLog].sort(
		(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
	)

	return (
		<div className={cn('space-y-4', className)}>
			{sortedLog.map((entry, index) => {
				const config = getActionConfig(entry.action)
				const Icon = config.icon
				const isLast = index === sortedLog.length - 1

				return (
					<div key={entry.id} className="relative flex gap-3">
						{/* Timeline Line */}
						{!isLast && (
							<div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
						)}

						{/* Timeline Dot */}
						<div className="relative flex-shrink-0">
							<div
								className={cn(
									'flex h-8 w-8 items-center justify-center rounded-full border-2 border-background',
									config.colorClasses
								)}
							>
								<Icon className="h-4 w-4" />
							</div>
						</div>

						{/* Timeline Content */}
						<div className="flex-1 pt-0.5 pb-4">
							<div className="flex items-start justify-between gap-2">
								<div className="flex-1 space-y-1">
									{/* Action Label */}
									<p className="text-sm font-medium text-foreground">{config.label}</p>

									{/* Actor (if shown and available) */}
									{showActors && entry.characterName ? (
										<p className="text-xs text-muted-foreground">
											by {entry.characterName}
										</p>
									) : null}

									{/* Additional Metadata */}
									{entry.newValue && entry.action.startsWith('status_changed_') ? (
										<p className="text-xs text-muted-foreground">
											{entry.previousValue ? (
												<span>
													Changed from <span className="font-medium">{entry.previousValue}</span> to{' '}
												</span>
											) : null}
											<span className="font-medium">{entry.newValue}</span>
										</p>
									) : null}

									{/* Review Notes (if present) */}
									{entry.metadata?.reviewNotes ? (
										<p className="text-sm text-muted-foreground mt-2 italic">
											"{String(entry.metadata.reviewNotes)}"
										</p>
									) : null}
								</div>

								{/* Timestamp */}
								<time className="text-xs text-muted-foreground whitespace-nowrap">
									{formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
								</time>
							</div>
						</div>
					</div>
				)
			})}
		</div>
	)
}
