import { Heart } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useAppTranslation } from '@/i18n'

import { formatCorporationRoleLabel } from '../hooks'

import type { CorporationMember } from '../api'

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
	const { t } = useAppTranslation()

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
						{isMarkingEmeritus
							? t('characterpages.markAsEmeritus')
							: t('characterpages.removeEmeritusStatus')}
					</DialogTitle>
					<DialogDescription>
						{isMarkingEmeritus
							? t('characterpages.thisWillMarkTheCharacterAsEmeritusAndExcludeThem')
							: t('characterpages.thisWillRestoreTheCharacterToActiveStatusAndInclude')}
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
								<span className="text-muted-foreground">{t('characterpages.role2')}</span>
								<span className="font-medium">{formatCorporationRoleLabel(member.role)}</span>
							</div>
							{member.mainCharacterName && (
								<p className="text-sm text-muted-foreground">
									{t('characterpages.mainCharacter')}
									{member.mainCharacterName}
								</p>
							)}
						</div>
					</div>

					{/* Information/Warning */}
					{isMarkingEmeritus ? (
						<div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 space-y-2">
							<p className="text-sm text-amber-900 dark:text-amber-200">
								<strong>{t('characterpages.emeritusStatus')}</strong>
							</p>
							<ul className="text-sm text-amber-900 dark:text-amber-200 list-disc list-inside space-y-1">
								<li>{t('characterpages.characterWillBeExcludedFromAllCorporationStatistics')}</li>
								<li>{t('characterpages.theyWillNotCountTowardLinkedUnlinkedMemberTotals')}</li>
								<li>
									{t('characterpages.thisStatusIsDesignedForCharactersWhoseOwnersHavePassed')}
								</li>
								<li>
									<strong>{t('characterpages.important')}</strong>
									{t('characterpages.ifTheCharacterLogsInInGameOrToThe')}
								</li>
							</ul>
						</div>
					) : (
						<div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
							<p className="text-sm">
								<strong>{t('characterpages.note')}</strong>
								{t('characterpages.removingEmeritusStatusWillIncludeThisCharacterInAllCorporation')}
							</p>
						</div>
					)}

					{/* Action Buttons */}
					<div className="flex justify-end gap-2 pt-4">
						<Button
							variant="cancel"
							type="button"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							{t('characterpages.cancel')}
						</Button>
						<Button
							variant="destructive"
							type="submit"
							loading={isSubmitting}
							loadingText={
								isMarkingEmeritus
									? t('characterpages.markingAsEmeritus')
									: t('characterpages.removingEmeritusStatus')
							}
							showIcon={false}
						>
							<Heart className="h-4 w-4" />
							{isMarkingEmeritus
								? t('characterpages.markAsEmeritus')
								: t('characterpages.removeEmeritusStatus')}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
