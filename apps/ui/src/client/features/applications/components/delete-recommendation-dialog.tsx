/**
 * Delete Recommendation Dialog Component
 *
 * Confirmation dialog for deleting recommendations.
 * Shows warning message and requires explicit confirmation.
 */

import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DestructiveButton } from '@/components/ui/destructive-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useMessage } from '@/hooks/useMessage'

import { useDeleteRecommendation } from '../hooks'

import type { Recommendation } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface DeleteRecommendationDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	recommendation: Recommendation | null
	onSuccess?: () => void
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog for confirming recommendation deletion
 *
 * @example
 * ```tsx
 * <DeleteRecommendationDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   recommendation={selectedRecommendation}
 *   onSuccess={handleSuccess}
 * />
 * ```
 */
export function DeleteRecommendationDialog({
	open,
	onOpenChange,
	recommendation,
	onSuccess,
}: DeleteRecommendationDialogProps) {
	const { showSuccess, showError } = useMessage()
	const deleteMutation = useDeleteRecommendation()

	const handleDelete = async () => {
		if (!recommendation) return

		try {
			await deleteMutation.mutateAsync({
				applicationId: recommendation.applicationId,
				recommendationId: recommendation.id,
			})

			showSuccess('Recommendation deleted successfully')
			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Failed to delete recommendation'
			showError(message)
		}
	}

	const handleCancel = () => {
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<div className="flex items-center gap-3 mb-2">
						<div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
							<AlertTriangle className="h-5 w-5 text-destructive" />
						</div>
						<DialogTitle>Delete Recommendation</DialogTitle>
					</div>
					<DialogDescription className="text-base">
						Are you sure you want to delete your recommendation? This action cannot be undone.
					</DialogDescription>
				</DialogHeader>

				{recommendation && (
					<div className="rounded-lg border bg-muted/50 p-4">
						<p className="text-sm text-muted-foreground mb-1">Your recommendation:</p>
						<p className="text-sm italic line-clamp-3">
							"{recommendation.recommendationText}"
						</p>
					</div>
				)}

				<DialogFooter>
					<Button
						variant="outline"
						onClick={handleCancel}
						disabled={deleteMutation.isPending}
					>
						Cancel
					</Button>
					<DestructiveButton
						onClick={handleDelete}
						loading={deleteMutation.isPending}
						loadingText="Deleting..."
					>
						Delete Recommendation
					</DestructiveButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
