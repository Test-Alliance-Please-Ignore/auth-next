import { useState } from 'react'
import { UserPlus, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useJoinGroup, useCreateJoinRequest } from '@/hooks/useGroups'

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
			// Cannot join - show message
			alert('This group is invitation-only. You need an invitation to join.')
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
							<textarea
								id="reason"
								value={reason}
								onChange={(e) => setReason((e.target as HTMLTextAreaElement).value)}
								placeholder="Why do you want to join this group?"
								className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								rows={3}
							/>
						</div>
						<div className="flex justify-end gap-2">
							<Button
								variant="outline"
								onClick={() => setDialogOpen(false)}
								disabled={isLoading}
							>
								Cancel
							</Button>
							<Button onClick={handleSubmitRequest} disabled={isLoading}>
								<Send className="mr-2 h-4 w-4" />
								{isLoading ? 'Sending...' : 'Send Request'}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
