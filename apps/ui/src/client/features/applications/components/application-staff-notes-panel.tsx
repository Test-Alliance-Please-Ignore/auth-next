import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { MemberAvatar } from '@/components/member-avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/ui/loading'
import { Textarea } from '@/components/ui/textarea'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useMessage } from '@/hooks/useMessage'
import { useAppTranslation } from '@/i18n'
import { formatRelativeTime as formatDistanceToNow } from '@/lib/date-utils'

import {
	useAddApplicationStaffNote,
	useApplicationStaffNotes,
	useDeleteApplicationStaffNote,
	useUpdateApplicationStaffNote,
} from '../hooks'

interface ApplicationStaffNotesPanelProps {
	applicationId: string
	canWrite: boolean
	currentUserId: string | null
}

export function ApplicationStaffNotesPanel({
	applicationId,
	canWrite,
	currentUserId,
}: ApplicationStaffNotesPanelProps) {
	const { t } = useAppTranslation()

	const { showError, showSuccess } = useMessage()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const { data: notes, isLoading, error } = useApplicationStaffNotes(applicationId)
	const addNote = useAddApplicationStaffNote()
	const updateNote = useUpdateApplicationStaffNote()
	const deleteNote = useDeleteApplicationStaffNote()

	const [newNote, setNewNote] = useState('')
	const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
	const [editingText, setEditingText] = useState('')

	const handleAdd = async () => {
		const noteText = newNote.trim()
		if (!noteText) return
		try {
			await addNote.mutateAsync({ applicationId, data: { noteText } })
			setNewNote('')
			showSuccess(t('hrpages.staffNoteAdded'))
		} catch (err) {
			showError(err instanceof Error ? err.message : t('hrpages.failedToAddStaffNote'))
		}
	}

	const startEdit = (noteId: string, noteText: string) => {
		setEditingNoteId(noteId)
		setEditingText(noteText)
	}

	const handleSave = async (noteId: string) => {
		const noteText = editingText.trim()
		if (!noteText) return
		try {
			await updateNote.mutateAsync({ applicationId, noteId, data: { noteText } })
			setEditingNoteId(null)
			setEditingText('')
			showSuccess(t('hrpages.staffNoteUpdated'))
		} catch (err) {
			showError(err instanceof Error ? err.message : t('hrpages.failedToUpdateStaffNote'))
		}
	}

	const handleDelete = async (noteId: string) => {
		requestConfirmation({
			title: t('hrpages.deleteApplicationNote'),
			description: t('hrpages.areYouSureYouWantToDeleteThisApplicationNote'),
			confirmLabel: t('hrpages.deleteNote'),
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteNote.mutateAsync({ applicationId, noteId })
					showSuccess(t('hrpages.staffNoteDeleted'))
				} catch (err) {
					showError(err instanceof Error ? err.message : t('hrpages.failedToDeleteStaffNote'))
				}
			},
		})
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 text-warning">
				<Lock className="h-4 w-4" />
				<h3 className="font-semibold">{t('hrpages.applicationStaffNotes')}</h3>
			</div>

			{canWrite && (
				<div className="space-y-2">
					<Textarea
						value={newNote}
						onChange={(event) => setNewNote(event.target.value)}
						placeholder={t('hrpages.addAnInternalNoteForThisApplication')}
						rows={3}
					/>
					<div className="flex justify-end">
						<Button
							variant="primary"
							size="sm"
							onClick={handleAdd}
							disabled={addNote.isPending || newNote.trim().length === 0}
						>
							<Plus className="h-4 w-4 mr-1.5" />
							{t('hrpages.addNote')}
						</Button>
					</div>
				</div>
			)}

			{isLoading && (
				<div className="flex items-center justify-center py-8">
					<LoadingSpinner size="md" />
				</div>
			)}

			{error && (
				<p className="text-sm text-destructive">
					{error instanceof Error ? error.message : t('hrpages.failedToLoadApplicationStaffNotes')}
				</p>
			)}

			{!isLoading && !error && (!notes || notes.length === 0) && (
				<p className="text-sm text-muted-foreground">
					{t('hrpages.noStaffNotesOnThisApplicationYet')}
				</p>
			)}

			{!isLoading && !error && notes && notes.length > 0 && (
				<div className="space-y-3">
					{notes.map((note) => (
						<Card
							key={note.id}
							className="bg-muted/30 border-border/50 transition-all hover:bg-muted/50"
						>
							<CardContent className="p-3">
								<div className="flex items-center gap-2 mb-2">
									<MemberAvatar
										characterId={note.authorCharacterId ?? undefined}
										characterName={note.authorCharacterName}
										size="sm"
									/>
									<span className="font-medium text-sm">
										{note.authorCharacterName ?? t('hrpages.unknown')}
									</span>
									<span className="text-xs text-muted-foreground ml-auto">
										{formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true })}
									</span>
									{currentUserId === note.authorId && editingNoteId !== note.id && (
										<>
											<Button
												variant="ghost"
												size="sm"
												className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
												onClick={() => startEdit(note.id, note.noteText)}
											>
												<Pencil className="h-3.5 w-3.5" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												className="h-6 w-6 p-0 text-destructive hover:text-destructive"
												onClick={() => handleDelete(note.id)}
											>
												<Trash2 className="h-3.5 w-3.5" />
											</Button>
										</>
									)}
								</div>

								{editingNoteId === note.id ? (
									<div className="space-y-2">
										<Textarea
											value={editingText}
											onChange={(event) => setEditingText(event.target.value)}
											rows={3}
										/>
										<div className="flex justify-end gap-2">
											<Button variant="ghost" size="sm" onClick={() => setEditingNoteId(null)}>
												{t('hrpages.cancel')}
											</Button>
											<Button variant="primary" size="sm" onClick={() => handleSave(note.id)}>
												{t('hrpages.save')}
											</Button>
										</div>
									</div>
								) : (
									<div className="mt-2 p-2 bg-background/40 rounded-md border border-border/30">
										<p className="text-sm text-foreground whitespace-pre-wrap">{note.noteText}</p>
									</div>
								)}
							</CardContent>
						</Card>
					))}
				</div>
			)}
			{confirmationDialog}
		</div>
	)
}
