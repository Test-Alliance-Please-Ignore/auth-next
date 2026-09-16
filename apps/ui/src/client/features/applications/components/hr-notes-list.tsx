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
import { Select } from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import { i18n, useAppTranslation } from '@/i18n'

import { useHRNotes } from '../hooks'
import { HRNoteCard } from './hr-note-card'

import type { HRNotePriority, HRNoteType } from '../api'

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
	/** Override access check (defaults to user.is_admin) */
	hasAccess?: boolean
}

// ============================================================================
// Filter Options
// ============================================================================

const NOTE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
	{
		value: 'all',
		get label() {
			return i18n.t('hrpages.allTypes')
		},
	},
	{
		value: 'general',
		get label() {
			return i18n.t('hrpages.general')
		},
	},
	{
		value: 'warning',
		get label() {
			return i18n.t('hrpages.warning')
		},
	},
	{
		value: 'positive',
		get label() {
			return i18n.t('hrpages.positive')
		},
	},
	{
		value: 'incident',
		get label() {
			return i18n.t('hrpages.incident')
		},
	},
]

const PRIORITY_OPTIONS: Array<{ value: string; label: string }> = [
	{
		value: 'all',
		get label() {
			return i18n.t('hrpages.allPriorities')
		},
	},
	{
		value: 'low',
		get label() {
			return i18n.t('hrpages.low')
		},
	},
	{
		value: 'normal',
		get label() {
			return i18n.t('hrpages.normal')
		},
	},
	{
		value: 'high',
		get label() {
			return i18n.t('hrpages.high')
		},
	},
	{
		value: 'critical',
		get label() {
			return i18n.t('hrpages.critical')
		},
	},
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
	hasAccess,
}: HRNotesListProps) {
	const { t } = useAppTranslation()

	const { user } = useAuth()
	const [noteTypeFilter, setNoteTypeFilter] = useState<string>('all')
	const [priorityFilter, setPriorityFilter] = useState<string>('all')

	// Security check: Only render for users with HR access
	if (!(hasAccess ?? user?.is_admin)) {
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
					<h3 className="font-semibold">{t('hrpages.hrNotes')}</h3>
				</div>
				{onAddNote && (
					<Button variant="primary" onClick={onAddNote} size="sm" className="gap-1.5">
						<Plus className="h-4 w-4" />
						{t('hrpages.addNote')}
					</Button>
				)}
			</div>

			{/* Filters */}
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
				<Select
					value={noteTypeFilter}
					onValueChange={setNoteTypeFilter}
					options={NOTE_TYPE_OPTIONS.map((option) => ({
						value: option.value,
						label: option.label,
					}))}
					placeholder={t('hrpages.filterByType')}
				/>

				<Select
					value={priorityFilter}
					onValueChange={setPriorityFilter}
					options={PRIORITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
					placeholder={t('hrpages.filterByPriority')}
				/>
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
					<p className="font-medium">{t('hrpages.failedToLoadHrNotes')}</p>
					<p className="text-sm text-muted-foreground mt-1">
						{error instanceof Error ? error.message : t('hrpages.anUnexpectedErrorOccurred')}
					</p>
				</div>
			)}

			{/* Empty State */}
			{!isLoading && !error && sortedNotes.length === 0 && (
				<div className="text-center py-12 space-y-3">
					<Lock className="h-12 w-12 mx-auto text-muted-foreground/50" />
					<div>
						<p className="font-medium text-muted-foreground">{t('hrpages.noHrNotesYet')}</p>
						{subjectCharacterName && (
							<p className="text-sm text-muted-foreground mt-1">
								{t('hrpages.noNotesRecordedFor')}
								{subjectCharacterName}
							</p>
						)}
					</div>
					{onAddNote && (
						<Button variant="primary" onClick={onAddNote} size="sm" className="mt-4">
							<Plus className="h-4 w-4 mr-1.5" />
							{t('hrpages.addFirstNote')}
						</Button>
					)}
				</div>
			)}

			{/* Notes List */}
			{!isLoading && !error && sortedNotes.length > 0 && (
				<div className="space-y-4">
					{sortedNotes.map((note) => (
						<HRNoteCard key={note.id} note={note} onEdit={onEditNote} onDelete={onDeleteNote} />
					))}
				</div>
			)}

			{/* Results Count */}
			{!isLoading && !error && sortedNotes.length > 0 && (
				<div className="text-center text-xs text-muted-foreground mt-4">
					{t('hrpages.showing')}
					{t('hrpages.noteCount', { count: sortedNotes.length })}
				</div>
			)}
		</div>
	)
}
