/**
 * Recommendation List Component
 *
 * Displays all recommendations for an application in a responsive grid.
 * Includes loading states, empty states, and error handling.
 */

import { MessageSquare, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/ui/loading'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { RecommendationCard } from './recommendation-card'
import { useRecommendations } from '../hooks'

import type { Recommendation } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface RecommendationListProps {
	applicationId: string
	currentUserId?: string
	onAddRecommendation?: () => void
	onEditRecommendation?: (rec: Recommendation) => void
	onDeleteRecommendation?: (rec: Recommendation) => void
	className?: string
}

// ============================================================================
// Loading Skeleton
// ============================================================================

function RecommendationCardSkeleton() {
	return (
		<Card variant="elevated">
			<CardHeader className="pb-3">
				<div className="flex items-start gap-3">
					<Skeleton className="h-8 w-8 rounded" />
					<div className="flex-1 space-y-2">
						<Skeleton className="h-5 w-32" />
						<Skeleton className="h-4 w-40" />
					</div>
					<Skeleton className="h-6 w-20 rounded-full" />
				</div>
			</CardHeader>
			<CardContent>
				<Skeleton className="h-4 w-full mb-2" />
				<Skeleton className="h-4 w-full mb-2" />
				<Skeleton className="h-4 w-3/4" />
			</CardContent>
		</Card>
	)
}

function LoadingState() {
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
			<RecommendationCardSkeleton />
			<RecommendationCardSkeleton />
		</div>
	)
}

// ============================================================================
// Empty State
// ============================================================================

interface EmptyStateProps {
	onAddRecommendation?: () => void
}

function EmptyState({ onAddRecommendation }: EmptyStateProps) {
	return (
		<div className="text-center py-12">
			<MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
			<h3 className="text-lg font-semibold text-foreground mb-2">No recommendations yet</h3>
			<p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
				Community members can vouch for this applicant by adding their recommendation.
			</p>
			{onAddRecommendation && (
				<Button onClick={onAddRecommendation} size="sm">
					<Plus className="h-4 w-4 mr-2" />
					Add Recommendation
				</Button>
			)}
		</div>
	)
}

// ============================================================================
// Error State
// ============================================================================

interface ErrorStateProps {
	error: Error
	onRetry: () => void
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
	return (
		<div className="text-center py-12">
			<Card className="max-w-md mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
				<CardHeader>
					<CardTitle className="text-red-900 dark:text-red-100">
						Failed to Load Recommendations
					</CardTitle>
					<CardDescription className="text-red-700 dark:text-red-300">
						{error.message || 'An unexpected error occurred'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button variant="outline" onClick={onRetry}>
						Try Again
					</Button>
				</CardContent>
			</Card>
		</div>
	)
}

// ============================================================================
// Component
// ============================================================================

/**
 * List component that displays all recommendations for an application
 *
 * @example
 * ```tsx
 * <RecommendationList
 *   applicationId={applicationId}
 *   currentUserId={user?.id}
 *   onAddRecommendation={handleAddRecommendation}
 *   onEditRecommendation={handleEditRecommendation}
 *   onDeleteRecommendation={handleDeleteRecommendation}
 * />
 * ```
 */
export function RecommendationList({
	applicationId,
	currentUserId,
	onAddRecommendation,
	onEditRecommendation,
	onDeleteRecommendation,
	className,
}: RecommendationListProps) {
	const { data: recommendations, isLoading, error, refetch } = useRecommendations(applicationId)

	// Sort recommendations by date (newest first)
	const sortedRecommendations = recommendations
		? [...recommendations].sort(
				(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
			)
		: []

	// Check if user already has a recommendation
	const userHasRecommendation = currentUserId
		? sortedRecommendations.some((rec) => rec.userId === currentUserId)
		: false

	// Determine if "Add Recommendation" button should be shown
	const canAddRecommendation = onAddRecommendation && !userHasRecommendation

	// Loading state
	if (isLoading) {
		return (
			<div className={className}>
				<LoadingState />
			</div>
		)
	}

	// Error state
	if (error) {
		return (
			<div className={className}>
				<ErrorState error={error as Error} onRetry={() => refetch()} />
			</div>
		)
	}

	// Empty state
	if (!sortedRecommendations.length) {
		return (
			<div className={className}>
				<EmptyState onAddRecommendation={canAddRecommendation ? onAddRecommendation : undefined} />
			</div>
		)
	}

	// Main content
	return (
		<div className={cn('space-y-4', className)}>
			{/* Header with count and add button */}
			<div className="flex items-center justify-between">
				<h3 className="text-lg font-semibold text-foreground">
					Recommendations ({sortedRecommendations.length})
				</h3>
				{canAddRecommendation && (
					<Button onClick={onAddRecommendation} size="sm" variant="outline">
						<Plus className="h-4 w-4 mr-2" />
						Add Recommendation
					</Button>
				)}
			</div>

			{/* Recommendations Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{sortedRecommendations.map((recommendation) => {
					const isOwner = currentUserId === recommendation.userId

					return (
						<RecommendationCard
							key={recommendation.id}
							recommendation={recommendation}
							canEdit={isOwner}
							canDelete={isOwner}
							onEdit={onEditRecommendation}
							onDelete={onDeleteRecommendation}
						/>
					)
				})}
			</div>
		</div>
	)
}
