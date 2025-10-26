import { LogOut } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { DestructiveButton } from '@/components/ui/destructive-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
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
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const leaveGroup = useLeaveGroup()

	const handleLeave = async () => {
		setErrorMessage(null)
		try {
			await leaveGroup.mutateAsync(group.id)
			setConfirmOpen(false)
			onSuccess?.()
		} catch (error) {
			console.error('Failed to leave group:', error)
			if (error instanceof Error) {
				setErrorMessage(error.message)
			} else {
				setErrorMessage('Failed to leave group. Please try again.')
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
					{errorMessage && (
						<div className="rounded-md border border-destructive bg-destructive/10 p-3">
							<p className="text-sm text-destructive">{errorMessage}</p>
						</div>
					)}
					<DialogFooter>
						<CancelButton onClick={() => setConfirmOpen(false)} disabled={leaveGroup.isPending}>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleLeave}
							loading={leaveGroup.isPending}
							loadingText="Leaving..."
						>
							Leave Group
						</DestructiveButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
