/**
 * Delete HR Note Dialog Component
 *
 * Confirmation dialog for deleting HR notes.
 * Shows note preview and requires explicit confirmation.
 *
 * SECURITY: This dialog should only be opened for admin users.
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

import { HRNoteTypeBadge } from './hr-note-type-badge'
import { HRNotePriorityBadge } from './hr-note-priority-badge'
import { useDeleteHRNote } from '../hooks'

import type { HRNote } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface DeleteHRNoteDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	note: HRNote | null
	onSuccess?: () => void
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog for confirming HR note deletion
 *
 * @example
 * ```tsx
 * <DeleteHRNoteDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   note={selectedNote}
 *   onSuccess={handleSuccess}
 * />
 * ```
 */
export function DeleteHRNoteDialog({
	open,
	onOpenChange,
	note,
	onSuccess,
}: DeleteHRNoteDialogProps) {
	const { showSuccess, showError } = useMessage()
	const deleteMutation = useDeleteHRNote()

	const isPending = deleteMutation.isPending

	// Handlers
	const handleDelete = async () => {
		if (!note) return

		try {
			await deleteMutation.mutateAsync({
				noteId: note.id,
				subjectUserId: note.subjectUserId,
			})

			showSuccess('HR note deleted successfully')
			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Failed to delete HR note'
			showError(message)
		}
	}

	const handleCancel = () => {
		onOpenChange(false)
	}

	if (!note) return null

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<div className="flex items-center gap-2 text-destructive mb-2">
						<AlertTriangle className="h-5 w-5" />
						<DialogTitle>Delete HR Note</DialogTitle>
					</div>
					<DialogDescription>
						Are you sure you want to delete this HR note? This action cannot be undone.
					</DialogDescription>
				</DialogHeader>

				{/* Note Preview */}
				<div className="space-y-3 py-4">
					<div className="flex items-center gap-2 flex-wrap">
						<HRNoteTypeBadge noteType={note.noteType} size="sm" />
						<HRNotePriorityBadge priority={note.priority} showAll size="sm" />
					</div>

					<div className="p-4 rounded-lg bg-muted border border-border">
						<p className="text-sm text-muted-foreground line-clamp-4">
							{note.noteText}
						</p>
					</div>

					<div className="text-xs text-muted-foreground">
						<p>Author: {note.authorCharacterName}</p>
						{note.subjectCharacterName && (
							<p>Subject: {note.subjectCharacterName}</p>
						)}
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={handleCancel} disabled={isPending}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={handleDelete}
						disabled={isPending}
					>
						{isPending ? 'Deleting...' : 'Delete Note'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
