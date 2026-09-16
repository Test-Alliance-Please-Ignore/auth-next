/**
 * Add/Edit HR Note Dialog Component
 *
 * Modal dialog for adding new HR notes or editing existing ones.
 * Includes note type selector, priority selector, and note text.
 *
 * SECURITY: This dialog should only be opened for admin users.
 */

import { AlertOctagon, AlertTriangle, CheckCircle, Info, Lock, X } from 'lucide-react'
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
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useMessage } from '@/hooks/useMessage'
import { i18n, useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import { useAddHRNote, useUpdateHRNote } from '../hooks'

import type { HRNote, HRNotePriority, HRNoteType, HRNoteVisibility } from '../api'

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
	canSelectVisibility?: boolean
	canSelectAdminVisibility?: boolean
	initialVisibility?: HRNoteVisibility
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
	baseClass: string
	selectedClass: string
	iconClass: string
}> = [
	{
		value: 'general',
		get label() {
			return i18n.t('hrpages.general')
		},
		icon: Info,
		get description() {
			return i18n.t('hrpages.generalInformation')
		},
		baseClass: 'border-muted/50 bg-muted/10 hover:bg-muted/20',
		selectedClass: 'border-muted ring-2 ring-muted/30',
		iconClass: 'text-muted-foreground',
	},
	{
		value: 'warning',
		get label() {
			return i18n.t('hrpages.warning')
		},
		icon: AlertTriangle,
		get description() {
			return i18n.t('hrpages.cautionAdvised')
		},
		baseClass: 'border-warning/30 bg-warning/10 hover:bg-warning/20',
		selectedClass: 'border-warning ring-2 ring-warning/30',
		iconClass: 'text-warning',
	},
	{
		value: 'positive',
		get label() {
			return i18n.t('hrpages.positive')
		},
		icon: CheckCircle,
		get description() {
			return i18n.t('hrpages.positiveNote')
		},
		baseClass: 'border-success/30 bg-success/10 hover:bg-success/20',
		selectedClass: 'border-success ring-2 ring-success/30',
		iconClass: 'text-success',
	},
	{
		value: 'incident',
		get label() {
			return i18n.t('hrpages.incident')
		},
		icon: AlertOctagon,
		get description() {
			return i18n.t('hrpages.securityIncident')
		},
		baseClass: 'border-destructive/30 bg-destructive/10 hover:bg-destructive/20',
		selectedClass: 'border-destructive ring-2 ring-destructive/30',
		iconClass: 'text-destructive',
	},
]

const PRIORITY_OPTIONS: Array<{ value: HRNotePriority; label: string }> = [
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
// Note Type Button Component
// ============================================================================

interface NoteTypeButtonProps {
	value: HRNoteType
	label: string
	description: string
	icon: typeof Info
	selected: boolean
	onClick: () => void
	baseClass: string
	selectedClass: string
	iconClass: string
}

function NoteTypeButton({
	label,
	description,
	icon: Icon,
	selected,
	onClick,
	baseClass,
	selectedClass,
	iconClass,
}: NoteTypeButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all cursor-pointer',
				'focus:outline-none focus:ring-offset-2',
				baseClass,
				selected && selectedClass
			)}
			data-state={selected ? 'checked' : 'unchecked'}
		>
			<Icon className={cn('h-4 w-4', iconClass)} />
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
	canSelectVisibility = false,
	canSelectAdminVisibility = false,
	initialVisibility = 'auditor',
	onSuccess,
}: AddHRNoteDialogProps) {
	const { showSuccess, showError } = useMessage()
	const { t } = useAppTranslation()

	// Form state
	const [noteType, setNoteType] = useState<HRNoteType>('general')
	const [priority, setPriority] = useState<HRNotePriority>('normal')
	const [noteText, setNoteText] = useState('')
	const [tags, setTags] = useState<string[]>([])
	const [tagInput, setTagInput] = useState('')
	const [visibility, setVisibility] = useState<HRNoteVisibility>('auditor')

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
				setTags(existingNote.metadata?.tags ? (existingNote.metadata.tags as string[]) : [])
			} else {
				// Add mode - reset to defaults
				setNoteType('general')
				setPriority('normal')
				setNoteText('')
				setTags([])
				setVisibility(initialVisibility)
				setTagInput('')
			}
		}
	}, [open, existingNote, initialVisibility])

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
			const metadata = {
				...(tags.length > 0 ? { tags } : {}),
				...(canSelectVisibility ? { visibility } : {}),
			}

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
				showSuccess(t('hrpages.hrNoteUpdatedSuccessfully'))
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
				showSuccess(t('hrpages.hrNoteAddedSuccessfully'))
			}

			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('hrpages.failedToValue1HrNote', { value1: isEditMode ? 'update' : 'add' })
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
						<span className="text-xs font-semibold uppercase tracking-wide">
							{t('hr.notes.internal')}
						</span>
					</div>
					<DialogTitle>{isEditMode ? t('hr.notes.edit') : t('hr.notes.add')}</DialogTitle>
					<DialogDescription>
						{isEditMode ? t('hr.notes.updateDescription') : t('hr.notes.addDescription')}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Subject Display */}
					{subjectCharacterName && (
						<div className="space-y-2">
							<Label>{t('hrpages.subject')}</Label>
							<div className="p-3 rounded-lg bg-muted text-sm font-medium">
								{subjectCharacterName}
							</div>
						</div>
					)}

					{/* Note Type Selector */}
					<div className="space-y-3">
						<Label>
							{t('hrpages.noteType')}
							<span className="text-destructive">*</span>
						</Label>
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
							{NOTE_TYPE_OPTIONS.map((option) => (
								<NoteTypeButton
									key={option.value}
									value={option.value}
									label={option.label}
									description={option.description}
									icon={option.icon}
									selected={noteType === option.value}
									onClick={() => setNoteType(option.value)}
									baseClass={option.baseClass}
									selectedClass={option.selectedClass}
									iconClass={option.iconClass}
								/>
							))}
						</div>
					</div>

					{/* Priority Selector */}
					<div className="space-y-2">
						<Label htmlFor="priority">
							{t('hrpages.priority')}
							<span className="text-destructive">*</span>
						</Label>
						<Select
							inputId="priority"
							value={priority}
							onValueChange={(v) => setPriority(v as HRNotePriority)}
							options={PRIORITY_OPTIONS.map((option) => ({
								value: option.value,
								label: option.label,
							}))}
							placeholder={t('hrpages.selectPriority')}
						/>
					</div>

					{canSelectVisibility && !isEditMode && (
						<div className="space-y-2">
							<Label htmlFor="note-visibility">{t('hr.notes.visibility')}</Label>
							<Select
								inputId="note-visibility"
								value={visibility}
								onValueChange={(value) => setVisibility(value as HRNoteVisibility)}
								options={[
									...(canSelectAdminVisibility
										? [{ value: 'admin', label: t('hr.notes.adminsOnly') }]
										: []),
									{ value: 'auditor', label: t('hr.notes.auditorsAndAdmins') },
									{ value: 'hr', label: t('hr.notes.allAuthorizedHr') },
								]}
								placeholder={t('hrpages.selectVisibility')}
							/>
						</div>
					)}

					{/* Note Text */}
					<div className="space-y-2">
						<Label htmlFor="note-text">
							{t('hrpages.noteText')}
							<span className="text-destructive">*</span>
						</Label>
						<Textarea
							id="note-text"
							placeholder={t('hrpages.privateInternalNotesAboutThisUser')}
							value={noteText}
							onChange={(e) => setNoteText(e.target.value)}
							disabled={isPending}
							className="min-h-[150px] resize-y"
							maxLength={MAX_LENGTH}
						/>
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								{textLength < MIN_LENGTH
									? t('hrpages.minimumValue1Characters', { value1: MIN_LENGTH })
									: textLength > MAX_LENGTH
										? t('hrpages.maximumLengthExceeded')
										: t('hrpages.characterCount')}
							</span>
							<span className={cn('font-mono', getCounterColor())}>
								{textLength} / {MAX_LENGTH}
							</span>
						</div>
					</div>

					{/* Tags */}
					<div className="space-y-2">
						<Label htmlFor="tag-input">{t('hrpages.tagsOptional')}</Label>
						<div className="flex gap-2">
							<Input
								id="tag-input"
								placeholder={t('hrpages.addATag')}
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
								variant="ghost"
								size="sm"
								onClick={handleAddTag}
								disabled={!tagInput.trim() || isPending}
							>
								{t('hrpages.add')}
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
					<Button variant="cancel" onClick={handleCancel} disabled={isPending}>
						{t('hrpages.cancel')}
					</Button>
					<Button
						variant="confirm"
						onClick={handleSubmit}
						disabled={!isFormValid}
						loading={isPending}
						loadingText={isEditMode ? t('hrpages.updating') : t('hrpages.saving')}
					>
						{isEditMode ? t('hrpages.updateNote') : t('hrpages.saveNote')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
