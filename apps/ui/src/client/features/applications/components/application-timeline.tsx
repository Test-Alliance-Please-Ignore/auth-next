/** Activity history shared by applicant and reviewer views. */
import { CheckCircle, Clock, Eye, Minus, User, XCircle } from 'lucide-react'

import { MemberAvatar } from '@/components/member-avatar'
import { useAppTranslation } from '@/i18n'
import { formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import type { LucideIcon } from 'lucide-react'
import type { AppTranslationKey, AppTranslator } from '@/i18n'
import type { ApplicationActivityLogEntry, ApplicationStatus } from '../api'

export interface ApplicationTimelineProps {
	activityLog: ApplicationActivityLogEntry[]
	showActors?: boolean
	className?: string
}

type ActivityStyle = { icon: LucideIcon; colorClasses: string }
const defaultStyle: ActivityStyle = { icon: User, colorClasses: 'bg-muted text-muted-foreground' }
const activeStyle: ActivityStyle = {
	icon: User,
	colorClasses: 'bg-primary text-primary-foreground',
}
const statusStyles: Record<ApplicationStatus, ActivityStyle> = {
	pending: { icon: Clock, colorClasses: 'bg-accent text-accent-foreground' },
	under_review: { icon: Eye, colorClasses: 'bg-primary text-primary-foreground' },
	accepted: { icon: CheckCircle, colorClasses: 'bg-success text-success-foreground' },
	completed: { icon: CheckCircle, colorClasses: 'bg-emerald-500 text-white' },
	rejected: { icon: XCircle, colorClasses: 'bg-destructive text-destructive-foreground' },
	withdrawn: { icon: Minus, colorClasses: 'bg-muted text-muted-foreground' },
}

const actionConfig: Record<string, ActivityStyle & { labelKey: AppTranslationKey }> = {
	created: { ...statusStyles.pending, labelKey: 'applications.timeline.actions.submitted' },
	submitted: { ...statusStyles.pending, labelKey: 'applications.timeline.actions.submitted' },
	withdrawn: { ...statusStyles.withdrawn, labelKey: 'applications.timeline.actions.withdrawn' },
	recommendation_added: {
		...activeStyle,
		labelKey: 'applications.timeline.actions.recommendation_added',
	},
	recommendation_updated: {
		...activeStyle,
		labelKey: 'applications.timeline.actions.recommendation_updated',
	},
	recommendation_deleted: {
		...defaultStyle,
		labelKey: 'applications.timeline.actions.recommendation_deleted',
	},
	note_added: { ...activeStyle, labelKey: 'applications.timeline.actions.note_added' },
	alt_added: { ...activeStyle, labelKey: 'applications.timeline.actions.alt_added' },
	alt_removed: { ...defaultStyle, labelKey: 'applications.timeline.actions.alt_removed' },
}

function statusLabel(status: string, t: AppTranslator): string {
	return Object.hasOwn(statusStyles, status)
		? t(`applications.status.${status as ApplicationStatus}`)
		: status
}

function getActionConfig(action: string, t: AppTranslator) {
	if (Object.hasOwn(actionConfig, action)) {
		const config = actionConfig[action]
		return { ...config, label: t(config.labelKey) }
	}

	if (action.startsWith('status_changed_')) {
		const status = action.slice('status_changed_'.length)
		return {
			...(Object.hasOwn(statusStyles, status)
				? statusStyles[status as ApplicationStatus]
				: defaultStyle),
			label: t('applications.timeline.status', { status: statusLabel(status, t) }),
		}
	}

	// Preserve unknown server codes rather than assigning them a known status.
	return { ...defaultStyle, label: t('applications.timeline.unknownAction', { action }) }
}

export function ApplicationTimeline({
	activityLog,
	showActors = true,
	className,
}: ApplicationTimelineProps) {
	const { t } = useAppTranslation()
	// Messages have their own tab. Check emptiness after filtering them out.
	const sortedLog = [...activityLog]
		.filter((entry) => entry.action !== 'message_sent')
		.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

	if (sortedLog.length === 0) {
		return (
			<div className={cn('text-center py-8 text-muted-foreground', className)}>
				<p>{t('applications.timeline.empty')}</p>
			</div>
		)
	}

	return (
		<div className={cn('space-y-4', className)}>
			{sortedLog.map((entry, index) => {
				const resolvedAction =
					entry.action === 'status_changed' && entry.newValue
						? `status_changed_${entry.newValue}`
						: entry.action
				const config = getActionConfig(resolvedAction, t)
				const Icon = config.icon
				const altId = entry.action === 'alt_added' ? entry.newValue : entry.previousValue
				const altName = entry.metadata?.altCharacterName
					? String(entry.metadata.altCharacterName)
					: undefined

				return (
					<div key={entry.id} className="relative flex gap-3">
						{index < sortedLog.length - 1 && (
							<div className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />
						)}
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
						<div className="flex-1 pt-0.5 pb-4">
							<div className="flex flex-wrap items-start justify-between gap-4">
								<div className="flex-1 space-y-1">
									<p className="text-sm font-medium text-foreground">{config.label}</p>
									{(entry.action === 'alt_added' || entry.action === 'alt_removed') && altId && (
										<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
											<span>
												{t(
													entry.action === 'alt_added'
														? 'applications.timeline.added'
														: 'applications.timeline.removed'
												)}
											</span>
											<MemberAvatar characterId={altId} characterName={altName} size="sm" />
											{altName && <span className="font-medium">{altName}</span>}
										</div>
									)}
									{entry.newValue && resolvedAction.startsWith('status_changed_') && (
										<p className="text-xs text-muted-foreground">
											{entry.previousValue
												? t('applications.timeline.changed', {
														previous: statusLabel(entry.previousValue, t),
														next: statusLabel(entry.newValue, t),
													})
												: statusLabel(entry.newValue, t)}
										</p>
									)}
									{entry.metadata?.reviewNotes ? (
										<p className="text-sm text-muted-foreground mt-2 italic">
											"{String(entry.metadata.reviewNotes)}"
										</p>
									) : null}
								</div>
								<div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
									<time dateTime={entry.timestamp} className="text-xs text-muted-foreground">
										{formatRelativeTime(entry.timestamp)}
									</time>
									{showActors && entry.characterId && (
										<>
											<MemberAvatar
												characterId={entry.characterId}
												characterName={entry.characterName}
												size="sm"
											/>
											<span className="text-xs text-muted-foreground">
												{t('applications.timeline.by', {
													actor: entry.characterName || entry.characterId,
												})}
											</span>
										</>
									)}
								</div>
							</div>
						</div>
					</div>
				)
			})}
		</div>
	)
}
