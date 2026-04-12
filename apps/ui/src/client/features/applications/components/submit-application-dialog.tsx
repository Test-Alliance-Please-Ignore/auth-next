/**
 * Submit Application Dialog Component
 *
 * Modal dialog for submitting a job application to a corporation.
 * Features character selection, application text with character counter,
 * and validation.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useMessage } from '@/hooks/useMessage'
import { cn } from '@/lib/utils'

import { useSubmitApplication } from '../hooks'
import { Button } from '@/components/ui/button'

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

const MIN_APPLICATION_LENGTH = 25
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
	const { message, showError, clearMessage } = useMessage()
	const submitMutation = useSubmitApplication()

	// Form state
	const [selectedAltIds, setSelectedAltIds] = useState<Set<string>>(new Set())
	const [applicationText, setApplicationText] = useState('')

	// Main character is always the user's main
	const mainCharacterId = user?.mainCharacterId ?? ''
	const characters = user?.characters || []
	const mainCharacter = characters.find(
		(char: { characterId: string }) => char.characterId === mainCharacterId
	)

	// Derived state
	const characterCount = applicationText.length
	const isTextValid =
		characterCount >= MIN_APPLICATION_LENGTH && characterCount <= MAX_APPLICATION_LENGTH
	const isFormValid = mainCharacterId && isTextValid
	const charactersRemaining = MAX_APPLICATION_LENGTH - characterCount
	const isCharacterCountLow = charactersRemaining < 100

	// Alt characters = all characters except the main
	const altCharacters = characters.filter(
		(char: { characterId: string }) => char.characterId !== mainCharacterId
	)

	const toggleAlt = (characterId: string) => {
		setSelectedAltIds((prev) => {
			const next = new Set(prev)
			if (next.has(characterId)) {
				next.delete(characterId)
			} else {
				next.add(characterId)
			}
			return next
		})
	}

	// Handlers
	const handleSubmit = async () => {
		if (!isFormValid) return

		try {
			clearMessage()
			const newApplication = await submitMutation.mutateAsync({
				corporationId,
				characterId: mainCharacterId,
				applicationText,
				altCharacterIds: selectedAltIds.size > 0 ? [...selectedAltIds] : undefined,
			})

			onOpenChange(false)

			// Reset form
			setSelectedAltIds(new Set())
			setApplicationText('')
			navigate('/my-applications')
		} catch (error) {
			showError(error instanceof Error ? error.message : 'Failed to submit application')
		}
	}

	const handleCancel = () => {
		onOpenChange(false)
		// Reset form after dialog closes
		setTimeout(() => {
			setSelectedAltIds(new Set())
			setApplicationText('')
			clearMessage()
		}, 200)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[600px]">
				<DialogHeader>
					<DialogTitle>Apply to {corporationName}</DialogTitle>
					<DialogDescription>
						Submit your application to join this corporation. Make sure to explain why you want to
						join and what you can bring to the corporation.
					</DialogDescription>
				</DialogHeader>

				{message && (
					<Card className="border-destructive bg-destructive/10">
						<CardContent className="py-3">
							<p className="text-destructive text-sm">{message.text}</p>
						</CardContent>
					</Card>
				)}

				<div className="space-y-4 py-4">
					{/* Main Character (read-only) */}
					<div className="space-y-2">
						<Label className="text-sm font-medium">Main Character</Label>
						<div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
							{mainCharacter ? (
								<>
									<span className="font-medium">{mainCharacter.characterName}</span>
									{!mainCharacter.hasValidToken && (
										<span className="text-muted-foreground">(No valid token)</span>
									)}
								</>
							) : (
								<span className="text-muted-foreground">No main character found</span>
							)}
						</div>
					</div>

					{/* Alt Characters */}
					{mainCharacterId && altCharacters.length > 0 && (
						<div className="space-y-2">
							<Label className="text-sm font-medium">Alt Characters</Label>
							<p className="text-xs text-muted-foreground">
								Select any alt characters you are also applying with.
							</p>
							<div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
								{altCharacters.map((char: { characterId: string; characterName: string; hasValidToken: boolean }) => (
									<label
										key={char.characterId}
										className="flex items-center gap-2 cursor-pointer"
									>
										<Checkbox
											checked={selectedAltIds.has(char.characterId)}
											onCheckedChange={() => toggleAlt(char.characterId)}
										/>
										<span className="text-sm">
											{char.characterName}
											{!char.hasValidToken && (
												<span className="text-muted-foreground"> (No valid token)</span>
											)}
										</span>
									</label>
								))}
							</div>
						</div>
					)}

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
									<>{MIN_APPLICATION_LENGTH - characterCount} more characters required</>
								)}
								{characterCount >= MIN_APPLICATION_LENGTH && isTextValid && <>Minimum length met</>}
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
					<Button variant="cancel" onClick={handleCancel} disabled={submitMutation.isPending}>
						Cancel
					</Button>
					<Button variant="confirm"
						onClick={handleSubmit}
						disabled={!isFormValid}
						loading={submitMutation.isPending}
						loadingText="Submitting..."
					>
						Submit Application
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
