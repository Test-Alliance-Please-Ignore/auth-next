import { LogOut } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useLeaveGroup } from '@/hooks/useGroups'

import type { GroupWithDetails } from '@/lib/api'

interface LeaveButtonProps {
	group: GroupWithDetails
	onSuccess?: () => void
}

export function LeaveButton({ group, onSuccess }: LeaveButtonProps) {
	const [confirmOpen, setConfirmOpen] = useState(false)
	const leaveGroup = useLeaveGroup()

	const handleLeave = async () => {
		try {
			await leaveGroup.mutateAsync(group.id)
			setConfirmOpen(false)
			onSuccess?.()
		} catch (error) {
			console.error('Failed to leave group:', error)
			if (error instanceof Error) {
				alert(error.message)
			}
		}
	}

	if (!group.isMember) {
		return null
	}

	if (group.isOwner) {
		return (
			<Button disabled variant="outline">
				You are the owner
			</Button>
		)
	}

	return (
		<>
			<Button variant="destructive" onClick={() => setConfirmOpen(true)}>
				<LogOut className="mr-2 h-4 w-4" />
				Leave Group
			</Button>

			<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Leave {group.name}?</DialogTitle>
						<DialogDescription>
							Are you sure you want to leave this group? You will need to rejoin or be re-invited to
							access group content again.
						</DialogDescription>
					</DialogHeader>
					<div className="flex justify-end gap-2">
						<Button
							variant="outline"
							onClick={() => setConfirmOpen(false)}
							disabled={leaveGroup.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleLeave} disabled={leaveGroup.isPending}>
							{leaveGroup.isPending ? 'Leaving...' : 'Leave Group'}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
