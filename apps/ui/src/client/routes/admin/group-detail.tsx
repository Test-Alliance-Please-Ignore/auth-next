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
	RefreshCw,
	Settings,
	Shield,
	ShieldOff,
	Ticket,
	Trash2,
	UserMinus,
	X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { AttachPermissionDialog } from '@/components/attach-permission-dialog'
import { EditGroupDescriptionDialog } from '@/components/edit-group-description-dialog'
import { EditGroupDialog } from '@/components/edit-group-dialog'
import { EditGroupNameDialog } from '@/components/edit-group-name-dialog'
import { EditGroupMumbleDialog } from '@/components/edit-group-mumble-dialog'
import { GroupCard } from '@/components/group-card'
import { GroupPermissionCard } from '@/components/group-permission-card'
import { GroupPermissionForm } from '@/components/group-permission-form'
import { InviteMemberForm } from '@/components/invite-member-form'
import { MemberList } from '@/components/member-list'
import { PendingInvitationsList } from '@/components/pending-invitations-list'
import { PendingJoinRequestsList } from '@/components/pending-join-requests-list'
import { ReassignCategoryDialog } from '@/components/reassign-category-dialog'
import { TransferOwnershipDialog } from '@/components/transfer-ownership-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion'
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
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/hooks/useAuth'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'
import { useCategories } from '@/hooks/useCategories'
import {
	useAssignRoleToGroupServer,
	useAttachDiscordServerToGroup,
	useDetachDiscordServerFromGroup,
	useDiscordServers,
	useGroupDiscordServers,
	useRefreshGroupDiscordServerRoles,
	useUnassignRoleFromGroupServer,
	useUpdateGroupDiscordServer,
} from '@/hooks/useDiscord'
import { useGroupMembers, useRemoveMember, useToggleAdmin } from '@/hooks/useGroupMembers'
import {
	groupPermissionKeys,
	useAttachPermission,
	useCreateGroupScopedPermission,
	useGroupPermissions,
	useRemoveGroupPermission,
	useUpdateGroupPermission,
} from '@/hooks/useGroupPermissions'
import { useDeleteGroup, useGroup, useUpdateGroup } from '@/hooks/useGroups'
import {
	useCreateInviteCode,
	useGroupInviteCodes,
	useRevokeInviteCode,
} from '@/hooks/useInviteCodes'
import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient } from '@/lib/api'
import {
	groupDiscordRoleAssignmentSections,
	groupDiscordRoleAssignmentSummary,
} from './group-discord-role-sections'

import type { GroupDiscordServer, GroupPermissionWithDetails } from '@/lib/api'

export default function GroupDetailPage() {
	const { groupId } = useParams<{ groupId: string }>()
	const location = useLocation()
	const navigate = useNavigate()
	const { setCustomLabel, clearCustomLabel } = useBreadcrumb()
	const { user } = useAuth()
	const queryClient = useQueryClient()
	const { data: group, isLoading: groupLoading } = useGroup(groupId!)
	const isAdminManaged = group?.joinMode === 'admin_managed'
	const { data: categories = [] } = useCategories()
	const updateGroup = useUpdateGroup()
	const deleteGroup = useDeleteGroup()

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
	const refreshServerRoles = useRefreshGroupDiscordServerRoles()

	// Invite code hooks
	const { data: inviteCodes = [] } = useGroupInviteCodes(groupId!, Boolean(group && !isAdminManaged))
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
	const [editMumbleDialogOpen, setEditMumbleDialogOpen] = useState(false)
	const [editGroupDialogOpen, setEditGroupDialogOpen] = useState(false)
	const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false)
	const [deleteConfirmationText, setDeleteConfirmationText] = useState('')
	const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
	const [selectedUserIsAdmin, setSelectedUserIsAdmin] = useState(false)

	// Discord UI state
	const [showAddServerDialog, setShowAddServerDialog] = useState(false)
	const [selectedServerId, setSelectedServerId] = useState('')
	const [pendingRoleSelections, setPendingRoleSelections] = useState<Record<string, string>>({})
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

	const handleRefreshServerRoles = async (attachmentId: string) => {
		if (!groupId) return

		try {
			const result = await refreshServerRoles.mutateAsync({ groupId, attachmentId })

			// Show detailed summary
			const successMsg =
				result.message ||
				`Refreshed ${result.success}/${result.totalMembers} members successfully` +
					(result.skipped > 0 ? ` (${result.skipped} skipped)` : '') +
					(result.failed > 0 ? ` (${result.failed} failed)` : '')

			setMessage({
				type: result.failed > 0 && result.success === 0 ? 'error' : 'success',
				text: successMsg,
			})
			setTimeout(() => setMessage(null), 5000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to refresh Discord roles',
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

	const handleAssignRole = async (
		attachmentId: string,
		discordRoleId: string,
		membershipType: 'member' | 'owner_admin'
	) => {
		if (!groupId) return

		try {
			await assignRole.mutateAsync({
				groupId,
				attachmentId,
				data: { discordRoleId, membershipType },
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
			if (groupId) {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: groupPermissionKeys.list(groupId),
					}),
					queryClient.invalidateQueries({
						queryKey: groupPermissionKeys.memberPermissions(groupId),
					}),
				])
			}
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to attach permission',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleCreateCustomPermission = async (data: any) => {
		console.log('handleCreateCustomPermission called with data:', data)
		try {
			await createCustomPermission.mutateAsync(data)
			setShowCreateCustomPermissionDialog(false)
			setMessage({ type: 'success', text: 'Custom permission created successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			console.error('Failed to create custom permission:', error)
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

	// Group edit and delete handlers
	const handleEditGroup = async (data: any) => {
		if (!groupId) return

		try {
			await updateGroup.mutateAsync({ id: groupId, data })
			setMessage({ type: 'success', text: 'Group updated successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update group',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDeleteGroup = async () => {
		if (!groupId || !group) return

		// Verify the confirmation text matches
		if (deleteConfirmationText !== group.name) {
			setMessage({
				type: 'error',
				text: 'Group name does not match. Please type the exact group name to confirm deletion.',
			})
			setTimeout(() => setMessage(null), 5000)
			return
		}

		try {
			await deleteGroup.mutateAsync(groupId)
			setMessage({ type: 'success', text: 'Group deleted successfully!' })
			setTimeout(() => {
				navigate('/admin/groups')
			}, 1000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete group',
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
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/admin/groups">
							<ArrowLeft className="h-4 w-4" />
							Back to Groups
						</Link>
					</Button>
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
			<Button variant="ghost" size="sm" asChild>
				<Link to="/admin/groups">
					<ArrowLeft className="h-4 w-4" />
					Back to Groups
				</Link>
			</Button>

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
			<Card>
				<CardHeader>
					<CardTitle>Group Management</CardTitle>
					<CardDescription>Administrative actions for this group</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						<Button variant="primary" size="sm" onClick={() => setEditGroupDialogOpen(true)}>
							<Settings className="h-4 w-4" />
							Edit Group
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setEditNameDialogOpen(true)}>
							<Pencil className="h-4 w-4" />
							Edit Name
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setEditDescriptionDialogOpen(true)}>
							<Pencil className="h-4 w-4" />
							Edit Description
						</Button>
						{user?.is_admin && (
							<Button variant="ghost" size="sm" onClick={() => setEditMumbleDialogOpen(true)}>
								<Settings className="h-4 w-4" />
								Edit Mumble Settings
							</Button>
						)}
						<Button variant="ghost" size="sm" onClick={() => setReassignCategoryDialogOpen(true)}>
							<FolderEdit className="h-4 w-4" />
							Reassign Category
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Stats Section */}
			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Members</CardTitle>
						<CardDescription>Total group members</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold gradient-text">{memberCount}</p>
					</CardContent>
				</Card>

				<Card>
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
			<InviteMemberForm group={group} allowDirectAdd={user?.is_admin ?? false} />

			{/* Pending Invitations */}
			{!isAdminManaged && <PendingInvitationsList groupId={groupId!} />}

			{/* Pending Join Requests */}
			{!isAdminManaged && <PendingJoinRequestsList groupId={groupId!} />}

			{/* Invite Codes */}
			{!isAdminManaged && (
				<Card>
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
							<Plus className="h-4 w-4" />
							Create Code
						</Button>
					</div>
				</CardHeader>
				<CardContent>
							{inviteCodes.length === 0 ? (
								<div className="text-center py-8">
									<Ticket className="mx-auto h-12 w-12 text-muted-foreground" />
									<h3 className="mt-4 text-sm font-medium">No invite codes</h3>
									<p className="text-sm text-muted-foreground mt-2">
										Create an invite code to allow users to join this group
									</p>
								</div>
					) : (
						<div className="space-y-3">
							{inviteCodes.map((inviteCode) => {
								const isRevoked = inviteCode.revokedAt !== null
								const isExpired = new Date(inviteCode.expiresAt) < new Date()
								const isMaxedOut =
									!isRevoked &&
									!isExpired &&
									inviteCode.maxUses !== null && inviteCode.currentUses >= inviteCode.maxUses
								const statusLabel = isRevoked
									? 'Revoked'
									: isExpired
										? 'Expired'
										: isMaxedOut
											? 'Max uses reached'
											: null
								const inviteUrl = `${window.location.origin}/invite/${inviteCode.code}`

								return (
									<div
										key={inviteCode.id}
										className={`rounded-lg border p-4 ${statusLabel ? 'opacity-50' : ''}`}
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
													{statusLabel && (
														<span className="text-xs text-destructive font-medium">
															{statusLabel}
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
								<Button
									variant="cancel"
									onClick={() => {
										setShowCreateInviteCodeDialog(false)
										setInviteCodeSettings({ maxUses: null, expiresInDays: 7 })
									}}
								>
									Cancel
								</Button>
								<Button
									variant="confirm"
									onClick={handleCreateInviteCode}
									loading={createInviteCode.isPending}
									loadingText="Creating..."
								>
									Create Code
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</CardContent>
				</Card>
			)}

			{/* Discord Servers */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<div className="flex items-center gap-2">
								<MessageSquare className="h-5 w-5 text-[hsl(var(--discord-blurple))]" />
								<CardTitle>Discord Servers</CardTitle>
							</div>
							<CardDescription>
								Attach Discord servers from the registry to enable auto-invite and split role
								assignment for members versus owners/admins.
							</CardDescription>
						</div>
						<Button
							onClick={() => setShowAddServerDialog(true)}
							disabled={discordServers.length === 0}
							size="sm"
						>
							<Plus className="h-4 w-4" />
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
						<Accordion
							type="multiple"
							defaultValue={[]}
							className="space-y-4"
						>
							{groupDiscordServers.map((attachment) => (
								<AccordionItem
									key={attachment.id}
									value={attachment.id}
									className="overflow-hidden rounded-lg border border-border/90 bg-card shadow-md ring-1 ring-border/50"
								>
									<AccordionTrigger className="px-4 py-4 text-left hover:bg-muted/40">
										<div>
											<h4 className="font-medium">{attachment.discordServer?.guildName}</h4>
											<p className="text-xs text-muted-foreground">
												ID: {attachment.discordServer?.guildId}
											</p>
											{attachment.discordServer?.description && (
												<p className="mt-1 text-sm text-muted-foreground">
													{attachment.discordServer.description}
												</p>
											)}
										</div>
									</AccordionTrigger>
									<AccordionContent className="px-4">
										<div className="space-y-4">
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleRefreshServerRoles(attachment.id)}
													disabled={
														refreshServerRoles.isPending || (attachment.roles?.length ?? 0) === 0
													}
													title={
														(attachment.roles?.length ?? 0) === 0
															? 'No roles configured'
															: 'Refresh role assignments for all group members'
													}
												>
													<RefreshCw
														className={`h-4 w-4 ${refreshServerRoles.isPending ? 'animate-spin' : ''}`}
													/>
												</Button>
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
											{(() => {
												const discordServer = attachment.discordServer
												if (!discordServer?.roles || discordServer.roles.length === 0) {
													return null
												}

												return (
													<div className="rounded-xl border border-border/90 bg-card/90 p-4 shadow-md ring-1 ring-border/60 space-y-4">
														<p className="text-xs text-muted-foreground">
															{groupDiscordRoleAssignmentSummary}
														</p>
														{groupDiscordRoleAssignmentSections.map((section) => {
															const sectionAssignments = (attachment.roles ?? []).filter(
																(roleAssignment) => roleAssignment.membershipType === section.membershipType
															)
															const selectionKey = `${attachment.id}:${section.membershipType}`
															const availableRoles = discordServer.roles.filter(
																(role) =>
																	!attachment.roles?.some(
																		(roleAssignment) => roleAssignment.discordRole.roleId === role.roleId
																	)
															)

															return (
																<div
																	key={`${attachment.id}-${section.membershipType}`}
																	className="space-y-3 rounded-lg border border-border/80 bg-background/75 p-4 shadow-sm"
																>
																	<div className="flex items-start justify-between gap-3">
																		<div>
																			<p className="text-sm font-medium">{section.label}</p>
																			<p className="text-xs text-muted-foreground">
																				{section.description}
																			</p>
																		</div>
																		<p className="text-xs text-muted-foreground">
																			{sectionAssignments.length} assigned
																		</p>
																	</div>

																	<div className="flex flex-wrap gap-2">
																		{sectionAssignments.length === 0 ? (
																			<p className="text-sm text-muted-foreground">
																				No roles assigned.
																			</p>
																		) : (
																			sectionAssignments.map((roleAssignment) => (
																				<div
																					key={roleAssignment.id}
																					className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/10 px-2 py-1 text-sm text-primary"
																				>
																					<span>{roleAssignment.discordRole.roleName}</span>
																					<button
																						onClick={() =>
																							handleUnassignRole(
																								attachment.id,
																								roleAssignment.id
																							)
																						}
																						className="ml-1 hover:text-destructive"
																					>
																						<X className="h-3 w-3" />
																					</button>
																				</div>
																			))
																		)}
																	</div>

																	{availableRoles.length > 0 ? (
																		<div className="flex items-center gap-2">
																			<Select
																				value=""
																				onValueChange={(nextValue) => {
																					if (!nextValue) {
																						return
																					}
																					void handleAssignRole(
																						attachment.id,
																						nextValue,
																						section.membershipType
																					).finally(() => {
																						setPendingRoleSelections((prev) => {
																							const { [selectionKey]: _, ...rest } = prev
																							return rest
																						})
																					})
																				}}
																				query={pendingRoleSelections[selectionKey] ?? ''}
																				onQueryChange={(value) =>
																					setPendingRoleSelections((prev) => ({
																						...prev,
																						[selectionKey]: value,
																					}))
																				}
																				searchable
																				options={availableRoles.map((role) => ({
																					value: role.id,
																					label: role.roleName,
																				}))}
																				placeholder="Add role..."
																				emptyText="No matching roles found"
																				className="w-full"
																				contentClassName="w-[min(90vw,36rem)]"
																				inputClassName="h-9"
																			/>
																		</div>
																	) : (
																		<p className="text-xs text-muted-foreground">
																			No available roles left to assign.
																		</p>
																	)}
															</div>
																)
															})}
													</div>
												)
											})()}
										</div>
									</AccordionContent>
								</AccordionItem>
							))}
						</Accordion>
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
									<Select
										inputId="discord-server"
										value={selectedServerId}
										onValueChange={setSelectedServerId}
										options={discordServers
											.filter(
												(server) =>
													!groupDiscordServers.some((att) => att.discordServerId === server.id)
											)
											.map((server) => ({ value: server.id, label: server.guildName }))}
										placeholder="Choose a server..."
										className="w-full"
									/>
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
								<Button variant="cancel" onClick={() => setShowAddServerDialog(false)}>
									Cancel
								</Button>
								<Button
									variant="confirm"
									onClick={handleAttachServer}
									disabled={!selectedServerId}
									showIcon={false}
								>
									<Plus className="h-4 w-4" />
									Attach
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</CardContent>
			</Card>

			{/* Permissions */}
			<Card>
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
								variant="ghost"
							>
								<Plus className="h-4 w-4" />
								Custom
							</Button>
							<Button onClick={() => setShowAttachPermissionDialog(true)} size="sm">
								<Plus className="h-4 w-4" />
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
					<Dialog
						open={showCreateCustomPermissionDialog}
						onOpenChange={setShowCreateCustomPermissionDialog}
					>
						<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
							<DialogHeader>
								<DialogTitle>Create Custom Permission</DialogTitle>
								<DialogDescription>
									Create a group-scoped custom permission that is unique to this group
								</DialogDescription>
							</DialogHeader>
							<GroupPermissionForm
								groupId={groupId!}
								onSubmit={handleCreateCustomPermission}
								onCancel={() => setShowCreateCustomPermissionDialog(false)}
								isSubmitting={createCustomPermission.isPending}
							/>
						</DialogContent>
					</Dialog>

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
								<Button
									variant="cancel"
									onClick={() => {
										setRemovePermissionDialogOpen(false)
										setSelectedPermission(null)
									}}
									disabled={removePermission.isPending}
								>
									Cancel
								</Button>
								<Button
									variant="danger"
									onClick={handleRemovePermission}
									loading={removePermission.isPending}
									loadingText="Removing..."
								>
									Remove Permission
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</CardContent>
			</Card>

			{/* Members List */}
			<Card>
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

			{/* Danger Zone */}
			<Card className="border-destructive">
				<CardHeader>
					<CardTitle className="text-destructive">Danger Zone</CardTitle>
					<CardDescription>
						Irreversible and destructive actions. Please be certain before proceeding.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
						<div className="flex items-start justify-between">
							<div className="space-y-1">
								<h4 className="font-medium text-destructive">Delete This Group</h4>
								<p className="text-sm text-muted-foreground">
									Once you delete a group, there is no going back. This will permanently delete:
								</p>
								<ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 mt-2">
									<li>
										All {memberCount} member{memberCount !== 1 ? 's' : ''}
									</li>
									<li>
										All {adminCount} admin{adminCount !== 1 ? 's' : ''}
									</li>
									<li>All pending invitations and join requests</li>
									<li>All invite codes</li>
									<li>All Discord server attachments</li>
									<li>All permissions</li>
								</ul>
							</div>
							<Button
								variant="danger"
								onClick={() => {
									setDeleteConfirmationText('')
									setDeleteGroupDialogOpen(true)
								}}
								size="sm"
							>
								<Trash2 className="h-4 w-4" />
								Delete Group
							</Button>
						</div>
					</div>
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
							variant="cancel"
							onClick={() => {
								setRemoveDialogOpen(false)
								setSelectedUserId(null)
							}}
							disabled={removeMember.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="danger"
							onClick={handleRemoveMemberConfirm}
							loading={removeMember.isPending}
							loadingText="Removing..."
							showIcon={false}
						>
							<UserMinus className="h-4 w-4" />
							Remove Member
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
							variant="cancel"
							onClick={() => {
								setAdminDialogOpen(false)
								setSelectedUserId(null)
							}}
							disabled={toggleAdmin.isPending}
						>
							Cancel
						</Button>
						{selectedUserIsAdmin ? (
							<Button
								variant="danger"
								onClick={handleToggleAdminConfirm}
								loading={toggleAdmin.isPending}
								loadingText="Removing..."
								showIcon={false}
							>
								<ShieldOff className="h-4 w-4" />
								Remove Admin
							</Button>
						) : (
							<Button
								variant="confirm"
								onClick={handleToggleAdminConfirm}
								loading={toggleAdmin.isPending}
								loadingText="Promoting..."
								showIcon={false}
							>
								<Shield className="h-4 w-4" />
								Make Admin
							</Button>
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

			{/* Edit Group Mumble Dialog */}
			{group && (
				<EditGroupMumbleDialog
					group={group}
					open={editMumbleDialogOpen}
					onOpenChange={setEditMumbleDialogOpen}
					onSuccess={() => {
						setMessage({ type: 'success', text: 'Group Mumble settings updated successfully!' })
						setTimeout(() => setMessage(null), 3000)
					}}
				/>
			)}

			{/* Edit Group Dialog */}
			{group && categories.length > 0 && (
				<EditGroupDialog
					group={group}
					categories={categories}
					open={editGroupDialogOpen}
					onOpenChange={setEditGroupDialogOpen}
					onSubmit={handleEditGroup}
					canEditAdminManaged={user?.is_admin ?? false}
				/>
			)}

			{/* Delete Group Confirmation Dialog */}
			<Dialog open={deleteGroupDialogOpen} onOpenChange={setDeleteGroupDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Group</DialogTitle>
						<DialogDescription>
							This action cannot be undone. This will permanently delete the group and all
							associated data.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="confirm-delete">
								Type <span className="font-mono font-bold">{group?.name}</span> to confirm deletion
							</Label>
							<Input
								id="confirm-delete"
								value={deleteConfirmationText}
								onChange={(e) => setDeleteConfirmationText((e.target as HTMLInputElement).value)}
								placeholder="Enter group name"
								disabled={deleteGroup.isPending}
							/>
						</div>
						<div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
							<p className="text-sm text-muted-foreground">
								<strong className="text-destructive">Warning:</strong> Deleting this group will
								permanently remove:
							</p>
							<ul className="text-sm text-muted-foreground list-disc list-inside mt-2 space-y-1">
								<li>
									{memberCount} member{memberCount !== 1 ? 's' : ''}
								</li>
								<li>
									{adminCount} admin{adminCount !== 1 ? 's' : ''}
								</li>
								<li>All invitations, join requests, and invite codes</li>
								<li>All Discord server attachments and role assignments</li>
								<li>All permissions</li>
							</ul>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => {
								setDeleteGroupDialogOpen(false)
								setDeleteConfirmationText('')
							}}
							disabled={deleteGroup.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="danger"
							onClick={handleDeleteGroup}
							disabled={deleteConfirmationText !== group?.name}
							loading={deleteGroup.isPending}
							loadingText="Deleting..."
						>
							Delete Group Permanently
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
