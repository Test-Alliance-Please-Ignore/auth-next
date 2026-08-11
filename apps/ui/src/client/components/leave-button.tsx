import { LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useLeaveGroup } from '@/hooks/useGroups'

import type { GroupWithDetails } from '@/lib/api'

type LeaveableGroup = Pick<GroupWithDetails, 'id' | 'name' | 'isMember' | 'isOwner' | 'joinMode'>

interface LeaveButtonProps {
	group: LeaveableGroup
	onSuccess?: () => void
	compact?: boolean
}

export function LeaveButton({ group, onSuccess, compact = false }: LeaveButtonProps) {
	const leaveGroup = useLeaveGroup()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	if (!group.isMember) {
		return null
	}

	if (group.isOwner) {
		return (
			<Button disabled variant="ghost" size={compact ? 'sm' : undefined}>
				You are the owner
			</Button>
		)
	}

	if (group.joinMode === 'admin_managed') {
		return (
			<Button disabled variant="ghost" size={compact ? 'sm' : undefined}>
				Managed by Admins
			</Button>
		)
	}

	return (
		<>
			<Button
				variant={compact ? 'danger' : 'destructive'}
				size={compact ? 'sm' : undefined}
				showIcon={compact ? false : undefined}
				onClick={() =>
					requestConfirmation({
						title: `Leave ${group.name}?`,
						description:
							'Are you sure you want to leave this group? You will need to rejoin or be re-invited to access group content again.',
						confirmLabel: 'Leave Group',
						intent: 'destructive',
						confirmButtonVariant: 'danger',
						onConfirm: async () => {
							try {
								await leaveGroup.mutateAsync(group.id)
								onSuccess?.()
							} catch {
								// useLeaveGroup reports the failure through the shared toast handler.
							}
						},
					})
				}
			>
				<LogOut className="h-4 w-4" />
				{compact ? 'Leave' : 'Leave Group'}
			</Button>
			{confirmationDialog}
		</>
	)
}
