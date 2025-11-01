/**
 * Add/Edit HR Note Dialog Component
 *
 * Modal dialog for adding new HR notes or editing existing ones.
 * Includes note type selector, priority selector, and note text.
 *
 * SECURITY: This dialog should only be opened for admin users.
 */

import { AlertOctagon, AlertTriangle, CheckCircle, Info, Lock, Shield, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useMessage } from '@/hooks/useMessage'
import { cn } from '@/lib/utils'

import { useAddHRNote, useUpdateHRNote } from '../hooks'

import type { HRNote, HRNoteType, HRNotePriority } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface AddHRNoteDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	subjectUserId: string
	subjectCharacterId?: string
	subjectCharacterName?: string
	existingNote?: HRNote
	onSuccess?: () => void
}

// ============================================================================
// Constants
// ============================================================================

const MIN_LENGTH = 10
const MAX_LENGTH = 2000

const NOTE_TYPE_OPTIONS: Array<{
	value: HRNoteType
	label: string
	icon: typeof Info
	description: string
	colorClass: string
}> = [
	{
		value: 'general',
		label: 'General',
		icon: Info,
		description: 'General information',
		colorClass: 'border-muted bg-muted/10 hover:bg-muted/20 data-[state=checked]:border-muted',
	},
	{
		value: 'warning',
		label: 'Warning',
		icon: AlertTriangle,
		description: 'Caution advised',
		colorClass:
			'border-warning/30 bg-warning/10 hover:bg-warning/20 data-[state=checked]:border-warning',
	},
	{
		value: 'positive',
		label: 'Positive',
		icon: CheckCircle,
		description: 'Positive note',
		colorClass:
			'border-success/30 bg-success/10 hover:bg-success/20 data-[state=checked]:border-success',
	},
	{
		value: 'incident',
		label: 'Incident',
		icon: AlertOctagon,
		description: 'Security incident',
		colorClass:
			'border-destructive/30 bg-destructive/10 hover:bg-destructive/20 data-[state=checked]:border-destructive',
	},
	{
		value: 'background_check',
		label: 'Background Check',
		icon: Shield,
		description: 'Background verification',
		colorClass:
			'border-primary/30 bg-primary/10 hover:bg-primary/20 data-[state=checked]:border-primary',
	},
]

const PRIORITY_OPTIONS: Array<{ value: HRNotePriority; label: string }> = [
	{ value: 'low', label: 'Low' },
	{ value: 'normal', label: 'Normal' },
	{ value: 'high', label: 'High' },
	{ value: 'critical', label: 'Critical' },
]

// ============================================================================
// Note Type Button Component
// ============================================================================

interface NoteTypeButtonProps {
	value: HRNoteType
	label: string
	description: string
	icon: typeof Info
	selected: boolean
	onClick: () => void
	colorClass: string
}

function NoteTypeButton({
	value,
	label,
	description,
	icon: Icon,
	selected,
	onClick,
	colorClass,
}: NoteTypeButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all cursor-pointer',
				'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
				selected ? colorClass : 'border-input bg-background hover:bg-muted/50'
			)}
			data-state={selected ? 'checked' : 'unchecked'}
		>
			<Icon className="h-4 w-4" />
			<div className="text-center">
				<div className="font-semibold text-xs">{label}</div>
				<div className="text-[10px] text-muted-foreground">{description}</div>
			</div>
		</button>
	)
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog for adding or editing HR notes
 *
 * @example
 * ```tsx
 * <AddHRNoteDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   subjectUserId={userId}
 *   subjectCharacterName={characterName}
 *   existingNote={note}
 *   onSuccess={handleSuccess}
 * />
 * ```
 */
export function AddHRNoteDialog({
	open,
	onOpenChange,
	subjectUserId,
	subjectCharacterId,
	subjectCharacterName,
	existingNote,
	onSuccess,
}: AddHRNoteDialogProps) {
	const { showSuccess, showError } = useMessage()

	// Form state
	const [noteType, setNoteType] = useState<HRNoteType>('general')
	const [priority, setPriority] = useState<HRNotePriority>('normal')
	const [noteText, setNoteText] = useState('')
	const [tags, setTags] = useState<string[]>([])
	const [tagInput, setTagInput] = useState('')

	// Mutations
	const addMutation = useAddHRNote()
	const updateMutation = useUpdateHRNote()

	const isEditMode = !!existingNote
	const isPending = addMutation.isPending || updateMutation.isPending

	// Initialize form when dialog opens or note changes
	useEffect(() => {
		if (open) {
			if (existingNote) {
				// Edit mode - populate from existing
				setNoteType(existingNote.noteType)
				setPriority(existingNote.priority)
				setNoteText(existingNote.noteText)
				setTags(
					existingNote.metadata?.tags
						? (existingNote.metadata.tags as string[])
						: []
				)
			} else {
				// Add mode - reset to defaults
				setNoteType('general')
				setPriority('normal')
				setNoteText('')
				setTags([])
				setTagInput('')
			}
		}
	}, [open, existingNote])

	// Validation
	const textLength = noteText.trim().length
	const isTextValid = textLength >= MIN_LENGTH && textLength <= MAX_LENGTH
	const isFormValid = noteType && priority && isTextValid

	// Character counter color
	const getCounterColor = () => {
		if (textLength < MIN_LENGTH) return 'text-muted-foreground'
		if (textLength > MAX_LENGTH) return 'text-destructive'
		return 'text-success'
	}

	// Handlers
	const handleAddTag = () => {
		const tag = tagInput.trim()
		if (tag && !tags.includes(tag)) {
			setTags([...tags, tag])
			setTagInput('')
		}
	}

	const handleRemoveTag = (tagToRemove: string) => {
		setTags(tags.filter((tag) => tag !== tagToRemove))
	}

	const handleSubmit = async () => {
		if (!isFormValid) return

		try {
			const metadata = tags.length > 0 ? { tags } : undefined

			if (isEditMode) {
				// Update existing note
				await updateMutation.mutateAsync({
					noteId: existingNote.id,
					data: {
						noteType,
						priority,
						noteText: noteText.trim(),
						metadata,
					},
				})
				showSuccess('HR note updated successfully')
			} else {
				// Add new note
				await addMutation.mutateAsync({
					subjectUserId,
					subjectCharacterId,
					noteType,
					priority,
					noteText: noteText.trim(),
					metadata,
				})
				showSuccess('HR note added successfully')
			}

			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: `Failed to ${isEditMode ? 'update' : 'add'} HR note`
			showError(message)
		}
	}

	const handleCancel = () => {
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[650px]">
				<DialogHeader>
					<div className="flex items-center gap-2 text-warning mb-2">
						<Lock className="h-4 w-4" />
						<span className="text-xs font-semibold uppercase tracking-wide">Admin Only</span>
					</div>
					<DialogTitle>{isEditMode ? 'Edit HR Note' : 'Add HR Note'}</DialogTitle>
					<DialogDescription>
						{isEditMode
							? 'Update the HR note about this user.'
							: 'Add a private internal note about this user. Only visible to site administrators.'}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Subject Display */}
					{subjectCharacterName && (
						<div className="space-y-2">
							<Label>Subject</Label>
							<div className="p-3 rounded-lg bg-muted text-sm font-medium">
								{subjectCharacterName}
							</div>
						</div>
					)}

					{/* Note Type Selector */}
					<div className="space-y-3">
						<Label>
							Note Type <span className="text-destructive">*</span>
						</Label>
						<div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
							{NOTE_TYPE_OPTIONS.map((option) => (
								<NoteTypeButton
									key={option.value}
									value={option.value}
									label={option.label}
									description={option.description}
									icon={option.icon}
									selected={noteType === option.value}
									onClick={() => setNoteType(option.value)}
									colorClass={option.colorClass}
								/>
							))}
						</div>
					</div>

					{/* Priority Selector */}
					<div className="space-y-2">
						<Label htmlFor="priority">
							Priority <span className="text-destructive">*</span>
						</Label>
						<Select value={priority} onValueChange={(v) => setPriority(v as HRNotePriority)}>
							<SelectTrigger id="priority">
								<SelectValue placeholder="Select priority" />
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

					{/* Note Text */}
					<div className="space-y-2">
						<Label htmlFor="note-text">
							Note Text <span className="text-destructive">*</span>
						</Label>
						<Textarea
							id="note-text"
							placeholder="Private internal notes about this user..."
							value={noteText}
							onChange={(e) => setNoteText(e.target.value)}
							disabled={isPending}
							className="min-h-[150px] resize-y"
							maxLength={MAX_LENGTH}
						/>
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								{textLength < MIN_LENGTH
									? `Minimum ${MIN_LENGTH} characters`
									: textLength > MAX_LENGTH
										? 'Maximum length exceeded'
										: 'Character count:'}
							</span>
							<span className={cn('font-mono', getCounterColor())}>
								{textLength} / {MAX_LENGTH}
							</span>
						</div>
					</div>

					{/* Tags */}
					<div className="space-y-2">
						<Label htmlFor="tag-input">Tags (optional)</Label>
						<div className="flex gap-2">
							<Input
								id="tag-input"
								placeholder="Add a tag..."
								value={tagInput}
								onChange={(e) => setTagInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault()
										handleAddTag()
									}
								}}
								disabled={isPending}
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={handleAddTag}
								disabled={!tagInput.trim() || isPending}
							>
								Add
							</Button>
						</div>
						{tags.length > 0 && (
							<div className="flex flex-wrap gap-2 mt-2">
								{tags.map((tag) => (
									<span
										key={tag}
										className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20"
									>
										#{tag}
										<button
											type="button"
											onClick={() => handleRemoveTag(tag)}
											className="hover:text-destructive transition-colors"
											disabled={isPending}
										>
											<X className="h-3 w-3" />
										</button>
									</span>
								))}
							</div>
						)}
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={handleCancel} disabled={isPending}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={!isFormValid || isPending}>
						{isPending
							? isEditMode
								? 'Updating...'
								: 'Saving...'
							: isEditMode
								? 'Update Note'
								: 'Save Note'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
