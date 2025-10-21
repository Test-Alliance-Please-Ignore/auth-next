import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Section } from '@/components/ui/section'
import { GroupCard } from '@/components/group-card'
import { JoinButton } from '@/components/join-button'
import { LeaveButton } from '@/components/leave-button'
import { MemberListReadonly } from '@/components/member-list-readonly'
import { TransferOwnershipDialog } from '@/components/transfer-ownership-dialog'
import { useAuth } from '@/hooks/useAuth'
import { useGroup } from '@/hooks/useGroups'
import { useGroupMembers } from '@/hooks/useGroupMembers'

export default function GroupDetailPage() {
	const { groupId } = useParams<{ groupId: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()
	const { data: group, isLoading } = useGroup(groupId!)
	const { data: members, isLoading: membersLoading } = useGroupMembers(groupId!)
	const [transferDialogOpen, setTransferDialogOpen] = useState(false)

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
		<Container>
			<Section>
				{/* Back Button */}
				<Button variant="ghost" onClick={() => navigate('/groups')}>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Groups
				</Button>

				{/* Group Info */}
				<GroupCard group={group} />

				{/* Actions */}
				<Card variant="interactive">
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

			{/* Members List */}
				<Card variant="interactive">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Users className="h-5 w-5" />
						Members ({group.memberCount || 0})
					</CardTitle>
					<CardDescription>All members of this group</CardDescription>
				</CardHeader>
				<CardContent>
					<MemberListReadonly
						members={members || []}
						group={group}
						currentUserId={user?.id}
						isLoading={membersLoading}
					/>
				</CardContent>
			</Card>

			{/* Transfer Ownership - Owner Only */}
			{group.isOwner && (
				<Card variant="interactive" className="border-amber-500/50">
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<UserCog className="h-5 w-5" />
							Transfer Ownership
						</CardTitle>
						<CardDescription>
							Transfer ownership of this group to another member. You will become a group admin after the
							transfer.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button variant="outline" onClick={() => setTransferDialogOpen(true)}>
							<UserCog className="mr-2 h-4 w-4" />
							Transfer Ownership
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Transfer Ownership Dialog */}
				{group && members && (
					<TransferOwnershipDialog
						group={group}
						members={members}
						open={transferDialogOpen}
						onOpenChange={setTransferDialogOpen}
						onSuccess={() => {
							alert('Ownership transferred successfully!')
							navigate('/my-groups')
						}}
					/>
				)}
			</Section>
		</Container>
	)
}
