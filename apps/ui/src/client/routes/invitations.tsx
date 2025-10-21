import { useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InvitationCard } from '@/components/invitation-card'
import { usePendingInvitations } from '@/hooks/useGroups'

export default function InvitationsPage() {
	const navigate = useNavigate()
	const { data: invitations, isLoading } = usePendingInvitations()

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<p className="text-muted-foreground">Loading invitations...</p>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">Group Invitations</h1>
				<p className="text-muted-foreground mt-1">View and respond to pending group invitations</p>
			</div>

			{/* Invitations List */}
			{invitations && invitations.length > 0 ? (
				<div className="space-y-4">
					{invitations.map((invitation) => (
						<InvitationCard
							key={invitation.id}
							invitation={invitation}
							onActionComplete={() => {
								navigate('/my-groups')
							}}
						/>
					))}
				</div>
			) : (
				/* Empty State */
				<Card className="glow">
					<CardContent className="py-12 text-center">
						<Mail className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
						<h3 className="text-lg font-semibold mb-2">No Pending Invitations</h3>
						<p className="text-muted-foreground mb-4">
							You don't have any pending group invitations at the moment.
						</p>
						<button
							onClick={() => navigate('/groups')}
							className="text-primary hover:underline font-medium"
						>
							Browse Groups
						</button>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
