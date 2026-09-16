import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { hasExplicitMemberCorporationHrRole, useHrAccessibleCorporations } from '@/features/hr'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { getActiveLocale, useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'

export default function AdminLegacyHistoryPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('hrpages.hrLegacyHistory'))
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const canCheckAccessibleCorporations = isAuthenticated && !user?.is_admin && !isAuditor
	const { data: accessibleCorporations, isLoading: accessibleCorporationsLoading } =
		useHrAccessibleCorporations({
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
		hasExplicitMemberCorporationHrRole(accessibleCorporations)

	const listQuery = useQuery({
		queryKey: [
			'hr',
			'legacy-history',
			page,
			pageSize,
			characterIds,
			characterName,
			corporationName,
		],
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
		return <LoadingPage label={t('hrpages.loadingLegacyHistory')} />
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
		<Container className="space-y-6">
			<PageHeader
				title={t('hrpages.legacyHistory')}
				description={t('hrpages.readOnlyLegacyCorporationApplicationHistoryUseThisForHistorical')}
			/>

			<Card>
				<CardHeader>
					<CardTitle>{t('hrpages.search')}</CardTitle>
					<CardDescription>
						{t('hrpages.filterLegacyApplicationsByCharacterCorporationIdentity')}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-3">
					<Input
						placeholder={t('hrpages.characterName')}
						value={characterName}
						onChange={(e) => {
							setCharacterName(e.target.value)
							setPage(1)
						}}
					/>
					<Input
						placeholder={t('hrpages.corporationName')}
						value={corporationName}
						onChange={(e) => {
							setCorporationName(e.target.value)
							setPage(1)
						}}
					/>
					<Input
						placeholder={t('hrpages.characterIdSCommaSeparated')}
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
							<CardTitle>{t('hrpages.applications2')}</CardTitle>
							<CardDescription>
								{listQuery.data?.pagination.total ?? 0}
								{t('hrpages.resultS')}
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
							itemLabel={t('hrpages.legacyApplications')}
						/>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t('hrpages.character')}</TableHead>
								<TableHead>{t('hrpages.corporation')}</TableHead>
								<TableHead>{t('hrpages.status')}</TableHead>
								<TableHead>{t('hrpages.date')}</TableHead>
								<TableHead className="text-right">{t('hrpages.actions')}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(listQuery.data?.items ?? []).map((item) => (
								<TableRow key={item.legacyApplicationId}>
									<TableCell>
										<div className="font-medium">{item.characterName ?? t('hrpages.unknown')}</div>
										<div className="text-xs text-muted-foreground font-mono">
											{item.characterId ?? 'N/A'}
										</div>
									</TableCell>
									<TableCell>
										<div>{item.corporationName ?? t('hrpages.unknown')}</div>
										<div className="text-xs text-muted-foreground font-mono">
											{item.corporationId ?? 'N/A'}
										</div>
									</TableCell>
									<TableCell>
										<Badge variant="ghost">{item.status ?? 'unknown'}</Badge>
									</TableCell>
									<TableCell>
										{item.applicationDate
											? new Date(item.applicationDate).toLocaleString(getActiveLocale())
											: t('hrpages.unknown')}
									</TableCell>
									<TableCell className="text-right">
										<Button asChild size="sm" variant="secondary">
											<a
												href={`/hr/legacy-history/${encodeURIComponent(item.legacyApplicationId)}?returnTo=${encodeURIComponent(currentSearchPath)}`}
												target="_blank"
												rel="noreferrer"
											>
												{t('hrpages.open')}
											</a>
										</Button>
									</TableCell>
								</TableRow>
							))}
							{!listQuery.isLoading && (listQuery.data?.items.length ?? 0) === 0 ? (
								<TableRow>
									<TableCell colSpan={5} className="text-center text-muted-foreground">
										{t('hrpages.noLegacyApplicationsFound')}
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
								itemLabel={t('hrpages.legacyApplications')}
							/>
						</div>
					) : null}
				</CardContent>
			</Card>
		</Container>
	)
}
