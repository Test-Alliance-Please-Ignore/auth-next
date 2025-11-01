/**
 * Recommendation Card Component
 *
 * Displays a single recommendation with character info, sentiment, text,
 * and edit/delete actions for the recommendation owner.
 */

import { formatDistanceToNow } from 'date-fns'
import { Edit, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { MemberAvatar } from '@/components/member-avatar'
import { cn } from '@/lib/utils'

import { RecommendationSentimentBadge } from './recommendation-sentiment-badge'

import type { Recommendation } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface RecommendationCardProps {
	recommendation: Recommendation
	canEdit?: boolean
	canDelete?: boolean
	onEdit?: (rec: Recommendation) => void
	onDelete?: (rec: Recommendation) => void
	className?: string
}

// ============================================================================
// Component
// ============================================================================

/**
 * Card that displays a recommendation with character portrait, sentiment, and text
 *
 * @example
 * ```tsx
 * <RecommendationCard
 *   recommendation={rec}
 *   canEdit={isOwner}
 *   canDelete={isOwner}
 *   onEdit={handleEdit}
 *   onDelete={handleDelete}
 * />
 * ```
 */
export function RecommendationCard({
	recommendation,
	canEdit = false,
	canDelete = false,
	onEdit,
	onDelete,
	className,
}: RecommendationCardProps) {
	const sentimentBorderColor = {
		positive: 'border-l-success',
		neutral: 'border-l-primary',
		negative: 'border-l-warning',
	}[recommendation.sentiment]

	const showActions = (canEdit || canDelete) && (onEdit || onDelete)

	return (
		<Card
			className={cn(
				'border-l-4 transition-shadow hover:shadow-md',
				sentimentBorderColor,
				className
			)}
			variant="elevated"
		>
			<CardHeader className="pb-3">
				<div className="flex items-start gap-3">
					{/* Character Portrait */}
					<MemberAvatar
						characterId={recommendation.characterId}
						characterName={recommendation.characterName}
						size="sm"
					/>

					{/* Character Info and Sentiment */}
					<div className="flex-1 min-w-0">
						<div className="flex items-start justify-between gap-2">
							<div className="flex-1 min-w-0">
								<h3 className="font-semibold text-foreground truncate">
									{recommendation.characterName}
								</h3>
								<p className="text-sm text-muted-foreground">
									Recommended{' '}
									{formatDistanceToNow(new Date(recommendation.createdAt), { addSuffix: true })}
								</p>
							</div>
							<RecommendationSentimentBadge sentiment={recommendation.sentiment} size="sm" />
						</div>
					</div>
				</div>
			</CardHeader>

			<CardContent className="pb-4">
				<p className="text-foreground whitespace-pre-wrap leading-relaxed">
					"{recommendation.recommendationText}"
				</p>
			</CardContent>

			{showActions && (
				<CardFooter className="pt-0 pb-4 flex justify-end gap-2">
					{canEdit && onEdit && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onEdit(recommendation)}
							className="text-muted-foreground hover:text-foreground"
						>
							<Edit className="h-4 w-4 mr-1.5" />
							Edit
						</Button>
					)}
					{canDelete && onDelete && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onDelete(recommendation)}
							className="text-muted-foreground hover:text-destructive"
						>
							<Trash2 className="h-4 w-4 mr-1.5" />
							Delete
						</Button>
					)}
				</CardFooter>
			)}
		</Card>
	)
}
