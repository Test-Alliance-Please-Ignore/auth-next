/**
 * Delete Recommendation Dialog Component
 *
 * Confirmation dialog for deleting recommendations.
 * Shows warning message and requires explicit confirmation.
 */

import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useMessage } from '@/hooks/useMessage'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { useDeleteRecommendation } from '../hooks'
import { RecommendationFeedback } from './recommendation-feedback'

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
	const { t } = useAppTranslation()
	const { message, showError, clearMessage } = useMessage()
	const deleteMutation = useDeleteRecommendation()

	const handleDelete = async () => {
		if (!recommendation || deleteMutation.isPending) return
		clearMessage()

		try {
			await deleteMutation.mutateAsync({
				applicationId: recommendation.applicationId,
				recommendationId: recommendation.id,
			})

			toast.success(<RecommendationFeedback action="deleted" />)
			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			showError(
				(translate) =>
					error instanceof Error && error.message
						? error.message
						: translate('applications.recommendations.feedback.deleteFailed'),
				0
			)
		}
	}

	const handleOpenChange = (nextOpen: boolean) => {
		if (deleteMutation.isPending) return
		if (!nextOpen) clearMessage()
		onOpenChange(nextOpen)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<div className="flex items-center gap-3 mb-2">
						<div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
							<AlertTriangle className="h-5 w-5 text-destructive" />
						</div>
						<DialogTitle>{t('applications.recommendations.delete.title')}</DialogTitle>
					</div>
					<DialogDescription className="text-base">
						{t('applications.recommendations.delete.description')}
					</DialogDescription>
				</DialogHeader>

				{recommendation && (
					<div className="rounded-lg border bg-muted/50 p-4">
						<p className="text-sm text-muted-foreground mb-1">
							{t('applications.recommendations.delete.preview')}
						</p>
						<p className="text-sm italic line-clamp-3 break-words">
							"{recommendation.recommendationText}"
						</p>
					</div>
				)}

				{message && (
					<p role="alert" className="text-sm text-destructive break-words">
						{message.text}
					</p>
				)}
				<DialogFooter>
					<Button
						variant="ghost"
						onClick={() => handleOpenChange(false)}
						disabled={deleteMutation.isPending}
					>
						{t('common.cancel')}
					</Button>
					<Button
						variant="destructive"
						onClick={handleDelete}
						loading={deleteMutation.isPending}
						disabled={!recommendation}
						loadingText={t('applications.recommendations.delete.pending')}
					>
						{t('applications.recommendations.delete.title')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
