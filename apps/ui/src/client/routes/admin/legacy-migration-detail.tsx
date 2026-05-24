import { useMemo, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
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
		importIpAssociations: false,
		applyBlacklistToUser: hasBlacklist,
		markSkipped: false,
	})

	const ensureSelection = (
		queueId: string,
		characters: LegacyMigrationCandidateCharacter[],
		notes: LegacyMigrationCandidateNote[],
		hasBlacklist: boolean
	): SelectionState => {
		const existing = selectionsByQueueId[queueId]
		if (existing) return existing
		return buildDefaultSelection(characters, notes, hasBlacklist)
	}

	const updateSelection = (queueId: string, updater: (state: SelectionState) => SelectionState) => {
		setSelectionsByQueueId((prev) => {
			const current = prev[queueId] ?? {
				characterIds: new Set<string>(),
				noteIds: new Set<string>(),
				importIpAssociations: false,
				applyBlacklistToUser: false,
				markSkipped: false,
			}
			return { ...prev, [queueId]: updater(current) }
		})
	}

	const allDetails = useMemo(() => detailsQuery.data ?? [], [detailsQuery.data])

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
									{index + 1}. {detail.item.legacyAuthUserId}
								</a>
							</Button>
						))}
					</div>
				</CardContent>
			</Card>

			{allDetails.map((detail) => {
				const { item, candidates } = detail
				const conflictSummary = parseConflicts(item.conflicts)
				const selection = ensureSelection(
					item.id,
					candidates.characters,
					candidates.notes,
					conflictSummary.hasBlacklist
				)
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
								{conflictSummary.hasBlacklist ? <Badge variant="destructive">Blacklist</Badge> : null}
								{conflictSummary.multiMatch ? <Badge variant="warning">Multi-match</Badge> : null}
								{conflictSummary.crossUserCount > 0 ? (
									<Badge variant="destructive">Cross-user ({conflictSummary.crossUserCount})</Badge>
								) : null}
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
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
											<Badge variant="destructive">Linked to other user</Badge>
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
										<span className="text-sm">Apply blacklist to user</span>
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
						</CardContent>
					</Card>
				)
			})}
			{confirmationDialog}
		</div>
	)
}
