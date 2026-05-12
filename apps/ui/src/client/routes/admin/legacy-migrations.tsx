import { useEffect, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { LoadingInline } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api, type LegacyMigrationQueueItem, type LegacyMigrationSeverity, type LegacyMigrationStatus } from '@/lib/api'

const statusOptions = [
	{ value: '', label: 'All statuses' },
	{ value: 'pending', label: 'Pending' },
	{ value: 'partially_applied', label: 'Partially Applied' },
	{ value: 'applied', label: 'Applied' },
	{ value: 'dismissed', label: 'Dismissed' },
	{ value: 'error', label: 'Error' },
] as const

const severityOptions = [
	{ value: '', label: 'All severities' },
	{ value: 'none', label: 'None' },
	{ value: 'high', label: 'High' },
	{ value: 'critical', label: 'Critical' },
] as const

function severityBadgeVariant(severity: LegacyMigrationSeverity): 'ghost' | 'secondary' | 'warning' | 'destructive' {
	if (severity === 'critical') return 'destructive'
	if (severity === 'high') return 'warning'
	if (severity === 'none') return 'ghost'
	return 'secondary'
}

function statusBadgeVariant(status: LegacyMigrationStatus): 'secondary' | 'success' | 'warning' | 'destructive' | 'ghost' {
	if (status === 'applied') return 'success'
	if (status === 'pending') return 'warning'
	if (status === 'partially_applied') return 'secondary'
	if (status === 'error') return 'destructive'
	return 'ghost'
}

function readCount(record: Record<string, unknown>, key: string): number {
	const value = record[key]
	return typeof value === 'number' ? value : 0
}

function parseSnapshot(item: LegacyMigrationQueueItem): {
	matchingCharacters: number
	ipAddresses: number
	notes: number
	applications: number
} {
	const snapshot = item.candidateSnapshot
	const associatedCounts =
		snapshot && typeof snapshot === 'object' && snapshot.associatedCounts && typeof snapshot.associatedCounts === 'object'
			? (snapshot.associatedCounts as Record<string, unknown>)
			: {}
	return {
		matchingCharacters: readCount(associatedCounts, 'characters'),
		ipAddresses: readCount(associatedCounts, 'ipAddresses'),
		notes: readCount(associatedCounts, 'notes'),
		applications: readCount(associatedCounts, 'applications'),
	}
}

function parseConflicts(item: LegacyMigrationQueueItem): {
	multipleLegacyUsersForModernUser: boolean
	crossModernUserQueueMatches: number
	hasAnyBlacklistSignal: boolean
	modernUserBlacklisted: boolean
	matchingCharactersBlacklisted: number
	matchingCharacterDetails: Array<{
		characterId: string
		characterName: string
		matchedById: boolean
		matchedByName: boolean
	}>
} {
	const conflicts = item.conflicts
	const crossMatches =
		conflicts &&
		typeof conflicts === 'object' &&
		Array.isArray((conflicts as Record<string, unknown>).crossModernUserQueueMatches)
			? ((conflicts as Record<string, unknown>).crossModernUserQueueMatches as unknown[])
			: []
	const blacklistSignals =
		conflicts && typeof conflicts === 'object' && (conflicts as Record<string, unknown>).blacklistSignals
			? ((conflicts as Record<string, unknown>).blacklistSignals as Record<string, unknown>)
			: undefined
	const matchingCharacters = Array.isArray(blacklistSignals?.matchingCharactersBlacklisted)
		? blacklistSignals?.matchingCharactersBlacklisted
		: []
	const matchingCharacterDetails = matchingCharacters
		.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
		.map((value) => ({
			characterId: String(value.characterId ?? ''),
			characterName: String(value.characterName ?? ''),
			matchedById: Boolean(value.matchedById),
			matchedByName: Boolean(value.matchedByName),
		}))
		.filter((value) => value.characterId.length > 0)
	return {
		multipleLegacyUsersForModernUser:
			Boolean(
				conflicts &&
					typeof conflicts === 'object' &&
					(conflicts as Record<string, unknown>).multipleLegacyUsersForModernUser
			),
		crossModernUserQueueMatches: crossMatches.length,
		hasAnyBlacklistSignal: Boolean(blacklistSignals?.hasAnyBlacklistSignal),
		modernUserBlacklisted: Boolean(blacklistSignals?.modernUserBlacklisted),
		matchingCharactersBlacklisted: matchingCharacterDetails.length,
		matchingCharacterDetails,
	}
}

export default function AdminLegacyMigrationsPage() {
	usePageTitle('Admin - Legacy Migrations')
	const queryClient = useQueryClient()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	const [status, setStatus] = useState<string>('')
	const [severity, setSeverity] = useState<string>('')
	const [modernUserId, setModernUserId] = useState('')
	const [legacyAuthUserId, setLegacyAuthUserId] = useState('')
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [applyBlacklistToUser, setApplyBlacklistToUser] = useState(true)
	const [importCharacterLinks, setImportCharacterLinks] = useState(false)
	const [importNotes, setImportNotes] = useState(false)
	const [importIpAssociations, setImportIpAssociations] = useState(false)
	const [markSkipped, setMarkSkipped] = useState(false)

	const listQuery = useQuery({
		queryKey: ['admin', 'legacy-migrations', page, pageSize, status, severity, modernUserId, legacyAuthUserId],
		queryFn: () =>
			api.getLegacyMigrationQueue({
				page,
				pageSize,
				status: (status || undefined) as LegacyMigrationStatus | undefined,
				severity: (severity || undefined) as LegacyMigrationSeverity | undefined,
				modernUserId: modernUserId.trim() || undefined,
				legacyAuthUserId: legacyAuthUserId.trim() || undefined,
			}),
	})

	const detailQuery = useQuery({
		queryKey: ['admin', 'legacy-migration-detail', selectedId],
		queryFn: () => api.getLegacyMigrationQueueItem(selectedId as string),
		enabled: Boolean(selectedId),
	})

	useEffect(() => {
		const first = listQuery.data?.items[0]
		if (!selectedId && first) setSelectedId(first.id)
		if (selectedId && !listQuery.data?.items.some((i) => i.id === selectedId)) {
			setSelectedId(listQuery.data?.items[0]?.id ?? null)
		}
	}, [listQuery.data?.items, selectedId])

	const refreshList = async () => {
		await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migrations'] })
		if (selectedId) {
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migration-detail', selectedId] })
		}
	}

	const applyMutation = useMutation({
		mutationFn: (id: string) =>
			api.applyLegacyMigrationQueueItem(id, {
				applyBlacklistToUser,
				importCharacterLinks,
				importNotes,
				importIpAssociations,
				markSkipped,
			}),
		onSuccess: refreshList,
	})
	const dismissMutation = useMutation({
		mutationFn: (id: string) => api.dismissLegacyMigrationQueueItem(id),
		onSuccess: refreshList,
	})
	const recheckMutation = useMutation({
		mutationFn: (userId: string) => api.recheckLegacyMigrationQueueUser(userId),
		onSuccess: refreshList,
	})
	const resolveMutation = useMutation({
		mutationFn: (params: { id: string; decision: 'accept' | 'reject' | 'needs_review' }) =>
			api.resolveLegacyMigrationQueueItem(params.id, { decision: params.decision }),
		onSuccess: refreshList,
	})

	const selectedItem: LegacyMigrationQueueItem | undefined = detailQuery.data?.item
	const selectedConflicts = selectedItem ? parseConflicts(selectedItem) : null
	const selectedSnapshot = selectedItem ? parseSnapshot(selectedItem) : null
	const latestApplyAction = [...(detailQuery.data?.actions ?? [])]
		.reverse()
		.find((action) => action.action === 'apply')
	const hasPagination = (listQuery.data?.pagination.total ?? 0) > pageSize

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-semibold">Legacy Migrations</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Admin queue for reviewing and applying legacy-auth migration matches.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Queue Filters</CardTitle>
					<CardDescription>Filter pending migration candidates and conflicts.</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
					<Select
						options={statusOptions.map((o) => ({ value: o.value, label: o.label }))}
						value={status}
						onValueChange={(v) => {
							setStatus(v)
							setPage(1)
						}}
						placeholder="Status"
						searchable
					/>
					<Select
						options={severityOptions.map((o) => ({ value: o.value, label: o.label }))}
						value={severity}
						onValueChange={(v) => {
							setSeverity(v)
							setPage(1)
						}}
						placeholder="Severity"
						searchable
					/>
					<Input
						placeholder="Modern User ID"
						value={modernUserId}
						onChange={(e) => {
							setModernUserId(e.target.value)
							setPage(1)
						}}
					/>
					<Input
						placeholder="Legacy Auth User ID"
						value={legacyAuthUserId}
						onChange={(e) => {
							setLegacyAuthUserId(e.target.value)
							setPage(1)
						}}
					/>
				</CardContent>
			</Card>

			<div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
				<Card>
					<CardHeader>
						<div className="space-y-4">
							<div>
								<CardTitle>Queue</CardTitle>
								<CardDescription>
									{listQuery.isLoading
										? 'Loading queue...'
										: `${listQuery.data?.pagination.total ?? 0} item(s)`}
								</CardDescription>
							</div>
							<UserSearchPaginationControls
								page={page}
								pageSize={pageSize}
								totalCount={listQuery.data?.pagination.total ?? 0}
								onPageChange={setPage}
								onPageSizeChange={(next) => {
									setPageSize(next)
									setPage(1)
								}}
								pageSizeOptions={[10, 25, 50, 100]}
								itemLabel="queue items"
							/>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Modern User</TableHead>
									<TableHead>Legacy User</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Severity</TableHead>
									<TableHead>Conflicts</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(listQuery.data?.items ?? []).map((item) => {
									const conflictSummary = parseConflicts(item)
									const hasConflict =
										conflictSummary.multipleLegacyUsersForModernUser ||
										conflictSummary.crossModernUserQueueMatches > 0
									return (
										<TableRow
											key={item.id}
											className={selectedId === item.id ? 'bg-accent/30' : undefined}
											onClick={() => setSelectedId(item.id)}
										>
											<TableCell className="font-mono text-xs">{item.modernUserId}</TableCell>
											<TableCell className="font-mono text-xs">{item.legacyAuthUserId}</TableCell>
											<TableCell>
												<Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
											</TableCell>
											<TableCell>
												<Badge variant={severityBadgeVariant(item.severity)}>{item.severity}</Badge>
											</TableCell>
											<TableCell>
												{hasConflict ? (
													<div className="flex gap-1 flex-wrap">
														{conflictSummary.multipleLegacyUsersForModernUser ? (
															<Badge variant="warning">Multi-match</Badge>
														) : null}
														{conflictSummary.crossModernUserQueueMatches > 0 ? (
															<Badge variant="destructive">
																Cross-user ({conflictSummary.crossModernUserQueueMatches})
															</Badge>
														) : null}
													</div>
												) : (
													<Badge variant="ghost">None</Badge>
												)}
											</TableCell>
										</TableRow>
									)
								})}
								{!listQuery.isLoading && (listQuery.data?.items.length ?? 0) === 0 ? (
									<TableRow>
										<TableCell colSpan={5} className="text-center text-muted-foreground">
											No queue items found.
										</TableCell>
									</TableRow>
								) : null}
							</TableBody>
						</Table>
						{hasPagination ? (
							<div className="border-t border-border pt-4">
								<UserSearchPaginationControls
									page={page}
									pageSize={pageSize}
									totalCount={listQuery.data?.pagination.total ?? 0}
									onPageChange={setPage}
									onPageSizeChange={(next) => {
										setPageSize(next)
										setPage(1)
									}}
									pageSizeOptions={[10, 25, 50, 100]}
									itemLabel="queue items"
								/>
							</div>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Details</CardTitle>
						<CardDescription>
							{selectedItem ? `Queue ID: ${selectedItem.id}` : 'Select a queue item'}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{selectedItem ? (
							<>
								<div className="text-sm space-y-1">
									<div>
										<span className="font-medium">Modern User:</span>{' '}
										<span className="font-mono text-xs">{selectedItem.modernUserId}</span>
									</div>
									<div>
										<span className="font-medium">Legacy User:</span>{' '}
										<span className="font-mono text-xs">{selectedItem.legacyAuthUserId}</span>
									</div>
								</div>

								<div className="flex gap-2 flex-wrap">
									<label
										htmlFor="legacy-apply-blacklist"
										className="flex items-center gap-2 text-sm cursor-pointer mr-2"
									>
										<Checkbox
											id="legacy-apply-blacklist"
											checked={applyBlacklistToUser}
											onCheckedChange={(checked) => setApplyBlacklistToUser(checked === true)}
										/>
										Apply blacklist to user
									</label>
									<label
										htmlFor="legacy-import-character-links"
										className="flex items-center gap-2 text-sm cursor-pointer mr-2"
									>
										<Checkbox
											id="legacy-import-character-links"
											checked={importCharacterLinks}
											onCheckedChange={(checked) => setImportCharacterLinks(checked === true)}
										/>
										Import character links
									</label>
									<label htmlFor="legacy-import-notes" className="flex items-center gap-2 text-sm cursor-pointer mr-2">
										<Checkbox
											id="legacy-import-notes"
											checked={importNotes}
											onCheckedChange={(checked) => setImportNotes(checked === true)}
										/>
										Import notes
									</label>
									<label
										htmlFor="legacy-import-ip-associations"
										className="flex items-center gap-2 text-sm cursor-pointer mr-2"
									>
										<Checkbox
											id="legacy-import-ip-associations"
											checked={importIpAssociations}
											onCheckedChange={(checked) => setImportIpAssociations(checked === true)}
										/>
										Import IP associations
									</label>
									<label htmlFor="legacy-mark-skipped" className="flex items-center gap-2 text-sm cursor-pointer mr-2">
										<Checkbox
											id="legacy-mark-skipped"
											checked={markSkipped}
											onCheckedChange={(checked) => setMarkSkipped(checked === true)}
										/>
										Mark skipped
									</label>
									<Button
										variant="primary"
										size="sm"
										onClick={() =>
											requestConfirmation({
												title: 'Apply Legacy Migration?',
												description: applyBlacklistToUser
													? 'This applies the migration and blacklists the user via admin cascade.'
													: 'This applies the migration state without blacklisting the user.',
												confirmLabel: 'Apply Migration',
												intent: 'confirm',
												onConfirm: async () => {
													await applyMutation.mutateAsync(selectedItem.id)
												},
											})
										}
										disabled={applyMutation.isPending || dismissMutation.isPending}
									>
										{applyMutation.isPending ? <LoadingInline className="mr-2" /> : null}
										Apply
									</Button>
									<Button
										variant="secondary"
										size="sm"
										onClick={() =>
											requestConfirmation({
												title: 'Dismiss Legacy Migration?',
												description: 'This marks the queue item dismissed.',
												confirmLabel: 'Dismiss Item',
												intent: 'destructive',
												onConfirm: async () => {
													await dismissMutation.mutateAsync(selectedItem.id)
												},
											})
										}
										disabled={applyMutation.isPending || dismissMutation.isPending}
									>
										{dismissMutation.isPending ? <LoadingInline className="mr-2" /> : null}
										Dismiss
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											requestConfirmation({
												title: 'Recheck Legacy Matches?',
												description:
													'Re-runs matching for this modern user and refreshes queue conflicts/state.',
												confirmLabel: 'Recheck User',
												intent: 'confirm',
												onConfirm: async () => {
													await recheckMutation.mutateAsync(selectedItem.modernUserId)
												},
											})
										}
										disabled={recheckMutation.isPending}
									>
										{recheckMutation.isPending ? <LoadingInline className="mr-2" /> : null}
										Recheck User
									</Button>
									<Button
										variant="secondary"
										size="sm"
										onClick={() =>
											requestConfirmation({
												title: 'Resolve As Accepted?',
												description: 'Marks conflict resolution as accepted and keeps item pending for execution.',
												confirmLabel: 'Accept Resolution',
												intent: 'confirm',
												onConfirm: async () => {
													await resolveMutation.mutateAsync({ id: selectedItem.id, decision: 'accept' })
												},
											})
										}
										disabled={resolveMutation.isPending}
									>
										Resolve Accept
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											requestConfirmation({
												title: 'Mark Needs Review?',
												description: 'Sets conflict resolution state to needs review.',
												confirmLabel: 'Mark Needs Review',
												intent: 'confirm',
												onConfirm: async () => {
													await resolveMutation.mutateAsync({ id: selectedItem.id, decision: 'needs_review' })
												},
											})
										}
										disabled={resolveMutation.isPending}
									>
										Needs Review
									</Button>
									<Button
										variant="destructive"
										size="sm"
										onClick={() =>
											requestConfirmation({
												title: 'Resolve As Rejected?',
												description: 'Marks resolution rejected and dismisses this queue item.',
												confirmLabel: 'Reject Resolution',
												intent: 'destructive',
												onConfirm: async () => {
													await resolveMutation.mutateAsync({ id: selectedItem.id, decision: 'reject' })
												},
											})
										}
										disabled={resolveMutation.isPending}
									>
										Resolve Reject
									</Button>
								</div>
								{latestApplyAction ? (
									<div className="space-y-2">
										<div className="text-sm font-medium">Latest Apply Result</div>
										<div className="rounded border bg-muted/20 p-2 space-y-1">
											<div className="text-xs text-muted-foreground">
												{new Date(latestApplyAction.createdAt).toLocaleString()}
											</div>
											{latestApplyAction.payload &&
											typeof latestApplyAction.payload === 'object' &&
											latestApplyAction.payload.applyResults &&
											typeof latestApplyAction.payload.applyResults === 'object' ? (
												Object.entries(
													latestApplyAction.payload.applyResults as Record<
														string,
														{ status?: string; message?: string }
													>
												).map(([key, value]) => (
													<div key={key} className="flex items-center gap-2 text-xs">
														<Badge
															variant={
																value.status === 'applied'
																	? 'success'
																	: value.status === 'error'
																		? 'destructive'
																		: 'ghost'
															}
														>
															{value.status ?? 'unknown'}
														</Badge>
														<span className="font-medium">{key}</span>
														{value.message ? (
															<span className="text-muted-foreground">- {value.message}</span>
														) : null}
													</div>
												))
											) : (
												<div className="text-xs text-muted-foreground">No structured apply result payload.</div>
											)}
										</div>
									</div>
								) : null}

								<div className="space-y-2">
									<div className="text-sm font-medium">Candidate Summary</div>
									<div className="flex gap-2 flex-wrap">
										<Badge variant="secondary">
											Characters {selectedSnapshot?.matchingCharacters ?? 0}
										</Badge>
										<Badge variant="secondary">IPs {selectedSnapshot?.ipAddresses ?? 0}</Badge>
										<Badge variant="secondary">Notes {selectedSnapshot?.notes ?? 0}</Badge>
										<Badge variant="secondary">
											Applications {selectedSnapshot?.applications ?? 0}
										</Badge>
									</div>
								</div>
								<div className="space-y-2">
									<div className="text-sm font-medium">Conflict Summary</div>
									<div className="flex gap-2 flex-wrap">
										{selectedConflicts?.multipleLegacyUsersForModernUser ? (
											<Badge variant="warning">Multiple legacy users matched</Badge>
										) : (
											<Badge variant="ghost">Single legacy-user match</Badge>
										)}
										{selectedConflicts && selectedConflicts.crossModernUserQueueMatches > 0 ? (
											<Badge variant="destructive">
												Cross-user queue matches: {selectedConflicts.crossModernUserQueueMatches}
											</Badge>
										) : (
											<Badge variant="ghost">No cross-user queue conflicts</Badge>
										)}
										{selectedConflicts?.hasAnyBlacklistSignal ? (
											<Badge variant="destructive">
												Blacklist signals
												{selectedConflicts.modernUserBlacklisted ? ' · User' : ''}
												{selectedConflicts.matchingCharactersBlacklisted > 0
													? ` · Chars ${selectedConflicts.matchingCharactersBlacklisted}`
													: ''}
											</Badge>
										) : (
											<Badge variant="ghost">No blacklist signals</Badge>
										)}
									</div>
									{selectedItem.conflicts &&
									typeof selectedItem.conflicts === 'object' &&
									(selectedItem.conflicts as Record<string, unknown>).resolution &&
									typeof (selectedItem.conflicts as Record<string, unknown>).resolution === 'object' ? (
										<div className="rounded border p-2 bg-muted/20 text-xs">
											{(() => {
												const resolution = (selectedItem.conflicts as Record<string, unknown>)
													.resolution as Record<string, unknown>
												return (
													<div className="space-y-1">
														<div className="font-medium">Resolution: {String(resolution.decision ?? 'unknown')}</div>
														<div className="text-muted-foreground">
															By: <span className="font-mono">{String(resolution.decidedByUserId ?? 'unknown')}</span>
														</div>
														<div className="text-muted-foreground">
															At: {resolution.decidedAt ? new Date(String(resolution.decidedAt)).toLocaleString() : 'unknown'}
														</div>
														{resolution.note ? <div>Note: {String(resolution.note)}</div> : null}
													</div>
												)
											})()}
										</div>
									) : null}
								</div>
								<div className="space-y-2">
									<div className="text-sm font-medium">Blacklist Matches</div>
									<div className="space-y-2">
										{selectedConflicts?.modernUserBlacklisted ? (
											<div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs">
												Modern user is already blacklisted.
											</div>
										) : (
											<div className="rounded border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
												Modern user is not currently blacklisted.
											</div>
										)}
										{selectedConflicts && selectedConflicts.matchingCharacterDetails.length > 0 ? (
											<div className="rounded border border-destructive/40 bg-destructive/10 p-2">
												<div className="text-xs font-medium mb-1">Matched blacklisted characters</div>
												<div className="space-y-1">
													{selectedConflicts.matchingCharacterDetails.map((character) => (
														<div key={character.characterId} className="text-xs flex gap-2 items-center">
															<Badge variant="destructive">Blacklisted</Badge>
															<span className="font-medium">{character.characterName || 'Unknown'}</span>
															<span className="font-mono text-muted-foreground">{character.characterId}</span>
															<span className="text-muted-foreground">
																(
																{character.matchedById && character.matchedByName
																	? 'matched by ID + name'
																	: character.matchedById
																		? 'matched by ID'
																		: 'matched by name'}
																)
															</span>
														</div>
													))}
												</div>
											</div>
										) : (
											<div className="rounded border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
												No blacklisted character matches in this candidate set.
											</div>
										)}
									</div>
								</div>
								<details className="rounded border p-2 text-xs bg-muted/20">
									<summary className="cursor-pointer font-medium">Raw Payload</summary>
									<div className="mt-2 space-y-2">
										<pre className="overflow-auto max-h-48">
											{JSON.stringify(selectedItem.candidateSnapshot, null, 2)}
										</pre>
										<pre className="overflow-auto max-h-48">
											{JSON.stringify(selectedItem.conflicts, null, 2)}
										</pre>
									</div>
								</details>
								<div className="text-xs text-muted-foreground">
									Last matched: {new Date(selectedItem.lastMatchedAt).toLocaleString()}
								</div>
							</>
						) : (
							<div className="text-sm text-muted-foreground">No item selected.</div>
						)}
					</CardContent>
				</Card>
			</div>
			{confirmationDialog}
		</div>
	)
}
