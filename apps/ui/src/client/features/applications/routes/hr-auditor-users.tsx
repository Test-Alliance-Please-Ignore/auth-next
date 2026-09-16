import { Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { UserSearchResultsTable } from '@/components/user-search-results-table'
import { useHrAccessibleCorporations } from '@/features/hr'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'

import { useAuditorUsers } from '../../../hooks/useAuditorUsers'
import { AccessDeniedCard } from '../components/access-denied-card'
import { HrUserSearchContent } from '../components/hr-user-search-content'

export default function HrAuditorUsersPage() {
	const { t } = useAppTranslation()

	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const isSiteAdmin = user?.is_admin === true
	const isAllianceMember = user?.roles?.includes(ROLE_CORE_ALLIANCE_MEMBER) === true
	const isGlobalHrSearchUser = isSiteAdmin || isAuditor
	const { data: hrCorporations = [], isLoading: hrCorporationsLoading } =
		useHrAccessibleCorporations({
			enabled: isAllianceMember && !isGlobalHrSearchUser,
		})

	usePageTitle(t('hrpages.userSearch'))

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (authLoading) {
		return (
			<Container>
				<div className="flex min-h-[320px] items-center justify-center">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	if (!isAllianceMember && !isSiteAdmin) {
		return (
			<Container>
				<AccessDeniedCard
					title={t('hrpages.allianceMembershipRequired')}
					message={t('hrpages.userSearchIsAvailableOnlyToMembersOfAnActive')}
					backHref="/dashboard"
					backLabel={t('hrpages.backToDashboard')}
				/>
			</Container>
		)
	}

	if (!isGlobalHrSearchUser && hrCorporationsLoading) {
		return (
			<Container>
				<div className="flex min-h-[320px] items-center justify-center">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	const hasMemberCorporationHrAccess = hrCorporations.some(
		(corporation) => corporation.isMemberCorporation
	)

	if (!isGlobalHrSearchUser && !hasMemberCorporationHrAccess) {
		return (
			<Container>
				<AccessDeniedCard
					title={t('hrpages.hrAccessRequired')}
					message={t('hrpages.userSearchRequiresHrAccessForAtLeastOneActive')}
					backHref="/dashboard"
					backLabel={t('hrpages.backToDashboard')}
				/>
			</Container>
		)
	}

	return isGlobalHrSearchUser ? <HrAuditorUsersAdminPage /> : <HrScopedUsersPage />
}

function HrAuditorUsersAdminPage() {
	const { t } = useAppTranslation()

	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedQuery, setDebouncedQuery] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState<number>(25)

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(searchQuery)
			setPage(1)
		}, 400)
		return () => clearTimeout(timer)
	}, [searchQuery])

	const offset = (page - 1) * pageSize
	const { data, isLoading } = useAuditorUsers({
		search: debouncedQuery || undefined,
		limit: pageSize,
		offset,
	})

	const users = data?.users ?? []
	const total = data?.total ?? 0
	const totalPages = Math.ceil(total / pageSize)
	const hasPagination = totalPages > 1

	return (
		<Container className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
			<PageHeader
				title={t('hrpages.userSearch')}
				description={t('hrpages.searchAllUsersForHrAuditPurposes')}
			/>

			<div className="flex flex-col space-y-4 lg:min-h-0 lg:flex-1">
				{/* Search */}
				<Card>
					<CardContent className="pt-6">
						<div className="relative">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder={t('hrpages.searchByCharacterNameUserIdCharacterIdDiscord')}
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
						</div>
					</CardContent>
				</Card>

				{/* Results */}
				<Card className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
					<CardHeader>
						<div className="space-y-4">
							<div>
								<CardTitle className="flex items-center gap-2">
									<Users className="h-5 w-5" />
									{t('hrpages.users')}
								</CardTitle>
								<CardDescription>
									{isLoading
										? t('hrpages.searching')
										: debouncedQuery
											? t('hrpages.searchResults')
											: t('hrpages.allUsers')}
								</CardDescription>
							</div>
							<UserSearchPaginationControls
								totalCount={total}
								page={page}
								pageSize={pageSize}
								onPageChange={setPage}
								onPageSizeChange={(nextPageSize) => {
									setPageSize(nextPageSize)
									setPage(1)
								}}
							/>
						</div>
					</CardHeader>
					<CardContent className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
						{isLoading ? (
							<div className="flex justify-center py-8">
								<LoadingSpinner size="md" />
							</div>
						) : users.length === 0 ? (
							<p className="text-center text-muted-foreground py-8">
								{debouncedQuery
									? t('hrpages.noUsersMatchYourSearch')
									: t('hrpages.enterASearchTermAbove')}
							</p>
						) : (
							<div className="lg:min-h-0 lg:flex-1 lg:overflow-auto">
								<UserSearchResultsTable
									users={users}
									userDetailsPath={(userId) => `/hr/users/${userId}`}
								/>
							</div>
						)}
						{!isLoading && users.length > 0 && hasPagination && (
							<div className="mt-4 border-t border-border pt-4">
								<UserSearchPaginationControls
									totalCount={total}
									page={page}
									pageSize={pageSize}
									onPageChange={setPage}
									onPageSizeChange={(nextPageSize) => {
										setPageSize(nextPageSize)
										setPage(1)
									}}
								/>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</Container>
	)
}

function HrScopedUsersPage() {
	const { t } = useAppTranslation()

	return (
		<Container className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
			<PageHeader
				title={t('hrpages.userSearch')}
				description={t('hrpages.searchSurfaceLevelUsersAndLinkedCharactersWithinYourHr')}
			/>

			<div className="flex min-h-0 flex-1 flex-col">
				<HrUserSearchContent fillAvailableHeight />
			</div>
		</Container>
	)
}
