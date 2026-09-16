import { Shield } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAppTranslation } from '@/i18n'

import { HR_ROLE_DESCRIPTIONS, HR_ROLE_NAMES } from '../api'
import { HrRoleBadge } from './hr-role-badge'

import type { CorporationMember } from '../../corporations/api'
import type { GrantHrRoleRequest, HrRoleType } from '../api'

interface GrantHrRoleDialogProps {
	member: CorporationMember | null
	corporationId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (request: GrantHrRoleRequest) => Promise<void>
	isSubmitting?: boolean
	allowedRoles?: HrRoleType[]
}

const HR_ROLES: HrRoleType[] = ['hr_admin', 'hr_reviewer', 'hr_viewer']

export function GrantHrRoleDialog({
	member,
	corporationId,
	open,
	onOpenChange,
	onSubmit,
	isSubmitting,
	allowedRoles = HR_ROLES,
}: GrantHrRoleDialogProps) {
	const { t } = useAppTranslation()

	const [selectedRole, setSelectedRole] = useState<HrRoleType>(
		allowedRoles.includes('hr_reviewer') ? 'hr_reviewer' : allowedRoles[0]
	)

	useEffect(() => {
		if (!allowedRoles.includes(selectedRole)) {
			setSelectedRole(allowedRoles.includes('hr_reviewer') ? 'hr_reviewer' : allowedRoles[0])
		}
	}, [allowedRoles, selectedRole])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!member?.authUserId) {
			console.error('Member does not have an auth user ID')
			return
		}

		try {
			await onSubmit({
				corporationId,
				userId: member.authUserId,
				characterId: member.characterId,
				characterName: member.characterName,
				role: selectedRole,
			})

			// Reset form
			setSelectedRole(allowedRoles.includes('hr_reviewer') ? 'hr_reviewer' : allowedRoles[0])
		} catch (error) {
			console.error('Failed to grant HR role:', error)
		}
	}

	const handleCancel = () => {
		setSelectedRole(allowedRoles.includes('hr_reviewer') ? 'hr_reviewer' : allowedRoles[0])
		onOpenChange(false)
	}

	if (!member) {
		return null
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>{t('hrpages.grantHrRole')}</DialogTitle>
					<DialogDescription>
						{t('hrpages.assignAnHrRoleTo')}
						{member.characterName}
						{t('hrpages.toGiveThemAccessToTheHrManagementSystem')}
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Member Information */}
					<div className="bg-muted/50 rounded-lg p-4 space-y-2">
						<div className="flex items-center gap-2">
							<Shield className="h-5 w-5 text-muted-foreground" />
							<h3 className="font-semibold">{member.characterName}</h3>
						</div>
						<div className="text-sm text-muted-foreground space-y-1">
							<p>
								{t('hrpages.corporationRole')}
								{member.role}
							</p>
							{member.mainCharacterName && (
								<p>
									{t('hrpages.mainCharacter2')}
									{member.mainCharacterName}
								</p>
							)}
						</div>
					</div>

					{/* Role Selection */}
					<div className="space-y-2">
						<Label htmlFor="hr-role">
							{t('hrpages.hrRole2')}
							<span className="text-destructive">*</span>
						</Label>
						<Select
							value={selectedRole}
							onValueChange={(value) => setSelectedRole(value as HrRoleType)}
							inputId="hr-role"
							options={allowedRoles.map((role) => ({ value: role, label: HR_ROLE_NAMES[role] }))}
						/>
						<p className="text-xs text-muted-foreground">
							{t('hrpages.selectTheHrRoleToGrantToThisMember')}
						</p>
					</div>

					{/* Role Description */}
					<div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-2">
						<div className="flex items-center gap-2">
							<HrRoleBadge role={selectedRole} showTooltip={false} />
							<span className="text-sm font-medium">{t('hrpages.roleCapabilities')}</span>
						</div>
						<p className="text-sm text-muted-foreground">{HR_ROLE_DESCRIPTIONS[selectedRole]}</p>
					</div>

					{/* Warning */}
					{selectedRole === 'hr_admin' && (
						<div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
							<p className="text-sm text-orange-600 dark:text-orange-400">
								<strong>{t('hrpages.warning2')}</strong>
								{t('hrpages.hrAdminsHaveFullAccessToTheHrSystemIncluding')}
							</p>
						</div>
					)}

					{/* Action Buttons */}
					<div className="flex justify-end gap-2 pt-4">
						<Button variant="cancel" type="button" onClick={handleCancel} disabled={isSubmitting}>
							{t('hrpages.cancel')}
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={isSubmitting}
							loadingText={t('hrpages.grantingRole')}
							showIcon={false}
						>
							<Shield className="h-4 w-4" />
							{t('hrpages.grantRole')}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
