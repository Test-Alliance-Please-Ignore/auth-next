/**
 * Application Card Component
 *
 * Compact card for displaying application summary in list views.
 * Features character portrait, name, status, timestamp, and recommendation count.
 */

import { MessageSquare } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatNumber, useAppTranslation } from '@/i18n'
import { formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import { ApplicationCharacterStack } from './application-character-stack'
import { ApplicationStatusBadge } from './application-status-badge'

import type { ApplicationListItem } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface ApplicationCardProps {
	application: ApplicationListItem
	onClick?: (application: ApplicationListItem) => void
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
	const { t } = useAppTranslation()
	const handleClick = () => {
		if (onClick) {
			onClick(application)
		}
	}

	const isInteractive = !!onClick

	const altCharacters = application.altCharacters ?? []
	const altCharacterIds = altCharacters.map((character) => character.characterId)
	const altCharacterNames = Object.fromEntries(
		altCharacters.map((character) => [character.characterId, character.characterName])
	)

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
					<ApplicationCharacterStack
						mainCharacterId={application.characterId}
						mainCharacterName={application.characterName}
						altCharacterIds={altCharacterIds}
						altCharacterNames={altCharacterNames}
						size="md"
					/>

					{/* Application Info */}
					<div className="flex-1 min-w-0 space-y-2">
						{/* Character Name and Status */}
						<div className="flex items-start justify-between gap-3">
							<div className="flex-1 min-w-0">
								<h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
									<span className="min-w-0 truncate">{application.characterName}</span>
									{application.isFirstApplication !== undefined && (
										<Badge
											variant={application.isFirstApplication ? 'success' : 'default'}
											className="h-5 px-1.5 text-[10px] font-semibold leading-none"
										>
											{t(
												application.isFirstApplication
													? 'applications.card.first'
													: 'applications.card.repeat'
											)}
										</Badge>
									)}
								</h3>
								{altCharacterIds.length > 0 && (
									<div className="text-sm font-normal text-muted-foreground">
										{t('applications.card.alts', {
											count: altCharacterIds.length,
											formattedCount: formatNumber(altCharacterIds.length),
										})}
									</div>
								)}
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
							{application.applicationTextPreview ?? t('applications.card.submitted')}
						</p>

						{/* Metadata Row */}
						<div className="flex items-center justify-between text-xs text-muted-foreground">
							{/* Timestamp */}
							<span>{formatRelativeTime(application.createdAt)}</span>

							{/* Recommendation Count */}
							{application.recommendationCount !== undefined &&
								application.recommendationCount > 0 && (
									<div
										className="flex items-center gap-1"
										title={t('applications.card.recommendations', {
											count: application.recommendationCount,
											formattedCount: formatNumber(application.recommendationCount),
										})}
									>
										<MessageSquare className="h-3.5 w-3.5" />
										<span>{formatNumber(application.recommendationCount)}</span>
									</div>
								)}
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	)
}
