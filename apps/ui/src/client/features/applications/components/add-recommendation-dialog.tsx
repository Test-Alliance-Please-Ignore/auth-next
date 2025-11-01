/**
 * Add/Edit Recommendation Dialog Component
 *
 * Modal dialog for adding new recommendations or editing existing ones.
 * Includes character selection, sentiment choice, and recommendation text.
 */

import { Minus, ThumbsDown, ThumbsUp } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { cn } from '@/lib/utils'

import { useAddRecommendation, useUpdateRecommendation } from '../hooks'

import type { Recommendation, RecommendationSentiment } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface AddRecommendationDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	applicationId: string
	existingRecommendation?: Recommendation
	onSuccess?: () => void
}

// ============================================================================
// Constants
// ============================================================================

const MIN_LENGTH = 50
const MAX_LENGTH = 500

const SENTIMENT_OPTIONS: Array<{
	value: RecommendationSentiment
	label: string
	icon: typeof ThumbsUp
	description: string
	colorClass: string
}> = [
	{
		value: 'positive',
		label: 'Positive',
		icon: ThumbsUp,
		description: 'Recommend this applicant',
		colorClass:
			'border-success/30 bg-success/10 hover:bg-success/20 data-[state=checked]:border-success',
	},
	{
		value: 'neutral',
		label: 'Neutral',
		icon: Minus,
		description: 'No strong opinion',
		colorClass:
			'border-primary/30 bg-primary/10 hover:bg-primary/20 data-[state=checked]:border-primary',
	},
	{
		value: 'negative',
		label: 'Negative',
		icon: ThumbsDown,
		description: 'Do not recommend',
		colorClass:
			'border-warning/30 bg-warning/10 hover:bg-warning/20 data-[state=checked]:border-warning',
	},
]

// ============================================================================
// Sentiment Radio Button Component
// ============================================================================

interface SentimentButtonProps {
	value: RecommendationSentiment
	label: string
	description: string
	icon: typeof ThumbsUp
	selected: boolean
	onClick: () => void
	colorClass: string
}

function SentimentButton({
	value,
	label,
	description,
	icon: Icon,
	selected,
	onClick,
	colorClass,
}: SentimentButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all cursor-pointer',
				'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
				selected ? colorClass : 'border-input bg-background hover:bg-muted/50'
			)}
			data-state={selected ? 'checked' : 'unchecked'}
		>
			<Icon className="h-5 w-5" />
			<div className="text-center">
				<div className="font-semibold text-sm">{label}</div>
				<div className="text-xs text-muted-foreground">{description}</div>
			</div>
		</button>
	)
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog for adding or editing recommendations
 *
 * @example
 * ```tsx
 * <AddRecommendationDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   applicationId={applicationId}
 *   existingRecommendation={recommendation}
 *   onSuccess={handleSuccess}
 * />
 * ```
 */
export function AddRecommendationDialog({
	open,
	onOpenChange,
	applicationId,
	existingRecommendation,
	onSuccess,
}: AddRecommendationDialogProps) {
	const { user } = useAuth()
	const { showSuccess, showError } = useMessage()

	// Form state
	const [characterId, setCharacterId] = useState('')
	const [sentiment, setSentiment] = useState<RecommendationSentiment>('positive')
	const [recommendationText, setRecommendationText] = useState('')
	const [isPublic, setIsPublic] = useState(true)

	// Mutations
	const addMutation = useAddRecommendation()
	const updateMutation = useUpdateRecommendation()

	const isEditMode = !!existingRecommendation
	const isPending = addMutation.isPending || updateMutation.isPending

	// Initialize form when dialog opens or recommendation changes
	useEffect(() => {
		if (open) {
			if (existingRecommendation) {
				// Edit mode - populate from existing
				setCharacterId(existingRecommendation.characterId)
				setSentiment(existingRecommendation.sentiment)
				setRecommendationText(existingRecommendation.recommendationText)
				setIsPublic(existingRecommendation.isPublic)
			} else {
				// Add mode - reset to defaults
				setCharacterId(user?.mainCharacterId || '')
				setSentiment('positive')
				setRecommendationText('')
				setIsPublic(true)
			}
		}
	}, [open, existingRecommendation, user])

	// Validation
	const textLength = recommendationText.trim().length
	const isTextValid = textLength >= MIN_LENGTH && textLength <= MAX_LENGTH
	const isFormValid = characterId && sentiment && isTextValid

	// Character counter color
	const getCounterColor = () => {
		if (textLength < MIN_LENGTH) return 'text-muted-foreground'
		if (textLength > MAX_LENGTH) return 'text-destructive'
		return 'text-success'
	}

	// Handlers
	const handleSubmit = async () => {
		if (!isFormValid) return

		try {
			if (isEditMode) {
				// Update existing recommendation
				await updateMutation.mutateAsync({
					applicationId,
					recommendationId: existingRecommendation.id,
					data: {
						characterId,
						sentiment,
						recommendationText: recommendationText.trim(),
						isPublic,
					},
				})
				showSuccess('Recommendation updated successfully')
			} else {
				// Add new recommendation
				await addMutation.mutateAsync({
					applicationId,
					data: {
						characterId,
						sentiment,
						recommendationText: recommendationText.trim(),
						isPublic,
					},
				})
				showSuccess('Recommendation added successfully')
			}

			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: `Failed to ${isEditMode ? 'update' : 'add'} recommendation`
			showError(message)
		}
	}

	const handleCancel = () => {
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[600px]">
				<DialogHeader>
					<DialogTitle>{isEditMode ? 'Edit Recommendation' : 'Add Recommendation'}</DialogTitle>
					<DialogDescription>
						{isEditMode
							? 'Update your recommendation for this applicant.'
							: 'Share your thoughts about this applicant with the corporation.'}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Character Selector */}
					<div className="space-y-2">
						<Label htmlFor="character">
							Character <span className="text-destructive">*</span>
						</Label>
						<Select value={characterId} onValueChange={setCharacterId} disabled={isPending}>
							<SelectTrigger id="character">
								<SelectValue placeholder="Select character" />
							</SelectTrigger>
							<SelectContent>
								{user?.characters.map((char: { characterId: string; characterName: string; hasValidToken: boolean }) => (
									<SelectItem key={char.characterId} value={char.characterId}>
										{char.characterName}
										{!char.hasValidToken && ' (Token expired)'}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* Sentiment Selector */}
					<div className="space-y-3">
						<Label>
							Sentiment <span className="text-destructive">*</span>
						</Label>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
							{SENTIMENT_OPTIONS.map((option) => (
								<SentimentButton
									key={option.value}
									value={option.value}
									label={option.label}
									description={option.description}
									icon={option.icon}
									selected={sentiment === option.value}
									onClick={() => setSentiment(option.value)}
									colorClass={option.colorClass}
								/>
							))}
						</div>
					</div>

					{/* Recommendation Text */}
					<div className="space-y-2">
						<Label htmlFor="recommendation-text">
							Recommendation Text <span className="text-destructive">*</span>
						</Label>
						<Textarea
							id="recommendation-text"
							placeholder="Share your thoughts about this applicant..."
							value={recommendationText}
							onChange={(e) => setRecommendationText(e.target.value)}
							disabled={isPending}
							className="min-h-[120px] resize-y"
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

					{/* Public/Private Toggle */}
					<div className="flex items-center justify-between space-x-2 p-4 rounded-lg border bg-muted/50">
						<div className="space-y-0.5">
							<Label htmlFor="is-public" className="cursor-pointer">
								Make recommendation public
							</Label>
							<p className="text-sm text-muted-foreground">
								{isPublic
									? 'Visible to the applicant and HR staff'
									: 'Only visible to HR staff'}
							</p>
						</div>
						<Switch
							id="is-public"
							checked={isPublic}
							onCheckedChange={setIsPublic}
							disabled={isPending}
						/>
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
								: 'Submitting...'
							: isEditMode
								? 'Update Recommendation'
								: 'Submit Recommendation'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
