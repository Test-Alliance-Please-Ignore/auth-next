import { Heart } from 'lucide-react'

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'

import type { CorporationMember } from '../api'
import { Button } from '@/components/ui/button'

interface EmeritusConfirmationDialogProps {
	member: CorporationMember | null
	action: 'mark' | 'remove'
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (characterId: string, status: 'active' | 'emeritus') => Promise<void>
	isSubmitting?: boolean
}

export function EmeritusConfirmationDialog({
	member,
	action,
	open,
	onOpenChange,
	onSubmit,
	isSubmitting,
}: EmeritusConfirmationDialogProps) {
	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!member) {
			console.error('No member selected')
			return
		}

		try {
			const newStatus = action === 'mark' ? 'emeritus' : 'active'
			await onSubmit(member.characterId, newStatus)
		} catch (error) {
			console.error('Failed to update member status:', error)
		}
	}

	if (!member) {
		return null
	}

	const isMarkingEmeritus = action === 'mark'

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{isMarkingEmeritus ? 'Mark as Emeritus' : 'Remove Emeritus Status'}
					</DialogTitle>
					<DialogDescription>
						{isMarkingEmeritus
							? 'This will mark the character as emeritus and exclude them from corporation statistics.'
							: 'This will restore the character to active status and include them in statistics.'}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Member Information */}
					<div className="bg-muted/50 rounded-lg p-4 space-y-3">
						<div className="flex items-center gap-2">
							<Heart className="h-5 w-5 text-muted-foreground" />
							<h3 className="font-semibold">{member.characterName}</h3>
						</div>
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm">
								<span className="text-muted-foreground">Role:</span>
								<span className="font-medium">{member.role}</span>
							</div>
							{member.mainCharacterName && (
								<p className="text-sm text-muted-foreground">
									Main Character: {member.mainCharacterName}
								</p>
							)}
						</div>
					</div>

					{/* Information/Warning */}
					{isMarkingEmeritus ? (
						<div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-2">
							<p className="text-sm text-amber-900 dark:text-amber-200">
								<strong>Emeritus Status:</strong>
							</p>
							<ul className="text-sm text-amber-900 dark:text-amber-200 list-disc list-inside space-y-1">
								<li>Character will be excluded from all corporation statistics</li>
								<li>They will not count toward linked/unlinked member totals</li>
								<li>This status is designed for characters whose owners have passed away</li>
								<li>
									<strong>Important:</strong> If the character logs in (in-game or to the app), they
									should be immediately blacklisted
								</li>
							</ul>
						</div>
					) : (
						<div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
							<p className="text-sm">
								<strong>Note:</strong> Removing emeritus status will include this character in all
								corporation statistics again.
							</p>
						</div>
					)}

					{/* Action Buttons */}
					<div className="flex justify-end gap-2 pt-4">
						<Button variant="cancel" type="button" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
							Cancel
						</Button>
						<Button variant="danger"
							type="submit"
							loading={isSubmitting}
							loadingText={
								isMarkingEmeritus ? 'Marking as Emeritus...' : 'Removing Emeritus Status...'
							}
							showIcon={false}
						>
							<Heart className="mr-2 h-4 w-4" />
							{isMarkingEmeritus ? 'Mark as Emeritus' : 'Remove Emeritus Status'}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
