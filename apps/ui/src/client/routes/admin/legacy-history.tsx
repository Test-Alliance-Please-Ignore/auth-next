import { useEffect, useState } from 'react'

import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api, type LegacyHistoryApplication } from '@/lib/api'

export default function AdminLegacyHistoryPage() {
	usePageTitle('Admin - Legacy History')
	const [searchParams] = useSearchParams()
	const initialCharacterIds = searchParams.get('characterIds') ?? ''
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	const [corporationId, setCorporationId] = useState('')
	const [characterId, setCharacterId] = useState('')
	const [characterIds, setCharacterIds] = useState(initialCharacterIds)
	const [characterName, setCharacterName] = useState('')
	const [selectedLegacyApplicationId, setSelectedLegacyApplicationId] = useState<string | null>(null)

	const listQuery = useQuery({
		queryKey: [
			'admin',
			'legacy-history',
			page,
			pageSize,
			corporationId,
			characterId,
			characterIds,
			characterName,
		],
		queryFn: () =>
			api.getLegacyHistory({
				page,
				pageSize,
				corporationId: corporationId.trim() || undefined,
				characterId: characterId.trim() || undefined,
				characterIds: characterIds.trim() || undefined,
				characterName: characterName.trim() || undefined,
			}),
	})

	const detailQuery = useQuery({
		queryKey: ['admin', 'legacy-history-detail', selectedLegacyApplicationId],
		queryFn: () => api.getLegacyHistoryApplication(selectedLegacyApplicationId as string),
		enabled: Boolean(selectedLegacyApplicationId),
	})

	useEffect(() => {
		const first = listQuery.data?.items[0]
		if (!selectedLegacyApplicationId && first?.legacyApplicationId) {
			setSelectedLegacyApplicationId(first.legacyApplicationId)
		}
		if (
			selectedLegacyApplicationId &&
			!listQuery.data?.items.some((item) => item.legacyApplicationId === selectedLegacyApplicationId)
		) {
			setSelectedLegacyApplicationId(listQuery.data?.items[0]?.legacyApplicationId ?? null)
		}
	}, [listQuery.data?.items, selectedLegacyApplicationId])

	const hasPagination = (listQuery.data?.pagination.total ?? 0) > pageSize
	const selected: LegacyHistoryApplication | undefined = detailQuery.data?.application

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-semibold">Legacy History</h2>
				<p className="text-sm text-muted-foreground mt-1">
					Read-only legacy corporation application history. Use this for historical context only.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Search</CardTitle>
				<CardDescription>
					Filter legacy applications by corporation, character ID(s), or name.
				</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-4">
					<Input
						placeholder="Corporation ID"
						value={corporationId}
						onChange={(e) => {
							setCorporationId(e.target.value)
							setPage(1)
						}}
					/>
					<Input
						placeholder="Character ID"
						value={characterId}
						onChange={(e) => {
							setCharacterId(e.target.value)
							setPage(1)
						}}
					/>
					<Input
						placeholder="Character IDs (comma-separated)"
						value={characterIds}
						onChange={(e) => {
							setCharacterIds(e.target.value)
							setPage(1)
						}}
					/>
					<Input
						placeholder="Character or Corporation Name"
						value={characterName}
						onChange={(e) => {
							setCharacterName(e.target.value)
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
								<CardTitle>Applications</CardTitle>
								<CardDescription>{listQuery.data?.pagination.total ?? 0} result(s)</CardDescription>
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
								itemLabel="legacy applications"
							/>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Character</TableHead>
									<TableHead>Corporation</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Date</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{(listQuery.data?.items ?? []).map((item) => (
									<TableRow
										key={item.legacyApplicationId}
										className={
											item.legacyApplicationId === selectedLegacyApplicationId ? 'bg-accent/30 cursor-pointer' : 'cursor-pointer'
										}
										onClick={() => setSelectedLegacyApplicationId(item.legacyApplicationId)}
									>
										<TableCell>
											<div className="font-medium">{item.characterName ?? 'Unknown'}</div>
											<div className="text-xs text-muted-foreground font-mono">{item.characterId ?? 'N/A'}</div>
										</TableCell>
										<TableCell>
											<div>{item.corporationName ?? 'Unknown'}</div>
											<div className="text-xs text-muted-foreground font-mono">{item.corporationId ?? 'N/A'}</div>
										</TableCell>
										<TableCell>
											<Badge variant="ghost">{item.status ?? 'unknown'}</Badge>
										</TableCell>
										<TableCell>
											{item.applicationDate ? new Date(item.applicationDate).toLocaleString() : 'Unknown'}
										</TableCell>
									</TableRow>
								))}
								{!listQuery.isLoading && (listQuery.data?.items.length ?? 0) === 0 ? (
									<TableRow>
										<TableCell colSpan={4} className="text-center text-muted-foreground">
											No legacy applications found.
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
									itemLabel="legacy applications"
								/>
							</div>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Legacy Detail</CardTitle>
								<CardDescription>{selected?.legacyApplicationId ?? 'Select an application'}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{selected ? (
							<>
								<div className="text-sm space-y-1">
									<div>
										<span className="font-medium">Character:</span> {selected.characterName ?? 'Unknown'}
									</div>
									<div>
										<span className="font-medium">Corporation:</span> {selected.corporationName ?? 'Unknown'}
									</div>
									<div>
										<span className="font-medium">Legacy User ID:</span>{' '}
										<span className="font-mono text-xs">{selected.legacyAuthUserId ?? 'N/A'}</span>
										<Badge variant="warning" className="ml-2">
											Legacy-only identity
										</Badge>
									</div>
								</div>
								<div className="space-y-2">
									<div className="text-sm font-medium">Event Timeline (Read-only)</div>
									<div className="space-y-2 max-h-80 overflow-auto pr-1">
										{(detailQuery.data?.events ?? []).map((event) => (
											<div key={event.id} className="rounded border p-2 bg-muted/20">
												<div className="flex items-center justify-between gap-2">
													<Badge variant="secondary">{event.eventType}</Badge>
													<span className="text-xs text-muted-foreground">
														{event.eventAt ? new Date(event.eventAt).toLocaleString() : 'Unknown time'}
													</span>
												</div>
												{event.message ? <p className="text-sm mt-1">{event.message}</p> : null}
												<div className="text-xs text-muted-foreground mt-1">
													Actor:{' '}
													<span className="font-mono">{event.legacyActorUserId ?? 'Unknown Legacy Actor'}</span>
													{event.legacyActorUserId ? null : (
														<Badge variant="secondary" className="ml-2">
															Unmapped legacy actor
														</Badge>
													)}
												</div>
											</div>
										))}
										{(detailQuery.data?.events.length ?? 0) === 0 ? (
											<div className="text-sm text-muted-foreground">No legacy events.</div>
										) : null}
									</div>
								</div>
							</>
						) : (
							<div className="text-sm text-muted-foreground">No application selected.</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
