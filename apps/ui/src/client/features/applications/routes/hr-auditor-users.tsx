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

import { useAuditorUsers } from '../../../hooks/useAuditorUsers'
import { AccessDeniedCard } from '../components/access-denied-card'
import { HrUserSearchContent } from '../components/hr-user-search-content'

export default function HrAuditorUsersPage() {
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

	usePageTitle('User Search')

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
					title="Alliance Membership Required"
					message="User Search is available only to members of an active alliance corporation."
					backHref="/dashboard"
					backLabel="Back to Dashboard"
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

	if (!isGlobalHrSearchUser && hrCorporations.length === 0) {
		return (
			<Container>
				<AccessDeniedCard
					title="HR Access Required"
					message="User Search requires an active HR role for at least one accessible corporation."
					backHref="/dashboard"
					backLabel="Back to Dashboard"
				/>
			</Container>
		)
	}

	return isGlobalHrSearchUser ? <HrAuditorUsersAdminPage /> : <HrScopedUsersPage />
}

function HrAuditorUsersAdminPage() {
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
			<PageHeader title="User Search" description="Search all users for HR audit purposes" />

			<div className="mt-6 flex flex-col space-y-4 lg:min-h-0 lg:flex-1">
				{/* Search */}
				<Card>
					<CardContent className="pt-6">
						<div className="relative">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Search by character name, user ID, character ID, Discord..."
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
									Users
								</CardTitle>
								<CardDescription>
									{isLoading ? 'Searching...' : debouncedQuery ? 'Search results' : 'All users'}
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
								{debouncedQuery ? 'No users match your search' : 'Enter a search term above'}
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
	return (
		<Container className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
			<PageHeader
				title="User Search"
				description="Search surface-level users and linked characters within your HR access scope."
			/>

			<div className="mt-6 flex min-h-0 flex-1 flex-col">
				<HrUserSearchContent fillAvailableHeight />
			</div>
		</Container>
	)
}
