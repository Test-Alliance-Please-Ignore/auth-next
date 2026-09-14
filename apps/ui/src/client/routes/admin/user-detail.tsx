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
import { Trans } from 'react-i18next'
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
import { formatList, formatNumber, useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import type { AppTranslationKey } from '@/i18n'
import type { BlacklistTargetType, DiscordRefreshOutput } from '@/lib/api'

const discordOperationKeys = {
	invite: 'admin.users.discord.operations.invite',
	update: 'admin.users.discord.operations.update',
	'revoke-ban': 'admin.users.discord.operations.revoke-ban',
} as const

const TARGET_TYPE_KEYS: Record<BlacklistTargetType, AppTranslationKey> = {
	user: 'admin.users.blocklist.targets.user',
	character_id: 'admin.users.blocklist.targets.character_id',
	character_name: 'admin.users.blocklist.targets.character_name',
	discord_id: 'admin.users.blocklist.targets.discord_id',
	corporation_id: 'admin.users.blocklist.targets.corporation_id',
	corporation_name: 'admin.users.blocklist.targets.corporation_name',
	alliance_id: 'admin.users.blocklist.targets.alliance_id',
	alliance_name: 'admin.users.blocklist.targets.alliance_name',
}

export default function UserDetailPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.users.account.pageTitle'))
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
	const [message, setMessage] = useState<{
		type: 'success' | 'error'
		key: AppTranslationKey
		values?: Record<string, unknown>
		detail?: string
	} | null>(null)

	// Fetch HR notes for this user
	const { data: hrNotes = [], isLoading: notesLoading } = useHRNotes({
		subjectUserId: userId!,
	})

	const primaryCharacter =
		user?.characters.find((character) => character.is_primary) ?? user?.characters[0] ?? null
	const primaryCharacterName = primaryCharacter?.characterName || t('admin.users.account.thisUser')
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
						{t('admin.users.account.back')}
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">
					{t('admin.users.account.loading')}
				</div>
			</div>
		)
	}

	if (!user) {
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/users')}>
						<ArrowLeft className="h-4 w-4" />
						{t('admin.users.account.back')}
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">
					{t('admin.users.account.notFound')}
				</div>
			</div>
		)
	}

	const handleToggleAdmin = async () => {
		try {
			await setUserAdmin.mutateAsync({ userId: user.id, isAdmin: !user.is_admin })
			setAdminDialogOpen(false)
			setMessage({
				type: 'success',
				key: user.is_admin
					? 'admin.users.feedback.adminRevoked'
					: 'admin.users.feedback.adminGranted',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.adminError',
				detail: error instanceof Error ? error.message : undefined,
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
				key: 'admin.users.feedback.onlyCharacter',
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
				key: 'admin.users.feedback.characterDeleted',
				values: { name: character?.characterName },
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.characterDeleteError',
				detail: error instanceof Error ? error.message : undefined,
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
				key: 'admin.users.feedback.primarySet',
				values: { name: character?.characterName },
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.primaryError',
				detail: error instanceof Error ? error.message : undefined,
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
				key: 'admin.users.feedback.discordRevoked',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.discordRevokeError',
				detail: error instanceof Error ? error.message : undefined,
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
				key: 'admin.users.feedback.discordUnlinked',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.discordUnlinkError',
				detail: error instanceof Error ? error.message : undefined,
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
				key: 'admin.users.feedback.sessionsCleared',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.sessionsError',
				detail: error instanceof Error ? error.message : undefined,
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
				key: 'admin.users.feedback.syncStarted',
			})
			setTimeout(() => setMessage(null), 5000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.syncError',
				detail: error instanceof Error ? error.message : undefined,
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
				key:
					results.status === 'failed'
						? results.error?.message
							? 'admin.users.feedback.discordFailedDetail'
							: 'admin.users.feedback.discordFailed'
						: 'admin.users.feedback.discordUpdated',
				values: { error: results.error?.message, joined: totalInvited, failed: totalFailed },
			})
			setTimeout(() => setMessage(null), 5000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.discordUpdateError',
				detail: error instanceof Error ? error.message : undefined,
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleSyncMumbleGroups = async () => {
		try {
			const result = await syncMumbleGroups.mutateAsync(user.id)
			setMessage({
				type: 'success',
				key: 'admin.users.feedback.mumbleSynced',
				values: { updated: result.synced.length, skipped: result.skipped.length },
			})
			setTimeout(() => setMessage(null), 4000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.mumbleSyncError',
				detail: error instanceof Error ? error.message : undefined,
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
				key:
					result.queued.length > 0
						? 'admin.users.feedback.mumbleDeleteQueued'
						: 'admin.users.feedback.mumbleDeleted',
			})
			setTimeout(() => setMessage(null), 4000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.mumbleDeleteError',
				detail: error instanceof Error ? error.message : undefined,
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleBlacklistConfirm = async () => {
		if (!blacklistReason.trim()) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.blocklistReason',
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
				key: 'admin.users.feedback.blocklisted',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.blocklistError',
				detail: error instanceof Error ? error.message : undefined,
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
				key: 'admin.users.feedback.blocklistRemoved',
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				key: 'admin.users.feedback.blocklistRemoveError',
				detail: error instanceof Error ? error.message : undefined,
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
						{t('admin.users.account.backToUsers')}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						aria-label={t('admin.users.account.refresh')}
						onClick={() => refetch()}
					>
						<RefreshCw className="h-4 w-4" />
					</Button>
				</div>
				<div className="flex gap-2">
					<Button variant="ghost" asChild>
						<Link to={`/admin/users/${user.id}/discord-access`}>
							<Bot className="h-4 w-4" />
							{t('admin.users.account.discordAccess')}
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link to={`/admin/users/${user.id}/oauth-inspection`}>
							<ExternalLink className="h-4 w-4" />
							{t('admin.users.account.oauthResolver')}
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link to={`/admin/users/${user.id}/groups`}>
							<Users className="h-4 w-4" />
							{t('admin.users.account.memberships')}
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link
							to={`/admin/legacy-migrations?userId=${encodeURIComponent(user.id)}&autoRecheck=1`}
							target="_blank"
							rel="noopener noreferrer"
						>
							<RefreshCw className="h-4 w-4" />
							{t('admin.users.account.legacyData')}
						</Link>
					</Button>
					<Button variant="ghost" asChild>
						<Link to={`/admin/users/${user.id}/activity`}>
							<History className="h-4 w-4" />
							{t('admin.nav.activityLog')}
						</Link>
					</Button>
				</div>
			</div>

			{/* Page Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">{t('admin.users.account.title')}</h1>
				<p className="text-muted-foreground mt-1">{t('admin.users.account.description')}</p>
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
							{message.detail ?? t(message.key, message.values)}
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
								{t('admin.users.account.noCharacters')}
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
											{primaryCharacterName || t('admin.users.account.unknown')}
										</h2>
										{user.is_admin && (
											<Badge variant="default">
												<Shield className="h-3 w-3 mr-1" />
												{t('admin.shell.admin')}
											</Badge>
										)}
									</div>
									<p className="text-sm text-muted-foreground mt-1">
										{t('admin.users.account.userId', { id: user.id })}
									</p>
								</div>
								<div className="flex items-center gap-2">
									{activeBlacklist && (
										<Badge variant="destructive">
											<ShieldBan className="h-3 w-3 mr-1" />
											{t('admin.users.account.blocklisted')}
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
											{t('admin.users.account.revokeAdmin')}
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
											{t('admin.users.account.grantAdmin')}
										</Button>
									)}
									{activeBlacklist ? (
										<Button
											variant="cancel"
											size="sm"
											onClick={() => setRemoveBlacklistDialogOpen(true)}
											disabled={removeBlacklist.isPending}
										>
											{t('admin.users.account.removeBlocklist')}
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
												{t('admin.users.account.blocklistButton')}
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
										{t('admin.users.account.clearSessions')}
									</Button>
									<Button
										variant="primary"
										onClick={() => setSyncUserDialogOpen(true)}
										disabled={syncUser.isPending}
										size="sm"
									>
										<RefreshCw className={cn('h-4 w-4', syncUser.isPending && 'animate-spin')} />
										{t('admin.users.account.syncUser')}
									</Button>
								</div>
							</div>

							<div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
								<div>
									<div className="text-sm text-muted-foreground">
										{t('admin.users.account.characters')}
									</div>
									<div className="text-lg font-semibold">
										{formatNumber(user.characters.length)}
									</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">
										{t('admin.users.account.lastUpdated')}
									</div>
									<div className="text-sm font-medium" title={formatDateTime(user.updatedAt)}>
										{formatRelativeTime(user.updatedAt)}
									</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">
										{t('admin.users.account.created')}
									</div>
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
									<CardTitle>{t('admin.users.account.accountNotes', { count: 0 })}</CardTitle>
									<CardDescription>{t('admin.users.account.notesDescription')}</CardDescription>
								</div>
								<Button onClick={() => setAddNoteDialogOpen(true)} size="sm">
									<MessageSquarePlus className="h-4 w-4" />
									{t('admin.users.account.addNote')}
								</Button>
							</div>
						</CardHeader>
						<CardContent>
							{notesLoading ? (
								<div className="text-center py-4 text-muted-foreground">
									{t('admin.users.account.loadingNotes')}
								</div>
							) : (
								<div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
									{t('admin.users.account.noNotes')}
								</div>
							)}
						</CardContent>
					</>
				) : (
					<details className="group">
						<summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
							<div>
								<CardTitle>
									{t('admin.users.account.accountNotes', { count: hrNotes.length })}
								</CardTitle>
								<CardDescription className="mt-1">
									{t('admin.users.account.notesDescription')}
								</CardDescription>
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
									{t('admin.users.account.addNote')}
								</Button>
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<span className="group-open:hidden">{t('admin.users.account.expand')}</span>
									<span className="hidden group-open:inline">
										{t('admin.users.account.collapse')}
									</span>
									<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
								</div>
							</div>
						</summary>
						<CardContent className="pt-0">
							{notesLoading ? (
								<div className="text-center py-4 text-muted-foreground">
									{t('admin.users.account.loadingNotes')}
								</div>
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
								<CardTitle>{t('admin.users.discord.account')}</CardTitle>
								<CardDescription>{t('admin.users.discord.accountDescription')}</CardDescription>
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
											{t('admin.users.discord.updateAccess')}
										</Button>
										<Button
											variant="destructive"
											onClick={() => setRevokeDiscordDialogOpen(true)}
											disabled={revokeDiscord.isPending}
											size="sm"
											showIcon={false}
										>
											<XCircle className="h-4 w-4" />
											{t('admin.users.discord.revoke')}
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
									{t('admin.users.discord.unlink')}
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
												{t('admin.users.account.blocklisted')}
											</Badge>
										)}
									</div>
									<p className="text-sm text-muted-foreground">
										{t('admin.users.discord.id', { id: user.discord.userId })}
									</p>
								</div>
							</div>

							{activeDiscordBlacklist && (
								<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
									<div className="flex items-start gap-2">
										<ShieldBan className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
										<div>
											<p className="text-sm text-destructive font-medium">
												{t('admin.users.discord.blocklisted')}
											</p>
											<p className="text-sm text-destructive/90 mt-1">
												{t('admin.users.discord.blocklistedDescription')}{' '}
												{activeDiscordBlacklist.isAutoBlacklist && (
													<span> {t('admin.users.discord.autoBlocked')}</span>
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
											<p className="text-sm text-destructive font-medium">
												{t('admin.users.discord.authorizationRevoked')}
											</p>
											<p className="text-sm text-destructive/90 mt-1">
												{t('admin.users.discord.revokedAt', {
													date: user.discord.authRevokedAt
														? formatDateTime(user.discord.authRevokedAt)
														: t('admin.users.account.unknownDate'),
												})}
											</p>
										</div>
									</div>
								</div>
							)}

							<div className="grid grid-cols-2 gap-4 pt-2">
								<div>
									<div className="text-sm text-muted-foreground">
										{t('admin.users.discord.authorizationStatus')}
									</div>
									<div className="text-sm font-medium">
										{user.discord.authRevoked ? (
											<Badge variant="destructive">{t('admin.users.discord.revoked')}</Badge>
										) : (
											<Badge variant="success">{t('admin.users.account.active')}</Badge>
										)}
									</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">
										{t('admin.users.discord.lastAuth')}
									</div>
									<div className="text-sm font-medium">
										{user.discord.lastSuccessfulAuth
											? formatRelativeTime(user.discord.lastSuccessfulAuth)
											: t('admin.users.account.never')}
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
							<CardTitle>{t('admin.users.services.title')}</CardTitle>
							<CardDescription>{t('admin.users.services.description')}</CardDescription>
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
															{mumbleAccountData.account.enabled
																? t('admin.users.account.active')
																: t('admin.users.account.disabled')}
														</Badge>
													</div>
													<p className="text-sm text-muted-foreground">
														{t('admin.users.services.login', {
															name: mumbleAccountData.account.loginName,
														})}
													</p>
													<p className="text-xs text-muted-foreground">
														{t('admin.users.services.display', {
															name: mumbleAccountData.account.displayName,
														})}
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
													{t('admin.users.services.syncGroups')}
												</Button>
												<Button
													variant="destructive"
													size="sm"
													onClick={() => setDeleteMumbleDialogOpen(true)}
													disabled={deleteMumbleAccount.isPending}
													showIcon={false}
												>
													<Trash2 className="h-4 w-4" />
													{t('admin.users.services.deleteAccount')}
												</Button>
											</div>
										</div>

										<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
											<div>
												<div className="text-xs uppercase tracking-wide text-muted-foreground">
													{t('admin.users.account.status')}
												</div>
												<div className="text-sm font-medium mt-1">
													{mumbleAccountData.account.enabled
														? t('admin.users.account.enabled')
														: t('admin.users.account.disabled')}
												</div>
											</div>
											<div>
												<div className="text-xs uppercase tracking-wide text-muted-foreground">
													{t('admin.nav.groups')}
												</div>
												<div className="text-sm font-medium mt-1">
													{formatNumber(mumbleAccountData.account.groups.length)}
												</div>
											</div>
											<div>
												<div className="text-xs uppercase tracking-wide text-muted-foreground">
													{t('admin.users.services.connection')}
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
													{t('admin.users.services.lastAuth')}
												</div>
												<div className="text-sm font-medium mt-1">
													{mumbleAccountData.account.lastAuthenticatedAt
														? formatRelativeTime(mumbleAccountData.account.lastAuthenticatedAt)
														: t('admin.users.account.never')}
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
						<CardTitle className="text-red-500">{t('admin.users.blocklist.status')}</CardTitle>
						<CardDescription>{t('admin.users.blocklist.description')}</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							<div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
								<div className="flex items-start gap-2">
									<AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
									<div className="flex-1">
										<p className="text-sm font-medium text-destructive mb-2">
											{t('admin.users.blocklist.reason')}
										</p>
										<p className="text-sm text-foreground">{activeBlacklist.reason}</p>
									</div>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<div className="text-sm text-muted-foreground">
										{t('admin.users.blocklist.created')}
									</div>
									<div className="text-sm font-medium">
										{formatDateTime(activeBlacklist.createdAt)}
									</div>
									<div className="text-xs text-muted-foreground">
										{formatRelativeTime(activeBlacklist.createdAt)}
									</div>
								</div>
								<div>
									<div className="text-sm text-muted-foreground">
										{t('admin.users.blocklist.type')}
									</div>
									<div className="text-sm font-medium">
										{activeBlacklist.isAutoBlacklist ? (
											<Badge variant="default" className="bg-orange-500/20 text-orange-500">
												{t('admin.users.blocklist.auto')}
											</Badge>
										) : (
											<Badge variant="destructive">{t('admin.users.blocklist.manual')}</Badge>
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
												{t('admin.users.blocklist.automatic')}
											</p>
											{triggeringEntry ? (
												<p className="text-sm text-orange-500/90">
													<Trans
														i18nKey="admin.users.blocklist.trigger"
														values={{
															type: t(TARGET_TYPE_KEYS[triggeringEntry.targetType]),
															value: triggeringEntry.targetValue,
														}}
														components={{
															kind: <span className="font-medium" />,
															value: <span className="font-mono" />,
														}}
													/>{' '}
													<Link to="/admin/blacklist" className="underline hover:text-orange-400">
														{t('admin.users.blocklist.view')}
													</Link>
												</p>
											) : (
												<p className="text-sm text-orange-500/90">
													{t('admin.users.blocklist.linkedEntry')}{' '}
													<Link to="/admin/blacklist" className="underline hover:text-orange-400">
														{t('admin.users.blocklist.view')}
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
					<CardTitle>{t('admin.users.account.characters')}</CardTitle>
					<CardDescription>{t('admin.users.account.characterDescription')}</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t('admin.users.account.character')}</TableHead>
								<TableHead>{t('admin.users.account.corporation')}</TableHead>
								<TableHead>{t('admin.users.account.tokenStatus')}</TableHead>
								<TableHead>{t('admin.users.account.added')}</TableHead>
								<TableHead className="text-right">{t('admin.fields.actions')}</TableHead>
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
												backLabel: t('admin.users.account.backToDetails'),
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
													{character.is_primary && (
														<Badge variant="default">{t('admin.users.account.primary')}</Badge>
													)}
													{character.isBlacklisted && (
														<Badge variant="destructive">
															<ShieldBan className="h-3 w-3 mr-1" />
															{t('admin.users.account.blocklisted')}
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
													{character.corporationName || t('admin.users.account.unknown')}
												</Link>
											) : (
												<div className="font-medium">
													{character.corporationName || t('admin.users.account.unknown')}
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
												<Badge variant="success">{t('admin.users.account.valid')}</Badge>
											) : (
												<Badge variant="destructive">{t('admin.users.account.invalid')}</Badge>
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
													backLabel: t('admin.users.account.backToDetails'),
												}}
											>
												<Button
													variant="ghost"
													size="sm"
													aria-label={t('admin.users.account.viewCharacter')}
												>
													<ExternalLink className="h-4 w-4" />
												</Button>
											</Link>
											{!character.is_primary && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleSetPrimaryClick(character.characterId)}
													disabled={setPrimaryCharacter.isPending}
													title={t('admin.users.account.setPrimaryAction')}
												>
													<CheckCircle className="h-4 w-4 text-green-500" />
												</Button>
											)}
											<Button
												variant="ghost"
												size="sm"
												aria-label={t('admin.users.account.deleteCharacter')}
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
				title={t('admin.users.ip.title')}
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
							{user.is_admin
								? t('admin.users.confirm.revokeAdminTitle')
								: t('admin.users.confirm.grantAdminTitle')}
						</DialogTitle>
						<DialogDescription>
							{user.is_admin
								? t('admin.users.confirm.revokeAdmin', { name: primaryCharacterName })
								: t('admin.users.confirm.grantAdmin', { name: primaryCharacterName })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setAdminDialogOpen(false)}
							disabled={setUserAdmin.isPending}
						>
							{t('common.cancel')}
						</Button>
						{user.is_admin ? (
							<Button
								variant="destructive"
								onClick={handleToggleAdmin}
								loading={setUserAdmin.isPending}
								showIcon={false}
								loadingText={t('admin.users.account.revoking')}
							>
								<ShieldOff className="h-4 w-4" />
								{t('admin.users.account.revokeAdmin')}
							</Button>
						) : (
							<Button
								variant="confirm"
								onClick={handleToggleAdmin}
								loading={setUserAdmin.isPending}
								loadingText={t('admin.users.account.granting')}
								showIcon={false}
							>
								<Shield className="h-4 w-4" />
								{t('admin.users.account.grantAdmin')}
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Revoke Discord Authorization Confirmation Dialog */}
			<Dialog open={revokeDiscordDialogOpen} onOpenChange={setRevokeDiscordDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.users.confirm.revokeDiscordTitle')}</DialogTitle>
						<DialogDescription>
							{t('admin.users.confirm.revokeDiscord', { name: primaryCharacterName })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setRevokeDiscordDialogOpen(false)}
							disabled={revokeDiscord.isPending}
						>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleRevokeDiscordConfirm}
							loading={revokeDiscord.isPending}
							loadingText={t('admin.users.account.revoking')}
							showIcon={false}
						>
							<XCircle className="h-4 w-4" />
							{t('admin.users.discord.revoke')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Unlink Discord Account Confirmation Dialog */}
			<Dialog open={unlinkDiscordDialogOpen} onOpenChange={setUnlinkDiscordDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.users.discord.unlink')}</DialogTitle>
						<DialogDescription>
							{t('admin.users.confirm.unlinkDiscord', { name: primaryCharacterName })}
							<ul className="list-disc list-inside mt-2 space-y-1">
								<li>{t('admin.users.confirm.unlinkRemove')}</li>
								<li>{t('admin.users.confirm.unlinkTokens')}</li>
								<li>{t('admin.users.confirm.unlinkServers')}</li>
							</ul>
							<strong className="block mt-2">{t('admin.users.confirm.unlinkRelink')}</strong>
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setUnlinkDiscordDialogOpen(false)}
							disabled={unlinkDiscord.isPending}
						>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleUnlinkDiscordConfirm}
							loading={unlinkDiscord.isPending}
							loadingText={t('admin.users.account.unlinking')}
							showIcon={false}
						>
							<Trash2 className="h-4 w-4" />
							{t('admin.users.discord.unlink')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Mumble Account Confirmation Dialog */}
			<ConfirmationDialog
				open={deleteMumbleDialogOpen}
				title={t('admin.users.confirm.deleteMumbleTitle')}
				description={t('admin.users.confirm.deleteMumble', { name: primaryCharacterName })}
				confirmLabel={t('admin.users.confirm.deleteMumbleTitle')}
				intent="destructive"
				pending={deleteMumbleAccount.isPending}
				onCancel={() => setDeleteMumbleDialogOpen(false)}
				onConfirm={handleDeleteMumbleConfirm}
			/>

			{/* Clear Sessions Confirmation Dialog */}
			<Dialog open={clearSessionsDialogOpen} onOpenChange={setClearSessionsDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.users.confirm.clearSessionsTitle')}</DialogTitle>
						<DialogDescription>
							{t('admin.users.confirm.clearSessions', { name: primaryCharacterName })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setClearSessionsDialogOpen(false)}
							disabled={clearSessions.isPending}
						>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleClearSessionsConfirm}
							loading={clearSessions.isPending}
							loadingText={t('admin.users.account.clearing')}
							showIcon={false}
						>
							<LogOut className="h-4 w-4" />
							{t('admin.users.account.clearSessions')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Sync User Confirmation Dialog */}
			<Dialog open={syncUserDialogOpen} onOpenChange={setSyncUserDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.users.confirm.syncTitle')}</DialogTitle>
						<DialogDescription>
							{t('admin.users.confirm.sync', { name: primaryCharacterName })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setSyncUserDialogOpen(false)}
							disabled={syncUser.isPending}
						>
							{t('common.cancel')}
						</Button>
						<Button
							variant="confirm"
							onClick={handleSyncUserConfirm}
							loading={syncUser.isPending}
							loadingText={t('admin.users.account.triggering')}
							showIcon={false}
						>
							<RefreshCw className="h-4 w-4" />
							{t('admin.users.account.syncUser')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Character Confirmation Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.users.account.deleteCharacter')}</DialogTitle>
						<DialogDescription>
							{t('admin.users.confirm.deleteCharacter', {
								name: selectedCharacterData?.characterName,
							})}
							{selectedCharacterData?.is_primary && (
								<div className="mt-2 text-destructive font-semibold">
									{t('admin.users.confirm.deletePrimaryWarning')}
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
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteCharacterConfirm}
							loading={deleteCharacter.isPending}
							loadingText={t('admin.users.account.deleting')}
							showIcon={false}
						>
							<Trash2 className="h-4 w-4" />
							{t('admin.users.account.deleteCharacter')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Set Primary Character Confirmation Dialog */}
			<Dialog open={primaryDialogOpen} onOpenChange={setPrimaryDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.users.confirm.setPrimaryTitle')}</DialogTitle>
						<DialogDescription>
							{t('admin.users.confirm.setPrimary', {
								character: selectedCharacterData?.characterName,
								name: primaryCharacterName,
							})}
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
							{t('common.cancel')}
						</Button>
						<Button
							variant="confirm"
							onClick={handleSetPrimaryConfirm}
							loading={setPrimaryCharacter.isPending}
							loadingText={t('admin.users.account.setting')}
							showIcon={false}
						>
							<CheckCircle className="h-4 w-4" />
							{t('admin.users.account.setPrimary')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Discord Access Update Results Dialog */}
			<Dialog open={updateDiscordDialogOpen} onOpenChange={setUpdateDiscordDialogOpen}>
				<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{t('admin.users.discord.updateResults')}</DialogTitle>
						<DialogDescription>
							{t('admin.users.discord.resultsDescription', { name: primaryCharacterName })}
						</DialogDescription>
					</DialogHeader>
					{discordUpdateResults && (
						<div className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
									<div className="text-sm text-muted-foreground">
										{t('admin.users.discord.serversJoined')}
									</div>
									<div className="text-2xl font-bold text-green-500">
										{formatNumber(discordUpdateResults.totalInvited ?? 0)}
									</div>
								</div>
								<div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
									<div className="text-sm text-muted-foreground">
										{t('admin.users.discord.serversUpdated')}
									</div>
									<div className="text-2xl font-bold text-blue-500">
										{formatNumber(discordUpdateResults.totalUpdated ?? 0)}
									</div>
								</div>
								<div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
									<div className="text-sm text-muted-foreground">
										{t('admin.users.discord.failed')}
									</div>
									<div className="text-2xl font-bold text-red-500">
										{formatNumber(discordUpdateResults.totalFailed ?? 0)}
									</div>
								</div>
							</div>

							{(discordUpdateResults.results ?? []).length > 0 && (
								<div className="space-y-2">
									<div className="text-sm font-semibold">
										{t('admin.users.discord.serverDetails')}
									</div>
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
															{t('admin.users.discord.alreadyMember')}
														</div>
													)}
													{result.operation && (
														<div className="text-xs text-muted-foreground mt-1">
															{t('admin.users.discord.operation', {
																operation: t(discordOperationKeys[result.operation]),
															})}
														</div>
													)}
													{result.attemptedRoleNames && result.attemptedRoleNames.length > 0 && (
														<div className="mt-2">
															<div className="text-xs font-medium text-blue-600">
																{t('admin.users.discord.attemptedRoles')}
															</div>
															<div className="text-xs font-mono break-all text-muted-foreground">
																{formatList(result.attemptedRoleNames)}
															</div>
														</div>
													)}
													{result.roleNamesAdded && result.roleNamesAdded.length > 0 && (
														<div className="mt-2">
															<div className="text-xs font-medium text-green-600">
																{t('admin.users.discord.rolesAdded')}
															</div>
															<div className="text-xs font-mono break-all text-muted-foreground">
																{formatList(result.roleNamesAdded)}
															</div>
														</div>
													)}
													{result.roleNamesRemoved && result.roleNamesRemoved.length > 0 && (
														<div className="mt-2">
															<div className="text-xs font-medium text-amber-600">
																{t('admin.users.discord.rolesRemoved')}
															</div>
															<div className="text-xs font-mono break-all text-muted-foreground">
																{formatList(result.roleNamesRemoved)}
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
													{result.success
														? t('admin.users.discord.success')
														: t('admin.users.discord.failed')}
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
							{t('common.close')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Blacklist User Dialog */}
			<Dialog open={blacklistDialogOpen} onOpenChange={setBlacklistDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.users.account.blocklistUser')}</DialogTitle>
						<DialogDescription>
							{t('admin.users.confirm.blocklist', { name: primaryCharacterName })}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="blacklist-reason">{t('admin.users.blocklist.reasonRequired')}</Label>
							<Textarea
								id="blacklist-reason"
								placeholder={t('admin.users.blocklist.reasonPlaceholder')}
								value={blacklistReason}
								onChange={(e) => setBlacklistReason(e.target.value)}
								rows={4}
							/>
							<p className="text-xs text-muted-foreground">
								{t('admin.users.blocklist.reasonVisibility')}
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
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleBlacklistConfirm}
							loading={createBlacklist.isPending}
							loadingText={t('admin.users.account.blocklisting')}
							showIcon={false}
						>
							<ShieldBan className="h-4 w-4" />
							{t('admin.users.account.blocklistUser')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Remove Blacklist Dialog */}
			<Dialog open={removeBlacklistDialogOpen} onOpenChange={setRemoveBlacklistDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.users.account.removeBlocklist')}</DialogTitle>
						<DialogDescription>
							{t('admin.users.confirm.removeBlocklist', { name: primaryCharacterName })}
						</DialogDescription>
					</DialogHeader>
					{activeBlacklist && (
						<div className="bg-muted/50 border rounded-lg p-3 my-2">
							<p className="text-sm text-muted-foreground mb-1">
								{t('admin.users.blocklist.currentReason')}
							</p>
							<p className="text-sm">{activeBlacklist.reason}</p>
						</div>
					)}
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => setRemoveBlacklistDialogOpen(false)}
							disabled={removeBlacklist.isPending}
						>
							{t('common.cancel')}
						</Button>
						<Button
							variant="confirm"
							onClick={handleRemoveBlacklistConfirm}
							loading={removeBlacklist.isPending}
							loadingText={t('admin.users.account.removing')}
							showIcon={false}
						>
							<ShieldBan className="h-4 w-4" />
							{t('admin.users.account.removeBlocklist')}
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
					setMessage({ type: 'success', key: 'admin.users.feedback.noteAdded' })
					setTimeout(() => setMessage(null), 3000)
				}}
			/>
		</div>
	)
}
