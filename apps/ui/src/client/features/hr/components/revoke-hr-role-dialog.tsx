import { ShieldOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useAppTranslation } from '@/i18n'

import { HrRoleBadge } from './hr-role-badge'

import type { CorporationMember } from '../../corporations/api'
import type { HrRoleGrant, RevokeHrRoleRequest } from '../api'

interface RevokeHrRoleDialogProps {
	member: CorporationMember | null
	hrRole: HrRoleGrant | null
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (request: RevokeHrRoleRequest) => Promise<void>
	isSubmitting?: boolean
}

export function RevokeHrRoleDialog({
	member,
	hrRole,
	open,
	onOpenChange,
	onSubmit,
	isSubmitting,
}: RevokeHrRoleDialogProps) {
	const { t } = useAppTranslation()

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!hrRole?.id || !hrRole?.corporationId) {
			console.error('HR role does not have an ID or corporation ID')
			return
		}

		try {
			await onSubmit({
				roleId: hrRole.id,
				corporationId: hrRole.corporationId,
			})
		} catch (error) {
			console.error('Failed to revoke HR role:', error)
		}
	}

	if (!member || !hrRole) {
		return null
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{t('hrpages.revokeHrRole')}</DialogTitle>
					<DialogDescription>
						{t('hrpages.thisWillRemoveHrAccessFor')}
						{member.characterName}
						{t('hrpages.theyWillNoLongerBeAbleToAccessTheHr')}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Member Information */}
					<div className="bg-muted/50 rounded-lg p-4 space-y-3">
						<div className="flex items-center gap-2">
							<ShieldOff className="h-5 w-5 text-muted-foreground" />
							<h3 className="font-semibold">{member.characterName}</h3>
						</div>
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm">
								<span className="text-muted-foreground">{t('hrpages.currentHrRole')}</span>
								<HrRoleBadge role={hrRole} />
							</div>
							{member.mainCharacterName && (
								<p className="text-sm text-muted-foreground">
									{t('hrpages.mainCharacter2')}
									{member.mainCharacterName}
								</p>
							)}
						</div>
					</div>

					{/* Warning */}
					<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
						<p className="text-sm text-destructive">
							<strong>{t('hrpages.warning2')}</strong>
							{t('hrpages.thisActionWillImmediatelyRevokeAllHrSystemAccessFor')}
						</p>
					</div>

					{/* Action Buttons */}
					<div className="flex justify-end gap-2 pt-4">
						<Button
							variant="cancel"
							type="button"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							{t('hrpages.cancel')}
						</Button>
						<Button
							variant="destructive"
							type="submit"
							loading={isSubmitting}
							loadingText={t('hrpages.revokingRole')}
							showIcon={false}
						>
							<ShieldOff className="h-4 w-4" />
							{t('hrpages.revokeRole')}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
