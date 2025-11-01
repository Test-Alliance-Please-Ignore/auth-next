/**
 * Recommendation Sentiment Badge Component
 *
 * Displays recommendation sentiment with appropriate color coding and icon.
 * Used to show positive, neutral, or negative recommendations.
 */

import { Minus, ThumbsDown, ThumbsUp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { RecommendationSentiment } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface RecommendationSentimentBadgeProps {
	sentiment: RecommendationSentiment
	size?: 'sm' | 'md' | 'lg'
	showIcon?: boolean
	className?: string
}

// ============================================================================
// Sentiment Configuration
// ============================================================================

const sentimentConfig: Record<
	RecommendationSentiment,
	{
		label: string
		icon: typeof ThumbsUp
		colorClasses: string
	}
> = {
	positive: {
		label: 'Positive',
		icon: ThumbsUp,
		colorClasses: 'text-success bg-success/10 border-success/30',
	},
	neutral: {
		label: 'Neutral',
		icon: Minus,
		colorClasses: 'text-primary bg-primary/10 border-primary/30',
	},
	negative: {
		label: 'Negative',
		icon: ThumbsDown,
		colorClasses: 'text-warning bg-warning/10 border-warning/30',
	},
}

const sizeClasses = {
	sm: 'text-xs px-2 py-0.5',
	md: 'text-sm px-2.5 py-0.5',
	lg: 'text-base px-3 py-1',
}

const iconSizeClasses = {
	sm: 'h-3 w-3',
	md: 'h-3.5 w-3.5',
	lg: 'h-4 w-4',
}

// ============================================================================
// Component
// ============================================================================

/**
 * Badge component that displays recommendation sentiment with color and icon
 *
 * @example
 * ```tsx
 * <RecommendationSentimentBadge sentiment="positive" showIcon />
 * <RecommendationSentimentBadge sentiment="neutral" size="lg" />
 * ```
 */
export function RecommendationSentimentBadge({
	sentiment,
	size = 'md',
	showIcon = true,
	className,
}: RecommendationSentimentBadgeProps) {
	const config = sentimentConfig[sentiment]
	const Icon = config.icon

	return (
		<Badge
			className={cn(
				'inline-flex items-center gap-1.5 font-medium border',
				config.colorClasses,
				sizeClasses[size],
				className
			)}
		>
			{showIcon && <Icon className={iconSizeClasses[size]} />}
			<span>{config.label}</span>
		</Badge>
	)
}
