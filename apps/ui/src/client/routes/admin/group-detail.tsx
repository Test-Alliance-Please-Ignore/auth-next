import { useEffect, useState } from 'react'
import { Link, useParams, useLocation } from 'react-router-dom'
import { ArrowLeft, Shield, ShieldOff, UserMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { GroupCard } from '@/components/group-card'
import { MemberList } from '@/components/member-list'
import { InviteMemberForm } from '@/components/invite-member-form'
import { PendingInvitationsList } from '@/components/pending-invitations-list'
import { useGroup } from '@/hooks/useGroups'
import { useGroupMembers, useRemoveMember, useToggleAdmin } from '@/hooks/useGroupMembers'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'

export default function GroupDetailPage() {
	const { groupId } = useParams<{ groupId: string }>()
	const location = useLocation()
	const { setCustomLabel, clearCustomLabel } = useBreadcrumb()
	const { data: group, isLoading: groupLoading } = useGroup(groupId!)
	const { data: members, isLoading: membersLoading } = useGroupMembers(groupId!)
	const removeMember = useRemoveMember()
	const toggleAdmin = useToggleAdmin()

	// Dialog state
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
	const [adminDialogOpen, setAdminDialogOpen] = useState(false)
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
	const [selectedUserIsAdmin, setSelectedUserIsAdmin] = useState(false)

	// Error/success messages
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Get admin user IDs from group data
	const adminUserIds = new Set(group?.adminUserIds || [])

	// Get selected member's character name
	const selectedMember = members?.find((m) => m.userId === selectedUserId)
	const selectedMemberName = selectedMember?.mainCharacterName || 'this user'

	// Set custom breadcrumb label when group loads
	useEffect(() => {
		if (group) {
			setCustomLabel(location.pathname, group.name)
		}
		return () => {
			clearCustomLabel(location.pathname)
		}
	}, [group, location.pathname, setCustomLabel, clearCustomLabel])

	// Handlers
	const handleRemoveMemberClick = (userId: string) => {
		setSelectedUserId(userId)
		setRemoveDialogOpen(true)
	}

	const handleRemoveMemberConfirm = async () => {
		if (!selectedUserId || !groupId) return

		try {
			await removeMember.mutateAsync({ groupId, userId: selectedUserId })
			setRemoveDialogOpen(false)
			setSelectedUserId(null)
			setMessage({ type: 'success', text: 'Member removed successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to remove member',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleToggleAdminClick = (userId: string, isCurrentlyAdmin: boolean) => {
		setSelectedUserId(userId)
		setSelectedUserIsAdmin(isCurrentlyAdmin)
		setAdminDialogOpen(true)
	}

	const handleToggleAdminConfirm = async () => {
		if (!selectedUserId || !groupId) return

		try {
			await toggleAdmin.mutateAsync({
				groupId,
				userId: selectedUserId,
				isCurrentlyAdmin: selectedUserIsAdmin,
			})
			setAdminDialogOpen(false)
			setSelectedUserId(null)
			setMessage({
				type: 'success',
				text: selectedUserIsAdmin ? 'Admin role removed successfully!' : 'User promoted to admin successfully!',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update admin status',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	// Loading state
	if (groupLoading) {
		return (
			<div className="space-y-6">
				<div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
				<div className="h-64 animate-pulse rounded-md bg-muted" />
			</div>
		)
	}

	// Not found state
	if (!group) {
		return (
			<Card className="border-destructive bg-destructive/10">
				<CardContent className="py-8 text-center">
					<p className="text-destructive font-medium">Group not found</p>
					<Link to="/admin/groups">
						<Button variant="outline" className="mt-4">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Groups
						</Button>
					</Link>
				</CardContent>
			</Card>
		)
	}

	// Calculate stats
	const memberCount = members?.length || 0
	const adminCount = adminUserIds.size

	return (
		<div className="space-y-6">
			{/* Back Button */}
			<Link to="/admin/groups">
				<Button variant="ghost" size="sm">
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back to Groups
				</Button>
			</Link>

			{/* Success/Error Message */}
			{message && (
				<Card
					className={message.type === 'error' ? 'border-destructive bg-destructive/10' : 'border-primary bg-primary/10'}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>{message.text}</p>
					</CardContent>
				</Card>
			)}

			{/* Group Info Card */}
			<GroupCard group={group} />

			{/* Stats Section */}
			<div className="grid gap-4 md:grid-cols-2">
				<Card className="glow">
					<CardHeader>
						<CardTitle>Members</CardTitle>
						<CardDescription>Total group members</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold gradient-text">{memberCount}</p>
					</CardContent>
				</Card>

				<Card className="glow">
					<CardHeader>
						<CardTitle>Admins</CardTitle>
						<CardDescription>Users with admin privileges</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold gradient-text">{adminCount}</p>
					</CardContent>
				</Card>
			</div>

			{/* Invite Member Form */}
			<InviteMemberForm groupId={groupId!} />

			{/* Pending Invitations */}
			<PendingInvitationsList groupId={groupId!} />

			{/* Members List */}
			<Card className="glow">
				<CardHeader>
					<CardTitle>Member Management</CardTitle>
					<CardDescription>View and manage group members</CardDescription>
				</CardHeader>
				<CardContent>
					<MemberList
						members={members || []}
						group={group}
						adminUserIds={adminUserIds}
						onRemoveMember={handleRemoveMemberClick}
						onToggleAdmin={handleToggleAdminClick}
						isLoading={membersLoading}
					/>
				</CardContent>
			</Card>

			{/* Remove Member Confirmation Dialog */}
			<Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove Member</DialogTitle>
						<DialogDescription>
							Are you sure you want to remove {selectedMemberName} from the group? They will need to be re-invited or request to join again.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setRemoveDialogOpen(false)
								setSelectedUserId(null)
							}}
							disabled={removeMember.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleRemoveMemberConfirm}
							disabled={removeMember.isPending}
						>
							<UserMinus className="mr-2 h-4 w-4" />
							{removeMember.isPending ? 'Removing...' : 'Remove Member'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Toggle Admin Confirmation Dialog */}
			<Dialog open={adminDialogOpen} onOpenChange={setAdminDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{selectedUserIsAdmin ? 'Remove Admin Role' : 'Make Admin'}</DialogTitle>
						<DialogDescription>
							{selectedUserIsAdmin
								? `Are you sure you want to remove admin privileges from ${selectedMemberName}? They will no longer be able to approve join requests or remove members.`
								: `Are you sure you want to give admin privileges to ${selectedMemberName}? They will be able to approve join requests and remove members.`}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setAdminDialogOpen(false)
								setSelectedUserId(null)
							}}
							disabled={toggleAdmin.isPending}
						>
							Cancel
						</Button>
						<Button onClick={handleToggleAdminConfirm} disabled={toggleAdmin.isPending}>
							{selectedUserIsAdmin ? (
								<>
									<ShieldOff className="mr-2 h-4 w-4" />
									{toggleAdmin.isPending ? 'Removing...' : 'Remove Admin'}
								</>
							) : (
								<>
									<Shield className="mr-2 h-4 w-4" />
									{toggleAdmin.isPending ? 'Promoting...' : 'Make Admin'}
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
