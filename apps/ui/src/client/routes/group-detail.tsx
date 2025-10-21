import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GroupCard } from '@/components/group-card'
import { JoinButton } from '@/components/join-button'
import { LeaveButton } from '@/components/leave-button'
import { useGroup } from '@/hooks/useGroups'

export default function GroupDetailPage() {
	const { groupId } = useParams<{ groupId: string }>()
	const navigate = useNavigate()
	const { data: group, isLoading } = useGroup(groupId!)

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<p className="text-muted-foreground">Loading group details...</p>
			</div>
		)
	}

	if (!group) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
				<p className="text-muted-foreground">Group not found</p>
				<Button onClick={() => navigate('/groups')}>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Groups
				</Button>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Back Button */}
			<Button variant="ghost" onClick={() => navigate('/groups')}>
				<ArrowLeft className="mr-2 h-4 w-4" />
				Back to Groups
			</Button>

			{/* Group Info */}
			<GroupCard group={group} />

			{/* Actions */}
			<Card className="glow">
				<CardHeader>
					<CardTitle>Actions</CardTitle>
					<CardDescription>Manage your membership in this group</CardDescription>
				</CardHeader>
				<CardContent className="flex gap-3">
					<JoinButton
						group={group}
						onSuccess={() => {
							alert('Successfully joined the group!')
							navigate('/my-groups')
						}}
					/>
					<LeaveButton
						group={group}
						onSuccess={() => {
							alert('You have left the group')
							navigate('/groups')
						}}
					/>
				</CardContent>
			</Card>

			{/* Member Count */}
			<Card className="glow">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Users className="h-5 w-5" />
						Members
					</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-2xl font-bold">{group.memberCount || 0}</p>
					<p className="text-sm text-muted-foreground">Active members</p>
				</CardContent>
			</Card>
		</div>
	)
}
