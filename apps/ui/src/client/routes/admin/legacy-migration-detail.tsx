import { useEffect, useMemo, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, User } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingInline } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api, type LegacyMigrationCandidateCharacter, type LegacyMigrationCandidateNote } from '@/lib/api'

type SelectionState = {
	characterIds: Set<string>
	noteIds: Set<string>
	importIpAssociations: boolean
	applyBlacklistToUser: boolean
	markSkipped: boolean
}

function parseConflicts(conflicts: Record<string, unknown>): {
	multiMatch: boolean
	crossUserCount: number
	hasBlacklist: boolean
} {
	const crossMatches =
		Array.isArray(conflicts.crossModernUserQueueMatches) ? conflicts.crossModernUserQueueMatches : []
	const blacklistSignals =
		conflicts && typeof conflicts.blacklistSignals === 'object'
			? (conflicts.blacklistSignals as Record<string, unknown>)
			: null
	const hasBlacklist =
		Boolean(blacklistSignals?.hasAnyBlacklistSignal) ||
		Boolean(blacklistSignals?.modernUserBlacklisted) ||
		(Array.isArray(blacklistSignals?.matchedTargets) && blacklistSignals.matchedTargets.length > 0)
	return {
		multiMatch: Boolean(conflicts.multipleLegacyUsersForModernUser),
		crossUserCount: crossMatches.length,
		hasBlacklist,
	}
}

function formatDiscoverySource(source: 'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'): string {
	switch (source) {
		case 'legacy_direct':
			return 'Legacy Character Match'
		case 'legacy_ip_association':
			return 'Legacy IP Association'
		case 'tang_direct':
			return 'TANG Character Match'
		case 'tang_ip_association':
			return 'TANG IP Association'
	}
}

function formatPreferredSource(source: 'legacy' | 'tang'): string {
	return source === 'tang' ? 'Source: TANG' : 'Source: Legacy'
}

function formatEntryMode(mode: 'manual' | 'automatic' | null): string {
	if (mode === 'manual') return 'Mode: Manual'
	if (mode === 'automatic') return 'Mode: Automatic'
	return 'Mode: Unknown'
}

function parseBlacklistAlerts(conflicts: Record<string, unknown>): {
	hasAnyBlacklistSignal: boolean
	modernUserBlacklisted: boolean
	matches: Array<{
		key: string
		label: string
		subLabel: string | null
		targetType: string
		entryMode: 'manual' | 'automatic' | null
		reason: string | null
		blacklistedBy: string | null
		createdAt: string | null
		discoverySources: Array<'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'>
		preferredSource: 'legacy' | 'tang'
	}>
	discordMatches: string[]
	ipAssociatedMatches: Array<{ userId: string; mainCharacterName: string | null }>
} {
	const blacklistSignals =
		conflicts && typeof conflicts.blacklistSignals === 'object'
			? (conflicts.blacklistSignals as Record<string, unknown>)
			: null
	const matchedTargets = Array.isArray(blacklistSignals?.matchedTargets)
		? blacklistSignals.matchedTargets
		: []
	const matchingCharactersBlacklisted = Array.isArray(blacklistSignals?.matchingCharactersBlacklisted)
		? blacklistSignals.matchingCharactersBlacklisted
		: []
	const characterNameById = new Map(
		matchingCharactersBlacklisted
			.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
			.map((value) => {
				const characterId = String(value.characterId ?? '').trim()
				const characterName = String(value.characterName ?? '').trim()
				return [characterId, characterName] as const
			})
			.filter(([characterId, characterName]) => characterId.length > 0 && characterName.length > 0)
	)

	const rawMatches = matchedTargets
		.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
		.map((value) => {
			const parsedEntryMode: 'manual' | 'automatic' | null =
				value.entryMode === 'manual' || value.entryMode === 'automatic' ? value.entryMode : null
			const targetType = String(value.targetType ?? '')
			const targetValue = String(value.targetValue ?? '')
			const preferredSource: 'legacy' | 'tang' =
				value.preferredSource === 'legacy' ? 'legacy' : 'tang'
			const resolvedCharacterName =
				targetType === 'character_id' ? characterNameById.get(targetValue.trim()) ?? null : null
			return {
				key: `${targetType}:${targetValue}`,
				label: resolvedCharacterName ?? targetValue,
				subLabel: resolvedCharacterName ? targetValue : null,
				targetType,
				reason: typeof value.reason === 'string' && value.reason.trim().length > 0 ? value.reason : null,
				entryMode: parsedEntryMode,
				discoverySources: Array.isArray(value.discoverySources)
					? value.discoverySources.filter((source): source is 'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association' =>
						source === 'legacy_direct' ||
						source === 'legacy_ip_association' ||
						source === 'tang_direct' ||
						source === 'tang_ip_association')
					: [],
				preferredSource,
				blacklistedBy:
					typeof value.blacklistedBy === 'string' && value.blacklistedBy.trim().length > 0
						? value.blacklistedBy
						: null,
				createdAt:
					typeof value.createdAt === 'string' && value.createdAt.trim().length > 0
						? value.createdAt
						: null,
			}
		})
		.filter((value) => value.targetType.length > 0 && value.label.length > 0)

	const characterIdMatches = new Set(
		rawMatches
			.filter((match) => match.targetType === 'character_id' && match.subLabel)
			.map((match) => `${match.label.trim().toLowerCase()}`)
	)

	const matches = rawMatches.filter((match) => {
		if (match.targetType !== 'character_name') return true
		return !characterIdMatches.has(match.label.trim().toLowerCase())
	})

	const discordMatches = Array.isArray(blacklistSignals?.matchingDiscordUserIdsBlacklisted)
		? blacklistSignals.matchingDiscordUserIdsBlacklisted
				.map((value) => String(value ?? ''))
				.filter((value) => value.length > 0)
		: []

	const ipAssociatedMatches = Array.isArray(blacklistSignals?.ipAssociatedBlacklistedUsers)
		? blacklistSignals.ipAssociatedBlacklistedUsers
				.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
				.map((value) => ({
					userId: String(value.userId ?? ''),
					mainCharacterName:
						typeof value.mainCharacterName === 'string' && value.mainCharacterName.length > 0
							? value.mainCharacterName
							: null,
				}))
				.filter((value) => value.userId.length > 0)
		: []

	return {
		hasAnyBlacklistSignal: Boolean(blacklistSignals?.hasAnyBlacklistSignal),
		modernUserBlacklisted: Boolean(blacklistSignals?.modernUserBlacklisted),
		matches,
		discordMatches,
		ipAssociatedMatches,
	}
}

function formatLegacyDate(value: string | null): string | null {
	if (!value) return null
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return null
	return date.toLocaleString()
}

function accountStatusVariant(status: string): 'secondary' | 'success' | 'warning' | 'destructive' | 'ghost' {
	if (status === 'applied') return 'success'
	if (status === 'pending') return 'warning'
	if (status === 'partially_applied') return 'secondary'
	if (status === 'error') return 'destructive'
	return 'ghost'
}

function formatTargetType(targetType: string): string {
	switch (targetType) {
		case 'character_id':
			return 'Character ID'
		case 'character_name':
			return 'Character Name'
		case 'discord_user_id':
			return 'Discord User ID'
		case 'corporation_id':
			return 'Corporation ID'
		case 'corporation_name':
			return 'Corporation Name'
		case 'alliance_id':
			return 'Alliance ID'
		case 'alliance_name':
			return 'Alliance Name'
		default:
			return targetType.replace(/_/g, ' ')
	}
}

export default function AdminLegacyMigrationDetailPage() {
	usePageTitle('Admin - Legacy Migration Detail')
	const { modernUserId } = useParams<{ modernUserId: string }>()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const [selectionsByQueueId, setSelectionsByQueueId] = useState<Record<string, SelectionState>>({})

	const queueQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', 'queue-list', modernUserId],
		queryFn: () =>
			api.getLegacyMigrationQueue({
				page: 1,
				pageSize: 250,
				modernUserId: modernUserId as string,
			}),
		enabled: Boolean(modernUserId),
	})

	const detailsQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', 'queue-details', modernUserId, queueQuery.data?.items],
		queryFn: async () => {
			const items = queueQuery.data?.items ?? []
			const details = await Promise.all(items.map((item) => api.getLegacyMigrationQueueItem(item.id)))
			return details
		},
		enabled: Boolean(queueQuery.data?.items?.length),
	})

	const primaryItem = queueQuery.data?.items?.[0]

	const modernUserQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', 'modern-user', modernUserId],
		queryFn: () => api.getAdminUser(modernUserId as string),
		enabled: Boolean(modernUserId),
	})

	const recheckMutation = useMutation({
		mutationFn: () => api.recheckLegacyMigrationQueueUser(modernUserId as string),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migrations'] })
			await queryClient.invalidateQueries({
				queryKey: ['admin', 'legacy-migration-detail', 'queue-list', modernUserId],
			})
			await queueQuery.refetch()
		},
	})

	const applyMutation = useMutation({
		mutationFn: async (queueId: string) => {
			const selection = selectionsByQueueId[queueId]
			return api.applyLegacyMigrationQueueItem(queueId, {
				applyBlacklistToUser: selection?.applyBlacklistToUser ?? false,
				importCharacterLinks: (selection?.characterIds?.size ?? 0) > 0,
				importNotes: (selection?.noteIds?.size ?? 0) > 0,
				importIpAssociations: selection?.importIpAssociations ?? false,
				markSkipped: selection?.markSkipped ?? false,
				characterIds: [...(selection?.characterIds ?? new Set<string>())],
				noteIds: [...(selection?.noteIds ?? new Set<string>())],
			})
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migrations'] })
			await queryClient.invalidateQueries({
				queryKey: ['admin-nav', 'legacy-migrations', 'pending-count'],
			})
			await queryClient.invalidateQueries({
				queryKey: ['admin', 'legacy-migration-detail', 'queue-list', modernUserId],
			})
			await queueQuery.refetch()
			await detailsQuery.refetch()
		},
	})

	const dismissMutation = useMutation({
		mutationFn: (queueId: string) => api.dismissLegacyMigrationQueueItem(queueId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migrations'] })
			await queryClient.invalidateQueries({
				queryKey: ['admin-nav', 'legacy-migrations', 'pending-count'],
			})
			await queryClient.invalidateQueries({
				queryKey: ['admin', 'legacy-migration-detail', 'queue-list', modernUserId],
			})
			await queueQuery.refetch()
			await detailsQuery.refetch()
		},
	})

	const buildDefaultSelection = (
		characters: LegacyMigrationCandidateCharacter[],
		notes: LegacyMigrationCandidateNote[],
		hasBlacklist: boolean
	): SelectionState => ({
		characterIds: new Set(
			characters
				.filter(
					(character) =>
						!character.alreadyLinkedToModernUser &&
						!character.linkedToOtherUserId &&
						!character.isDeleted
				)
				.map((character) => character.characterId)
		),
		noteIds: new Set(notes.filter((note) => !note.alreadyImported).map((note) => note.legacyNoteId)),
		importIpAssociations: true,
		applyBlacklistToUser: hasBlacklist,
		markSkipped: false,
	})

	const allDetails = useMemo(() => detailsQuery.data ?? [], [detailsQuery.data])
	const defaultSelectionsByQueueId = useMemo(
		() =>
			Object.fromEntries(
				allDetails.map((detail) => {
					const conflictSummary = parseConflicts(detail.item.conflicts)
					return [
						detail.item.id,
						buildDefaultSelection(
							detail.candidates.characters,
							detail.candidates.notes,
							conflictSummary.hasBlacklist
						),
					] as const
				})
			),
		[allDetails]
	)
	const updateSelection = (queueId: string, updater: (state: SelectionState) => SelectionState) => {
		setSelectionsByQueueId((prev) => {
			const current =
				prev[queueId] ??
				defaultSelectionsByQueueId[queueId] ??
				({
					characterIds: new Set<string>(),
					noteIds: new Set<string>(),
					importIpAssociations: false,
					applyBlacklistToUser: false,
					markSkipped: false,
				} satisfies SelectionState)
			return { ...prev, [queueId]: updater(current) }
		})
	}
	useEffect(() => {
		setSelectionsByQueueId((prev) => {
			let changed = false
			const next = { ...prev }
			for (const [queueId, defaults] of Object.entries(defaultSelectionsByQueueId)) {
				if (!next[queueId]) {
					next[queueId] = defaults
					changed = true
				}
			}
			for (const queueId of Object.keys(next)) {
				if (!defaultSelectionsByQueueId[queueId]) {
					delete next[queueId]
					changed = true
				}
			}
			return changed ? next : prev
		})
	}, [defaultSelectionsByQueueId])
	const linkedOtherUserIds = useMemo(
		() =>
			Array.from(
				new Set(
					allDetails
						.flatMap((detail) => detail.candidates.characters)
						.map((character) => character.linkedToOtherUserId)
						.filter((value): value is string => Boolean(value))
				)
			),
		[allDetails]
	)
	const linkedOtherUsersQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', modernUserId, 'linked-other-users', linkedOtherUserIds],
		queryFn: async () => {
			const rows = await Promise.all(
				linkedOtherUserIds.map(async (userId) => {
					try {
						const user = await api.getAdminUser(userId)
						const primaryCharacterName =
							user.characters.find((character) => character.is_primary)?.characterName ?? null
						return [userId, primaryCharacterName ?? userId] as const
					} catch {
						return [userId, userId] as const
					}
				})
			)
			return new Map(rows)
		},
		enabled: linkedOtherUserIds.length > 0,
	})
	const linkedOtherUserNameById = linkedOtherUsersQuery.data ?? new Map<string, string>()
	const blacklistAttributorIds = useMemo(
		() =>
			Array.from(
				new Set(
					allDetails
						.flatMap((detail) => parseBlacklistAlerts(detail.item.conflicts).matches)
						.map((match) => match.blacklistedBy)
						.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
				)
			),
		[allDetails]
	)
	const blacklistAttributorsQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', modernUserId, 'blacklist-attributors', blacklistAttributorIds],
		queryFn: async () => {
			const rows = await Promise.all(
				blacklistAttributorIds.map(async (userId) => {
					try {
						const user = await api.getAdminUser(userId)
						const primaryCharacter =
							user.characters.find((character) => character.is_primary)?.characterName ?? null
						return [userId, primaryCharacter ?? userId] as const
					} catch {
						return [userId, userId] as const
					}
				})
			)
			return new Map(rows)
		},
		enabled: blacklistAttributorIds.length > 0,
	})
	const blacklistAttributorNameById = blacklistAttributorsQuery.data ?? new Map<string, string>()
	const legacyActionActorIds = useMemo(
		() =>
			Array.from(
				new Set(
					allDetails
						.flatMap((detail) => detail.actions)
						.map((action) => action.performedByUserId)
						.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
				)
			),
		[allDetails]
	)
	const legacyActionActorsQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', modernUserId, 'action-actors', legacyActionActorIds],
		queryFn: async () => {
			const rows = await Promise.all(
				legacyActionActorIds.map(async (userId) => {
					try {
						const user = await api.getAdminUser(userId)
						const primaryCharacter =
							user.characters.find((character) => character.is_primary)?.characterName ?? null
						return [userId, primaryCharacter ?? userId] as const
					} catch {
						return [userId, userId] as const
					}
				})
			)
			return new Map(rows)
		},
		enabled: legacyActionActorIds.length > 0,
	})
	const legacyActionActorNameById = legacyActionActorsQuery.data ?? new Map<string, string>()

	if (queueQuery.isLoading || detailsQuery.isLoading || !modernUserId) {
		return (
			<div className="space-y-6">
				<Button variant="ghost" onClick={() => navigate('/admin/legacy-migrations')}>
					<ArrowLeft className="h-4 w-4" />
					Back to Legacy Migrations
				</Button>
				<Card>
					<CardContent className="py-6 text-muted-foreground">Loading migration detail...</CardContent>
				</Card>
			</div>
		)
	}

	if (!queueQuery.data?.items.length) {
		return (
			<div className="space-y-6">
				<Button variant="ghost" onClick={() => navigate('/admin/legacy-migrations')}>
					<ArrowLeft className="h-4 w-4" />
					Back to Legacy Migrations
				</Button>
				<Card>
					<CardContent className="py-6 text-muted-foreground">
						No legacy migration queue items found for this user.
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title={
					modernUserQuery.data?.characters.find((character) => character.is_primary)?.characterName ??
					primaryItem?.modernUserMainCharacterName ??
					'Unknown User'
				}
				description={<span className="font-mono text-sm">{modernUserId}</span>}
				action={
					<div className="flex items-center gap-2">
						<Button
							variant="secondary"
							onClick={() => void recheckMutation.mutateAsync()}
							disabled={recheckMutation.isPending}
						>
							{recheckMutation.isPending ? <LoadingInline className="mr-2" /> : null}
							Recheck
						</Button>
						<Button variant="ghost" asChild>
							<Link to={`/admin/users/${modernUserId}`} target="_blank" rel="noopener noreferrer">
								Open User Details
							</Link>
						</Button>
						<Button variant="ghost" asChild>
							<Link to="/admin/legacy-migrations">
								<ArrowLeft className="h-4 w-4" />
								Back to Legacy Migrations
							</Link>
						</Button>
					</div>
				}
			/>

			<Card className="sticky top-2 z-10 border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
				<CardHeader className="pb-2">
					<CardTitle className="text-base">Legacy Accounts</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						{allDetails.map((detail, index) => (
							<Button key={detail.item.id} variant="ghost" size="sm" asChild>
								<a href={`#legacy-account-${detail.item.id}`}>
									<User className="h-3.5 w-3.5" />
									<span className="font-semibold">{detail.item.legacyAuthUserId}</span>
								</a>
							</Button>
						))}
					</div>
				</CardContent>
			</Card>

			{allDetails.map((detail) => {
				const { item, candidates } = detail
				const conflictSummary = parseConflicts(item.conflicts)
				const blacklistAlerts = parseBlacklistAlerts(item.conflicts)
				const selection =
					selectionsByQueueId[item.id] ??
					defaultSelectionsByQueueId[item.id]
				const importSummary = `${selection.characterIds.size} character(s), ${selection.noteIds.size} note(s), ${selection.importIpAssociations ? candidates.ipAddressCount : 0} IP(s) selected`

				return (
					<Card key={item.id} id={`legacy-account-${item.id}`}>
						<CardHeader>
							<CardTitle className="flex flex-wrap items-center gap-2">
								<span>Legacy Account</span>
								<Badge variant="secondary" className="font-mono">
									{item.legacyAuthUserId}
								</Badge>
								<Badge variant={accountStatusVariant(item.status)}>{item.status}</Badge>
								{conflictSummary.hasBlacklist ? <Badge variant="destructive">Blocklist</Badge> : null}
								{conflictSummary.multiMatch ? <Badge variant="warning">Multi-match</Badge> : null}
								{conflictSummary.crossUserCount > 0 ? (
									<Badge variant="destructive">Cross-user ({conflictSummary.crossUserCount})</Badge>
								) : null}
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							{blacklistAlerts.hasAnyBlacklistSignal ? (
								<Card className="border-destructive/60">
									<CardHeader>
										<CardTitle className="text-destructive">Blocklist Alerts</CardTitle>
									</CardHeader>
									<CardContent className="space-y-2">
										{blacklistAlerts.modernUserBlacklisted ? <Badge variant="destructive">Modern user is blocklisted</Badge> : null}
										{blacklistAlerts.discordMatches.length > 0 ? (
											<Badge variant="destructive">Discord ID blocklist match ({blacklistAlerts.discordMatches.length})</Badge>
										) : null}
										{blacklistAlerts.ipAssociatedMatches.length > 0 ? (
											<Badge variant="destructive">
												IP-associated blocklist matches ({blacklistAlerts.ipAssociatedMatches.length})
											</Badge>
										) : null}
										{blacklistAlerts.matches.map((match) => (
											<div key={match.key} className="rounded border border-border/90 bg-card/80 p-2.5 text-sm">
												<div className="flex flex-wrap items-center gap-2">
													<span className="text-base font-semibold text-destructive">
														{match.label}{' '}
														{match.subLabel ? (
															<span className="text-sm font-mono text-destructive/90">({match.subLabel})</span>
														) : null}
													</span>
													<div className="flex flex-wrap items-center gap-1">
														<Badge variant="ghost">{formatTargetType(match.targetType)}</Badge>
														<Badge variant={match.preferredSource === 'tang' ? 'special' : 'warning'}>
															{formatPreferredSource(match.preferredSource)}
														</Badge>
														<Badge variant={match.entryMode === 'automatic' ? 'warning' : 'secondary'}>
															{formatEntryMode(match.entryMode)}
														</Badge>
														{match.discoverySources.map((source) => (
															<Badge
																key={`${match.key}:${source}`}
																variant={
																	source === 'legacy_ip_association' || source === 'tang_ip_association'
																		? 'warning'
																		: source === 'tang_direct'
																			? 'success'
																			: 'default'
																}
															>
																{formatDiscoverySource(source)}
															</Badge>
														))}
													</div>
												</div>
												<div className="mt-1 text-xs text-muted-foreground">
													By:{' '}
													<span className="text-foreground">
														{match.blacklistedBy
															? (blacklistAttributorNameById.get(match.blacklistedBy) ?? match.blacklistedBy)
															: 'unknown'}
													</span>
													{match.blacklistedBy ? (
														<span className="text-muted-foreground font-mono">
															{' '}
															({match.blacklistedBy})
														</span>
													) : null}
													{' • '}
													Date:{' '}
													<span className="text-foreground">
														{match.createdAt ? new Date(match.createdAt).toLocaleString() : 'unknown'}
													</span>
												</div>
												<div className="mt-1 text-xs text-muted-foreground">
													Reason:{' '}
													<span className="text-foreground">
														{match.reason ?? 'unknown'}
													</span>
												</div>
											</div>
										))}
										{blacklistAlerts.ipAssociatedMatches.map((match) => (
											<div key={match.userId} className="text-sm">
												<Badge variant="warning" className="mr-2">IP-linked</Badge>
												{match.mainCharacterName ?? 'Unknown user'}{' '}
												<span className="text-xs text-muted-foreground font-mono">({match.userId})</span>
											</div>
										))}
									</CardContent>
								</Card>
							) : null}

							<div className="space-y-2">
								<div className="text-sm font-medium">Characters</div>
								{candidates.characters.map((character) => (
									<div
										key={`${item.id}:${character.characterId}`}
										className="flex items-center justify-between rounded border border-border/90 bg-card/80 p-2.5"
									>
										<div className="min-w-0">
											<div className="font-medium">{character.characterName}</div>
											<div className="text-xs font-mono text-muted-foreground">{character.characterId}</div>
										</div>
										{character.alreadyLinkedToModernUser ? (
											<Badge variant="success">Already linked</Badge>
										) : character.linkedToOtherUserId ? (
											<div className="text-right">
												<Badge variant="destructive">Linked to other user</Badge>
												<div className="text-xs mt-1">
													<Link
														to={`/admin/users/${character.linkedToOtherUserId}`}
														target="_blank"
														rel="noopener noreferrer"
														className="text-primary hover:underline"
													>
														{linkedOtherUserNameById.get(character.linkedToOtherUserId) ??
															character.linkedToOtherUserId}
													</Link>
												</div>
												<div className="text-xs font-mono text-muted-foreground">
													{character.linkedToOtherUserId}
												</div>
											</div>
										) : character.isDeleted ? (
											<Badge variant="warning">Deleted - not importable</Badge>
										) : (
											<label className="flex items-center gap-2 cursor-pointer rounded border border-border/80 bg-muted/30 px-2 py-1">
												<Checkbox
													checked={selection.characterIds.has(character.characterId)}
													onCheckedChange={() =>
														updateSelection(item.id, (current) => {
															const nextIds = new Set(current.characterIds)
															if (nextIds.has(character.characterId)) nextIds.delete(character.characterId)
															else nextIds.add(character.characterId)
															return { ...current, characterIds: nextIds }
														})
													}
												/>
												<span className="text-sm">Import</span>
											</label>
										)}
									</div>
								))}
							</div>

							<div className="space-y-2">
								<div className="text-sm font-medium">Notes</div>
								{candidates.notes.map((note) => (
									<div
										key={`${item.id}:${note.legacyNoteId}`}
										className="flex items-start justify-between rounded border border-border/90 bg-card/80 p-2.5 gap-3"
									>
										<div className="min-w-0">
											<div className="text-sm whitespace-pre-wrap">{note.note}</div>
											<div className="text-xs text-muted-foreground font-mono mt-1">
												{note.legacyCreatedByCharacterName
													? `by ${note.legacyCreatedByCharacterName}`
													: note.legacyCreatedByUserId
														? `by legacy user ${note.legacyCreatedByUserId}`
														: ''}
											</div>
											{formatLegacyDate(note.legacyDateCreated) ? (
												<div className="text-xs text-muted-foreground font-mono">
													{formatLegacyDate(note.legacyDateCreated)}
												</div>
											) : null}
										</div>
										{note.alreadyImported ? (
											<Badge variant="success">Already imported</Badge>
										) : (
											<label className="flex items-center gap-2 cursor-pointer rounded border border-border/80 bg-muted/30 px-2 py-1">
												<Checkbox
													checked={selection.noteIds.has(note.legacyNoteId)}
													onCheckedChange={() =>
														updateSelection(item.id, (current) => {
															const nextIds = new Set(current.noteIds)
															if (nextIds.has(note.legacyNoteId)) nextIds.delete(note.legacyNoteId)
															else nextIds.add(note.legacyNoteId)
															return { ...current, noteIds: nextIds }
														})
													}
												/>
												<span className="text-sm">Import</span>
											</label>
										)}
									</div>
								))}
							</div>

							<Card>
								<CardHeader>
									<CardTitle className="text-sm">IP Associations</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="flex items-center justify-between rounded border border-border/90 bg-card/80 p-2.5">
										<div className="text-sm">
											Import legacy IP associations
											<span className="text-muted-foreground ml-2">
												({candidates.ipAddressCount} importable)
											</span>
										</div>
										<label className="flex items-center gap-2 cursor-pointer rounded border border-border/80 bg-muted/30 px-2 py-1">
											<Checkbox
												checked={selection.importIpAssociations}
												onCheckedChange={(checked) =>
													updateSelection(item.id, (current) => ({
														...current,
														importIpAssociations: checked === true,
													}))
												}
											/>
											<span className="text-sm">Import</span>
										</label>
									</div>
								</CardContent>
							</Card>

							<div className="rounded border border-border/80 p-3 space-y-3">
								<div className="text-sm text-muted-foreground">{importSummary}</div>
								{conflictSummary.hasBlacklist ? (
									<label className="flex items-center gap-2 cursor-pointer rounded border border-warning/40 bg-warning/10 px-2 py-1">
										<Checkbox
											checked={selection.applyBlacklistToUser}
											onCheckedChange={(checked) =>
												updateSelection(item.id, (current) => ({
													...current,
													applyBlacklistToUser: checked === true,
												}))
											}
										/>
										<span className="text-sm">Apply blocklist to user</span>
									</label>
								) : null}
								<label className="flex items-center gap-2 cursor-pointer">
									<Checkbox
										checked={selection.markSkipped}
										onCheckedChange={(checked) =>
											updateSelection(item.id, (current) => ({
												...current,
												markSkipped: checked === true,
											}))
										}
									/>
									<span className="text-sm">Mark skipped</span>
								</label>
								<div className="flex gap-2">
									<Button
										variant="primary"
										onClick={() =>
											requestConfirmation({
												title: 'Apply Selected Legacy Data?',
												description: importSummary,
												confirmLabel: 'Apply',
												intent: 'confirm',
												onConfirm: async () => {
													await applyMutation.mutateAsync(item.id)
												},
											})
										}
										disabled={applyMutation.isPending}
									>
										{applyMutation.isPending ? <LoadingInline className="mr-2" /> : null}
										Apply Selected
									</Button>
									<Button
										variant="destructive"
										onClick={() =>
											requestConfirmation({
												title: 'Dismiss Legacy Migration?',
												description: 'This marks the queue item dismissed.',
												confirmLabel: 'Dismiss',
												intent: 'destructive',
												onConfirm: async () => {
													await dismissMutation.mutateAsync(item.id)
												},
											})
										}
										disabled={dismissMutation.isPending}
									>
										{dismissMutation.isPending ? <LoadingInline className="mr-2" /> : null}
										Dismiss
									</Button>
								</div>
							</div>

							<Card>
								<CardHeader>
									<CardTitle className="text-sm">Queue Action History</CardTitle>
								</CardHeader>
								<CardContent className="space-y-2">
									{detail.actions.length === 0 ? (
										<div className="text-sm text-muted-foreground">No action history.</div>
									) : (
										[...detail.actions]
											.sort(
												(a, b) =>
													new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
											)
											.map((action) => (
												<div
													key={action.id}
													className="rounded border border-border/90 bg-card/80 p-2.5 text-sm"
												>
													<div className="flex flex-wrap items-center gap-2">
														<Badge variant="secondary">{action.action}</Badge>
														<span className="text-muted-foreground">by</span>
														<span className="font-medium">
															{action.performedByUserId
																? (legacyActionActorNameById.get(action.performedByUserId) ??
																	action.performedByUserId)
																: 'system'}
														</span>
														{action.performedByUserId ? (
															<span className="font-mono text-xs text-muted-foreground">
																({action.performedByUserId})
															</span>
														) : null}
													</div>
													<div className="mt-1 text-xs text-muted-foreground">
														{new Date(action.createdAt).toLocaleString()}
													</div>
												</div>
											))
									)}
								</CardContent>
							</Card>
						</CardContent>
					</Card>
				)
			})}
			{confirmationDialog}
		</div>
	)
}
