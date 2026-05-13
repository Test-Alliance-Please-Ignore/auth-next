import { useMemo, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingInline } from '@/components/ui/loading'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'

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
		case 'ip_address_hash':
			return 'IP Address Hash'
		default:
			return targetType.replace(/_/g, ' ')
	}
}

function parseBlacklistAlerts(conflicts: Record<string, unknown>): {
	hasAnyBlacklistSignal: boolean
	modernUserBlacklisted: boolean
	matches: Array<{
		key: string
		label: string
		subLabel: string | null
		targetType: string
		characterId: string
		characterName: string
		entryMode: 'manual' | 'automatic' | null
		reason: string | null
		blacklistedBy: string | null
		createdAt: string | null
		discoverySources: Array<'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'>
		preferredSource: 'legacy' | 'tang'
	}>
	discordMatches: string[]
	matchedTargets: Array<{
		targetType: string
		targetValue: string
		reason: string | null
		createdAt: string | null
		blacklistedBy: string | null
		entryMode: 'manual' | 'automatic' | null
		discoverySources: Array<'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association'>
		preferredSource: 'legacy' | 'tang'
	}>
	ipAssociatedMatches: Array<{ userId: string; mainCharacterName: string | null }>
} {
	const blacklistSignals =
		conflicts && typeof conflicts === 'object' && conflicts.blacklistSignals && typeof conflicts.blacklistSignals === 'object'
			? (conflicts.blacklistSignals as Record<string, unknown>)
			: undefined
	const matched = Array.isArray(blacklistSignals?.matchingCharactersBlacklisted)
		? blacklistSignals?.matchingCharactersBlacklisted
		: []
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
	const matchedTargets = Array.isArray(blacklistSignals?.matchedTargets)
		? blacklistSignals.matchedTargets
				.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
				.map((value) => {
					const entryMode: 'manual' | 'automatic' | null =
						value.entryMode === 'manual' || value.entryMode === 'automatic'
							? value.entryMode
							: null
					const createdAtValue = value.createdAt
					const createdAt =
						typeof createdAtValue === 'string' && createdAtValue.trim().length > 0
							? createdAtValue
							: createdAtValue instanceof Date
								? createdAtValue.toISOString()
								: null
					const preferredSource: 'legacy' | 'tang' =
						value.preferredSource === 'legacy' ? 'legacy' : 'tang'
					return {
						targetType: String(value.targetType ?? ''),
						targetValue: String(value.targetValue ?? ''),
						reason:
							typeof value.reason === 'string' && value.reason.trim().length > 0
								? value.reason
								: null,
						createdAt,
						blacklistedBy:
							typeof value.blacklistedBy === 'string' && value.blacklistedBy.trim().length > 0
								? value.blacklistedBy
								: null,
						entryMode,
						discoverySources: Array.isArray(value.discoverySources)
							? value.discoverySources.filter((source): source is 'legacy_direct' | 'legacy_ip_association' | 'tang_direct' | 'tang_ip_association' =>
								source === 'legacy_direct' || source === 'legacy_ip_association' || source === 'tang_direct' || source === 'tang_ip_association')
							: [],
						preferredSource,
					}
				})
				.filter((value) => value.targetType.length > 0 && value.targetValue.length > 0)
		: []
	const matchedTargetByKey = new Map(matchedTargets.map((target) => [`${target.targetType}:${target.targetValue}`, target]))

	const characterMatchesWithMetadata = matched
		.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
		.map((value) => {
			const characterId = String(value.characterId ?? '')
			const characterName = String(value.characterName ?? '')
			const directEntryMode: 'manual' | 'automatic' | null =
				value.entryMode === 'manual' || value.entryMode === 'automatic'
					? value.entryMode
					: null
			const directReason =
				typeof value.reason === 'string' && value.reason.trim().length > 0 ? value.reason : null
			const directBlacklistedBy =
				typeof value.blacklistedBy === 'string' && value.blacklistedBy.trim().length > 0
					? value.blacklistedBy
					: null
			const directCreatedAtValue = value.createdAt
			const directCreatedAt =
				typeof directCreatedAtValue === 'string' && directCreatedAtValue.trim().length > 0
					? directCreatedAtValue
					: directCreatedAtValue instanceof Date
						? directCreatedAtValue.toISOString()
						: null
			const byId = matchedTargetByKey.get(`character_id:${characterId}`)
			const byName = matchedTargetByKey.get(
				characterName.trim().length > 0 ? `character_name:${characterName.trim().toLowerCase()}` : ''
			)
			const meta = byId ?? byName
			return {
				key: `character_id:${characterId}`,
				label: characterName,
				subLabel: characterId,
				targetType: 'character_id',
				characterId,
				characterName,
				entryMode: directEntryMode ?? meta?.entryMode ?? null,
				reason: directReason ?? meta?.reason ?? null,
				blacklistedBy: directBlacklistedBy ?? meta?.blacklistedBy ?? null,
				createdAt: directCreatedAt ?? meta?.createdAt ?? null,
				discoverySources: meta?.discoverySources ?? [],
				preferredSource: meta?.preferredSource ?? 'legacy',
			}
		})
		.filter((value) => value.characterId.length > 0)
	const renderedCharacterTargetKeys = new Set<string>()
	for (const match of characterMatchesWithMetadata) {
		if (match.characterId.trim().length > 0) {
			renderedCharacterTargetKeys.add(`character_id:${match.characterId.trim()}`)
		}
		if (match.characterName.trim().length > 0) {
			renderedCharacterTargetKeys.add(`character_name:${match.characterName.trim().toLowerCase()}`)
		}
	}
	const unmatchedTargets = matchedTargets.filter((target) => {
		const key =
			target.targetType === 'character_name'
				? `${target.targetType}:${target.targetValue.trim().toLowerCase()}`
				: `${target.targetType}:${target.targetValue.trim()}`
		return !renderedCharacterTargetKeys.has(key)
	})
	const unifiedMatches = [
		...characterMatchesWithMetadata,
		...unmatchedTargets.map((target) => ({
			key: `${target.targetType}:${target.targetValue}`,
			label: `${target.targetType}: ${target.targetValue}`,
			subLabel: null,
			targetType: target.targetType,
			characterId: '',
			characterName: '',
			entryMode: target.entryMode,
			reason: target.reason,
			blacklistedBy: target.blacklistedBy,
			createdAt: target.createdAt,
			discoverySources: target.discoverySources,
			preferredSource: target.preferredSource,
		})),
	]

	return {
		hasAnyBlacklistSignal: Boolean(blacklistSignals?.hasAnyBlacklistSignal),
		modernUserBlacklisted: Boolean(blacklistSignals?.modernUserBlacklisted),
		matches: unifiedMatches,
		discordMatches,
		matchedTargets: [],
		ipAssociatedMatches,
	}
}

export default function AdminLegacyMigrationDetailPage() {
	usePageTitle('Admin - Legacy Migration Detail')
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const queryClient = useQueryClient()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const [applyBlacklistToUser, setApplyBlacklistToUser] = useState(true)
	const [markSkipped, setMarkSkipped] = useState(false)
	const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set())
	const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
	const [importIpAssociations, setImportIpAssociations] = useState(false)

	const detailQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', id],
		queryFn: () => api.getLegacyMigrationQueueItem(id as string),
		enabled: Boolean(id),
	})

	const applyMutation = useMutation({
		mutationFn: () =>
			api.applyLegacyMigrationQueueItem(id as string, {
				applyBlacklistToUser: canApplyBlacklist ? applyBlacklistToUser : false,
				importCharacterLinks: selectedCharacterIds.size > 0,
				importNotes: selectedNoteIds.size > 0,
				importIpAssociations,
				markSkipped,
				characterIds: [...selectedCharacterIds],
				noteIds: [...selectedNoteIds],
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migrations'] })
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migration-detail', id] })
		},
	})

	const dismissMutation = useMutation({
		mutationFn: () => api.dismissLegacyMigrationQueueItem(id as string),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migrations'] })
			navigate('/admin/legacy-migrations')
		},
	})

	const item = detailQuery.data?.item
	const candidates = detailQuery.data?.candidates
	const blacklistAlerts = item ? parseBlacklistAlerts(item.conflicts) : null
	const blacklistAttributorIds = useMemo(
		() =>
			Array.from(
				new Set(
					(blacklistAlerts?.matches ?? [])
						.map((match) => match.blacklistedBy)
						.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
				)
			),
		[blacklistAlerts?.matches]
	)
	const blacklistAttributorsQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', id, 'blacklist-attributors', blacklistAttributorIds],
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
	const directBlacklistedCharacterIds = useMemo(
		() =>
			new Set(
				(blacklistAlerts?.matches ?? [])
					.filter(
						(match) =>
							match.discoverySources.includes('legacy_direct') ||
							match.discoverySources.includes('tang_direct')
					)
					.map((match) => match.characterId)
			),
		[blacklistAlerts?.matches]
	)
	const canApplyBlacklist = Boolean(blacklistAlerts?.hasAnyBlacklistSignal)
	const modernUserId = item?.modernUserId
	const recheckMutation = useMutation({
		mutationFn: () => {
			if (!modernUserId) throw new Error('Missing modern user id for recheck')
			return api.recheckLegacyMigrationQueueUser(modernUserId)
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migrations'] })
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migration-detail', id] })
			await detailQuery.refetch()
		},
	})
	const modernUserQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', id, 'modern-user', item?.modernUserId],
		queryFn: () => api.getAdminUser(item!.modernUserId),
		enabled: Boolean(item?.modernUserId),
	})
	const blacklistAttributorNameById = blacklistAttributorsQuery.data ?? new Map<string, string>()

	const toggleCharacter = (characterId: string) => {
		setSelectedCharacterIds((prev) => {
			const next = new Set(prev)
			if (next.has(characterId)) next.delete(characterId)
			else next.add(characterId)
			return next
		})
	}

	const toggleNote = (noteId: string) => {
		setSelectedNoteIds((prev) => {
			const next = new Set(prev)
			if (next.has(noteId)) next.delete(noteId)
			else next.add(noteId)
			return next
		})
	}

	const importSummary = useMemo(
		() =>
			`${selectedCharacterIds.size} character(s), ${selectedNoteIds.size} note(s), ${importIpAssociations ? candidates?.ipAddresses.length ?? 0 : 0} IP(s) selected`,
		[candidates?.ipAddresses.length, importIpAssociations, selectedCharacterIds.size, selectedNoteIds.size]
	)

	if (detailQuery.isLoading || !item || !candidates) {
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

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold">
						{modernUserQuery.data?.characters.find((character) => character.is_primary)?.characterName ??
							item.modernUserMainCharacterName ??
							'Unknown User'}
					</h1>
					<p className="text-xs font-mono text-muted-foreground">{item.modernUserId}</p>
				</div>
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
						<Link to="/admin/legacy-migrations">
							<ArrowLeft className="h-4 w-4" />
							Back to Legacy Migrations
						</Link>
					</Button>
				</div>
			</div>

			{blacklistAlerts?.hasAnyBlacklistSignal ? (
				<Card className="border-destructive/60">
					<CardHeader>
						<CardTitle className="text-destructive">Blacklist Alerts</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{blacklistAlerts.modernUserBlacklisted ? <Badge variant="destructive">Modern user is blacklisted</Badge> : null}
						{blacklistAlerts.discordMatches.length > 0 ? (
							<Badge variant="destructive">Discord ID blacklist match ({blacklistAlerts.discordMatches.length})</Badge>
						) : null}
						{blacklistAlerts.ipAssociatedMatches.length > 0 ? (
							<Badge variant="destructive">
								IP-associated blacklist matches ({blacklistAlerts.ipAssociatedMatches.length})
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

			<Card>
				<CardHeader>
					<CardTitle>Character Matches</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					{candidates.characters.map((character) => (
						<div key={character.characterId} className="flex items-center justify-between rounded border border-border/90 bg-card/80 p-2.5">
							<div className="min-w-0">
								<div
									className={
										directBlacklistedCharacterIds.has(character.characterId)
											? 'font-medium text-destructive flex items-center gap-2'
											: 'font-medium'
									}
								>
									{directBlacklistedCharacterIds.has(character.characterId) ? (
										<AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
									) : null}
									<span>{character.characterName}</span>
								</div>
								<div className="text-xs font-mono text-muted-foreground">{character.characterId}</div>
							</div>
							{character.alreadyLinkedToModernUser ? (
								<Badge variant="success">Already linked</Badge>
							) : character.linkedToOtherUserId ? (
								<div className="text-right">
									<Badge variant="destructive">Linked to other user</Badge>
									<div className="text-xs font-mono text-muted-foreground mt-1">{character.linkedToOtherUserId}</div>
								</div>
							) : (
								<label className="flex items-center gap-2 cursor-pointer rounded border border-border/80 bg-muted/30 px-2 py-1">
									<Checkbox
										checked={selectedCharacterIds.has(character.characterId)}
										onCheckedChange={() => toggleCharacter(character.characterId)}
									/>
									<span className="text-sm">Import</span>
								</label>
							)}
						</div>
					))}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Notes</CardTitle>
				</CardHeader>
				<CardContent className="space-y-2">
					{candidates.notes.map((note) => (
						<div key={note.legacyNoteId} className="flex items-start justify-between rounded border border-border/90 bg-card/80 p-2.5 gap-3">
							<div className="min-w-0">
								<div className="text-sm whitespace-pre-wrap">{note.note}</div>
								<div className="text-xs text-muted-foreground font-mono mt-1">
									{note.legacyCreatedByCharacterName
										? `by ${note.legacyCreatedByCharacterName}`
										: note.legacyCreatedByUserId
											? `by legacy user ${note.legacyCreatedByUserId}`
											: ''}
								</div>
							</div>
							{note.alreadyImported ? (
								<Badge variant="success">Already imported</Badge>
							) : (
								<label className="flex items-center gap-2 cursor-pointer rounded border border-border/80 bg-muted/30 px-2 py-1">
									<Checkbox
										checked={selectedNoteIds.has(note.legacyNoteId)}
										onCheckedChange={() => toggleNote(note.legacyNoteId)}
									/>
									<span className="text-sm">Import</span>
								</label>
							)}
						</div>
					))}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>IP Associations</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-between rounded border border-border/90 bg-card/80 p-2.5">
						<div className="text-sm">
							Import legacy IP associations
							<span className="text-muted-foreground ml-2">
								({candidates.ipAddresses.length} importable)
							</span>
						</div>
						<label className="flex items-center gap-2 cursor-pointer rounded border border-border/80 bg-muted/30 px-2 py-1">
							<Checkbox checked={importIpAssociations} onCheckedChange={(checked) => setImportIpAssociations(checked === true)} />
							<span className="text-sm">Import</span>
						</label>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Apply</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="text-sm text-muted-foreground">{importSummary}</div>
					{canApplyBlacklist ? (
						<label className="flex items-center gap-2 cursor-pointer rounded border border-warning/40 bg-warning/10 px-2 py-1">
							<Checkbox checked={applyBlacklistToUser} onCheckedChange={(checked) => setApplyBlacklistToUser(checked === true)} />
							<span className="text-sm">Apply blacklist to user</span>
						</label>
					) : null}
					<label className="flex items-center gap-2 cursor-pointer">
						<Checkbox checked={markSkipped} onCheckedChange={(checked) => setMarkSkipped(checked === true)} />
						<span className="text-sm">Mark skipped</span>
					</label>
					<div className="flex gap-2">
						<Button
							variant="primary"
							onClick={() =>
								requestConfirmation({
									title: 'Apply Selected Legacy Data?',
									description:
										canApplyBlacklist && applyBlacklistToUser
											? `${importSummary}\n\nThis will also blacklist this user and propagate blacklist coverage to linked identities (including known Discord ID and related character identifiers).`
											: importSummary,
									confirmLabel: 'Apply',
									intent: 'confirm',
									onConfirm: async () => {
										await applyMutation.mutateAsync()
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
										await dismissMutation.mutateAsync()
									},
								})
							}
							disabled={dismissMutation.isPending}
						>
							{dismissMutation.isPending ? <LoadingInline className="mr-2" /> : null}
							Dismiss
						</Button>
					</div>
				</CardContent>
			</Card>
			{confirmationDialog}
		</div>
	)
}
