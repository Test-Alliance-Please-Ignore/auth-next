/**
 * Application Card Component
 *
 * Compact card for displaying application summary in list views.
 * Features character portrait, name, status, timestamp, and recommendation count.
 */

import { formatDistanceToNow } from 'date-fns'
import { MessageSquare } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { MemberAvatar } from '@/components/member-avatar'
import { cn } from '@/lib/utils'

import { ApplicationStatusBadge } from './application-status-badge'

import type { Application } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface ApplicationCardProps {
	application: Application
	onClick?: (application: Application) => void
	className?: string
}

// ============================================================================
// Component
// ============================================================================

/**
 * Compact card component for displaying application information
 *
 * @example
 * ```tsx
 * <ApplicationCard
 *   application={application}
 *   onClick={(app) => navigate(`/applications/${app.id}`)}
 * />
 * ```
 */
export function ApplicationCard({ application, onClick, className }: ApplicationCardProps) {
	const handleClick = () => {
		if (onClick) {
			onClick(application)
		}
	}

	const isInteractive = !!onClick

	return (
		<Card
			variant={isInteractive ? 'interactive' : 'default'}
			className={cn(
				'transition-all duration-200',
				isInteractive && 'hover:shadow-elevated',
				className
			)}
			onClick={handleClick}
		>
			<CardContent className="p-4">
				<div className="flex items-start gap-4">
					{/* Character Portrait */}
					<MemberAvatar
						characterId={application.characterId}
						characterName={application.characterName}
						size="md"
					/>

					{/* Application Info */}
					<div className="flex-1 min-w-0 space-y-2">
						{/* Character Name and Status */}
						<div className="flex items-start justify-between gap-3">
							<div className="flex-1 min-w-0">
								<h3 className="text-base font-semibold text-foreground truncate">
									{application.characterName}
								</h3>
								{application.corporationName && (
									<p className="text-sm text-muted-foreground truncate">
										{application.corporationName}
									</p>
								)}
							</div>
							<ApplicationStatusBadge status={application.status} size="sm" />
						</div>

						{/* Application Text Preview */}
						<p className="text-sm text-muted-foreground line-clamp-2">
							{application.applicationText}
						</p>

						{/* Metadata Row */}
						<div className="flex items-center justify-between text-xs text-muted-foreground">
							{/* Timestamp */}
							<span>
								{formatDistanceToNow(new Date(application.createdAt), { addSuffix: true })}
							</span>

							{/* Recommendation Count */}
							{application.recommendationCount !== undefined &&
								application.recommendationCount > 0 && (
									<div className="flex items-center gap-1">
										<MessageSquare className="h-3.5 w-3.5" />
										<span>{application.recommendationCount}</span>
									</div>
								)}
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
