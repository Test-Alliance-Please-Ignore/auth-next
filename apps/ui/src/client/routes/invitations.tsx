import { useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'

import { InvitationCard } from '@/components/invitation-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
				<h1 className="text-4xl md:text-5xl font-bold gradient-text">Group Invitations</h1>
				<p className="text-muted-foreground mt-2">View and respond to pending group invitations</p>
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
					<CardContent className="py-16 text-center">
						<div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
							<Mail className="h-10 w-10 text-muted-foreground" />
						</div>
						<h3 className="text-xl font-semibold mb-2">No Pending Invitations</h3>
						<p className="text-muted-foreground mb-6 max-w-md mx-auto">
							You don't have any pending group invitations at the moment. Browse available groups to
							find communities to join.
						</p>
						<Button onClick={() => navigate('/groups')} size="lg">
							Browse Available Groups
						</Button>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
