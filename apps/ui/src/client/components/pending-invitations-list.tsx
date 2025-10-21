import { useGroupInvitations } from '@/hooks/useGroups'
import { Card } from './ui/card'
import { Badge } from './ui/badge'

interface PendingInvitationsListProps {
	groupId: string
}

export function PendingInvitationsList({ groupId }: PendingInvitationsListProps) {
	const { data: invitations, isLoading, error } = useGroupInvitations(groupId)

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
						className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors"
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
							<Badge variant="outline" className="ml-2">
								{invitation.status}
							</Badge>
						</div>
					</div>
				))}
			</div>
		</Card>
	)
}
