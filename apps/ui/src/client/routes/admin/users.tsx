import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { UserSearchResultsTable } from '@/components/user-search-results-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useAdminUsers } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

export default function UsersPage() {
	usePageTitle('Admin - Users')
	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedQuery, setDebouncedQuery] = useState('')
	const [adminFilter, setAdminFilter] = useState<string>('all')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	const [joiningUserId, setJoiningUserId] = useState<string | null>(null)
	const [joinMessage, setJoinMessage] = useState<{
		type: 'success' | 'error'
		text: string
	} | null>(null)

	// Debounce search query
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(searchQuery)
			setPage(1) // Reset to first page on search
		}, 500)

		return () => clearTimeout(timer)
	}, [searchQuery])

	// Build filters
	const filters = {
		search: debouncedQuery || undefined,
		isAdmin: adminFilter === 'all' ? undefined : adminFilter === 'admin',
		page,
		pageSize,
	}

	const { data, isLoading } = useAdminUsers(filters)

	const users = data?.data || []
	const pagination = data?.pagination

	const handlePageSizeChange = (newSize: number) => {
		setPageSize(newSize)
		setPage(1) // Reset to first page
	}

	const totalCount = pagination?.totalCount ?? 0
	const totalPages = pagination?.totalPages ?? 0
	const hasPagination = totalPages > 1

	const handleDiscordJoin = async (userId: string) => {
		setJoiningUserId(userId)
		setJoinMessage(null)

		try {
			const result = await api.triggerDiscordJoin(userId)

			if (result.totalInvited > 0) {
				setJoinMessage({
					type: 'success',
					text: `Successfully joined ${result.totalInvited} Discord server${result.totalInvited !== 1 ? 's' : ''}${result.totalFailed > 0 ? ` (${result.totalFailed} failed)` : ''}`,
				})
			} else if (result.totalFailed > 0) {
				setJoinMessage({
					type: 'error',
					text: `Failed to join ${result.totalFailed} Discord server${result.totalFailed !== 1 ? 's' : ''}`,
				})
			} else {
				setJoinMessage({
					type: 'success',
					text: 'No eligible Discord servers found for this user',
				})
			}

			setTimeout(() => setJoinMessage(null), 5000)
		} catch (error) {
			setJoinMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to join Discord servers',
			})
			setTimeout(() => setJoinMessage(null), 5000)
		} finally {
			setJoiningUserId(null)
		}
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">User Management</h1>
				<p className="text-muted-foreground mt-1">
					Search by character/user/discord identity and manage account access
				</p>
			</div>

			{/* Success/Error Message */}
			{joinMessage && (
				<Card
					className={
						joinMessage.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={joinMessage.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{joinMessage.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Filters */}
			<Card>
				<CardContent className="pt-6">
					<div className="flex flex-col md:flex-row gap-4">
						{/* Search Input */}
						<div className="flex-1">
							<div className="relative">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search by character name/ID, user ID, Discord ID, or Discord username..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="pl-9"
								/>
							</div>
						</div>

						{/* Admin Filter */}
						<div className="w-full md:w-48">
							<Select
								value={adminFilter}
								onValueChange={(value) => {
									setAdminFilter(value)
									setPage(1)
								}}
								options={[
									{ value: 'all', label: 'All Users' },
									{ value: 'admin', label: 'Admins Only' },
									{ value: 'non-admin', label: 'Non-Admins' },
								]}
								placeholder="All Users"
								className="w-full"
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Users Table */}
			<Card>
				<CardHeader>
					<div className="space-y-4">
						<div>
							<CardTitle>Users</CardTitle>
							<CardDescription>
								{isLoading ? 'Loading users...' : debouncedQuery ? 'Search results' : 'All users'}
							</CardDescription>
						</div>
						<UserSearchPaginationControls
							totalCount={totalCount}
							page={page}
							pageSize={pageSize}
							onPageChange={setPage}
							onPageSizeChange={handlePageSizeChange}
						/>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="text-center py-8 text-muted-foreground">Loading users...</div>
					) : users.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">No users found</div>
					) : (
						<>
							<div className="rounded-md border bg-card">
								<UserSearchResultsTable
									users={users}
									userDetailsPath={(userId) => `/admin/users/${userId}`}
									onRefreshDiscordAccess={handleDiscordJoin}
									refreshingDiscordUserId={joiningUserId}
								/>
							</div>

							{hasPagination && (
								<div className="mt-4 border-t border-border pt-4">
									<UserSearchPaginationControls
										totalCount={totalCount}
										page={page}
										pageSize={pageSize}
										onPageChange={setPage}
										onPageSizeChange={handlePageSizeChange}
									/>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

		</div>
	)
}
