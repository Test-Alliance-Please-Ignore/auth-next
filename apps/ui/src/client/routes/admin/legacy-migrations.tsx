import { useEffect, useRef, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingInline } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api, type LegacyMigrationStatus } from '@/lib/api'

const statusOptions = [
	{ value: '', label: 'All statuses' },
	{ value: 'pending', label: 'Pending' },
	{ value: 'partially_applied', label: 'Partially Applied' },
	{ value: 'applied', label: 'Applied' },
	{ value: 'dismissed', label: 'Dismissed' },
	{ value: 'error', label: 'Error' },
] as const

function statusBadgeVariant(status: LegacyMigrationStatus): 'secondary' | 'success' | 'warning' | 'destructive' | 'ghost' {
	if (status === 'applied') return 'success'
	if (status === 'pending') return 'warning'
	if (status === 'partially_applied') return 'secondary'
	if (status === 'error') return 'destructive'
	return 'ghost'
}

function parseConflicts(conflicts: Record<string, unknown>): { multiMatch: boolean; crossUserCount: number } {
	const crossMatches =
		Array.isArray(conflicts.crossModernUserQueueMatches) ? conflicts.crossModernUserQueueMatches : []
	return {
		multiMatch: Boolean(conflicts.multipleLegacyUsersForModernUser),
		crossUserCount: crossMatches.length,
	}
}

export default function AdminLegacyMigrationsPage() {
	usePageTitle('Admin - Legacy Migrations')
	const [searchParams, setSearchParams] = useSearchParams()
	const queryClient = useQueryClient()
	const queryUserId = searchParams.get('userId') ?? searchParams.get('modernUserId') ?? ''
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	const [status, setStatus] = useState<string>('')
	const [modernUserId, setModernUserId] = useState(queryUserId)
	const [autoRecheckResult, setAutoRecheckResult] = useState<string | null>(null)
	const [autoRecheckError, setAutoRecheckError] = useState<string | null>(null)
	const [recheckingUserId, setRecheckingUserId] = useState<string | null>(null)
	const autoRecheckTriggeredRef = useRef(false)

	const listQuery = useQuery({
		queryKey: ['admin', 'legacy-migrations', page, pageSize, status, modernUserId],
		queryFn: () =>
			api.getLegacyMigrationQueue({
				page,
				pageSize,
				status: (status || undefined) as LegacyMigrationStatus | undefined,
				modernUserId: modernUserId.trim() || undefined,
			}),
	})

	const recheckMutation = useMutation({
		mutationFn: (userId: string) => api.recheckLegacyMigrationQueueUser(userId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ['admin', 'legacy-migrations'] })
		},
	})

	const selectedUserQuery = useQuery({
		queryKey: ['admin', 'legacy-migrations', 'selected-user', modernUserId],
		queryFn: () => api.getAdminUser(modernUserId),
		enabled: Boolean(modernUserId.trim()),
	})

	useEffect(() => {
		setModernUserId(queryUserId)
	}, [queryUserId])

	useEffect(() => {
		const shouldAutoRecheck = searchParams.get('autoRecheck') === '1'
		const targetModernUserId = modernUserId.trim()
		if (!shouldAutoRecheck || !targetModernUserId || autoRecheckTriggeredRef.current) return
		autoRecheckTriggeredRef.current = true
		setRecheckingUserId(targetModernUserId)
		setAutoRecheckResult(null)
		setAutoRecheckError(null)
		void recheckMutation
			.mutateAsync(targetModernUserId)
			.then((result) => {
				setAutoRecheckResult(
					`Legacy recheck complete (created: ${result.created}, updated: ${result.updated}, dismissed: ${result.dismissed}).`
				)
			})
			.catch((error) => {
				setAutoRecheckError(error instanceof Error ? error.message : 'Failed to run legacy recheck.')
			})
			.finally(() => {
				setRecheckingUserId(null)
				const next = new URLSearchParams(searchParams)
				next.delete('autoRecheck')
				setSearchParams(next, { replace: true })
			})
	}, [modernUserId, recheckMutation, searchParams, setSearchParams])

	const hasPagination = (listQuery.data?.pagination.total ?? 0) > pageSize

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-semibold">Legacy Migrations</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Review detected legacy matches and open an item for line-by-line import.
				</p>
			</div>
			{autoRecheckResult ? (
				<Card className="border-primary bg-primary/10">
					<CardContent className="py-3">
						<p className="text-primary">{autoRecheckResult}</p>
					</CardContent>
				</Card>
			) : null}
			{autoRecheckError ? (
				<Card className="border-destructive bg-destructive/10">
					<CardContent className="py-3">
						<p className="text-destructive">{autoRecheckError}</p>
					</CardContent>
				</Card>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Queue Filters</CardTitle>
					<CardDescription>Filter pending migration candidates and conflicts.</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-2">
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
						options={
							selectedUserQuery.data
								? [
										{
											value: selectedUserQuery.data.id,
											label: selectedUserQuery.data.characters.find((character) => character.is_primary)
												?.characterName ?? selectedUserQuery.data.id,
											description: selectedUserQuery.data.id,
										},
									]
								: []
						}
						value={modernUserId}
						onValueChange={(value) => {
							setModernUserId(value)
							const next = new URLSearchParams(searchParams)
							if (value) {
								next.set('userId', value)
							} else {
								next.delete('userId')
							}
							setSearchParams(next, { replace: true })
							setPage(1)
						}}
						searchable
						searchDelegate={async (query) => {
							const result = await api.getAdminUsers({ search: query, page: 1, pageSize: 25 })
							return result.data.map((user) => ({
								value: user.id,
								label: user.mainCharacterName ?? user.matchedCharacterName ?? user.id,
								description: user.id,
							}))
						}}
						placeholder="Search User"
						minQueryLength={2}
						queryHintText="Type at least 2 characters"
						emptyText="No users found"
						selectAllOption={{ value: '', label: 'All Users' }}
						showValueHint
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="space-y-4">
						<div>
							<CardTitle>Queue</CardTitle>
							<CardDescription>
								{listQuery.isLoading ? 'Loading queue...' : `${listQuery.data?.pagination.total ?? 0} item(s)`}
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
								<TableHead>Conflicts</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(listQuery.data?.items ?? []).map((item) => {
								const conflicts = parseConflicts(item.conflicts)
								const isRecheckingThisRow = recheckingUserId === item.modernUserId
								const detailPath = `/admin/legacy-migrations/${item.id}`
								return (
									<TableRow
										key={item.id}
										className="cursor-pointer"
										onClick={() => window.open(detailPath, '_blank', 'noopener,noreferrer')}
									>
										<TableCell>
											<div className="font-medium">{item.modernUserMainCharacterName ?? 'Unknown character'}</div>
											<div className="text-xs text-muted-foreground font-mono">{item.modernUserId}</div>
										</TableCell>
										<TableCell className="font-mono text-xs">{item.legacyAuthUserId}</TableCell>
										<TableCell>
											<Badge variant={statusBadgeVariant(item.status)}>{item.status}</Badge>
										</TableCell>
										<TableCell>
											<div className="flex gap-1 flex-wrap">
												{conflicts.multiMatch ? <Badge variant="warning">Multi-match</Badge> : null}
												{conflicts.crossUserCount > 0 ? (
													<Badge variant="destructive">Cross-user ({conflicts.crossUserCount})</Badge>
												) : conflicts.multiMatch ? null : (
													<Badge variant="ghost">None</Badge>
												)}
											</div>
										</TableCell>
										<TableCell className="text-right">
											<div className="inline-flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
												<Button
													variant="secondary"
													size="sm"
													onClick={async () => {
														setRecheckingUserId(item.modernUserId)
														try {
															await recheckMutation.mutateAsync(item.modernUserId)
														} finally {
															setRecheckingUserId(null)
														}
													}}
													disabled={isRecheckingThisRow}
												>
													{isRecheckingThisRow ? <LoadingInline className="mr-2" /> : null}
													Recheck
												</Button>
												<Button variant="primary" size="sm" asChild>
													<Link to={detailPath} target="_blank" rel="noopener noreferrer">
														Open
													</Link>
												</Button>
											</div>
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
		</div>
	)
}
