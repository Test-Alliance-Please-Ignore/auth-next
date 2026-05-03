import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
	AlertTriangle,
	ArrowLeft,
	Bot,
	CheckCircle,
	ExternalLink,
	History,
	LogOut,
	MessageSquare,
	Plus,
	RefreshCw,
	Shield,
	ShieldBan,
	ShieldOff,
	Trash2,
	Users,
	XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
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
import {
	useAdminUser,
	useClearUserSessions,
	useDeleteUserCharacter,
	useRevokeDiscordLink,
	useSetUserAdmin,
	useSetUserPrimaryCharacter,
	useSyncUser,
	useUnlinkDiscordAccount,
	useUpdateDiscordAccess,
} from '@/hooks/useAdminUsers'
import { useCorporations } from '@/hooks/useCorporations'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import { characterPortraitUrl } from '@/lib/eve-images'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import type { BlacklistTargetType } from '@/lib/api'

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

	const { data: user, isLoading, refetch } = useAdminUser(userId!)
	const setUserAdmin = useSetUserAdmin()
	const deleteCharacter = useDeleteUserCharacter()
	const setPrimaryCharacter = useSetUserPrimaryCharacter()
	const revokeDiscord = useRevokeDiscordLink()
	const unlinkDiscord = useUnlinkDiscordAccount()
	const clearSessions = useClearUserSessions()
	const syncUser = useSyncUser()
	const updateDiscordAccess = useUpdateDiscordAccess()
	const { data: managedCorporations = [] } = useCorporations()
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
			queryClient.invalidateQueries({ queryKey: ['userBlacklists', userId] })
			queryClient.invalidateQueries({ queryKey: ['adminUser', userId] })
		},
	})

	const removeBlacklist = useMutation({
		mutationFn: (id: string) => api.removeBlacklistEntry(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['userBlacklists', userId] })
			queryClient.invalidateQueries({ queryKey: ['adminUser', userId] })
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
	const [blacklistDialogOpen, setBlacklistDialogOpen] = useState(false)
	const [removeBlacklistDialogOpen, setRemoveBlacklistDialogOpen] = useState(false)
	const [blacklistReason, setBlacklistReason] = useState('')
	const [addNoteDialogOpen, setAddNoteDialogOpen] = useState(false)
	const [discordUpdateResults, setDiscordUpdateResults] = useState<{
		results: Array<{
			guildId: string
			guildName: string
			corporationName: string
			success: boolean
			errorMessage?: string
			alreadyMember?: boolean
			rolesAdded?: string[]
			rolesRemoved?: string[]
			attemptedRoleIds?: string[]
			operation?: 'invite' | 'update' | 'revoke-ban'
		}>
		totalInvited: number
		totalUpdated: number
		totalFailed: number
	} | null>(null)
	const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null)

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Fetch HR notes for this user
	const { data: hrNotes = [], isLoading: notesLoading } = useHRNotes({
		subjectUserId: userId!,
	})

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
			setMessage({
				type: 'success',
				text: `Discord access updated! Joined ${results.totalInvited} server(s), ${results.totalFailed} failed.`,
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

	const handleBlacklistConfirm = async () => {
		if (!blacklistReason.trim()) {
			setMessage({
				type: 'error',
				text: 'Please provide a reason for blacklisting',
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
				text: 'User has been blacklisted successfully',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to blacklist user',
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
				text: 'User has been removed from blacklist',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to remove blacklist',
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
						<Link to={`/admin/users/${user.id}/groups`}>
							<Users className="h-4 w-4" />
							Group Memberships
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
						<img
							src={characterPortraitUrl(user.mainCharacterId, 128)}
							alt={user.characters.find((c) => c.is_primary)?.characterName || 'Unknown'}
							className="h-24 w-24 rounded-full"
						/>
						<div className="flex-1">
							<div className="flex items-start justify-between">
								<div>
									<div className="flex items-center justify-between gap-2">
										<h2 className="text-2xl font-bold">
											{user.characters.find((c) => c.is_primary)?.characterName || 'Unknown'}
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
											Blacklisted
										</Badge>
									)}
									{user.is_admin ? (
										<Button variant="destructive"
											onClick={() => setAdminDialogOpen(true)}
											disabled={setUserAdmin.isPending}
											size="sm"
											showIcon={false}
										>
											<ShieldOff className="h-4 w-4" />
											Revoke Admin
										</Button>
									) : (
										<Button variant="destructive"
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
											Remove from Blacklist
										</Button>
									) : (
										<Button variant="destructive"
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
												💩 Blacklist User
											</span>
										</Button>
									)}
									<Button variant="destructive"
										onClick={() => setClearSessionsDialogOpen(true)}
										disabled={clearSessions.isPending}
										size="sm"
										showIcon={false}
									>
										<LogOut className="h-4 w-4" />
										Clear Sessions
									</Button>
									<Button variant="primary"
										onClick={() => setSyncUserDialogOpen(true)}
										disabled={syncUser.isPending}
										size="sm"
									>
										<RefreshCw
											className={cn('h-4 w-4', syncUser.isPending && 'animate-spin')}
										/>
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
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Admin Notes</CardTitle>
							<CardDescription>Private notes about this user (admin only)</CardDescription>
						</div>
						<Button onClick={() => setAddNoteDialogOpen(true)} size="sm">
							<Plus className="h-4 w-4" />
							Add Note
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{notesLoading ? (
						<div className="text-center py-4 text-muted-foreground">Loading notes...</div>
					) : hrNotes.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
							No notes yet. Add a note to track important information about this user.
						</div>
					) : (
						<div className="space-y-4">
							{hrNotes.map((note) => (
								<HRNoteCard key={note.id} note={note} />
							))}
						</div>
					)}
				</CardContent>
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
										<Button variant="primary"
											onClick={handleUpdateDiscordAccess}
											disabled={updateDiscordAccess.isPending}
											size="sm"
										>
											<RefreshCw
												className={cn(
													'h-4 w-4',
													updateDiscordAccess.isPending && 'animate-spin'
												)}
											/>
											Update Discord Access
										</Button>
										<Button variant="destructive"
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
								<Button variant="destructive"
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
												Blacklisted
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
											<p className="text-sm text-destructive font-medium">Discord Account Blacklisted</p>
											<p className="text-sm text-destructive/90 mt-1">
												This Discord account is blocked from accessing the platform.
												{activeDiscordBlacklist.isAutoBlacklist && (
													<span> Auto-blocked due to associated user blacklist.</span>
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
											<Badge variant="destructive">
												Revoked
											</Badge>
										) : (
											<Badge variant="success">
												Active
											</Badge>
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

			{/* Blacklist Information */}
			{activeBlacklist && (
				<Card className="border-red-500/20 bg-red-500/5">
					<CardHeader>
						<CardTitle className="text-red-500">Blacklist Status</CardTitle>
						<CardDescription>This user has been blacklisted</CardDescription>
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
									<div className="text-sm text-muted-foreground">Blacklisted On</div>
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
												Auto-Blacklisted
											</Badge>
										) : (
											<Badge variant="destructive">
												Manual Blacklist
											</Badge>
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
												Automatically Blacklisted
											</p>
											{triggeringEntry ? (
												<p className="text-sm text-orange-500/90">
													Triggered by a{' '}
													<span className="font-medium">
														{TARGET_TYPE_LABELS[triggeringEntry.targetType]}
													</span>{' '}
													blacklist on{' '}
													<span className="font-mono">
														{triggeringEntry.targetValue}
													</span>
													.{' '}
													<Link to="/admin/blacklist" className="underline hover:text-orange-400">
														View blacklist
													</Link>
												</p>
											) : (
												<p className="text-sm text-orange-500/90">
													This user was automatically blacklisted due to a linked blacklist entry.{' '}
													<Link to="/admin/blacklist" className="underline hover:text-orange-400">
														View blacklist
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
									onClick={() => navigate(`/character/${character.characterId}`)}
								>
										<TableCell>
											<div className="flex items-center gap-3">
												<img
												src={characterPortraitUrl(character.characterId, 64)}
												alt={character.characterName}
												className="h-10 w-10 rounded-full"
											/>
												<div>
													<div className="font-medium">{character.characterName}</div>
													<div className="text-xs text-muted-foreground">{character.characterId}</div>
													<div className="mt-1 flex gap-2">
														{character.is_primary && (
															<Badge variant="default">Primary</Badge>
														)}
														{character.isBlacklisted && (
															<Badge variant="destructive">
																<ShieldBan className="h-3 w-3 mr-1" />
																Blacklisted
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
														to={`/admin/corporations/${character.corporationId}`}
														className="font-medium underline-offset-2 hover:underline"
													>
														{character.corporationName || 'Unknown'}
													</Link>
												) : (
													<div className="font-medium">
														{character.corporationName || 'Unknown'}
													</div>
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
												<Badge variant="success">
													Valid
												</Badge>
											) : (
												<Badge variant="destructive">
													Invalid
												</Badge>
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
											<Link to={`/character/${character.characterId}`}>
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

			{/* Admin Toggle Confirmation Dialog */}
			<Dialog open={adminDialogOpen} onOpenChange={setAdminDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{user.is_admin ? 'Revoke Admin Privileges' : 'Grant Admin Privileges'}
						</DialogTitle>
						<DialogDescription>
							{user.is_admin
								? `Are you sure you want to revoke admin privileges for ${user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? They will lose access to all admin features.`
								: `Are you sure you want to grant admin privileges to ${user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? They will have full access to all admin features.`}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel"
							onClick={() => setAdminDialogOpen(false)}
							disabled={setUserAdmin.isPending}
						>
							Cancel
						</Button>
						{user.is_admin ? (
							<Button variant="destructive"
								onClick={handleToggleAdmin}
								loading={setUserAdmin.isPending}
								showIcon={false}
								loadingText="Revoking..."
							>
								<ShieldOff className="h-4 w-4" />
								Revoke Admin
							</Button>
						) : (
							<Button variant="confirm"
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
							Are you sure you want to revoke Discord authorization for{' '}
							{user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? This will
							mark their Discord account as unauthorized and they will need to re-link it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel"
							onClick={() => setRevokeDiscordDialogOpen(false)}
							disabled={revokeDiscord.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive"
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
							{user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? This action
							will:
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
						<Button variant="cancel"
							onClick={() => setUnlinkDiscordDialogOpen(false)}
							disabled={unlinkDiscord.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive"
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

			{/* Clear Sessions Confirmation Dialog */}
			<Dialog open={clearSessionsDialogOpen} onOpenChange={setClearSessionsDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Clear All Sessions</DialogTitle>
						<DialogDescription>
							Are you sure you want to clear all active sessions for{' '}
							{user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? This will
							force them to re-authenticate on all devices.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel"
							onClick={() => setClearSessionsDialogOpen(false)}
							disabled={clearSessions.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive"
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
							Are you sure you want to trigger a data sync for{' '}
							{user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? This will
							refresh all character data, authenticated data, and role assignments. The sync runs in
							the background and may take a few minutes to complete.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel"
							onClick={() => setSyncUserDialogOpen(false)}
							disabled={syncUser.isPending}
						>
							Cancel
						</Button>
						<Button variant="confirm"
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
						<Button variant="cancel"
							onClick={() => {
								setDeleteDialogOpen(false)
								setSelectedCharacter(null)
							}}
							disabled={deleteCharacter.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive"
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
							character for{' '}
							{user.characters.find((c) => c.is_primary)?.characterName || 'this user'}? This will
							change the user's main character and update their display name throughout the system.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel"
							onClick={() => {
								setPrimaryDialogOpen(false)
								setSelectedCharacter(null)
							}}
							disabled={setPrimaryCharacter.isPending}
						>
							Cancel
						</Button>
						<Button variant="confirm"
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
							Results of updating Discord server access for{' '}
							{user.characters.find((c) => c.is_primary)?.characterName || 'this user'}
						</DialogDescription>
					</DialogHeader>
					{discordUpdateResults && (
						<div className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
									<div className="text-sm text-muted-foreground">Servers Joined</div>
									<div className="text-2xl font-bold text-green-500">
										{discordUpdateResults.totalInvited}
									</div>
								</div>
								<div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
									<div className="text-sm text-muted-foreground">Servers Updated</div>
									<div className="text-2xl font-bold text-blue-500">
										{discordUpdateResults.totalUpdated}
									</div>
								</div>
								<div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
									<div className="text-sm text-muted-foreground">Failed</div>
									<div className="text-2xl font-bold text-red-500">
										{discordUpdateResults.totalFailed}
									</div>
								</div>
							</div>

							{discordUpdateResults.results.length > 0 && (
								<div className="space-y-2">
									<div className="text-sm font-semibold">Server Details</div>
									{discordUpdateResults.results.map((result, index) => (
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
													{result.attemptedRoleIds && result.attemptedRoleIds.length > 0 && (
														<div className="mt-2">
															<div className="text-xs font-medium text-blue-600">
																Attempted Role IDs
															</div>
															<div className="text-xs font-mono break-all text-muted-foreground">
																{result.attemptedRoleIds.join(', ')}
															</div>
														</div>
													)}
													{result.rolesAdded && result.rolesAdded.length > 0 && (
														<div className="mt-2">
															<div className="text-xs font-medium text-green-600">Role IDs Added</div>
															<div className="text-xs font-mono break-all text-muted-foreground">
																{result.rolesAdded.join(', ')}
															</div>
														</div>
													)}
													{result.rolesRemoved && result.rolesRemoved.length > 0 && (
														<div className="mt-2">
															<div className="text-xs font-medium text-amber-600">
																Role IDs Removed
															</div>
															<div className="text-xs font-mono break-all text-muted-foreground">
																{result.rolesRemoved.join(', ')}
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
						<DialogTitle>Blacklist User</DialogTitle>
						<DialogDescription>
							Blacklist {user.characters.find((c) => c.is_primary)?.characterName || 'this user'}.
							This will immediately disable all services and prevent login. This action can be
							reversed.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="blacklist-reason">Reason *</Label>
							<Textarea
								id="blacklist-reason"
								placeholder="Enter the reason for blacklisting this user..."
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
						<Button variant="cancel"
							onClick={() => {
								setBlacklistDialogOpen(false)
								setBlacklistReason('')
							}}
							disabled={createBlacklist.isPending}
						>
							Cancel
						</Button>
						<Button variant="destructive"
							onClick={handleBlacklistConfirm}
							loading={createBlacklist.isPending}
							loadingText="Blacklisting..."
							showIcon={false}
						>
							<ShieldBan className="h-4 w-4" />
							Blacklist User
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Remove Blacklist Dialog */}
			<Dialog open={removeBlacklistDialogOpen} onOpenChange={setRemoveBlacklistDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove from Blacklist</DialogTitle>
						<DialogDescription>
							Are you sure you want to remove{' '}
							{user.characters.find((c) => c.is_primary)?.characterName || 'this user'} from the
							blacklist? They will regain access to all services immediately.
						</DialogDescription>
					</DialogHeader>
					{activeBlacklist && (
						<div className="bg-muted/50 border rounded-lg p-3 my-2">
							<p className="text-sm text-muted-foreground mb-1">Current blacklist reason:</p>
							<p className="text-sm">{activeBlacklist.reason}</p>
						</div>
					)}
					<DialogFooter>
						<Button variant="cancel"
							onClick={() => setRemoveBlacklistDialogOpen(false)}
							disabled={removeBlacklist.isPending}
						>
							Cancel
						</Button>
						<Button variant="confirm"
							onClick={handleRemoveBlacklistConfirm}
							loading={removeBlacklist.isPending}
							loadingText="Removing..."
							showIcon={false}
						>
							<ShieldBan className="h-4 w-4" />
							Remove from Blacklist
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Add Note Dialog */}
			<AddHRNoteDialog
				open={addNoteDialogOpen}
				onOpenChange={setAddNoteDialogOpen}
				subjectUserId={user.id}
				subjectCharacterName={user.characters.find((c) => c.is_primary)?.characterName}
				onSuccess={() => {
					setMessage({ type: 'success', text: 'Note added successfully' })
					setTimeout(() => setMessage(null), 3000)
				}}
			/>
		</div>
	)
}
