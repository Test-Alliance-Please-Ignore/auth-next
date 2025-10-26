import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	ArrowLeft,
	MessageSquare,
	Pencil,
	Plus,
	Settings,
	Shield,
	ShieldOff,
	Trash2,
	UserMinus,
	X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { GroupCard } from '@/components/group-card'
import { InviteMemberForm } from '@/components/invite-member-form'
import { MemberList } from '@/components/member-list'
import { PendingInvitationsList } from '@/components/pending-invitations-list'
import { PendingJoinRequestsList } from '@/components/pending-join-requests-list'
import { TransferOwnershipDialog } from '@/components/transfer-ownership-dialog'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/useAuth'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'
import {
	useAssignRoleToGroupServer,
	useAttachDiscordServerToGroup,
	useDetachDiscordServerFromGroup,
	useDiscordServers,
	useGroupDiscordServers,
	useUnassignRoleFromGroupServer,
	useUpdateGroupDiscordServer,
} from '@/hooks/useDiscord'
import { useGroupMembers, useRemoveMember, useToggleAdmin } from '@/hooks/useGroupMembers'
import { useGroup } from '@/hooks/useGroups'
import { apiClient } from '@/lib/api'

import type { GroupDiscordServer } from '@/lib/api'

export default function GroupDetailPage() {
	const { groupId } = useParams<{ groupId: string }>()
	const location = useLocation()
	const { setCustomLabel, clearCustomLabel } = useBreadcrumb()
	const { user } = useAuth()
	const { data: group, isLoading: groupLoading } = useGroup(groupId!)
	const { data: members, isLoading: membersLoading } = useGroupMembers(groupId!)
	const removeMember = useRemoveMember()
	const toggleAdmin = useToggleAdmin()

	// Discord hooks
	const { data: discordServers = [] } = useDiscordServers()
	const { data: groupDiscordServers = [] } = useGroupDiscordServers(groupId!)
	const attachServer = useAttachDiscordServerToGroup()
	const detachServer = useDetachDiscordServerFromGroup()
	const updateAttachment = useUpdateGroupDiscordServer()
	const assignRole = useAssignRoleToGroupServer()
	const unassignRole = useUnassignRoleFromGroupServer()

	// Dialog state
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
	const [adminDialogOpen, setAdminDialogOpen] = useState(false)
	const [transferDialogOpen, setTransferDialogOpen] = useState(false)
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
	const [selectedUserIsAdmin, setSelectedUserIsAdmin] = useState(false)

	// Discord UI state
	const [showAddServerDialog, setShowAddServerDialog] = useState(false)
	const [selectedServerId, setSelectedServerId] = useState('')
	const [attachmentSettings, setAttachmentSettings] = useState({
		autoInvite: false,
		autoAssignRoles: false,
	})

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

	const handleTransferOwnershipClick = (userId: string) => {
		setSelectedUserId(userId)
		setTransferDialogOpen(true)
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
				text: selectedUserIsAdmin
					? 'Admin role removed successfully!'
					: 'User promoted to admin successfully!',
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

	// Handlers for Discord servers
	const handleAttachServer = async () => {
		if (!selectedServerId || !groupId) return

		try {
			await attachServer.mutateAsync({
				groupId,
				data: {
					discordServerId: selectedServerId,
					autoInvite: attachmentSettings.autoInvite,
					autoAssignRoles: attachmentSettings.autoAssignRoles,
				},
			})
			setShowAddServerDialog(false)
			setSelectedServerId('')
			setAttachmentSettings({ autoInvite: false, autoAssignRoles: false })
			setMessage({ type: 'success', text: 'Discord server attached successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to attach Discord server',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDetachServer = async (attachmentId: string) => {
		if (!groupId) return

		try {
			await detachServer.mutateAsync({ groupId, attachmentId })
			setMessage({ type: 'success', text: 'Discord server detached successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to detach Discord server',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleToggleAutoInvite = async (attachmentId: string, currentValue: boolean) => {
		if (!groupId) return

		try {
			await updateAttachment.mutateAsync({
				groupId,
				attachmentId,
				data: { autoInvite: !currentValue },
			})
			setMessage({ type: 'success', text: 'Auto-invite setting updated!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update auto-invite setting',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleToggleAutoAssignRoles = async (attachmentId: string, currentValue: boolean) => {
		if (!groupId) return

		try {
			await updateAttachment.mutateAsync({
				groupId,
				attachmentId,
				data: { autoAssignRoles: !currentValue },
			})
			setMessage({ type: 'success', text: 'Auto-assign roles setting updated!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update auto-assign roles setting',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleAssignRole = async (attachmentId: string, discordRoleId: string) => {
		if (!groupId) return

		try {
			await assignRole.mutateAsync({
				groupId,
				attachmentId,
				data: { discordRoleId },
			})
			setMessage({ type: 'success', text: 'Role assigned successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to assign role',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleUnassignRole = async (attachmentId: string, roleAssignmentId: string) => {
		if (!groupId) return

		try {
			await unassignRole.mutateAsync({
				groupId,
				attachmentId,
				roleAssignmentId,
			})
			setMessage({ type: 'success', text: 'Role unassigned successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to unassign role',
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
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Group Info Card */}
			<GroupCard group={group} />

			{/* Stats Section */}
			<div className="grid gap-4 md:grid-cols-2">
				<Card variant="interactive">
					<CardHeader>
						<CardTitle>Members</CardTitle>
						<CardDescription>Total group members</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold gradient-text">{memberCount}</p>
					</CardContent>
				</Card>

				<Card variant="interactive">
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

			{/* Pending Join Requests */}
			<PendingJoinRequestsList groupId={groupId!} />

			{/* Discord Servers */}
			<Card variant="interactive">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<div className="flex items-center gap-2">
								<MessageSquare className="h-5 w-5 text-[hsl(var(--discord-blurple))]" />
								<CardTitle>Discord Servers</CardTitle>
							</div>
							<CardDescription>
								Attach Discord servers from the registry to enable auto-invite for group members.
							</CardDescription>
						</div>
						<Button
							onClick={() => setShowAddServerDialog(true)}
							disabled={discordServers.length === 0}
							size="sm"
						>
							<Plus className="mr-2 h-4 w-4" />
							Attach Server
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{groupDiscordServers.length === 0 ? (
						<div className="text-center py-8">
							<MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
							<h3 className="mt-4 text-sm font-medium">No Discord servers attached</h3>
							<p className="text-sm text-muted-foreground mt-2">
								Attach a Discord server from the registry to enable auto-invite
							</p>
							{discordServers.length === 0 && (
								<p className="text-xs text-muted-foreground mt-2">
									<Link to="/admin/discord-servers" className="text-primary hover:underline">
										Add servers to the registry first
									</Link>
								</p>
							)}
						</div>
					) : (
						<div className="space-y-4">
							{groupDiscordServers.map((attachment) => (
								<div key={attachment.id} className="rounded-lg border p-4 space-y-3">
									<div className="flex items-start justify-between">
										<div>
											<h4 className="font-medium">{attachment.discordServer?.guildName}</h4>
											<p className="text-xs text-muted-foreground">
												ID: {attachment.discordServer?.guildId}
											</p>
											{attachment.discordServer?.description && (
												<p className="text-sm text-muted-foreground mt-1">
													{attachment.discordServer.description}
												</p>
											)}
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => handleDetachServer(attachment.id)}
										>
											<Trash2 className="h-4 w-4 text-destructive" />
										</Button>
									</div>

									<div className="flex gap-4">
										<div className="flex items-center space-x-2">
											<Switch
												id={`auto-invite-${attachment.id}`}
												checked={attachment.autoInvite}
												onCheckedChange={() =>
													handleToggleAutoInvite(attachment.id, attachment.autoInvite)
												}
											/>
											<Label htmlFor={`auto-invite-${attachment.id}`} className="cursor-pointer">
												Auto-Invite
											</Label>
										</div>

										<div className="flex items-center space-x-2">
											<Switch
												id={`auto-assign-${attachment.id}`}
												checked={attachment.autoAssignRoles}
												onCheckedChange={() =>
													handleToggleAutoAssignRoles(attachment.id, attachment.autoAssignRoles)
												}
											/>
											<Label htmlFor={`auto-assign-${attachment.id}`} className="cursor-pointer">
												Auto-Assign Roles
											</Label>
										</div>
									</div>

									{/* Role Management */}
									{attachment.discordServer?.roles && attachment.discordServer.roles.length > 0 && (
										<div className="space-y-2">
											<p className="text-sm font-medium">Assigned Roles</p>
											<div className="flex flex-wrap gap-2">
												{attachment.roles?.map((roleAssignment) => (
													<div
														key={roleAssignment.id}
														className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-sm"
													>
														<span>{roleAssignment.discordRole.roleName}</span>
														<button
															onClick={() => handleUnassignRole(attachment.id, roleAssignment.id)}
															className="ml-1 hover:text-destructive"
														>
															<X className="h-3 w-3" />
														</button>
													</div>
												))}
											</div>

											{/* Role Selection */}
											{attachment.discordServer.roles.filter(
												(role) =>
													!attachment.roles?.some((ra) => ra.discordRole.roleId === role.roleId)
											).length > 0 && (
												<div className="flex gap-2 items-center">
													<select
														className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
														onChange={(e) => {
															if (e.target.value) {
																handleAssignRole(attachment.id, e.target.value)
																e.target.value = ''
															}
														}}
														defaultValue=""
													>
														<option value="" disabled>
															Add role...
														</option>
														{attachment.discordServer.roles
															.filter(
																(role) =>
																	!attachment.roles?.some(
																		(ra) => ra.discordRole.roleId === role.roleId
																	)
															)
															.map((role) => (
																<option key={role.id} value={role.id}>
																	{role.roleName}
																</option>
															))}
													</select>
												</div>
											)}
										</div>
									)}
								</div>
							))}
						</div>
					)}

					{/* Add Server Dialog */}
					{showAddServerDialog && (
						<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
							<div className="bg-background rounded-lg p-6 max-w-md w-full space-y-4">
								<h3 className="text-lg font-medium">Attach Discord Server</h3>
								<div className="space-y-2">
									<Label htmlFor="discord-server">Select Server</Label>
									<select
										id="discord-server"
										className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
										value={selectedServerId}
										onChange={(e) => setSelectedServerId(e.target.value)}
									>
										<option value="">Choose a server...</option>
										{discordServers
											.filter(
												(server) =>
													!groupDiscordServers.some((att) => att.discordServerId === server.id)
											)
											.map((server) => (
												<option key={server.id} value={server.id}>
													{server.guildName}
												</option>
											))}
									</select>
								</div>

								<div className="space-y-3">
									<div className="flex items-center space-x-2">
										<Switch
											id="attach-auto-invite"
											checked={attachmentSettings.autoInvite}
											onCheckedChange={(checked) =>
												setAttachmentSettings({ ...attachmentSettings, autoInvite: checked })
											}
										/>
										<Label htmlFor="attach-auto-invite" className="cursor-pointer">
											Enable Auto-Invite
										</Label>
									</div>

									<div className="flex items-center space-x-2">
										<Switch
											id="attach-auto-assign"
											checked={attachmentSettings.autoAssignRoles}
											onCheckedChange={(checked) =>
												setAttachmentSettings({ ...attachmentSettings, autoAssignRoles: checked })
											}
										/>
										<Label htmlFor="attach-auto-assign" className="cursor-pointer">
											Auto-Assign Roles
										</Label>
									</div>
								</div>

								<div className="flex gap-2 pt-2">
									<Button onClick={handleAttachServer} disabled={!selectedServerId}>
										<Plus className="mr-2 h-4 w-4" />
										Attach
									</Button>
									<Button variant="outline" onClick={() => setShowAddServerDialog(false)}>
										Cancel
									</Button>
								</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Members List */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Member Management</CardTitle>
					<CardDescription>View and manage group members</CardDescription>
				</CardHeader>
				<CardContent>
					<MemberList
						members={members || []}
						group={group}
						adminUserIds={adminUserIds}
						currentUserId={user?.id}
						onRemoveMember={handleRemoveMemberClick}
						onToggleAdmin={handleToggleAdminClick}
						onTransferOwnership={handleTransferOwnershipClick}
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
							Are you sure you want to remove {selectedMemberName} from the group? They will need to
							be re-invited or request to join again.
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

			{/* Transfer Ownership Dialog */}
			{group && members && (
				<TransferOwnershipDialog
					group={group}
					members={members}
					open={transferDialogOpen}
					onOpenChange={setTransferDialogOpen}
					initialSelectedUserId={selectedUserId || undefined}
					onSuccess={() => {
						setMessage({ type: 'success', text: 'Ownership transferred successfully!' })
						setTimeout(() => setMessage(null), 3000)
					}}
				/>
			)}
		</div>
	)
}
