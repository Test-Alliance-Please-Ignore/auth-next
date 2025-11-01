/**
 * HR Notes List Component
 *
 * Timeline view of all HR notes for a user with filtering capabilities.
 * SECURITY: Only renders if user is admin.
 */

import { Lock, Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'

import { HRNoteCard } from './hr-note-card'
import { useHRNotes } from '../hooks'

import type { HRNoteType, HRNotePriority } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface HRNotesListProps {
	subjectUserId: string
	subjectCharacterName?: string
	onAddNote?: () => void
	onEditNote?: (noteId: string) => void
	onDeleteNote?: (noteId: string) => void
	className?: string
}

// ============================================================================
// Filter Options
// ============================================================================

const NOTE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: 'all', label: 'All Types' },
	{ value: 'general', label: 'General' },
	{ value: 'warning', label: 'Warning' },
	{ value: 'positive', label: 'Positive' },
	{ value: 'incident', label: 'Incident' },
	{ value: 'background_check', label: 'Background Check' },
]

const PRIORITY_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: 'all', label: 'All Priorities' },
	{ value: 'low', label: 'Low' },
	{ value: 'normal', label: 'Normal' },
	{ value: 'high', label: 'High' },
	{ value: 'critical', label: 'Critical' },
]

// ============================================================================
// Component
// ============================================================================

/**
 * List component displaying HR notes with filters
 *
 * SECURITY: Only renders if user.is_admin === true
 *
 * @example
 * ```tsx
 * <HRNotesList
 *   subjectUserId={userId}
 *   subjectCharacterName={characterName}
 *   onAddNote={handleAddNote}
 * />
 * ```
 */
export function HRNotesList({
	subjectUserId,
	subjectCharacterName,
	onAddNote,
	onEditNote,
	onDeleteNote,
	className,
}: HRNotesListProps) {
	const { user } = useAuth()
	const [noteTypeFilter, setNoteTypeFilter] = useState<string>('all')
	const [priorityFilter, setPriorityFilter] = useState<string>('all')

	// Security check: Only render for admins
	if (!user?.is_admin) {
		return null
	}

	// Build query params
	const queryParams = {
		subjectUserId,
		...(noteTypeFilter !== 'all' && { noteType: noteTypeFilter as HRNoteType }),
		...(priorityFilter !== 'all' && { priority: priorityFilter as HRNotePriority }),
	}

	// Fetch notes
	const { data: notes, isLoading, error } = useHRNotes(queryParams)

	// Filter notes client-side for better UX (server already filters too)
	const filteredNotes =
		notes?.filter((note) => {
			if (noteTypeFilter !== 'all' && note.noteType !== noteTypeFilter) return false
			if (priorityFilter !== 'all' && note.priority !== priorityFilter) return false
			return true
		}) || []

	// Sort by date (newest first)
	const sortedNotes = [...filteredNotes].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
	)

	return (
		<div className={className}>
			{/* Header with Add Button */}
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-2 text-warning">
					<Lock className="h-4 w-4" />
					<h3 className="font-semibold">HR Notes</h3>
				</div>
				{onAddNote && (
					<Button onClick={onAddNote} size="sm" variant="outline" className="gap-1.5">
						<Plus className="h-4 w-4" />
						Add Note
					</Button>
				)}
			</div>

			{/* Filters */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
				<Select value={noteTypeFilter} onValueChange={setNoteTypeFilter}>
					<SelectTrigger>
						<SelectValue placeholder="Filter by type" />
					</SelectTrigger>
					<SelectContent>
						{NOTE_TYPE_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select value={priorityFilter} onValueChange={setPriorityFilter}>
					<SelectTrigger>
						<SelectValue placeholder="Filter by priority" />
					</SelectTrigger>
					<SelectContent>
						{PRIORITY_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Loading State */}
			{isLoading && (
				<div className="flex items-center justify-center py-12">
					<LoadingSpinner size="md" />
				</div>
			)}

			{/* Error State */}
			{error && (
				<div className="text-center py-8 text-destructive">
					<p className="font-medium">Failed to load HR notes</p>
					<p className="text-sm text-muted-foreground mt-1">
						{error instanceof Error ? error.message : 'An unexpected error occurred'}
					</p>
				</div>
			)}

			{/* Empty State */}
			{!isLoading && !error && sortedNotes.length === 0 && (
				<div className="text-center py-12 space-y-3">
					<Lock className="h-12 w-12 mx-auto text-muted-foreground/50" />
					<div>
						<p className="font-medium text-muted-foreground">No HR notes yet</p>
						{subjectCharacterName && (
							<p className="text-sm text-muted-foreground mt-1">
								No notes recorded for {subjectCharacterName}
							</p>
						)}
					</div>
					{onAddNote && (
						<Button onClick={onAddNote} variant="outline" size="sm" className="mt-4">
							<Plus className="h-4 w-4 mr-1.5" />
							Add First Note
						</Button>
					)}
				</div>
			)}

			{/* Notes List */}
			{!isLoading && !error && sortedNotes.length > 0 && (
				<div className="space-y-4">
					{sortedNotes.map((note) => (
						<HRNoteCard
							key={note.id}
							note={note}
							canEdit={user.id === note.authorId || user.is_admin}
							canDelete={user.is_admin}
							onEdit={() => onEditNote?.(note.id)}
							onDelete={() => onDeleteNote?.(note.id)}
						/>
					))}
				</div>
			)}

			{/* Results Count */}
			{!isLoading && !error && sortedNotes.length > 0 && (
				<div className="text-center text-xs text-muted-foreground mt-4">
					Showing {sortedNotes.length} note{sortedNotes.length !== 1 ? 's' : ''}
				</div>
			)}
		</div>
	)
}
