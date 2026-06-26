import { useState } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Navigate, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LoadingPage } from '@/components/ui/loading'
import { useHrAccessibleCorporations } from '@/features/hr'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { api } from '@/lib/api'

export default function AdminLegacyHistoryPage() {
	usePageTitle('HR - Legacy History')
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const canCheckAccessibleCorporations = isAuthenticated && !user?.is_admin && !isAuditor
	const {
		data: accessibleCorporations,
		isLoading: accessibleCorporationsLoading,
	} = useHrAccessibleCorporations({
		enabled: canCheckAccessibleCorporations,
	})
	const [searchParams] = useSearchParams()
	const initialCharacterIds = searchParams.get('characterIds') ?? ''
	const initialCharacterName = searchParams.get('characterName') ?? ''
	const initialCorporationName = searchParams.get('corporationName') ?? ''
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	const [characterIds, setCharacterIds] = useState(initialCharacterIds)
	const [characterName, setCharacterName] = useState(initialCharacterName)
	const [corporationName, setCorporationName] = useState(initialCorporationName)
	const canAccessLegacyHistory =
		user?.is_admin === true ||
		isAuditor ||
		(accessibleCorporations?.some((corp) => corp.isMemberCorporation) ?? false)

	const listQuery = useQuery({
		queryKey: ['hr', 'legacy-history', page, pageSize, characterIds, characterName, corporationName],
		queryFn: () =>
			api.getLegacyHistory({
				page,
				pageSize,
				characterIds: characterIds.trim() || undefined,
				characterName: characterName.trim() || undefined,
				corporationName: corporationName.trim() || undefined,
			}),
		enabled: canAccessLegacyHistory,
	})

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/dashboard" replace />
	}

	if (authLoading || accessibleCorporationsLoading) {
		return <LoadingPage label="Loading legacy history..." />
	}

	if (!canAccessLegacyHistory) {
		return <Navigate to="/dashboard" replace />
	}

	const hasPagination = (listQuery.data?.pagination.total ?? 0) > pageSize
	const currentSearchParams = new URLSearchParams()
	currentSearchParams.set('page', String(page))
	currentSearchParams.set('pageSize', String(pageSize))
	if (characterName.trim()) currentSearchParams.set('characterName', characterName.trim())
	if (corporationName.trim()) currentSearchParams.set('corporationName', corporationName.trim())
	if (characterIds.trim()) currentSearchParams.set('characterIds', characterIds.trim())
	const currentSearchPath = `/hr/legacy-history?${currentSearchParams.toString()}`

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
					Filter legacy applications by character/corporation identity.
				</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-3">
					<Input
						placeholder="Character Name"
						value={characterName}
						onChange={(e) => {
							setCharacterName(e.target.value)
							setPage(1)
						}}
					/>
					<Input
						placeholder="Corporation Name"
						value={corporationName}
						onChange={(e) => {
							setCorporationName(e.target.value)
							setPage(1)
						}}
					/>
					<Input
						placeholder="Character ID(s), comma-separated"
						value={characterIds}
						onChange={(e) => {
							setCharacterIds(e.target.value)
							setPage(1)
						}}
					/>
				</CardContent>
			</Card>

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
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(listQuery.data?.items ?? []).map((item) => (
								<TableRow key={item.legacyApplicationId}>
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
									<TableCell className="text-right">
										<Button
											asChild
											size="sm"
											variant="secondary"
										>
											<a
												href={`/hr/legacy-history/${encodeURIComponent(item.legacyApplicationId)}?returnTo=${encodeURIComponent(currentSearchPath)}`}
												target="_blank"
												rel="noreferrer"
											>
												Open
											</a>
										</Button>
									</TableCell>
								</TableRow>
							))}
							{!listQuery.isLoading && (listQuery.data?.items.length ?? 0) === 0 ? (
								<TableRow>
									<TableCell colSpan={5} className="text-center text-muted-foreground">
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
		</div>
	)
}
