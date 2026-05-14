import { useCancelInvitation, useGroupInvitations } from '@/hooks/useGroups'
import { Trash2 } from 'lucide-react'

import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'

interface PendingInvitationsListProps {
	groupId: string
}

export function PendingInvitationsList({ groupId }: PendingInvitationsListProps) {
	const { data: invitations, isLoading, error } = useGroupInvitations(groupId)
	const cancelInvitation = useCancelInvitation()

	if (isLoading) {
		return (
			<Card className="p-4">
				<h3 className="text-lg font-semibold mb-3">Pending Invitations</h3>
				<div className="text-sm text-gray-500">Loading invitations...</div>
			</Card>
		)
	}

	if (error) {
		return (
			<Card className="p-4">
				<h3 className="text-lg font-semibold mb-3">Pending Invitations</h3>
				<div className="text-sm text-red-600">Failed to load invitations</div>
			</Card>
		)
	}

	if (!invitations || invitations.length === 0) {
		return (
			<Card className="p-4">
				<h3 className="text-lg font-semibold mb-3">Pending Invitations</h3>
				<div className="text-sm text-gray-500">No pending invitations</div>
			</Card>
		)
	}

	return (
		<Card className="p-4">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-lg font-semibold">Pending Invitations</h3>
				<Badge variant="secondary">{invitations.length}</Badge>
			</div>

			<div className="space-y-2">
				{invitations.map((invitation) => (
					<div
						key={invitation.id}
						className="rounded-lg border border-border p-3 transition-colors hover:bg-muted/30"
					>
						<div className="flex items-start justify-between">
							<div className="flex-1">
								<div className="font-medium text-sm">
									{invitation.inviteeCharacterName || 'Unknown Character'}
								</div>
								<div className="text-xs text-gray-500 mt-1">
									Invited by: {invitation.inviterCharacterName || 'Unknown'}
								</div>
								<div className="text-xs text-gray-500">
									Sent: {new Date(invitation.createdAt).toLocaleDateString()}
								</div>
								<div className="text-xs text-gray-500">
									Expires: {new Date(invitation.expiresAt).toLocaleDateString()}
								</div>
							</div>
							<Badge variant="ghost" className="ml-2">
								{invitation.status}
							</Badge>
						</div>
						<div className="mt-3 flex justify-end">
							<Button
								variant="ghost"
								size="sm"
								onClick={() =>
									cancelInvitation.mutate({
										invitationId: invitation.id,
										groupId,
									})
								}
								disabled={cancelInvitation.isPending}
								aria-label={`Cancel invitation for ${invitation.inviteeCharacterName || 'unknown character'}`}
							>
								<Trash2 className="h-4 w-4" />
								<span className="ml-2">Cancel</span>
							</Button>
						</div>
					</div>
				))}
			</div>
		</Card>
	)
}
