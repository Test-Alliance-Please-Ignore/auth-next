/**
 * HR Note Card Component
 *
 * Displays a single HR note with security indicators and admin-only warnings.
 * Features priority-based styling and clear visual separation from regular content.
 *
 * SECURITY: This component must only be rendered for admin users.
 */

import { formatDistanceToNow } from 'date-fns'
import { Edit2, Lock, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { MemberAvatar } from '@/components/member-avatar'
import { cn } from '@/lib/utils'

import { HRNoteTypeBadge } from './hr-note-type-badge'
import { HRNotePriorityBadge } from './hr-note-priority-badge'

import type { HRNote } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface HRNoteCardProps {
	note: HRNote
	canEdit?: boolean
	canDelete?: boolean
	onEdit?: (note: HRNote) => void
	onDelete?: (note: HRNote) => void
	showSubject?: boolean
	className?: string
}

// ============================================================================
// Component
// ============================================================================

/**
 * Card component for displaying an HR note with security indicators
 *
 * Features:
 * - Critical/high priority styling with red/orange border
 * - Lock icon and "ADMIN ONLY" badge
 * - Author avatar and metadata
 * - Edit/delete actions
 *
 * @example
 * ```tsx
 * <HRNoteCard
 *   note={note}
 *   canEdit={user.id === note.authorId || user.is_admin}
 *   canDelete={user.is_admin}
 *   onEdit={handleEdit}
 *   onDelete={handleDelete}
 * />
 * ```
 */
export function HRNoteCard({
	note,
	canEdit = false,
	canDelete = false,
	onEdit,
	onDelete,
	showSubject = false,
	className,
}: HRNoteCardProps) {
	// Priority-based card styling
	const getPriorityCardClasses = () => {
		switch (note.priority) {
			case 'critical':
				return 'border-destructive/50 shadow-[0_0_15px_rgba(239,68,68,0.15)]'
			case 'high':
				return 'border-l-4 border-l-warning'
			default:
				return ''
		}
	}

	return (
		<Card
			className={cn(
				'bg-warning/5 border-warning/30 transition-all hover:shadow-md',
				getPriorityCardClasses(),
				className
			)}
		>
			{/* Header with Security Badge */}
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 text-xs font-semibold text-warning">
						<Lock className="h-3.5 w-3.5" />
						<span className="uppercase tracking-wide">Admin Only</span>
					</div>
					<HRNotePriorityBadge priority={note.priority} />
				</div>
			</CardHeader>

			{/* Content */}
			<CardContent className="space-y-4">
				{/* Author and Metadata */}
				<div className="flex items-start gap-3">
					<MemberAvatar
						characterId={note.authorCharacterId}
						characterName={note.authorCharacterName}
						size="sm"
					/>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="font-medium text-foreground">{note.authorCharacterName}</span>
							<HRNoteTypeBadge noteType={note.noteType} size="sm" />
							<span className="text-xs text-muted-foreground">
								{formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
							</span>
						</div>
						{showSubject && note.subjectCharacterName && (
							<div className="text-sm text-muted-foreground mt-0.5">
								About: <span className="font-medium">{note.subjectCharacterName}</span>
							</div>
						)}
					</div>
				</div>

				{/* Note Text */}
				<div className="bg-background/50 rounded-md p-4 border border-border/50">
					<p className="text-foreground whitespace-pre-wrap leading-relaxed">{note.noteText}</p>
				</div>

				{/* Metadata Tags */}
				{note.metadata && Object.keys(note.metadata).length > 0 && (
					<div className="flex flex-wrap gap-1.5">
						{Object.entries(note.metadata).map(([key, value]) => (
							<span
								key={key}
								className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground font-mono"
							>
								{key}: {String(value)}
							</span>
						))}
					</div>
				)}

				{/* Actions */}
				{(canEdit || canDelete) && (
					<div className="flex items-center gap-2 pt-2 border-t border-border/50">
						{canEdit && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onEdit?.(note)}
								className="text-xs"
							>
								<Edit2 className="h-3.5 w-3.5 mr-1.5" />
								Edit
							</Button>
						)}
						{canDelete && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onDelete?.(note)}
								className="text-xs text-destructive hover:text-destructive"
							>
								<Trash2 className="h-3.5 w-3.5 mr-1.5" />
								Delete
							</Button>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
