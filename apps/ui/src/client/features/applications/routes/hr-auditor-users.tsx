import { Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { UserSearchResultsTable } from '@/components/user-search-results-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useAuditorUsers } from '../../../hooks/useAuditorUsers'

export default function HrAuditorUsersPage() {
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')

	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedQuery, setDebouncedQuery] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState<number>(25)

	usePageTitle('User Search')

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

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (authLoading) {
		return (
			<Container>
				<div className="flex items-center justify-center min-h-[320px]">
					<LoadingSpinner size="lg" />
				</div>
			</Container>
		)
	}

	if (!isAuditor && !user?.is_admin) {
		return (
			<Container>
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">Access Denied</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							HR Auditor permission is required to access this page.
						</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	const users = data?.users ?? []
	const total = data?.total ?? 0
	const totalPages = Math.ceil(total / pageSize)
	const hasPagination = totalPages > 1

	return (
		<Container>
			<PageHeader
				title="User Search"
				description="Search all users for HR audit purposes"
			/>

			<div className="mt-6 space-y-4">
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
				<Card>
					<CardHeader>
						<div className="space-y-4">
							<div>
								<CardTitle className="flex items-center gap-2">
									<Users className="h-5 w-5" />
									Users
								</CardTitle>
							<CardDescription>
									{isLoading
										? 'Searching...'
										: debouncedQuery
											? 'Search results'
											: 'All users'}
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
					<CardContent>
						{isLoading ? (
							<div className="flex justify-center py-8">
								<LoadingSpinner size="md" />
							</div>
						) : users.length === 0 ? (
							<p className="text-center text-muted-foreground py-8">
								{debouncedQuery ? 'No users match your search' : 'Enter a search term above'}
							</p>
						) : (
							<UserSearchResultsTable
								users={users}
								userDetailsPath={(userId) => `/hr/users/${userId}`}
							/>
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
