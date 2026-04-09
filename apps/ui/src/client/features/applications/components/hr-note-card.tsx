/**
 * HR Note Card Component
 *
 * Displays a single HR note with security indicators and admin-only warnings.
 * Features priority-based styling and clear visual separation from regular content.
 *
 * SECURITY: This component must only be rendered for admin users.
 */

import { formatDistanceToNow } from 'date-fns'
import { Pencil, Trash2 } from 'lucide-react'

import { MemberAvatar } from '@/components/member-avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { HRNotePriorityBadge } from './hr-note-priority-badge'
import { HRNoteTypeBadge } from './hr-note-type-badge'

import type { HRNote } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface HRNoteCardProps {
	note: HRNote
	showSubject?: boolean
	className?: string
	onEdit?: (noteId: string) => void
	onDelete?: (noteId: string) => void
}

// ============================================================================
// Component
// ============================================================================

/**
 * Card component for displaying an HR note with security indicators
 *
 * Features:
 * - Critical/high priority styling with red/orange border
 * - Author avatar and metadata
 * - Note type and priority badges
 *
 * @example
 * ```tsx
 * <HRNoteCard note={note} />
 * ```
 */
export function HRNoteCard({ note, showSubject = false, className, onEdit, onDelete }: HRNoteCardProps) {
	// Priority-based card styling
	const getPriorityCardClasses = () => {
		switch (note.priority) {
			case 'critical':
				return 'border-destructive/50 shadow-[0_0_10px_rgba(239,68,68,0.1)]'
			case 'high':
				return 'border-l-4 border-l-warning'
			default:
				return ''
		}
	}

	return (
		<Card
			className={cn(
				'bg-muted/30 border-border/50 transition-all hover:bg-muted/50',
				getPriorityCardClasses(),
				className
			)}
		>
			<CardContent className="p-3">
				{/* Header row: Author, badges, timestamp, actions */}
				<div className="flex items-center gap-2 mb-2">
					<MemberAvatar
						characterId={note.authorCharacterId}
						characterName={note.authorCharacterName}
						size="sm"
					/>
					<span className="font-medium text-sm">{note.authorCharacterName}</span>
					<HRNoteTypeBadge noteType={note.noteType} size="sm" />
					<HRNotePriorityBadge priority={note.priority} size="sm" />
					<span className="text-xs text-muted-foreground ml-auto">
						{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
					</span>
					{onEdit && (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
							onClick={() => onEdit(note.id)}
						>
							<Pencil className="h-3.5 w-3.5" />
						</Button>
					)}
					{onDelete && (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
							onClick={() => onDelete(note.id)}
						>
							<Trash2 className="h-3.5 w-3.5" />
						</Button>
					)}
				</div>

				{showSubject && note.subjectCharacterName && (
					<div className="text-xs text-muted-foreground mb-2">
						About: <span className="font-medium">{note.subjectCharacterName}</span>
					</div>
				)}

				{/* Note Text */}
				<div className="mt-2 p-2 bg-background/40 rounded-md border border-border/30">
					<p className="text-sm text-foreground whitespace-pre-wrap">{note.noteText}</p>
				</div>

				{/* Metadata Tags */}
				{note.metadata && Object.keys(note.metadata).length > 0 && (
					<div className="flex flex-wrap gap-1 mt-2">
						{Object.entries(note.metadata).map(([key, value]) => (
							<span
								key={key}
								className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono"
							>
								{key}: {String(value)}
							</span>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
