import { Send, UserPlus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
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
import { useCreateJoinRequest, useJoinGroup } from '@/hooks/useGroups'

import type { GroupWithDetails } from '@/lib/api'

interface JoinButtonProps {
	group: GroupWithDetails
	onSuccess?: () => void
}

export function JoinButton({ group, onSuccess }: JoinButtonProps) {
	const [dialogOpen, setDialogOpen] = useState(false)
	const [reason, setReason] = useState('')
	const joinGroup = useJoinGroup()
	const createJoinRequest = useCreateJoinRequest()

	const handleJoinOpen = async () => {
		if (group.joinMode === 'open') {
			// Join directly
			try {
				await joinGroup.mutateAsync(group.id)
				onSuccess?.()
			} catch (error) {
				console.error('Failed to join group:', error)
			}
		} else if (group.joinMode === 'approval') {
			// Open dialog for join request
			setDialogOpen(true)
		} else if (group.joinMode === 'invitation_only') {
			// Cannot join - this should not happen as button is disabled
			return
		}
	}

	const handleSubmitRequest = async () => {
		try {
			await createJoinRequest.mutateAsync({
				groupId: group.id,
				reason,
			})
			setDialogOpen(false)
			setReason('')
			onSuccess?.()
		} catch (error) {
			console.error('Failed to create join request:', error)
		}
	}

	const isLoading = joinGroup.isPending || createJoinRequest.isPending

	if (group.isMember) {
		return null
	}

	if (group.joinMode === 'invitation_only') {
		return (
			<Button disabled variant="outline">
				Invitation Only
			</Button>
		)
	}

	return (
		<>
			<Button onClick={handleJoinOpen} disabled={isLoading}>
				<UserPlus className="mr-2 h-4 w-4" />
				{group.joinMode === 'open' ? 'Join Group' : 'Request to Join'}
			</Button>

			{/* Join Request Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Request to Join {group.name}</DialogTitle>
						<DialogDescription>
							This group requires approval to join. Please provide a reason for your request.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="reason">Reason (optional)</Label>
							<Textarea
								id="reason"
								value={reason}
								onChange={(e) => setReason((e.target as HTMLTextAreaElement).value)}
								placeholder="Why do you want to join this group?"
								rows={3}
							/>
						</div>
					</div>
					<DialogFooter>
						<CancelButton onClick={() => setDialogOpen(false)} disabled={isLoading}>
							Cancel
						</CancelButton>
						<ConfirmButton
							onClick={handleSubmitRequest}
							disabled={isLoading}
							loading={isLoading}
							loadingText="Sending..."
							showIcon={false}
						>
							<Send className="mr-2 h-4 w-4" />
							Send Request
						</ConfirmButton>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
