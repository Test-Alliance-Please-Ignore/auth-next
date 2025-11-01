import { Shield } from 'lucide-react'
import { useState } from 'react'

import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
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

import type { CorporationMember } from '../../my-corporations/api'
import type { GrantHrRoleRequest, HrRoleType } from '../api'
import { HR_ROLE_DESCRIPTIONS, HR_ROLE_NAMES } from '../api'
import { HrRoleBadge } from './hr-role-badge'

interface GrantHrRoleDialogProps {
	member: CorporationMember | null
	corporationId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (request: GrantHrRoleRequest) => Promise<void>
	isSubmitting?: boolean
}

const HR_ROLES: HrRoleType[] = ['hr_admin', 'hr_reviewer', 'hr_viewer']

export function GrantHrRoleDialog({
	member,
	corporationId,
	open,
	onOpenChange,
	onSubmit,
	isSubmitting,
}: GrantHrRoleDialogProps) {
	const [selectedRole, setSelectedRole] = useState<HrRoleType>('hr_reviewer')

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
			setSelectedRole('hr_reviewer')
		} catch (error) {
			console.error('Failed to grant HR role:', error)
		}
	}

	const handleCancel = () => {
		setSelectedRole('hr_reviewer')
		onOpenChange(false)
	}

	if (!member) {
		return null
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Grant HR Role</DialogTitle>
					<DialogDescription>
						Assign an HR role to {member.characterName} to give them access to the HR management
						system
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
							<p>Corporation Role: {member.role}</p>
							{member.authUserName && <p>Auth Account: {member.authUserName}</p>}
						</div>
					</div>

					{/* Role Selection */}
					<div className="space-y-2">
						<Label htmlFor="hr-role">
							HR Role <span className="text-destructive">*</span>
						</Label>
						<Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as HrRoleType)}>
							<SelectTrigger id="hr-role">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{HR_ROLES.map((role) => (
									<SelectItem key={role} value={role}>
										<div className="flex items-center gap-2">
											<span>{HR_ROLE_NAMES[role]}</span>
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">Select the HR role to grant to this member</p>
					</div>

					{/* Role Description */}
					<div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-2">
						<div className="flex items-center gap-2">
							<HrRoleBadge role={selectedRole} showTooltip={false} />
							<span className="text-sm font-medium">Role Capabilities</span>
						</div>
						<p className="text-sm text-muted-foreground">{HR_ROLE_DESCRIPTIONS[selectedRole]}</p>
					</div>

					{/* Warning */}
					{selectedRole === 'hr_admin' && (
						<div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
							<p className="text-sm text-orange-600 dark:text-orange-400">
								<strong>Warning:</strong> HR Admins have full access to the HR system, including the
								ability to view sensitive notes and manage all applications.
							</p>
						</div>
					)}

					{/* Action Buttons */}
					<div className="flex justify-end gap-2 pt-4">
						<CancelButton type="button" onClick={handleCancel} disabled={isSubmitting}>
							Cancel
						</CancelButton>
						<ConfirmButton
							type="submit"
							loading={isSubmitting}
							loadingText="Granting Role..."
							showIcon={false}
						>
							<Shield className="mr-2 h-4 w-4" />
							Grant Role
						</ConfirmButton>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
