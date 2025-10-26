import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	ArrowLeft,
	Check,
	Copy,
	FolderEdit,
	Key,
	MessageSquare,
	Pencil,
	Plus,
	Settings,
	Shield,
	ShieldOff,
	Ticket,
	Trash2,
	UserMinus,
	X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { AttachPermissionDialog } from '@/components/attach-permission-dialog'
import { CreateCustomPermissionDialog } from '@/components/create-custom-permission-dialog'
import { EditGroupDescriptionDialog } from '@/components/edit-group-description-dialog'
import { EditGroupNameDialog } from '@/components/edit-group-name-dialog'
import { GroupCard } from '@/components/group-card'
import { GroupPermissionCard } from '@/components/group-permission-card'
import { InviteMemberForm } from '@/components/invite-member-form'
import { MemberList } from '@/components/member-list'
import { PendingInvitationsList } from '@/components/pending-invitations-list'
import { PendingJoinRequestsList } from '@/components/pending-join-requests-list'
import { ReassignCategoryDialog } from '@/components/reassign-category-dialog'
import { TransferOwnershipDialog } from '@/components/transfer-ownership-dialog'
import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DestructiveButton } from '@/components/ui/destructive-button'
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
import {
	useAttachPermission,
	useCreateGroupScopedPermission,
	useGroupPermissions,
	useRemoveGroupPermission,
	useUpdateGroupPermission,
} from '@/hooks/useGroupPermissions'
import { useGroup } from '@/hooks/useGroups'
import {
	useCreateInviteCode,
	useGroupInviteCodes,
	useRevokeInviteCode,
} from '@/hooks/useInviteCodes'
import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient } from '@/lib/api'

import type { GroupDiscordServer, GroupPermissionWithDetails } from '@/lib/api'

export default function GroupDetailPage() {
	const { groupId } = useParams<{ groupId: string }>()
	const location = useLocation()
	const { setCustomLabel, clearCustomLabel } = useBreadcrumb()
	const { user } = useAuth()
	const { data: group, isLoading: groupLoading } = useGroup(groupId!)

	// Set dynamic page title based on group name
	usePageTitle(group?.name ? `Admin - ${group.name}` : 'Admin - Group Details')
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

	// Invite code hooks
	const { data: inviteCodes = [] } = useGroupInviteCodes(groupId!)
	const createInviteCode = useCreateInviteCode()
	const revokeInviteCode = useRevokeInviteCode()

	// Permission hooks
	const { data: groupPermissions = [] } = useGroupPermissions(groupId!)
	const attachPermission = useAttachPermission()
	const createCustomPermission = useCreateGroupScopedPermission()
	const removePermission = useRemoveGroupPermission()
	const updatePermission = useUpdateGroupPermission()

	// Dialog state
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
	const [adminDialogOpen, setAdminDialogOpen] = useState(false)
	const [transferDialogOpen, setTransferDialogOpen] = useState(false)
	const [reassignCategoryDialogOpen, setReassignCategoryDialogOpen] = useState(false)
	const [editNameDialogOpen, setEditNameDialogOpen] = useState(false)
	const [editDescriptionDialogOpen, setEditDescriptionDialogOpen] = useState(false)
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
	const [selectedUserIsAdmin, setSelectedUserIsAdmin] = useState(false)

	// Discord UI state
	const [showAddServerDialog, setShowAddServerDialog] = useState(false)
	const [selectedServerId, setSelectedServerId] = useState('')
	const [attachmentSettings, setAttachmentSettings] = useState({
		autoInvite: false,
		autoAssignRoles: false,
	})

	// Invite code UI state
	const [showCreateInviteCodeDialog, setShowCreateInviteCodeDialog] = useState(false)
	const [inviteCodeSettings, setInviteCodeSettings] = useState({
		maxUses: null as number | null,
		expiresInDays: 7,
	})
	const [copiedCode, setCopiedCode] = useState<string | null>(null)

	// Permission UI state
	const [showAttachPermissionDialog, setShowAttachPermissionDialog] = useState(false)
	const [showCreateCustomPermissionDialog, setShowCreateCustomPermissionDialog] = useState(false)
	const [removePermissionDialogOpen, setRemovePermissionDialogOpen] = useState(false)
	const [selectedPermission, setSelectedPermission] = useState<GroupPermissionWithDetails | null>(
		null
	)

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

	// Invite code handlers
	const handleCreateInviteCode = async () => {
		if (!groupId) return

		try {
			await createInviteCode.mutateAsync({
				groupId,
				maxUses: inviteCodeSettings.maxUses,
				expiresInDays: inviteCodeSettings.expiresInDays,
			})
			setShowCreateInviteCodeDialog(false)
			setInviteCodeSettings({ maxUses: null, expiresInDays: 7 })
			setMessage({ type: 'success', text: 'Invite code created successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create invite code',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleRevokeInviteCode = async (codeId: string) => {
		if (!groupId) return

		try {
			await revokeInviteCode.mutateAsync({ codeId, groupId })
			setMessage({ type: 'success', text: 'Invite code revoked successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to revoke invite code',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleCopyCode = async (code: string) => {
		try {
			await navigator.clipboard.writeText(code)
			setCopiedCode(code)
			setTimeout(() => setCopiedCode(null), 2000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: 'Failed to copy code to clipboard',
			})
			setTimeout(() => setMessage(null), 3000)
		}
	}

	// Permission handlers
	const handleAttachPermission = async (data: any) => {
		try {
			await attachPermission.mutateAsync(data)
			setShowAttachPermissionDialog(false)
			setMessage({ type: 'success', text: 'Permission attached successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to attach permission',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleCreateCustomPermission = async (data: any) => {
		try {
			await createCustomPermission.mutateAsync(data)
			setShowCreateCustomPermissionDialog(false)
			setMessage({ type: 'success', text: 'Custom permission created successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create custom permission',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleRemovePermission = async () => {
		if (!selectedPermission || !groupId) return

		try {
			await removePermission.mutateAsync({ id: selectedPermission.id, groupId })
			setRemovePermissionDialogOpen(false)
			setSelectedPermission(null)
			setMessage({ type: 'success', text: 'Permission removed successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to remove permission',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const openRemovePermissionDialog = (permission: GroupPermissionWithDetails) => {
		setSelectedPermission(permission)
		setRemovePermissionDialogOpen(true)
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

			{/* Group Management Actions */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Group Management</CardTitle>
					<CardDescription>Administrative actions for this group</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" size="sm" onClick={() => setEditNameDialogOpen(true)}>
							<Pencil className="mr-2 h-4 w-4" />
							Edit Name
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setEditDescriptionDialogOpen(true)}
						>
							<Pencil className="mr-2 h-4 w-4" />
							Edit Description
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setReassignCategoryDialogOpen(true)}
						>
							<FolderEdit className="mr-2 h-4 w-4" />
							Reassign Category
						</Button>
					</div>
				</CardContent>
			</Card>

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

			{/* Invite Codes */}
			<Card variant="interactive">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<div className="flex items-center gap-2">
								<Ticket className="h-5 w-5 text-primary" />
								<CardTitle>Invite Codes</CardTitle>
							</div>
							<CardDescription>
								Create reusable invite codes for this group. Codes can be shared to allow users to
								join without approval.
							</CardDescription>
						</div>
						<Button onClick={() => setShowCreateInviteCodeDialog(true)} size="sm">
							<Plus className="mr-2 h-4 w-4" />
							Create Code
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{inviteCodes.length === 0 ? (
						<div className="text-center py-8">
							<Ticket className="mx-auto h-12 w-12 text-muted-foreground" />
							<h3 className="mt-4 text-sm font-medium">No active invite codes</h3>
							<p className="text-sm text-muted-foreground mt-2">
								Create an invite code to allow users to join this group
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{inviteCodes.map((inviteCode) => {
								const isExpired = new Date(inviteCode.expiresAt) < new Date()
								const isMaxedOut =
									inviteCode.maxUses !== null && inviteCode.currentUses >= inviteCode.maxUses
								const inviteUrl = `${window.location.origin}/invite/${inviteCode.code}`

								return (
									<div
										key={inviteCode.id}
										className={`rounded-lg border p-4 ${isExpired || isMaxedOut ? 'opacity-50' : ''}`}
									>
										<div className="flex items-start justify-between">
											<div className="flex-1 space-y-2">
												<div className="flex items-center gap-2">
													<code className="text-sm font-mono bg-muted px-2 py-1 rounded">
														{inviteCode.code}
													</code>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleCopyCode(inviteCode.code)}
														className="h-7 px-2"
														title="Copy code"
													>
														{copiedCode === inviteCode.code ? (
															<Check className="h-4 w-4 text-green-500" />
														) : (
															<Copy className="h-4 w-4" />
														)}
													</Button>
													{(isExpired || isMaxedOut) && (
														<span className="text-xs text-destructive font-medium">
															{isExpired ? 'Expired' : 'Max uses reached'}
														</span>
													)}
												</div>
												<div className="flex items-center gap-2 text-xs">
													<code className="bg-muted/50 px-2 py-1 rounded text-muted-foreground truncate max-w-md">
														{inviteUrl}
													</code>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleCopyCode(inviteUrl)}
														className="h-7 px-2 shrink-0"
														title="Copy invite URL"
													>
														{copiedCode === inviteUrl ? (
															<Check className="h-4 w-4 text-green-500" />
														) : (
															<Copy className="h-4 w-4" />
														)}
													</Button>
												</div>
												<div className="flex gap-4 text-xs text-muted-foreground">
													<span>
														Uses: {inviteCode.currentUses}
														{inviteCode.maxUses ? ` / ${inviteCode.maxUses}` : ' (unlimited)'}
													</span>
													<span>
														Expires: {new Date(inviteCode.expiresAt).toLocaleDateString()}
													</span>
													<span>
														Created: {new Date(inviteCode.createdAt).toLocaleDateString()}
													</span>
												</div>
											</div>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleRevokeInviteCode(inviteCode.id)}
												disabled={revokeInviteCode.isPending}
											>
												<Trash2 className="h-4 w-4 text-destructive" />
											</Button>
										</div>
									</div>
								)
							})}
						</div>
					)}

					{/* Create Invite Code Dialog */}
					<Dialog open={showCreateInviteCodeDialog} onOpenChange={setShowCreateInviteCodeDialog}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Create Invite Code</DialogTitle>
								<DialogDescription>Configure settings for the new invite code</DialogDescription>
							</DialogHeader>

							<div className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="max-uses">Max Uses (optional)</Label>
									<Input
										id="max-uses"
										type="number"
										min="1"
										placeholder="Unlimited"
										value={inviteCodeSettings.maxUses ?? ''}
										onChange={(e) =>
											setInviteCodeSettings({
												...inviteCodeSettings,
												maxUses: e.target.value ? parseInt(e.target.value) : null,
											})
										}
									/>
									<p className="text-xs text-muted-foreground">Leave empty for unlimited uses</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="expires-in-days">Expires In (days)</Label>
									<Input
										id="expires-in-days"
										type="number"
										min="1"
										max="30"
										value={inviteCodeSettings.expiresInDays}
										onChange={(e) =>
											setInviteCodeSettings({
												...inviteCodeSettings,
												expiresInDays: parseInt(e.target.value) || 7,
											})
										}
									/>
									<p className="text-xs text-muted-foreground">Between 1 and 30 days</p>
								</div>
							</div>

							<DialogFooter>
								<CancelButton
									onClick={() => {
										setShowCreateInviteCodeDialog(false)
										setInviteCodeSettings({ maxUses: null, expiresInDays: 7 })
									}}
								>
									Cancel
								</CancelButton>
								<ConfirmButton
									onClick={handleCreateInviteCode}
									loading={createInviteCode.isPending}
									loadingText="Creating..."
								>
									Create Code
								</ConfirmButton>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</CardContent>
			</Card>

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
					<Dialog open={showAddServerDialog} onOpenChange={setShowAddServerDialog}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Attach Discord Server</DialogTitle>
								<DialogDescription>
									Select a Discord server from the registry to attach to this group
								</DialogDescription>
							</DialogHeader>

							<div className="space-y-4">
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
							</div>

							<DialogFooter>
								<CancelButton onClick={() => setShowAddServerDialog(false)}>Cancel</CancelButton>
								<ConfirmButton
									onClick={handleAttachServer}
									disabled={!selectedServerId}
									showIcon={false}
								>
									<Plus className="mr-2 h-4 w-4" />
									Attach
								</ConfirmButton>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</CardContent>
			</Card>

			{/* Permissions */}
			<Card variant="interactive">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<div className="flex items-center gap-2">
								<Key className="h-5 w-5 text-primary" />
								<CardTitle>Permissions</CardTitle>
							</div>
							<CardDescription>
								Manage permissions for this group. Attach global permissions or create custom ones.
							</CardDescription>
						</div>
						<div className="flex gap-2">
							<Button
								onClick={() => setShowCreateCustomPermissionDialog(true)}
								size="sm"
								variant="outline"
							>
								<Plus className="mr-2 h-4 w-4" />
								Custom
							</Button>
							<Button onClick={() => setShowAttachPermissionDialog(true)} size="sm">
								<Plus className="mr-2 h-4 w-4" />
								Attach Global
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{groupPermissions.length === 0 ? (
						<div className="text-center py-8">
							<Key className="mx-auto h-12 w-12 text-muted-foreground" />
							<h3 className="mt-4 text-sm font-medium">No permissions assigned</h3>
							<p className="text-sm text-muted-foreground mt-2">
								Attach a global permission or create a custom one for this group
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{groupPermissions.map((permission) => (
								<GroupPermissionCard
									key={permission.id}
									permission={permission}
									onRemove={openRemovePermissionDialog}
									showActions={true}
								/>
							))}
						</div>
					)}

					{/* Attach Permission Dialog */}
					<AttachPermissionDialog
						groupId={groupId!}
						open={showAttachPermissionDialog}
						onOpenChange={setShowAttachPermissionDialog}
						onSubmit={handleAttachPermission}
						isSubmitting={attachPermission.isPending}
					/>

					{/* Create Custom Permission Dialog */}
					<CreateCustomPermissionDialog
						groupId={groupId!}
						open={showCreateCustomPermissionDialog}
						onOpenChange={setShowCreateCustomPermissionDialog}
						onSubmit={handleCreateCustomPermission}
						isSubmitting={createCustomPermission.isPending}
					/>

					{/* Remove Permission Confirmation Dialog */}
					<Dialog open={removePermissionDialogOpen} onOpenChange={setRemovePermissionDialogOpen}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Remove Permission</DialogTitle>
								<DialogDescription>
									Are you sure you want to remove "
									{selectedPermission?.permission?.name || selectedPermission?.customName}" from
									this group?
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<CancelButton
									onClick={() => {
										setRemovePermissionDialogOpen(false)
										setSelectedPermission(null)
									}}
									disabled={removePermission.isPending}
								>
									Cancel
								</CancelButton>
								<DestructiveButton
									onClick={handleRemovePermission}
									loading={removePermission.isPending}
									loadingText="Removing..."
								>
									Remove Permission
								</DestructiveButton>
							</DialogFooter>
						</DialogContent>
					</Dialog>
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
						<CancelButton
							onClick={() => {
								setRemoveDialogOpen(false)
								setSelectedUserId(null)
							}}
							disabled={removeMember.isPending}
						>
							Cancel
						</CancelButton>
						<DestructiveButton
							onClick={handleRemoveMemberConfirm}
							loading={removeMember.isPending}
							loadingText="Removing..."
							showIcon={false}
						>
							<UserMinus className="mr-2 h-4 w-4" />
							Remove Member
						</DestructiveButton>
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
						<CancelButton
							onClick={() => {
								setAdminDialogOpen(false)
								setSelectedUserId(null)
							}}
							disabled={toggleAdmin.isPending}
						>
							Cancel
						</CancelButton>
						{selectedUserIsAdmin ? (
							<DestructiveButton
								onClick={handleToggleAdminConfirm}
								loading={toggleAdmin.isPending}
								loadingText="Removing..."
								showIcon={false}
							>
								<ShieldOff className="mr-2 h-4 w-4" />
								Remove Admin
							</DestructiveButton>
						) : (
							<ConfirmButton
								onClick={handleToggleAdminConfirm}
								loading={toggleAdmin.isPending}
								loadingText="Promoting..."
								showIcon={false}
							>
								<Shield className="mr-2 h-4 w-4" />
								Make Admin
							</ConfirmButton>
						)}
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

			{/* Reassign Category Dialog */}
			{group && (
				<ReassignCategoryDialog
					group={group}
					open={reassignCategoryDialogOpen}
					onOpenChange={setReassignCategoryDialogOpen}
					onSuccess={() => {
						setMessage({ type: 'success', text: 'Category reassigned successfully!' })
						setTimeout(() => setMessage(null), 3000)
					}}
				/>
			)}

			{/* Edit Group Name Dialog */}
			{group && (
				<EditGroupNameDialog
					group={group}
					open={editNameDialogOpen}
					onOpenChange={setEditNameDialogOpen}
					onSuccess={() => {
						setMessage({ type: 'success', text: 'Group name updated successfully!' })
						setTimeout(() => setMessage(null), 3000)
					}}
				/>
			)}

			{/* Edit Group Description Dialog */}
			{group && (
				<EditGroupDescriptionDialog
					group={group}
					open={editDescriptionDialogOpen}
					onOpenChange={setEditDescriptionDialogOpen}
					onSuccess={() => {
						setMessage({ type: 'success', text: 'Group description updated successfully!' })
						setTimeout(() => setMessage(null), 3000)
					}}
				/>
			)}
		</div>
	)
}
