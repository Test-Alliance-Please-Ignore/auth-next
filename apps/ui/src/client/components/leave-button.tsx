import { LogOut } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { useLeaveGroup } from '@/hooks/useGroups'
import { useAppTranslation } from '@/i18n'

import type { GroupWithDetails } from '@/lib/api'

type LeaveableGroup = Pick<GroupWithDetails, 'id' | 'name' | 'isMember' | 'isOwner' | 'joinMode'>

interface LeaveButtonProps {
	group: LeaveableGroup
	onSuccess?: () => void
	compact?: boolean
}

export function LeaveButton({ group, onSuccess, compact = false }: LeaveButtonProps) {
	const { t } = useAppTranslation()
	const leaveGroup = useLeaveGroup()
	const [confirmationOpen, setConfirmationOpen] = useState(false)
	const [isLeaving, setIsLeaving] = useState(false)

	const handleLeave = async () => {
		if (isLeaving) return
		setIsLeaving(true)
		try {
			await leaveGroup.mutateAsync(group.id)
			onSuccess?.()
		} catch {
			// useLeaveGroup reports the failure through the shared toast handler.
		} finally {
			setConfirmationOpen(false)
			setIsLeaving(false)
		}
	}

	if (!group.isMember) {
		return null
	}

	if (group.isOwner) {
		return (
			<Button disabled variant="ghost" size={compact ? 'sm' : undefined}>
				{t('groups.leave.owner')}
			</Button>
		)
	}

	if (group.joinMode === 'admin_managed') {
		return (
			<Button disabled variant="ghost" size={compact ? 'sm' : undefined}>
				{t('groups.leave.managed')}
			</Button>
		)
	}

	return (
		<>
			<Button
				variant={compact ? 'danger' : 'destructive'}
				size={compact ? 'sm' : undefined}
				showIcon={compact ? false : undefined}
				onClick={() => setConfirmationOpen(true)}
			>
				<LogOut className="h-4 w-4" />
				{compact ? t('groups.leave.short') : t('groups.leave.confirm')}
			</Button>
			<ConfirmationDialog
				open={confirmationOpen}
				title={t('groups.leave.title', { name: group.name })}
				description={t('groups.leave.description')}
				confirmLabel={t('groups.leave.confirm')}
				intent="destructive"
				confirmButtonVariant="danger"
				pending={isLeaving}
				onCancel={() => {
					if (!isLeaving) setConfirmationOpen(false)
				}}
				onConfirm={() => void handleLeave()}
			/>
		</>
	)
}
