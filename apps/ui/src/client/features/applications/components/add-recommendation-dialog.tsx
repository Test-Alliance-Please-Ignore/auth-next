/**
 * Add/Edit Recommendation Dialog Component
 *
 * Modal dialog for adding new recommendations or editing existing ones.
 * Includes character selection, sentiment choice, and recommendation text.
 */

import { AlertCircle, Minus, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { formatNumber, useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'
import { cn } from '@/lib/utils'

import { useAddRecommendation, useUpdateRecommendation } from '../hooks'
import { RecommendationFeedback } from './recommendation-feedback'

import type { AppTranslationKey } from '@/i18n'
import type { Recommendation, RecommendationSentiment } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface AddRecommendationDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	applicationId: string
	applicationUserId: string
	existingRecommendation?: Recommendation
	onSuccess?: () => void
}

// ============================================================================
// Constants
// ============================================================================

const MIN_LENGTH = 10
const MAX_LENGTH = 500

const SENTIMENT_OPTIONS: Array<{
	value: RecommendationSentiment
	label: AppTranslationKey
	icon: typeof ThumbsUp
	description: AppTranslationKey
	colorClass: string
}> = [
	{
		value: 'positive',
		label: 'applications.recommendations.sentiment.positive',
		icon: ThumbsUp,
		description: 'applications.recommendations.sentiment.positiveHint',
		colorClass:
			'border-success/30 bg-success/10 hover:bg-success/20 data-[state=checked]:border-success',
	},
	{
		value: 'neutral',
		label: 'applications.recommendations.sentiment.neutral',
		icon: Minus,
		description: 'applications.recommendations.sentiment.neutralHint',
		colorClass:
			'border-primary/30 bg-primary/10 hover:bg-primary/20 data-[state=checked]:border-primary',
	},
	{
		value: 'negative',
		label: 'applications.recommendations.sentiment.negative',
		icon: ThumbsDown,
		description: 'applications.recommendations.sentiment.negativeHint',
		colorClass:
			'border-warning/30 bg-warning/10 hover:bg-warning/20 data-[state=checked]:border-warning',
	},
]

// ============================================================================
// Sentiment Radio Button Component
// ============================================================================

interface SentimentButtonProps {
	label: string
	description: string
	icon: typeof ThumbsUp
	selected: boolean
	disabled: boolean
	onClick: () => void
	colorClass: string
}

function SentimentButton({
	label,
	description,
	icon: Icon,
	selected,
	disabled,
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
			disabled={disabled}
			aria-pressed={selected}
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
 *   applicationUserId={application.userId}
 *   existingRecommendation={recommendation}
 *   onSuccess={handleSuccess}
 * />
 * ```
 */
export function AddRecommendationDialog({
	open,
	onOpenChange,
	applicationId,
	applicationUserId,
	existingRecommendation,
	onSuccess,
}: AddRecommendationDialogProps) {
	const { user } = useAuth()
	const { t } = useAppTranslation()
	const { message, showError, clearMessage } = useMessage()
	const recommendationTextRef = useRef<HTMLTextAreaElement | null>(null)

	// Form state
	const [characterId, setCharacterId] = useState('')
	const [sentiment, setSentiment] = useState<RecommendationSentiment>('positive')
	const [recommendationText, setRecommendationText] = useState('')
	const [isPublic, setIsPublic] = useState(false)

	// Mutations
	const addMutation = useAddRecommendation()
	const updateMutation = useUpdateRecommendation()

	const isEditMode = !!existingRecommendation
	const isPending = addMutation.isPending || updateMutation.isPending

	// Keep the form initialization tied to the dialog lifecycle, not to auth object identity.
	const mainCharacterId = user?.mainCharacterId ?? ''

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
				setCharacterId(mainCharacterId)
				setSentiment('positive')
				setRecommendationText('')
				setIsPublic(false)
			}
		}
	}, [open, existingRecommendation?.id, mainCharacterId])

	// Validation
	const textLength = recommendationText.trim().length
	const isTextValid = textLength >= MIN_LENGTH && textLength <= MAX_LENGTH

	// Check if selected character belongs to the application owner (self-recommendation)
	const selectedCharacter = user?.characters.find(
		(char: { characterId: string }) => char.characterId === characterId
	)
	const isSelfRecommendation = selectedCharacter && user?.id === applicationUserId && !isEditMode

	const isFormValid = characterId && sentiment && isTextValid && !isSelfRecommendation

	// Character counter color
	const getCounterColor = () => {
		if (textLength < MIN_LENGTH) return 'text-muted-foreground'
		if (textLength > MAX_LENGTH) return 'text-destructive'
		return 'text-success'
	}

	// Handlers
	const handleSubmit = async () => {
		if (!isFormValid || isPending) return
		clearMessage()

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
				toast.success(<RecommendationFeedback action="updated" />)
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
				toast.success(<RecommendationFeedback action="added" />)
			}

			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			showError(
				(translate) =>
					error instanceof Error && error.message
						? error.message
						: translate(
								isEditMode
									? 'applications.recommendations.feedback.updateFailed'
									: 'applications.recommendations.feedback.addFailed'
							),
				0
			)
		}
	}

	const handleOpenChange = (nextOpen: boolean) => {
		if (isPending) return
		if (!nextOpen) clearMessage()
		onOpenChange(nextOpen)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				className="sm:max-w-[600px] max-h-[90dvh] overflow-y-auto"
				onOpenAutoFocus={(event) => {
					event.preventDefault()
					requestAnimationFrame(() => {
						recommendationTextRef.current?.focus()
					})
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{isEditMode
							? t('applications.recommendations.form.editTitle')
							: t('applications.recommendations.form.addTitle')}
					</DialogTitle>
					<DialogDescription>
						{isEditMode
							? t('applications.recommendations.form.editDescription')
							: t('applications.recommendations.form.addDescription')}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* Character Selector */}
					<div className="space-y-2">
						<Label htmlFor="character">
							{t('applications.recommendations.form.character')}{' '}
							<span className="text-destructive">*</span>
						</Label>
						<Select
							inputId="character"
							value={characterId}
							onValueChange={setCharacterId}
							disabled={isPending}
							options={
								user?.characters.map(
									(char: {
										characterId: string
										characterName: string
										hasValidToken: boolean
									}) => ({
										value: char.characterId,
										label: char.hasValidToken
											? char.characterName
											: t('applications.recommendations.form.expiredCharacter', {
													character: char.characterName,
												}),
									})
								) ?? []
							}
							placeholder={t('applications.recommendations.form.selectCharacter')}
						/>

						{/* Self-recommendation warning */}
						{isSelfRecommendation && (
							<div className="mt-2 flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive">
								<AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
								<p className="text-sm">{t('applications.recommendations.form.selfWarning')}</p>
							</div>
						)}
					</div>

					{/* Sentiment Selector */}
					<div className="space-y-3">
						<Label>
							{t('applications.recommendations.form.sentiment')}{' '}
							<span className="text-destructive">*</span>
						</Label>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
							{SENTIMENT_OPTIONS.map((option) => (
								<SentimentButton
									key={option.value}
									label={t(option.label)}
									description={t(option.description)}
									icon={option.icon}
									selected={sentiment === option.value}
									disabled={isPending}
									onClick={() => setSentiment(option.value)}
									colorClass={option.colorClass}
								/>
							))}
						</div>
					</div>

					{/* Recommendation Text */}
					<div className="space-y-2">
						<Label htmlFor="recommendation-text">
							{t('applications.recommendations.form.text')}{' '}
							<span className="text-destructive">*</span>
						</Label>
						<Textarea
							ref={recommendationTextRef}
							id="recommendation-text"
							placeholder={t('applications.recommendations.form.placeholder')}
							value={recommendationText}
							onChange={(e) => setRecommendationText(e.target.value)}
							disabled={isPending}
							className="min-h-[120px] resize-y"
							maxLength={MAX_LENGTH}
						/>
						<div className="flex items-center justify-between text-xs">
							<span className="text-muted-foreground">
								{textLength < MIN_LENGTH
									? t('applications.recommendations.form.minimum', {
											count: formatNumber(MIN_LENGTH),
										})
									: textLength > MAX_LENGTH
										? t('applications.recommendations.form.maximum')
										: t('applications.recommendations.form.countLabel')}
							</span>
							<span className={cn('font-mono', getCounterColor())}>
								{t('applications.recommendations.form.counter', {
									current: formatNumber(textLength),
									maximum: formatNumber(MAX_LENGTH),
								})}
							</span>
						</div>
					</div>

					{/* Public/Private Toggle */}
					<div className="flex items-center justify-between space-x-2 p-4 rounded-lg border bg-muted/50">
						<div className="space-y-0.5">
							<Label htmlFor="is-public" className="cursor-pointer">
								{t('applications.recommendations.form.makePublic')}
							</Label>
							<p className="text-sm text-muted-foreground">
								{isPublic
									? t('applications.recommendations.form.publicHint')
									: t('applications.recommendations.form.privateHint')}
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

				{message && (
					<p role="alert" className="text-sm text-destructive break-words">
						{message.text}
					</p>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={isPending}>
						{t('common.cancel')}
					</Button>
					<Button onClick={handleSubmit} disabled={!isFormValid || isPending}>
						{isPending
							? isEditMode
								? t('applications.recommendations.form.updating')
								: t('applications.recommendations.form.submitting')
							: isEditMode
								? t('applications.recommendations.form.update')
								: t('applications.recommendations.form.submit')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
