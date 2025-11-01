/**
 * Submit Application Dialog Component
 *
 * Modal dialog for submitting a job application to a corporation.
 * Features character selection, application text with character counter,
 * and validation.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
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
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { cn } from '@/lib/utils'

import { useSubmitApplication } from '../hooks'

// ============================================================================
// Types
// ============================================================================

export interface SubmitApplicationDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	corporationId: string
	corporationName: string
}

// ============================================================================
// Constants
// ============================================================================

const MIN_APPLICATION_LENGTH = 100
const MAX_APPLICATION_LENGTH = 2000

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog for submitting a job application
 *
 * @example
 * ```tsx
 * <SubmitApplicationDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   corporationId="98012345"
 *   corporationName="Test Corporation"
 * />
 * ```
 */
export function SubmitApplicationDialog({
	open,
	onOpenChange,
	corporationId,
	corporationName,
}: SubmitApplicationDialogProps) {
	const navigate = useNavigate()
	const { user } = useAuth()
	const { showSuccess, showError } = useMessage()
	const submitMutation = useSubmitApplication()

	// Form state
	const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')
	const [applicationText, setApplicationText] = useState('')

	// Derived state
	const characterCount = applicationText.length
	const isTextValid =
		characterCount >= MIN_APPLICATION_LENGTH && characterCount <= MAX_APPLICATION_LENGTH
	const isFormValid = selectedCharacterId && isTextValid
	const charactersRemaining = MAX_APPLICATION_LENGTH - characterCount
	const isCharacterCountLow = charactersRemaining < 100

	// Get user's characters
	const characters = user?.characters || []

	// Handlers
	const handleSubmit = async () => {
		if (!isFormValid) return

		try {
			const newApplication = await submitMutation.mutateAsync({
				corporationId,
				characterId: selectedCharacterId,
				applicationText,
			})

			showSuccess('Application submitted successfully')
			onOpenChange(false)

			// Reset form
			setSelectedCharacterId('')
			setApplicationText('')

			// Navigate to My Applications page
			navigate('/my-applications')
		} catch (error) {
			showError(
				error instanceof Error ? error.message : 'Failed to submit application'
			)
		}
	}

	const handleCancel = () => {
		onOpenChange(false)
		// Reset form after dialog closes
		setTimeout(() => {
			setSelectedCharacterId('')
			setApplicationText('')
		}, 200)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[600px]">
				<DialogHeader>
					<DialogTitle>Apply to {corporationName}</DialogTitle>
					<DialogDescription>
						Submit your application to join this corporation. Make sure to explain why you
						want to join and what you can bring to the corporation.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Character Selection */}
					<div className="space-y-2">
						<Label htmlFor="character" className="text-sm font-medium">
							Character <span className="text-destructive">*</span>
						</Label>
						<Select value={selectedCharacterId} onValueChange={setSelectedCharacterId}>
							<SelectTrigger id="character">
								<SelectValue placeholder="Select a character" />
							</SelectTrigger>
							<SelectContent>
								{characters.map((char: { characterId: string; characterName: string; hasValidToken: boolean }) => (
									<SelectItem key={char.characterId} value={char.characterId}>
										{char.characterName}
										{!char.hasValidToken && ' (No valid token)'}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{characters.length === 0 && (
							<p className="text-xs text-muted-foreground">
								You don't have any characters linked to your account.
							</p>
						)}
					</div>

					{/* Application Text */}
					<div className="space-y-2">
						<Label htmlFor="application-text" className="text-sm font-medium">
							Application Text <span className="text-destructive">*</span>
						</Label>
						<Textarea
							id="application-text"
							placeholder="Tell us why you want to join this corporation..."
							value={applicationText}
							onChange={(e) => setApplicationText(e.target.value)}
							className="min-h-[200px] resize-y"
							maxLength={MAX_APPLICATION_LENGTH}
						/>

						{/* Character Counter */}
						<div className="flex justify-between items-center text-xs">
							<span
								className={cn(
									'text-muted-foreground',
									characterCount < MIN_APPLICATION_LENGTH && 'text-destructive',
									isTextValid && 'text-success'
								)}
							>
								{characterCount < MIN_APPLICATION_LENGTH && (
									<>
										{MIN_APPLICATION_LENGTH - characterCount} more characters required
									</>
								)}
								{characterCount >= MIN_APPLICATION_LENGTH && isTextValid && (
									<>Minimum length met</>
								)}
							</span>
							<span
								className={cn(
									'text-muted-foreground',
									isCharacterCountLow && 'text-warning',
									charactersRemaining < 0 && 'text-destructive'
								)}
							>
								{characterCount.toLocaleString()} / {MAX_APPLICATION_LENGTH.toLocaleString()}{' '}
								characters
							</span>
						</div>
					</div>
				</div>

				<DialogFooter>
					<CancelButton onClick={handleCancel} disabled={submitMutation.isPending}>
						Cancel
					</CancelButton>
					<ConfirmButton
						onClick={handleSubmit}
						disabled={!isFormValid}
						loading={submitMutation.isPending}
						loadingText="Submitting..."
					>
						Submit Application
					</ConfirmButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
