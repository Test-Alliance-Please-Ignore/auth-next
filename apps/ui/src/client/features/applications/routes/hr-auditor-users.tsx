import { Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { UserSearchResultsTable } from '@/components/user-search-results-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useAuditorUsers } from '../../../hooks/useAuditorUsers'

const PAGE_SIZE = 25

export default function HrAuditorUsersPage() {
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')

	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedQuery, setDebouncedQuery] = useState('')
	const [page, setPage] = useState(1)

	usePageTitle('HR Auditor Search')

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(searchQuery)
			setPage(1)
		}, 400)
		return () => clearTimeout(timer)
	}, [searchQuery])

	const offset = (page - 1) * PAGE_SIZE
	const { data, isLoading } = useAuditorUsers({
		search: debouncedQuery || undefined,
		limit: PAGE_SIZE,
		offset,
	})

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (authLoading) {
		return (
			<div className="container mx-auto max-w-full px-4 py-8">
				<div className="flex items-center justify-center min-h-[320px]">
					<LoadingSpinner size="lg" />
				</div>
			</div>
		)
	}

	if (!isAuditor && !user?.is_admin) {
		return (
			<div className="container mx-auto max-w-full px-4 py-8">
				<Card className="max-w-2xl mx-auto border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
					<CardHeader className="text-center">
						<CardTitle className="text-2xl text-red-900 dark:text-red-100">Access Denied</CardTitle>
						<CardDescription className="mt-2 text-red-700 dark:text-red-300">
							HR Auditor permission is required to access this page.
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		)
	}

	const users = data?.users ?? []
	const total = data?.total ?? 0
	const totalPages = Math.ceil(total / PAGE_SIZE)
	const start = total === 0 ? 0 : offset + 1
	const end = Math.min(offset + PAGE_SIZE, total)

	return (
		<div className="container mx-auto max-w-full px-4 py-8">
			<PageHeader
				title="Auditor Search"
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
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="flex items-center gap-2">
									<Users className="h-5 w-5" />
									Users
								</CardTitle>
								<CardDescription>
									{isLoading
										? 'Searching...'
										: total > 0
											? `Showing ${start}-${end} of ${total} users`
											: debouncedQuery
												? 'No users found'
												: 'Enter a search term to find users'}
								</CardDescription>
							</div>
							{totalPages > 1 && (
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<button
										type="button"
										disabled={page <= 1}
										onClick={() => setPage((p) => p - 1)}
										className="disabled:opacity-40 hover:text-foreground"
									>
										Prev
									</button>
									<span>
										{page} / {totalPages}
									</span>
									<button
										type="button"
										disabled={page >= totalPages}
										onClick={() => setPage((p) => p + 1)}
										className="disabled:opacity-40 hover:text-foreground"
									>
										Next
									</button>
								</div>
							)}
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
								userDetailsPath={(userId) => `/hr/auditor/users/${userId}`}
							/>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
