import { formatDistanceToNow } from 'date-fns'
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { MemberAvatar } from '@/components/member-avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingSpinner } from '@/components/ui/loading'
import { Textarea } from '@/components/ui/textarea'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useMessage } from '@/hooks/useMessage'

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
			showSuccess('Staff note added')
		} catch (err) {
			showError(err instanceof Error ? err.message : 'Failed to add staff note')
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
			showSuccess('Staff note updated')
		} catch (err) {
			showError(err instanceof Error ? err.message : 'Failed to update staff note')
		}
	}

	const handleDelete = async (noteId: string) => {
		requestConfirmation({
			title: 'Delete Application Note',
			description: 'Are you sure you want to delete this application note? This action cannot be undone.',
			confirmLabel: 'Delete Note',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteNote.mutateAsync({ applicationId, noteId })
					showSuccess('Staff note deleted')
				} catch (err) {
					showError(err instanceof Error ? err.message : 'Failed to delete staff note')
				}
			},
		})
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 text-warning">
				<Lock className="h-4 w-4" />
				<h3 className="font-semibold">Application Staff Notes</h3>
			</div>

			{canWrite && (
				<div className="space-y-2">
					<Textarea
						value={newNote}
						onChange={(event) => setNewNote(event.target.value)}
						placeholder="Add an internal note for this application..."
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
							Add Note
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
					{error instanceof Error ? error.message : 'Failed to load application staff notes'}
				</p>
			)}

			{!isLoading && !error && (!notes || notes.length === 0) && (
				<p className="text-sm text-muted-foreground">No staff notes on this application yet.</p>
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
									<span className="font-medium text-sm">{note.authorCharacterName ?? 'Unknown'}</span>
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
												Cancel
											</Button>
											<Button variant="primary" size="sm" onClick={() => handleSave(note.id)}>
												Save
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
