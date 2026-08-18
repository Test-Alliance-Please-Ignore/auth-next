import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	AlertTriangle,
	ArrowLeft,
	Bot,
	CheckCircle,
	ChevronDown,
	ExternalLink,
	History,
	LogOut,
	MessageSquare,
	MessageSquarePlus,
	Mic,
	RefreshCw,
	Server,
	Shield,
	ShieldBan,
	ShieldOff,
	Trash2,
	Users,
	XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { IpHistoryCard } from '@/components/ip-history-card'
import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { AddHRNoteDialog } from '@/features/applications/components/add-hr-note-dialog'
import { HRNoteCard } from '@/features/applications/components/hr-note-card'
import { useHRNotes } from '@/features/applications/hooks'
import { useMumbleFeatureEnabled } from '@/features/mumble/feature'
import {
	useAdminMumbleAccount,
	useAdminUser,
	useAdminUserIpHistory,
	useClearUserSessions,
	useDeleteAdminMumbleAccount,
	useDeleteUserCharacter,
	useRevokeDiscordLink,
	useSetUserAdmin,
	useSetUserPrimaryCharacter,
	useSyncAdminMumbleGroups,
	useSyncUser,
	useUnlinkDiscordAccount,
	useUpdateDiscordAccess,
} from '@/hooks/useAdminUsers'
import { useAuth } from '@/hooks/useAuth'
import { useBreadcrumb } from '@/hooks/useBreadcrumb'
import { useCorporations } from '@/hooks/useCorporations'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import type { BlacklistTargetType, DiscordRefreshOutput } from '@/lib/api'

const TARGET_TYPE_LABELS: Record<BlacklistTargetType, string> = {
	user: 'User',
	character_id: 'Character ID',
	character_name: 'Character Name',
	discord_id: 'Discord ID',
	corporation_id: 'Corporation ID',
	corporation_name: 'Corporation Name',
	alliance_id: 'Alliance ID',
	alliance_name: 'Alliance Name',
}

export default function UserDetailPage() {
	usePageTitle('Admin - User Details')
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { setCustomLabel, clearCustomLabel } = useBreadcrumb()
	const { user: sessionUser } = useAuth()
	const { isEnabled: isMumbleFeatureEnabled, isLoading: isLoadingMumbleFeature } =
		useMumbleFeatureEnabled()

	const { data: user, isLoading, refetch } = useAdminUser(userId!)
	const { data: ipHistoryData } = useAdminUserIpHistory(userId!)
	const { data: mumbleAccountData, isLoading: isLoadingMumbleAccount } = useAdminMumbleAccount(
		userId!,
		isMumbleFeatureEnabled
	)
	const setUserAdmin = useSetUserAdmin()
	const deleteCharacter = useDeleteUserCharacter()
	const setPrimaryCharacter = useSetUserPrimaryCharacter()
	const revokeDiscord = useRevokeDiscordLink()
	const unlinkDiscord = useUnlinkDiscordAccount()
	const clearSessions = useClearUserSessions()
	const syncUser = useSyncUser()
	const updateDiscordAccess = useUpdateDiscordAccess()
	const syncMumbleGroups = useSyncAdminMumbleGroups()
	const deleteMumbleAccount = useDeleteAdminMumbleAccount()
	const { data: managedCorporationData } = useCorporations({ page: 1, pageSize: 100 })
	const managedCorporations = managedCorporationData?.data ?? []
	const managedCorporationIds = new Set(managedCorporations.map((corp) => corp.corporationId))

	// Blacklist data
	const { data: blacklistEntries = [] } = useQuery({
		queryKey: ['userBlacklists', userId],
		queryFn: () => api.getUserBlacklists(userId!),
		enabled: !!userId,
	})

	const createBlacklist = useMutation({
		mutationFn: (data: { userId: string; reason: string }) =>
			api.createUserBlacklist({ userId: data.userId, reason: data.reason }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['userBlacklists', userId] })
			void queryClient.invalidateQueries({ queryKey: ['adminUser', userId] })
		},
	})

	const removeBlacklist = useMutation({
		mutationFn: (id: string) => api.removeBlacklistEntry(id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ['userBlacklists', userId] })
			void queryClient.invalidateQueries({ queryKey: ['adminUser', userId] })
		},
	})
	const activeBlacklist = blacklistEntries.find((entry) => entry.targetType === 'user')
	const activeDiscordBlacklist = blacklistEntries.find((entry) => entry.targetType === 'discord_id')

	// Fetch the entry that triggered this blacklist (for contextual display)
	const { data: triggeringEntry } = useQuery({
		queryKey: ['blacklistEntry', activeBlacklist?.triggeredBy],
		queryFn: () => api.getBlacklistEntry(activeBlacklist!.triggeredBy!),
		enabled: !!activeBlacklist?.triggeredBy,
	})

	// Dialog state
	const [adminDialogOpen, setAdminDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [primaryDialogOpen, setPrimaryDialogOpen] = useState(false)
	const [revokeDiscordDialogOpen, setRevokeDiscordDialogOpen] = useState(false)
	const [unlinkDiscordDialogOpen, setUnlinkDiscordDialogOpen] = useState(false)
	const [clearSessionsDialogOpen, setClearSessionsDialogOpen] = useState(false)
	const [syncUserDialogOpen, setSyncUserDialogOpen] = useState(false)
	const [updateDiscordDialogOpen, setUpdateDiscordDialogOpen] = useState(false)
	const [deleteMumbleDialogOpen, setDeleteMumbleDialogOpen] = useState(false)
	const [blacklistDialogOpen, setBlacklistDialogOpen] = useState(false)
	const [removeBlacklistDialogOpen, setRemoveBlacklistDialogOpen] = useState(false)
	const [blacklistReason, setBlacklistReason] = useState('')
	const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false)
	const [discordUpdateResults, setDiscordUpdateResults] = useState<DiscordRefreshOutput | null>(
		null
	)
	const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null)

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Fetch HR notes for this user
	const { data: hrNotes = [], isLoading: notesLoading } = useHRNotes({
		subjectUserId: userId!,
	})

	const primaryCharacter =
		user?.characters.find((character) => character.is_primary) ?? user?.characters[0] ?? null
	const primaryCharacterName = primaryCharacter?.characterName || 'this user'
	const corporationLinkForCurrentUser =
		sessionUser?.is_admin === true
			? (corporationId: string) => `/admin/corporations/${corporationId}`
			: (corporationId: string) => `/corporations/${corporationId}/members`

	useEffect(() => {
		if (!userId) return
		const path = `/admin/users/${userId}`
		if (user) {
			const label = primaryCharacter?.characterName ?? user.id
			setCustomLabel(path, label)
		}
		return () => {
			clearCustomLabel(path)
		}
	}, [clearCustomLabel, primaryCharacter, setCustomLabel, user, userId])

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/users')}>
						<ArrowLeft className="h-4 w-4" />
						Back
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">Loading user details...</div>
			</div>
		)
	}

	if (!user) {
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/users')}>
						<ArrowLeft className="h-4 w-4" />
						Back
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">User not found</div>
			</div>
		)
	}

	const handleToggleAdmin = async () => {
		try {
			await setUserAdmin.mutateAsync({ userId: user.id, isAdmin: !user.is_admin })
			setAdminDialogOpen(false)
			setMessage({
				type: 'success',
				text: user.is_admin
					? 'Admin privileges revoked successfully'
					: 'Admin privileges granted successfully',
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

	const handleDeleteCharacterClick = (characterId: string) => {
		const character = user.characters.find((c) => c.characterId === characterId)

		// Prevent deleting primary character if it's the only one
		if (character?.is_primary && user.characters.length === 1) {
			setMessage({
				type: 'error',
				text: 'Cannot delete the only character on an account',
			})
			setTimeout(() => setMessage(null), 5000)
			return
		}

		setSelectedCharacter(characterId)
		setDeleteDialogOpen(true)
	}

	const handleDeleteCharacterConfirm = async () => {
		if (!selectedCharacter) return

		const character = user.characters.find((c) => c.characterId === selectedCharacter)

		try {
			await deleteCharacter.mutateAsync({ userId: user.id, characterId: selectedCharacter })
			setDeleteDialogOpen(false)
			setSelectedCharacter(null)
			setMessage({
				type: 'success',
				text: `Character ${character?.characterName} deleted successfully`,
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete character',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleSetPrimaryClick = (characterId: string) => {
		setSelectedCharacter(characterId)
		setPrimaryDialogOpen(true)
	}

	const handleSetPrimaryConfirm = async () => {
		if (!selectedCharacter) return

		const character = user.characters.find((c) => c.characterId === selectedCharacter)

		try {
			await setPrimaryCharacter.mutateAsync({ userId: user.id, characterId: selectedCharacter })
			setPrimaryDialogOpen(false)
			setSelectedCharacter(null)
			setMessage({
				type: 'success',
				text: `${character?.characterName} set as primary character`,
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to set primary character',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleRevokeDiscordConfirm = async () => {
		try {
			await revokeDiscord.mutateAsync(user.id)
			setRevokeDiscordDialogOpen(false)
			setMessage({
				type: 'success',
				text: 'Discord authorization revoked successfully',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to revoke Discord authorization',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleUnlinkDiscordConfirm = async () => {
		try {
			await unlinkDiscord.mutateAsync(user.id)
			setUnlinkDiscordDialogOpen(false)
			setMessage({
				type: 'success',
				text: 'Discord account unlinked successfully',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to unlink Discord account',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleClearSessionsConfirm = async () => {
		try {
			await clearSessions.mutateAsync(user.id)
			setClearSessionsDialogOpen(false)
			setMessage({
				type: 'success',
				text: 'All sessions cleared successfully',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to clear sessions',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleSyncUserConfirm = async () => {
		try {
			await syncUser.mutateAsync(user.id)
			setSyncUserDialogOpen(false)
			setMessage({
				type: 'success',
				text: 'User sync workflow triggered. Data will be refreshed in the background.',
			})
			setTimeout(() => setMessage(null), 5000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to trigger user sync',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleUpdateDiscordAccess = async () => {
		try {
			const results = await updateDiscordAccess.mutateAsync(user.id)
			setDiscordUpdateResults(results)
			setUpdateDiscordDialogOpen(true)
			const totalInvited = results.totalInvited ?? 0
			const totalFailed = results.totalFailed ?? 0
			setMessage({
				type: results.status === 'failed' ? 'error' : 'success',
				text:
					results.status === 'failed'
						? `Discord access refresh failed: ${results.error?.message ?? 'The refresh did not complete.'}`
						: `Discord access updated! Joined ${totalInvited} server(s), ${totalFailed} failed.`,
			})
			setTimeout(() => setMessage(null), 5000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to update Discord access',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleSyncMumbleGroups = async () => {
		try {
			const result = await syncMumbleGroups.mutateAsync(user.id)
			setMessage({
				type: 'success',
				text: `Mumble groups synced successfully (${result.synced.length} updated, ${result.skipped.length} skipped).`,
			})
			setTimeout(() => setMessage(null), 4000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to sync Mumble groups',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDeleteMumbleConfirm = async () => {
		try {
			const result = await deleteMumbleAccount.mutateAsync(user.id)
			setDeleteMumbleDialogOpen(false)
			setMessage({
				type: 'success',
				text:
					result.queued.length > 0
						? 'Mumble account deletion queued for retry'
						: 'Mumble account deleted successfully',
			})
			setTimeout(() => setMessage(null), 4000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to delete Mumble account',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleBlacklistConfirm = async () => {
		if (!blacklistReason.trim()) {
			setMessage({
				type: 'error',
				text: 'Please provide a reason for blocklisting',
			})
			setTimeout(() => setMessage(null), 3000)
			return
		}

		try {
			await createBlacklist.mutateAsync({ userId: user.id, reason: blacklistReason })
			setBlacklistDialogOpen(false)
			setBlacklistReason('')
			setMessage({
				type: 'success',
				text: 'User has been blocklisted successfully',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to blocklist user',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleRemoveBlacklistConfirm = async () => {
		if (!activeBlacklist) return

		try {
			await removeBlacklist.mutateAsync(activeBlacklist.id)
			setRemoveBlacklistDialogOpen(false)
			setMessage({
				type: 'success',
				text: 'User has been removed from blocklist',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to remove blocklist',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const selectedCharacterData = user.characters.find((c) => c.characterId === selectedCharacter)

	return (
		<div className="space-y-6">
			{/* Top Row Actions */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/users')}>
						<ArrowLeft className="h-4 w-4" />
						Back to Users
					</Button>
					<Button variant="ghost" size="sm" onClick={() => refetch()}>
						<RefreshCw className="h-4 w-4" />
					</Button>
				</div>
				<div className="flex gap-2">
					<Button variant="ghost" asChild>
						<Link to={`/admin/users/${user.id}/discord-access`}>
							<Bot className="h-4 w-4" />
							Discord Access
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link to={`/admin/users/${user.id}/oauth-inspection`}>
							<ExternalLink className="h-4 w-4" />
							OAuth Resolver
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link to={`/admin/users/${user.id}/groups`}>
							<Users className="h-4 w-4" />
							Group Memberships
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link
							to={`/admin/legacy-migrations?userId=${encodeURIComponent(user.id)}&autoRecheck=1`}
							target="_blank"
							rel="noopener noreferrer"
						>
							<RefreshCw className="h-4 w-4" />
							Legacy Data
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link to={`/admin/users/${user.id}/activity`}>
							<History className="h-4 w-4" />
							Activity Log
						</Link>
					</Button>
				</div>
			</div>

			{/* Page Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">User Details</h1>
				<p className="text-muted-foreground mt-1">Inspect user account, access, and activity</p>
			</div>

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

			{/* User Header */}
			<Card>
				<CardContent className="pt-6">
					<div className="flex items-start gap-6">
						{primaryCharacter ? (
							<MemberAvatar
								characterId={primaryCharacter.characterId}
								characterName={primaryCharacterName}
								isBlacklisted={Boolean(primaryCharacter.isBlacklisted)}
								size="auto"
								imageSize={128}
								className="h-24 w-24 rounded-full"
							/>
						) : (
							<div className="flex h-24 w-24 items-center justify-center rounded-full border border-dashed text-xs text-muted-foreground">
								No live characters
							</div>
						)}
						<div className="flex-1">
							<div className="flex items-start justify-between">
								<div>
									<div className="flex items-center justify-between gap-2">
										<h2
											className={cn(
												'text-2xl font-bold',
												(activeBlacklist || primaryCharacter?.isBlacklisted) && 'text-red-500'
											)}
										>
											{primaryCharacterName || 'Unknown'}
										</h2>
										{user.is_admin && (
											<Badge variant="default">
												<Shield className="h-3 w-3 mr-1" />
												Admin
											</Badge>
										)}
									</div>
									<p className="text-sm text-muted-foreground mt-1">User ID: {user.id}</p>
								</div>
								<div className="flex items-center gap-2">
									{activeBlacklist && (
										<Badge variant="destructive">
											<ShieldBan className="h-3 w-3 mr-1" />
											Blocklisted
										</Badge>
									)}
									{user.is_admin ? (
										<Button
											variant="destructive"
											onClick={() => setAdminDialogOpen(true)}
											disabled={setUserAdmin.isPending}
											size="sm"
											showIcon={false}
										>
											<ShieldOff className="h-4 w-4" />
											Revoke Admin
										</Button>
									) : (
										<Button
											variant="destructive"
											onClick={() => setAdminDialogOpen(true)}
											disabled={setUserAdmin.isPending}
											size="sm"
											showIcon={false}
										>
											<Shield className="h-4 w-4" />
											Grant Admin
										</Button>
									)}
									{activeBlacklist ? (
										<Button
											variant="cancel"
											size="sm"
											onClick={() => setRemoveBlacklistDialogOpen(true)}
											disabled={removeBlacklist.isPending}
										>
											Remove from Blocklist
										</Button>
									) : (
										<Button
											variant="destructive"
											onClick={() => setBlacklistDialogOpen(true)}
											disabled={createBlacklist.isPending}
											size="sm"
											showIcon={false}
											className="
												bg-[#7a1a1a]
												!border-2
												!border-black
												hover:bg-[#8a2020]
												hover:!border-[#c2410c]
												bg-[repeating-linear-gradient(45deg,transparent_0,transparent_6px,rgba(0,0,0,0.6)_6px,rgba(0,0,0,0.6)_12px)]
												text-white
											"
										>
											<span
												className="font-semibold text-white"
												style={{
													textShadow:
														'0 1px 8px rgba(220, 38, 38, 1), 0 1px 3px rgba(248, 113, 113, 0.95)',
												}}
											>
												💩 Blocklist User
											</span>
										</Button>
									)}
									<Button
										variant="destructive"
										onClick={() => setClearSessionsDialogOpen(true)}
										disabled={clearSessions.isPending}
										size="sm"
										showIcon={false}
									>
										<LogOut className="h-4 w-4" />
										Clear Sessions
									</Button>
									<Button
										variant="primary"
										onClick={() => setSyncUserDialogOpen(true)}
										disabled={syncUser.isPending}
										size="sm"
									>
										<RefreshCw className={cn('h-4 w-4', syncUser.isPending && 'animate-spin')} />
										Sync User
									</Button>
								</div>
							</div>

							<div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
								<div>
									<div className="text-sm text-muted-foreground">Characters</div>
									<div className="text-lg font-semibold">{user.characters.length}</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">Last Updated</div>
									<div className="text-sm font-medium" title={formatDateTime(user.updatedAt)}>
										{formatRelativeTime(user.updatedAt)}
									</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">Created</div>
									<div className="text-sm font-medium" title={formatDateTime(user.createdAt)}>
										{formatRelativeTime(user.createdAt)}
									</div>
								</div>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Admin Notes */}
			<Card>
				{hrNotes.length === 0 ? (
					<>
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<CardTitle>Account Notes (0)</CardTitle>
									<CardDescription>Private notes about this user</CardDescription>
								</div>
								<Button onClick={() => setAddNoteDialogOpen(true)} size="sm">
									<MessageSquarePlus className="h-4 w-4" />
									Add Note
								</Button>
							</div>
						</CardHeader>
						<CardContent>
							{notesLoading ? (
								<div className="text-center py-4 text-muted-foreground">Loading notes...</div>
							) : (
								<div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
									No notes yet. Add a note to track important information about this user.
								</div>
							)}
						</CardContent>
					</>
				) : (
					<details className="group">
						<summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
							<div>
								<CardTitle>Account Notes ({hrNotes.length})</CardTitle>
								<CardDescription className="mt-1">Private notes about this user</CardDescription>
							</div>
							<div className="pointer-events-auto flex items-center gap-3">
								<Button
									onClick={(event) => {
										event.preventDefault()
										event.stopPropagation()
										setAddNoteDialogOpen(true)
									}}
									size="sm"
								>
									<MessageSquarePlus className="h-4 w-4" />
									Add Note
								</Button>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<span className="group-open:hidden">Click to expand</span>
									<span className="hidden group-open:inline">Click to collapse</span>
									<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
								</div>
							</div>
						</summary>
						<CardContent className="pt-0">
							{notesLoading ? (
								<div className="text-center py-4 text-muted-foreground">Loading notes...</div>
							) : (
								<div className="space-y-4">
									{hrNotes.map((note) => (
										<HRNoteCard key={note.id} note={note} />
									))}
								</div>
							)}
						</CardContent>
					</details>
				)}
			</Card>

			{/* Discord Information */}
			{user.discord && (
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle>Discord Account</CardTitle>
								<CardDescription>Linked Discord account information</CardDescription>
							</div>
							<div className="flex items-center gap-2">
								{!user.discord.authRevoked && (
									<>
										<Button
											variant="primary"
											onClick={handleUpdateDiscordAccess}
											disabled={updateDiscordAccess.isPending}
											size="sm"
										>
											<RefreshCw
												className={cn('h-4 w-4', updateDiscordAccess.isPending && 'animate-spin')}
											/>
											Update Discord Access
										</Button>
										<Button
											variant="destructive"
											onClick={() => setRevokeDiscordDialogOpen(true)}
											disabled={revokeDiscord.isPending}
											size="sm"
											showIcon={false}
										>
											<XCircle className="h-4 w-4" />
											Revoke Authorization
										</Button>
									</>
								)}
								<Button
									variant="destructive"
									onClick={() => setUnlinkDiscordDialogOpen(true)}
									disabled={unlinkDiscord.isPending}
									size="sm"
									showIcon={false}
								>
									<Trash2 className="h-4 w-4" />
									Unlink Discord Account
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							<div className="flex items-center gap-3">
								<div className="flex items-center justify-center w-12 h-12 rounded-full bg-[hsl(var(--discord-blurple))]">
									<MessageSquare className="h-6 w-6 text-white" />
								</div>
								<div>
									<div className="flex items-center gap-2">
										<p className="font-semibold text-lg">
											{user.discord.username}
											{user.discord.discriminator !== '0' && `#${user.discord.discriminator}`}
										</p>
										{activeDiscordBlacklist && (
											<Badge variant="destructive" className="gap-1">
												<ShieldBan className="h-3 w-3" />
												Blocklisted
											</Badge>
										)}
									</div>
									<p className="text-sm text-muted-foreground">Discord ID: {user.discord.userId}</p>
								</div>
							</div>

							{activeDiscordBlacklist && (
								<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
									<div className="flex items-start gap-2">
										<ShieldBan className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
										<div>
											<p className="text-sm text-destructive font-medium">
												Discord Account Blocklisted
											</p>
											<p className="text-sm text-destructive/90 mt-1">
												This Discord account is blocked from accessing the platform.
												{activeDiscordBlacklist.isAutoBlacklist && (
													<span> Auto-blocked due to associated user blocklist.</span>
												)}
											</p>
										</div>
									</div>
								</div>
							)}

							{user.discord.authRevoked && (
								<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
									<div className="flex items-start gap-2">
										<AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
										<div>
											<p className="text-sm text-destructive font-medium">Authorization Revoked</p>
											<p className="text-sm text-destructive/90 mt-1">
												User's Discord authorization was revoked on{' '}
												{user.discord.authRevokedAt
													? formatDateTime(user.discord.authRevokedAt)
													: 'unknown date'}
											</p>
										</div>
									</div>
								</div>
							)}

							<div className="grid grid-cols-2 gap-4 pt-2">
								<div>
									<div className="text-sm text-muted-foreground">Authorization Status</div>
									<div className="text-sm font-medium">
										{user.discord.authRevoked ? (
											<Badge variant="destructive">Revoked</Badge>
										) : (
											<Badge variant="success">Active</Badge>
										)}
									</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">Last Successful Auth</div>
									<div className="text-sm font-medium">
										{user.discord.lastSuccessfulAuth
											? formatRelativeTime(user.discord.lastSuccessfulAuth)
											: 'Never'}
									</div>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Mumble Services */}
			{isMumbleFeatureEnabled &&
				!isLoadingMumbleFeature &&
				!isLoadingMumbleAccount &&
				mumbleAccountData?.account && (
					<Card>
						<CardHeader>
							<CardTitle>Services</CardTitle>
							<CardDescription>Mumble account status and admin controls</CardDescription>
						</CardHeader>
						<CardContent>
							<Card variant="flat" className="border-border/50">
								<CardContent className="p-4">
									<div className="flex flex-col gap-4">
										<div className="flex items-start justify-between gap-4">
											<div className="flex items-center gap-3 min-w-0">
												<div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
													<Mic className="h-6 w-6 text-muted-foreground" />
												</div>
												<div className="min-w-0">
													<div className="flex flex-wrap items-center gap-2">
														<p className="font-semibold text-lg">Mumble</p>
														<Badge
															variant="default"
															className={cn(
																'text-xs',
																mumbleAccountData.account.enabled
																	? 'bg-green-500/20 text-green-500'
																	: 'bg-muted text-muted-foreground'
															)}
														>
															{mumbleAccountData.account.enabled ? 'Active' : 'Disabled'}
														</Badge>
													</div>
													<p className="text-sm text-muted-foreground">
														Login: {mumbleAccountData.account.loginName}
													</p>
													<p className="text-xs text-muted-foreground">
														Display: {mumbleAccountData.account.displayName}
													</p>
												</div>
											</div>
											<div className="flex items-center gap-2">
												<Button
													variant="primary"
													size="sm"
													onClick={handleSyncMumbleGroups}
													disabled={syncMumbleGroups.isPending}
													showIcon={false}
												>
													<RefreshCw
														className={cn('h-4 w-4', syncMumbleGroups.isPending && 'animate-spin')}
													/>
													Sync Groups
												</Button>
												<Button
													variant="destructive"
													size="sm"
													onClick={() => setDeleteMumbleDialogOpen(true)}
													disabled={deleteMumbleAccount.isPending}
													showIcon={false}
												>
													<Trash2 className="h-4 w-4" />
													Delete Account
												</Button>
											</div>
										</div>

										<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
											<div>
												<div className="text-xs uppercase tracking-wide text-muted-foreground">
													Status
												</div>
												<div className="text-sm font-medium mt-1">
													{mumbleAccountData.account.enabled ? 'Enabled' : 'Disabled'}
												</div>
											</div>
											<div>
												<div className="text-xs uppercase tracking-wide text-muted-foreground">
													Groups
												</div>
												<div className="text-sm font-medium mt-1">
													{mumbleAccountData.account.groups.length}
												</div>
											</div>
											<div>
												<div className="text-xs uppercase tracking-wide text-muted-foreground">
													Connection
												</div>
												<div className="text-sm font-medium mt-1 flex items-center gap-1">
													<Server className="h-3.5 w-3.5 text-muted-foreground" />
													<span>
														{mumbleAccountData.connection.host}:{mumbleAccountData.connection.port}
													</span>
												</div>
											</div>
											<div>
												<div className="text-xs uppercase tracking-wide text-muted-foreground">
													Last Auth
												</div>
												<div className="text-sm font-medium mt-1">
													{mumbleAccountData.account.lastAuthenticatedAt
														? formatRelativeTime(mumbleAccountData.account.lastAuthenticatedAt)
														: 'Never'}
												</div>
											</div>
										</div>
									</div>
								</CardContent>
							</Card>
						</CardContent>
					</Card>
				)}

			{/* Blacklist Information */}
			{activeBlacklist && (
				<Card className="border-red-500/20 bg-red-500/5">
					<CardHeader>
						<CardTitle className="text-red-500">Blocklist Status</CardTitle>
						<CardDescription>This user has been blocklisted</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
								<div className="flex items-start gap-2">
									<AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
									<div className="flex-1">
										<p className="text-sm font-medium text-destructive mb-2">Reason:</p>
										<p className="text-sm text-foreground">{activeBlacklist.reason}</p>
									</div>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<div className="text-sm text-muted-foreground">Blocklisted On</div>
									<div className="text-sm font-medium">
										{formatDateTime(activeBlacklist.createdAt)}
									</div>
									<div className="text-xs text-muted-foreground">
										{formatRelativeTime(activeBlacklist.createdAt)}
									</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">Type</div>
									<div className="text-sm font-medium">
										{activeBlacklist.isAutoBlacklist ? (
											<Badge variant="default" className="bg-orange-500/20 text-orange-500">
												Auto-Blocklisted
											</Badge>
										) : (
											<Badge variant="destructive">Manual Blocklist</Badge>
										)}
									</div>
								</div>
							</div>

							{activeBlacklist.isAutoBlacklist && activeBlacklist.triggeredBy && (
								<div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
									<div className="flex items-start gap-2">
										<AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
										<div className="space-y-1">
											<p className="text-sm text-orange-500 font-medium">
												Automatically Blocklisted
											</p>
											{triggeringEntry ? (
												<p className="text-sm text-orange-500/90">
													Triggered by a{' '}
													<span className="font-medium">
														{TARGET_TYPE_LABELS[triggeringEntry.targetType]}
													</span>{' '}
													blocklist on{' '}
													<span className="font-mono">{triggeringEntry.targetValue}</span>.{' '}
													<Link to="/admin/blacklist" className="underline hover:text-orange-400">
														View blocklist
													</Link>
												</p>
											) : (
												<p className="text-sm text-orange-500/90">
													This user was automatically blocklisted due to a linked blocklist entry.{' '}
													<Link to="/admin/blacklist" className="underline hover:text-orange-400">
														View blocklist
													</Link>
												</p>
											)}
										</div>
									</div>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Characters */}
			<Card>
				<CardHeader>
					<CardTitle>Characters</CardTitle>
					<CardDescription>All characters associated with this user account</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Character</TableHead>
								<TableHead>Corporation</TableHead>
								<TableHead>Token Status</TableHead>
								<TableHead>Added</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{user.characters.map((character) => (
								<TableRow
									key={character.characterId}
									className="cursor-pointer"
									onClick={() =>
										navigate(`/character/${character.characterId}`, {
											state: {
												source: 'admin-user-detail',
												backTo: `/admin/users/${userId}`,
												backLabel: 'Back to User Details',
											},
										})
									}
								>
									<TableCell>
										<div className="flex items-center gap-3">
											<MemberAvatar
												characterId={character.characterId}
												characterName={character.characterName}
												isBlacklisted={character.isBlacklisted}
												size="auto"
												className="h-10 w-10 rounded-full"
											/>
											<div>
												<div
													className={cn('font-medium', character.isBlacklisted && 'text-red-500')}
												>
													{character.characterName}
												</div>
												<div className="text-xs text-muted-foreground">{character.characterId}</div>
												<div className="mt-1 flex gap-2">
													{character.is_primary && <Badge variant="default">Primary</Badge>}
													{character.isBlacklisted && (
														<Badge variant="destructive">
															<ShieldBan className="h-3 w-3 mr-1" />
															Blocklisted
														</Badge>
													)}
												</div>
											</div>
										</div>
									</TableCell>
									<TableCell>
										<div className="text-sm">
											{character.corporationId &&
											managedCorporationIds.has(character.corporationId) ? (
												<Link
													to={corporationLinkForCurrentUser(character.corporationId)}
													className="font-medium underline-offset-2 hover:underline"
												>
													{character.corporationName || 'Unknown'}
												</Link>
											) : (
												<div className="font-medium">{character.corporationName || 'Unknown'}</div>
											)}
											{character.corporationId && (
												<div className="text-xs text-muted-foreground">
													{character.corporationId}
												</div>
											)}
										</div>
									</TableCell>
									<TableCell>
										<div className="text-sm">
											{character.hasValidToken ? (
												<Badge variant="success">Valid</Badge>
											) : (
												<Badge variant="destructive">Invalid</Badge>
											)}
										</div>
									</TableCell>
									<TableCell>
										<div className="text-sm" title={formatDateTime(character.linkedAt)}>
											{formatRelativeTime(character.linkedAt)}
										</div>
									</TableCell>
									<TableCell className="text-right">
										<div
											className="flex items-center justify-end gap-2"
											onClick={(event) => event.stopPropagation()}
										>
											<Link
												to={`/character/${character.characterId}`}
												state={{
													source: 'admin-user-detail',
													backTo: `/admin/users/${userId}`,
													backLabel: 'Back to User Details',
												}}
											>
												<Button variant="ghost" size="sm">
													<ExternalLink className="h-4 w-4" />
												</Button>
											</Link>
											{!character.is_primary && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleSetPrimaryClick(character.characterId)}
													disabled={setPrimaryCharacter.isPending}
													title="Set as primary character"
												>
													<CheckCircle className="h-4 w-4 text-green-500" />
												</Button>
											)}
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleDeleteCharacterClick(character.characterId)}
												disabled={
													deleteCharacter.isPending ||
													(character.is_primary && user.characters.length === 1)
												}
											>
												<Trash2 className="h-4 w-4 text-destructive" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<IpHistoryCard
				title="IP History"
				entries={ipHistoryData?.entries ?? []}
				buildHashInspectionLink={(ipHash) =>
					`/admin/ip-history/${encodeURIComponent(ipHash)}?userId=${encodeURIComponent(user.id)}`
				}
			/>

			{/* Admin Toggle Confirmation Dialog */}
			<Dialog open={adminDialogOpen} onOpenChange={setAdminDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{user.is_admin ? 'Revoke Admin Privileges' : 'Grant Admin Privileges'}
						</DialogTitle>
						<DialogDescription>
							{user.is_admin
								? `Are you sure you want to revoke admin privileges for ${primaryCharacterName}? They will lose access to all admin features.`
								: `Are you sure you want to grant admin privileges to ${primaryCharacterName}? They will have full access to all admin features.`}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setAdminDialogOpen(false)}
							disabled={setUserAdmin.isPending}
						>
							Cancel
						</Button>
						{user.is_admin ? (
							<Button
								variant="destructive"
								onClick={handleToggleAdmin}
								loading={setUserAdmin.isPending}
								showIcon={false}
								loadingText="Revoking..."
							>
								<ShieldOff className="h-4 w-4" />
								Revoke Admin
							</Button>
						) : (
							<Button
								variant="confirm"
								onClick={handleToggleAdmin}
								loading={setUserAdmin.isPending}
								loadingText="Granting..."
								showIcon={false}
							>
								<Shield className="h-4 w-4" />
								Grant Admin
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Revoke Discord Authorization Confirmation Dialog */}
			<Dialog open={revokeDiscordDialogOpen} onOpenChange={setRevokeDiscordDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Revoke Discord Authorization</DialogTitle>
						<DialogDescription>
							Are you sure you want to revoke Discord authorization for {primaryCharacterName}? This
							will mark their Discord account as unauthorized and they will need to re-link it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setRevokeDiscordDialogOpen(false)}
							disabled={revokeDiscord.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleRevokeDiscordConfirm}
							loading={revokeDiscord.isPending}
							loadingText="Revoking..."
							showIcon={false}
						>
							<XCircle className="h-4 w-4" />
							Revoke Authorization
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Unlink Discord Account Confirmation Dialog */}
			<Dialog open={unlinkDiscordDialogOpen} onOpenChange={setUnlinkDiscordDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Unlink Discord Account</DialogTitle>
						<DialogDescription>
							Are you sure you want to completely unlink the Discord account for{' '}
							{primaryCharacterName}? This action will:
							<ul className="list-disc list-inside mt-2 space-y-1">
								<li>Remove the Discord link from their account</li>
								<li>Delete all Discord tokens</li>
								<li>Remove them from all managed Discord servers</li>
							</ul>
							<strong className="block mt-2">
								They will need to re-link Discord from scratch.
							</strong>
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setUnlinkDiscordDialogOpen(false)}
							disabled={unlinkDiscord.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleUnlinkDiscordConfirm}
							loading={unlinkDiscord.isPending}
							loadingText="Unlinking..."
							showIcon={false}
						>
							<Trash2 className="h-4 w-4" />
							Unlink Discord Account
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Mumble Account Confirmation Dialog */}
			<ConfirmationDialog
				open={deleteMumbleDialogOpen}
				title="Delete Mumble Account"
				description={`Are you sure you want to delete the Mumble account for ${primaryCharacterName}? This will remove the user's voice account from the Mumble control plane and clear access to the service. If the control plane is temporarily unavailable, the deletion may be queued for retry.`}
				confirmLabel="Delete Mumble Account"
				intent="destructive"
				pending={deleteMumbleAccount.isPending}
				onCancel={() => setDeleteMumbleDialogOpen(false)}
				onConfirm={handleDeleteMumbleConfirm}
			/>

			{/* Clear Sessions Confirmation Dialog */}
			<Dialog open={clearSessionsDialogOpen} onOpenChange={setClearSessionsDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Clear All Sessions</DialogTitle>
						<DialogDescription>
							Are you sure you want to clear all active sessions for {primaryCharacterName}? This
							will force them to re-authenticate on all devices.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setClearSessionsDialogOpen(false)}
							disabled={clearSessions.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleClearSessionsConfirm}
							loading={clearSessions.isPending}
							loadingText="Clearing..."
							showIcon={false}
						>
							<LogOut className="h-4 w-4" />
							Clear Sessions
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Sync User Confirmation Dialog */}
			<Dialog open={syncUserDialogOpen} onOpenChange={setSyncUserDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Sync User Data</DialogTitle>
						<DialogDescription>
							Are you sure you want to trigger a data sync for {primaryCharacterName}? This will
							refresh all character data, authenticated data, and role assignments. The sync runs in
							the background and may take a few minutes to complete.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setSyncUserDialogOpen(false)}
							disabled={syncUser.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="confirm"
							onClick={handleSyncUserConfirm}
							loading={syncUser.isPending}
							loadingText="Triggering..."
							showIcon={false}
						>
							<RefreshCw className="h-4 w-4" />
							Sync User
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Character Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Character</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete "{selectedCharacterData?.characterName}"? This action
							cannot be undone. The character will be removed from the user's account.
							{selectedCharacterData?.is_primary && (
								<div className="mt-2 text-destructive font-semibold">
									Warning: This is the user's primary character. A new primary will be automatically
									selected.
								</div>
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedCharacter(null)
							}}
							disabled={deleteCharacter.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteCharacterConfirm}
							loading={deleteCharacter.isPending}
							loadingText="Deleting..."
							showIcon={false}
						>
							<Trash2 className="h-4 w-4" />
							Delete Character
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Set Primary Character Confirmation Dialog */}
			<Dialog open={primaryDialogOpen} onOpenChange={setPrimaryDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Set Primary Character</DialogTitle>
						<DialogDescription>
							Are you sure you want to set "{selectedCharacterData?.characterName}" as the primary
							character for {primaryCharacterName}? This will change the user's main character and
							update their display name throughout the system.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => {
								setPrimaryDialogOpen(false)
								setSelectedCharacter(null)
							}}
							disabled={setPrimaryCharacter.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="confirm"
							onClick={handleSetPrimaryConfirm}
							loading={setPrimaryCharacter.isPending}
							loadingText="Setting..."
							showIcon={false}
						>
							<CheckCircle className="h-4 w-4" />
							Set as Primary
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Discord Access Update Results Dialog */}
			<Dialog open={updateDiscordDialogOpen} onOpenChange={setUpdateDiscordDialogOpen}>
				<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Discord Access Update Results</DialogTitle>
						<DialogDescription>
							Results of updating Discord server access for {primaryCharacterName}
						</DialogDescription>
					</DialogHeader>
					{discordUpdateResults && (
						<div className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
									<div className="text-sm text-muted-foreground">Servers Joined</div>
									<div className="text-2xl font-bold text-green-500">
										{discordUpdateResults.totalInvited ?? 0}
									</div>
								</div>
								<div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
									<div className="text-sm text-muted-foreground">Servers Updated</div>
									<div className="text-2xl font-bold text-blue-500">
										{discordUpdateResults.totalUpdated ?? 0}
									</div>
								</div>
								<div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
									<div className="text-sm text-muted-foreground">Failed</div>
									<div className="text-2xl font-bold text-red-500">
										{discordUpdateResults.totalFailed ?? 0}
									</div>
								</div>
							</div>

							{(discordUpdateResults.results ?? []).length > 0 && (
								<div className="space-y-2">
									<div className="text-sm font-semibold">Server Details</div>
									{(discordUpdateResults.results ?? []).map((result, index) => (
										<div
											key={`${result.guildId}-${index}`}
											className={cn(
												'p-3 rounded-lg border',
												result.success
													? 'bg-green-500/5 border-green-500/20'
													: 'bg-red-500/5 border-red-500/20'
											)}
										>
											<div className="flex items-start justify-between gap-3">
												<div className="flex-1">
													<div className="font-medium">{result.guildName}</div>
													<div className="text-sm text-muted-foreground">
														{result.corporationName}
													</div>
													{result.errorMessage && (
														<div className="text-sm text-red-500 mt-1">{result.errorMessage}</div>
													)}
													{result.alreadyMember && (
														<div className="text-sm text-muted-foreground mt-1">
															Already a member
														</div>
													)}
													{result.operation && (
														<div className="text-xs text-muted-foreground mt-1">
															Operation: {result.operation}
														</div>
													)}
													{result.attemptedRoleNames && result.attemptedRoleNames.length > 0 && (
														<div className="mt-2">
															<div className="text-xs font-medium text-blue-600">
																Attempted Roles
															</div>
															<div className="text-xs font-mono break-all text-muted-foreground">
																{result.attemptedRoleNames.join(', ')}
															</div>
														</div>
													)}
													{result.roleNamesAdded && result.roleNamesAdded.length > 0 && (
														<div className="mt-2">
															<div className="text-xs font-medium text-green-600">Roles Added</div>
															<div className="text-xs font-mono break-all text-muted-foreground">
																{result.roleNamesAdded.join(', ')}
															</div>
														</div>
													)}
													{result.roleNamesRemoved && result.roleNamesRemoved.length > 0 && (
														<div className="mt-2">
															<div className="text-xs font-medium text-amber-600">
																Roles Removed
															</div>
															<div className="text-xs font-mono break-all text-muted-foreground">
																{result.roleNamesRemoved.join(', ')}
															</div>
														</div>
													)}
												</div>
												<Badge
													variant="ghost"
													className={
														result.success
															? 'border-green-500 text-green-500'
															: 'border-red-500 text-red-500'
													}
												>
													{result.success ? 'Success' : 'Failed'}
												</Badge>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					)}
					<DialogFooter>
						<Button
							onClick={() => {
								setUpdateDiscordDialogOpen(false)
								setDiscordUpdateResults(null)
							}}
						>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Blacklist User Dialog */}
			<Dialog open={blacklistDialogOpen} onOpenChange={setBlacklistDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Blocklist User</DialogTitle>
						<DialogDescription>
							Blocklist {primaryCharacterName}. This will immediately disable all services and
							prevent login. This action can be reversed.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="blacklist-reason">Reason *</Label>
							<Textarea
								id="blacklist-reason"
								placeholder="Enter the reason for blocklisting this user..."
								value={blacklistReason}
								onChange={(e) => setBlacklistReason(e.target.value)}
								rows={4}
							/>
							<p className="text-xs text-muted-foreground">
								This reason will be visible to other administrators.
							</p>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => {
								setBlacklistDialogOpen(false)
								setBlacklistReason('')
							}}
							disabled={createBlacklist.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleBlacklistConfirm}
							loading={createBlacklist.isPending}
							loadingText="Blocklisting..."
							showIcon={false}
						>
							<ShieldBan className="h-4 w-4" />
							Blocklist User
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Remove Blacklist Dialog */}
			<Dialog open={removeBlacklistDialogOpen} onOpenChange={setRemoveBlacklistDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove from Blocklist</DialogTitle>
						<DialogDescription>
							Are you sure you want to remove {primaryCharacterName} from the blocklist? They will
							regain access to all services immediately.
						</DialogDescription>
					</DialogHeader>
					{activeBlacklist && (
						<div className="bg-muted/50 border rounded-lg p-3 my-2">
							<p className="text-sm text-muted-foreground mb-1">Current blocklist reason:</p>
							<p className="text-sm">{activeBlacklist.reason}</p>
						</div>
					)}
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setRemoveBlacklistDialogOpen(false)}
							disabled={removeBlacklist.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="confirm"
							onClick={handleRemoveBlacklistConfirm}
							loading={removeBlacklist.isPending}
							loadingText="Removing..."
							showIcon={false}
						>
							<ShieldBan className="h-4 w-4" />
							Remove from Blocklist
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Add Note Dialog */}
			<AddHRNoteDialog
				open={addNoteDialogOpen}
				onOpenChange={setAddNoteDialogOpen}
				subjectUserId={user.id}
				subjectCharacterName={primaryCharacter?.characterName}
				onSuccess={() => {
					setMessage({ type: 'success', text: 'Note added successfully' })
					setTimeout(() => setMessage(null), 3000)
				}}
			/>
		</div>
	)
}
