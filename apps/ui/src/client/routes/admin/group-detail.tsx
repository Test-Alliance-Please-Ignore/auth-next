import { useQueryClient } from '@tanstack/react-query'
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
import { Trans } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { AttachPermissionDialog } from '@/components/attach-permission-dialog'
import { EditGroupDescriptionDialog } from '@/components/edit-group-description-dialog'
import { EditGroupDialog } from '@/components/edit-group-dialog'
import { EditGroupMumbleDialog } from '@/components/edit-group-mumble-dialog'
import { EditGroupNameDialog } from '@/components/edit-group-name-dialog'
import { GroupCard } from '@/components/group-card'
import { GroupPermissionCard } from '@/components/group-permission-card'
import { GroupPermissionForm } from '@/components/group-permission-form'
import { InviteMemberForm } from '@/components/invite-member-form'
import { MemberList } from '@/components/member-list'
import { PendingInvitationsList } from '@/components/pending-invitations-list'
import { PendingJoinRequestsList } from '@/components/pending-join-requests-list'
import { ReassignCategoryDialog } from '@/components/reassign-category-dialog'
import { TransferOwnershipDialog } from '@/components/transfer-ownership-dialog'
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion'
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
} from '@/hooks/useGroupPermissions'
import { useDeleteGroup, useGroup, useUpdateGroup } from '@/hooks/useGroups'
import {
	useCreateInviteCode,
	useGroupInviteCodes,
	useRevokeInviteCode,
} from '@/hooks/useInviteCodes'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate, formatNumber, useAppTranslation } from '@/i18n'

import {
	groupDiscordRoleAssignmentSections,
	groupDiscordRoleAssignmentSummaryKey,
} from './group-discord-role-sections'

import type { MessageText } from '@/hooks/useMessage'
import type { GroupPermissionWithDetails } from '@/lib/api'

export default function GroupDetailPage() {
	const { t } = useAppTranslation()
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
	usePageTitle(
		group?.name
			? t('admin.organizations.shared.entityTitle', { name: group.name })
			: t('admin.organizations.group.detailPageTitle')
	)
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
	const { data: inviteCodes = [] } = useGroupInviteCodes(
		groupId!,
		Boolean(group && !isAdminManaged)
	)
	const createInviteCode = useCreateInviteCode()
	const revokeInviteCode = useRevokeInviteCode()

	// Permission hooks
	const { data: groupPermissions = [] } = useGroupPermissions(groupId!)
	const attachPermission = useAttachPermission()
	const createCustomPermission = useCreateGroupScopedPermission()
	const removePermission = useRemoveGroupPermission()

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
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: MessageText } | null>(
		null
	)

	// Get admin user IDs from group data
	const adminUserIds = new Set(group?.adminUserIds || [])

	// Get selected member's character name
	const selectedMember = members?.find((m) => m.userId === selectedUserId)
	const selectedMemberName = selectedMember?.mainCharacterName || t('admin.users.account.thisUser')

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
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.memberRemoved') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.memberRemoveError'),
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
				text: (t) =>
					selectedUserIsAdmin
						? t('admin.organizations.feedback.adminRemoved')
						: t('admin.organizations.feedback.adminGranted'),
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error ? error.message : t('admin.users.feedback.adminError'),
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
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.serverAttached') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.serverAttachError'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDetachServer = async (attachmentId: string) => {
		if (!groupId) return

		try {
			await detachServer.mutateAsync({ groupId, attachmentId })
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.serverDetached') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.serverDetachError'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleRefreshServerRoles = async (attachmentId: string) => {
		if (!groupId) return

		try {
			const result = await refreshServerRoles.mutateAsync({ groupId, attachmentId })

			// Show detailed summary
			const successMsg: MessageText = (t) =>
				result.message ||
				t('admin.organizations.feedback.rolesRefreshed', {
					success: result.success,
					total: result.totalMembers,
					skipped: result.skipped,
					failed: result.failed,
				})

			setMessage({
				type: result.failed > 0 && result.success === 0 ? 'error' : 'success',
				text: successMsg,
			})
			setTimeout(() => setMessage(null), 5000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.rolesRefreshError'),
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
			setMessage({
				type: 'success',
				text: (t) => t('admin.organizations.feedback.autoInviteSaved'),
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.autoInviteError'),
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
			setMessage({
				type: 'success',
				text: (t) => t('admin.organizations.feedback.autoAssignSaved'),
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.autoAssignError'),
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
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.roleAssigned') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.roleAssignError'),
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
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.roleUnassigned') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.roleUnassignError'),
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
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.codeCreated') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.codeCreateError'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleRevokeInviteCode = async (codeId: string) => {
		if (!groupId) return

		try {
			await revokeInviteCode.mutateAsync({ codeId, groupId })
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.codeRevoked') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.codeRevokeError'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleCopyCode = async (code: string) => {
		try {
			await navigator.clipboard.writeText(code)
			setCopiedCode(code)
			setTimeout(() => setCopiedCode(null), 2000)
		} catch {
			setMessage({
				type: 'error',
				text: (t) => t('admin.organizations.feedback.copyError'),
			})
			setTimeout(() => setMessage(null), 3000)
		}
	}

	// Permission handlers
	const handleAttachPermission = async (data: any) => {
		try {
			await attachPermission.mutateAsync(data)
			setShowAttachPermissionDialog(false)
			setMessage({
				type: 'success',
				text: (t) => t('admin.organizations.feedback.permissionAttached'),
			})
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
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.permissionAttachError'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleCreateCustomPermission = async (data: any) => {
		console.log('handleCreateCustomPermission called with data:', data)
		try {
			await createCustomPermission.mutateAsync(data)
			setShowCreateCustomPermissionDialog(false)
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.customCreated') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			console.error('Failed to create custom permission:', error)
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.customCreateError'),
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
			setMessage({
				type: 'success',
				text: (t) => t('admin.organizations.feedback.permissionRemoved'),
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.permissionRemoveError'),
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
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.groupUpdated') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.groupUpdateError'),
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
				text: (t) => t('admin.organizations.feedback.groupNameMismatch'),
			})
			setTimeout(() => setMessage(null), 5000)
			return
		}

		try {
			await deleteGroup.mutateAsync(groupId)
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.groupDeleted') })
			setTimeout(() => {
				void navigate('/admin/groups')
			}, 1000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.groupDeleteError'),
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
					<p className="text-destructive font-medium">{t('groupDetail.notFound')}</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/admin/groups">
							<ArrowLeft className="h-4 w-4" />
							{t('groupDetail.back')}
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
					{t('groupDetail.back')}
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
							{typeof message.text === 'function' ? message.text(t) : message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Group Info Card */}
			<GroupCard group={group} />

			{/* Group Management Actions */}
			<Card>
				<CardHeader>
					<CardTitle>{t('admin.organizations.group.management')}</CardTitle>
					<CardDescription>{t('admin.organizations.group.managementDescription')}</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						<Button variant="primary" size="sm" onClick={() => setEditGroupDialogOpen(true)}>
							<Settings className="h-4 w-4" />
							{t('groups.form.edit')}
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setEditNameDialogOpen(true)}>
							<Pencil className="h-4 w-4" />
							{t('admin.organizations.group.editName')}
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setEditDescriptionDialogOpen(true)}>
							<Pencil className="h-4 w-4" />
							{t('admin.organizations.group.editDescription')}
						</Button>
						{user?.is_admin && (
							<Button variant="ghost" size="sm" onClick={() => setEditMumbleDialogOpen(true)}>
								<Settings className="h-4 w-4" />
								{t('groups.mumble.title')}
							</Button>
						)}
						<Button variant="ghost" size="sm" onClick={() => setReassignCategoryDialogOpen(true)}>
							<FolderEdit className="h-4 w-4" />
							{t('admin.organizations.group.reassignCategory')}
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Stats Section */}
			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>{t('admin.organizations.group.members')}</CardTitle>
						<CardDescription>{t('admin.organizations.group.totalMembers')}</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold gradient-text">{formatNumber(memberCount)}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>{t('admin.organizations.group.admins')}</CardTitle>
						<CardDescription>{t('admin.organizations.group.adminDescription')}</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-3xl font-bold gradient-text">{formatNumber(adminCount)}</p>
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
									<CardTitle>{t('groupDetail.inviteCodes.title')}</CardTitle>
								</div>
								<CardDescription>{t('groupDetail.inviteCodes.description')}</CardDescription>
							</div>
							<Button onClick={() => setShowCreateInviteCodeDialog(true)} size="sm">
								<Plus className="h-4 w-4" />
								{t('admin.organizations.group.createCode')}
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						{inviteCodes.length === 0 ? (
							<div className="text-center py-8">
								<Ticket className="mx-auto h-12 w-12 text-muted-foreground" />
								<h3 className="mt-4 text-sm font-medium">{t('groupDetail.inviteCodes.empty')}</h3>
								<p className="text-sm text-muted-foreground mt-2">
									{t('groupDetail.inviteCodes.emptyDescription')}
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
										inviteCode.maxUses !== null &&
										inviteCode.currentUses >= inviteCode.maxUses
									const statusLabel = isRevoked
										? t('groupDetail.inviteCodes.revoked')
										: isExpired
											? t('invitations.pending.status.expired')
											: isMaxedOut
												? t('groupDetail.inviteCodes.maxUsesReached')
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
															title={t('groupDetail.inviteCodes.copyCode')}
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
															title={t('groupDetail.inviteCodes.copyUrl')}
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
															{t(
																inviteCode.maxUses
																	? 'groupDetail.inviteCodes.usesLimited'
																	: 'groupDetail.inviteCodes.usesUnlimited',
																{
																	current: formatNumber(inviteCode.currentUses),
																	maximum: formatNumber(inviteCode.maxUses ?? 0),
																}
															)}
														</span>
														<span>
															{t('groupDetail.inviteCodes.expires', {
																date: formatDate(inviteCode.expiresAt),
															})}
														</span>
														<span>
															{t('groupDetail.inviteCodes.created', {
																date: formatDate(inviteCode.createdAt),
															})}
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
									<DialogTitle>{t('groupDetail.inviteCodes.createTitle')}</DialogTitle>
									<DialogDescription>
										{t('groupDetail.inviteCodes.createDescription')}
									</DialogDescription>
								</DialogHeader>

								<div className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="max-uses">{t('groupDetail.inviteCodes.maxUses')}</Label>
										<Input
											id="max-uses"
											type="number"
											min="1"
											placeholder={t('groupDetail.inviteCodes.unlimited')}
											value={inviteCodeSettings.maxUses ?? ''}
											onChange={(e) =>
												setInviteCodeSettings({
													...inviteCodeSettings,
													maxUses: e.target.value ? parseInt(e.target.value) : null,
												})
											}
										/>
										<p className="text-xs text-muted-foreground">
											{t('groupDetail.inviteCodes.maxUsesHint')}
										</p>
									</div>

									<div className="space-y-2">
										<Label htmlFor="expires-in-days">
											{t('groupDetail.inviteCodes.expiresInDays')}
										</Label>
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
										<p className="text-xs text-muted-foreground">
											{t('groupDetail.inviteCodes.expiryHint')}
										</p>
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
										{t('common.cancel')}
									</Button>
									<Button
										variant="confirm"
										onClick={handleCreateInviteCode}
										loading={createInviteCode.isPending}
										loadingText={t('groupDetail.inviteCodes.creating')}
									>
										{t('admin.organizations.group.createCode')}
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
								<CardTitle>{t('admin.organizations.discord.servers')}</CardTitle>
							</div>
							<CardDescription>{t('admin.organizations.discord.groupDescription')}</CardDescription>
						</div>
						<Button
							onClick={() => setShowAddServerDialog(true)}
							disabled={discordServers.length === 0}
							size="sm"
						>
							<Plus className="h-4 w-4" />
							{t('admin.organizations.discord.attachServer')}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{groupDiscordServers.length === 0 ? (
						<div className="text-center py-8">
							<MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
							<h3 className="mt-4 text-sm font-medium">{t('admin.organizations.discord.empty')}</h3>
							<p className="text-sm text-muted-foreground mt-2">
								{t('admin.organizations.discord.emptyHint')}
							</p>
							{discordServers.length === 0 && (
								<p className="text-xs text-muted-foreground mt-2">
									<Link to="/admin/discord-servers" className="text-primary hover:underline">
										{t('admin.organizations.discord.registryHint')}
									</Link>
								</p>
							)}
						</div>
					) : (
						<Accordion type="multiple" defaultValue={[]} className="space-y-4">
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
												{t('admin.organizations.shared.id', {
													id: attachment.discordServer?.guildId,
												})}
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
															? t('admin.organizations.discord.noRolesConfigured')
															: t('admin.organizations.discord.refreshHint')
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
													<Label
														htmlFor={`auto-invite-${attachment.id}`}
														className="cursor-pointer"
													>
														{t('admin.organizations.discord.autoInvite')}
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
													<Label
														htmlFor={`auto-assign-${attachment.id}`}
														className="cursor-pointer"
													>
														{t('admin.organizations.discord.autoAssign')}
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
															{t(groupDiscordRoleAssignmentSummaryKey)}
														</p>
														{groupDiscordRoleAssignmentSections.map((section) => {
															const sectionAssignments = (attachment.roles ?? []).filter(
																(roleAssignment) =>
																	roleAssignment.membershipType === section.membershipType
															)
															const selectionKey = `${attachment.id}:${section.membershipType}`
															const availableRoles = discordServer.roles.filter(
																(role) =>
																	!attachment.roles?.some(
																		(roleAssignment) =>
																			roleAssignment.discordRole.roleId === role.roleId
																	)
															)

															return (
																<div
																	key={`${attachment.id}-${section.membershipType}`}
																	className="space-y-3 rounded-lg border border-border/80 bg-background/75 p-4 shadow-sm"
																>
																	<div className="flex items-start justify-between gap-3">
																		<div>
																			<p className="text-sm font-medium">{t(section.labelKey)}</p>
																			<p className="text-xs text-muted-foreground">
																				{t(section.descriptionKey)}
																			</p>
																		</div>
																		<p className="text-xs text-muted-foreground">
																			{t('admin.organizations.discord.assigned', {
																				count: sectionAssignments.length,
																			})}
																		</p>
																	</div>

																	<div className="flex flex-wrap gap-2">
																		{sectionAssignments.length === 0 ? (
																			<p className="text-sm text-muted-foreground">
																				{t('admin.organizations.discord.noRoles')}
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
																							handleUnassignRole(attachment.id, roleAssignment.id)
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
																				placeholder={t('admin.organizations.discord.addRole')}
																				emptyText={t('admin.organizations.discord.noMatchingRoles')}
																				className="w-full"
																				contentClassName="w-[min(90vw,36rem)]"
																				inputClassName="h-9"
																			/>
																		</div>
																	) : (
																		<p className="text-xs text-muted-foreground">
																			{t('admin.organizations.discord.noAvailableRoles')}
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
								<DialogTitle>{t('admin.organizations.discord.attachTitle')}</DialogTitle>
								<DialogDescription>
									{t('admin.organizations.discord.attachGroupDescription')}
								</DialogDescription>
							</DialogHeader>

							<div className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="discord-server">
										{t('admin.organizations.discord.selectServer')}
									</Label>
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
										placeholder={t('admin.organizations.discord.chooseServer')}
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
											{t('admin.organizations.discord.enableAutoInvite')}
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
											{t('admin.organizations.discord.autoAssign')}
										</Label>
									</div>
								</div>
							</div>

							<DialogFooter>
								<Button variant="cancel" onClick={() => setShowAddServerDialog(false)}>
									{t('common.cancel')}
								</Button>
								<Button
									variant="confirm"
									onClick={handleAttachServer}
									disabled={!selectedServerId}
									showIcon={false}
								>
									<Plus className="h-4 w-4" />
									{t('admin.organizations.discord.attach')}
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
								<CardTitle>{t('admin.nav.permissions')}</CardTitle>
							</div>
							<CardDescription>
								{t('admin.organizations.group.permissionsDescription')}
							</CardDescription>
						</div>
						<div className="flex gap-2">
							<Button
								onClick={() => setShowCreateCustomPermissionDialog(true)}
								size="sm"
								variant="ghost"
							>
								<Plus className="h-4 w-4" />
								{t('groups.permissions.custom')}
							</Button>
							<Button onClick={() => setShowAttachPermissionDialog(true)} size="sm">
								<Plus className="h-4 w-4" />
								{t('admin.organizations.group.attachGlobal')}
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{groupPermissions.length === 0 ? (
						<div className="text-center py-8">
							<Key className="mx-auto h-12 w-12 text-muted-foreground" />
							<h3 className="mt-4 text-sm font-medium">
								{t('admin.organizations.group.noPermissions')}
							</h3>
							<p className="text-sm text-muted-foreground mt-2">
								{t('admin.organizations.group.noPermissionsHint')}
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
								<DialogTitle>{t('admin.organizations.group.createCustom')}</DialogTitle>
								<DialogDescription>
									{t('admin.organizations.group.customDescription')}
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
								<DialogTitle>{t('admin.organizations.shared.removePermission')}</DialogTitle>
								<DialogDescription>
									{t('admin.organizations.group.removePermissionWarning', {
										name: selectedPermission?.permission?.name || selectedPermission?.customName,
									})}
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
									{t('common.cancel')}
								</Button>
								<Button
									variant="danger"
									onClick={handleRemovePermission}
									loading={removePermission.isPending}
									loadingText={t('admin.users.account.removing')}
								>
									{t('admin.organizations.shared.removePermission')}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</CardContent>
			</Card>

			{/* Members List */}
			<Card>
				<CardHeader>
					<CardTitle>{t('admin.organizations.group.memberManagement')}</CardTitle>
					<CardDescription>
						{t('admin.organizations.group.memberManagementDescription')}
					</CardDescription>
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
					<CardTitle className="text-destructive">
						{t('admin.organizations.group.danger')}
					</CardTitle>
					<CardDescription>{t('admin.organizations.group.dangerDescription')}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
						<div className="flex items-start justify-between">
							<div className="space-y-1">
								<h4 className="font-medium text-destructive">
									{t('admin.organizations.group.deleteThis')}
								</h4>
								<p className="text-sm text-muted-foreground">
									{t('admin.organizations.group.deleteWarning')}
								</p>
								<ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 mt-2">
									<li>{t('admin.organizations.group.deleteMembers', { count: memberCount })}</li>
									<li>{t('admin.organizations.group.deleteAdmins', { count: adminCount })}</li>
									<li>{t('admin.organizations.group.deleteInvitations')}</li>
									<li>{t('admin.organizations.group.deleteCodes')}</li>
									<li>{t('admin.organizations.group.deleteAttachments')}</li>
									<li>{t('admin.organizations.group.deletePermissions')}</li>
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
								{t('admin.organizations.group.delete')}
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Remove Member Confirmation Dialog */}
			<Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('groupDetail.remove.title')}</DialogTitle>
						<DialogDescription>
							{t('admin.organizations.group.removeMemberWarning', { name: selectedMemberName })}
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
							{t('common.cancel')}
						</Button>
						<Button
							variant="danger"
							onClick={handleRemoveMemberConfirm}
							loading={removeMember.isPending}
							loadingText={t('admin.users.account.removing')}
							showIcon={false}
						>
							<UserMinus className="h-4 w-4" />
							{t('groupDetail.remove.title')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Toggle Admin Confirmation Dialog */}
			<Dialog open={adminDialogOpen} onOpenChange={setAdminDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{selectedUserIsAdmin
								? t('admin.organizations.group.removeAdminTitle')
								: t('groupDetail.memberList.makeAdmin')}
						</DialogTitle>
						<DialogDescription>
							{selectedUserIsAdmin
								? t('admin.organizations.group.removeAdminWarning', { name: selectedMemberName })
								: t('admin.organizations.group.grantAdminWarning', { name: selectedMemberName })}
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
							{t('common.cancel')}
						</Button>
						{selectedUserIsAdmin ? (
							<Button
								variant="danger"
								onClick={handleToggleAdminConfirm}
								loading={toggleAdmin.isPending}
								loadingText={t('admin.users.account.removing')}
								showIcon={false}
							>
								<ShieldOff className="h-4 w-4" />
								{t('groupDetail.memberList.removeAdmin')}
							</Button>
						) : (
							<Button
								variant="confirm"
								onClick={handleToggleAdminConfirm}
								loading={toggleAdmin.isPending}
								loadingText={t('admin.organizations.group.promoting')}
								showIcon={false}
							>
								<Shield className="h-4 w-4" />
								{t('groupDetail.memberList.makeAdmin')}
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
						setMessage({
							type: 'success',
							text: (t) => t('admin.organizations.feedback.ownershipTransferred'),
						})
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
						setMessage({
							type: 'success',
							text: (t) => t('admin.organizations.feedback.categoryChanged'),
						})
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
						setMessage({
							type: 'success',
							text: (t) => t('admin.organizations.feedback.nameUpdated'),
						})
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
						setMessage({
							type: 'success',
							text: (t) => t('admin.organizations.feedback.descriptionUpdated'),
						})
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
						setMessage({
							type: 'success',
							text: (t) => t('admin.organizations.feedback.mumbleUpdated'),
						})
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
						<DialogTitle>{t('admin.organizations.group.delete')}</DialogTitle>
						<DialogDescription>
							{t('admin.organizations.group.deleteDescription')}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="confirm-delete">
								<Trans
									i18nKey="admin.organizations.group.confirmName"
									values={{ name: group?.name }}
									components={{ name: <span className="font-mono font-bold" /> }}
								/>
							</Label>
							<Input
								id="confirm-delete"
								value={deleteConfirmationText}
								onChange={(e) => setDeleteConfirmationText((e.target as HTMLInputElement).value)}
								placeholder={t('groups.form.namePlaceholder')}
								disabled={deleteGroup.isPending}
							/>
						</div>
						<div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
							<p className="text-sm text-muted-foreground">
								<strong className="text-destructive">
									{t('admin.organizations.group.warning')}
								</strong>{' '}
								{t('admin.organizations.group.deleteRemoves')}
							</p>
							<ul className="text-sm text-muted-foreground list-disc list-inside mt-2 space-y-1">
								<li>{t('admin.organizations.group.memberCount', { count: memberCount })}</li>
								<li>{t('admin.organizations.group.adminCount', { count: adminCount })}</li>
								<li>{t('admin.organizations.group.deleteAllInvites')}</li>
								<li>{t('admin.organizations.group.deleteAllRoles')}</li>
								<li>{t('admin.organizations.group.deletePermissions')}</li>
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
							{t('common.cancel')}
						</Button>
						<Button
							variant="danger"
							onClick={handleDeleteGroup}
							disabled={deleteConfirmationText !== group?.name}
							loading={deleteGroup.isPending}
							loadingText={t('admin.users.account.deleting')}
						>
							{t('admin.organizations.group.deletePermanent')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
