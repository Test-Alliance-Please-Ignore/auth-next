import { ExternalLink, Filter, Search, UserCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchDialog } from '@/components/user-search-dialog'
import { useAdminUsers } from '@/hooks/useAdminUsers'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

export default function UsersPage() {
	const [searchDialogOpen, setSearchDialogOpen] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedQuery, setDebouncedQuery] = useState('')
	const [adminFilter, setAdminFilter] = useState<string>('all')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)

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

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">User Management</h1>
					<p className="text-muted-foreground mt-1">Manage user accounts and permissions</p>
				</div>
				<Button onClick={() => setSearchDialogOpen(true)}>
					<Search className="mr-2 h-4 w-4" />
					Quick Search
				</Button>
			</div>

			{/* Filters */}
			<Card variant="interactive">
				<CardContent className="pt-6">
					<div className="flex flex-col md:flex-row gap-4">
						{/* Search Input */}
						<div className="flex-1">
							<div className="relative">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search by username or character..."
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									className="pl-9"
								/>
							</div>
						</div>

						{/* Admin Filter */}
						<div className="w-full md:w-48">
							<select
								value={adminFilter}
								onChange={(e) => {
									setAdminFilter(e.target.value)
									setPage(1)
								}}
								className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
							>
								<option value="all">All Users</option>
								<option value="admin">Admins Only</option>
								<option value="non-admin">Non-Admins</option>
							</select>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Users Table */}
			<Card variant="interactive">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Users</CardTitle>
							<CardDescription>
								{pagination
									? `Showing ${(pagination.page - 1) * pagination.pageSize + 1}-${Math.min(pagination.page * pagination.pageSize, pagination.totalCount)} of ${pagination.totalCount} users`
									: 'Loading users...'}
							</CardDescription>
						</div>

						{/* Page Size Selector */}
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Show:</span>
							<select
								value={pageSize}
								onChange={(e) => handlePageSizeChange(Number(e.target.value))}
								className="h-9 rounded-md border border-input bg-background px-2 py-1 text-sm"
							>
								<option value={25}>25</option>
								<option value={50}>50</option>
								<option value={100}>100</option>
							</select>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="text-center py-8 text-muted-foreground">Loading users...</div>
					) : users.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">No users found</div>
					) : (
						<>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>User</TableHead>
										<TableHead>Characters</TableHead>
										<TableHead>Discord</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Last Updated</TableHead>
										<TableHead>Created</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{users.map((user) => (
										<TableRow key={user.id}>
											<TableCell>
												<div className="flex items-center gap-3">
													<img
														src={`https://images.evetech.net/characters/${user.mainCharacterId}/portrait?size=64`}
														alt={user.mainCharacterName || 'Unknown Character'}
														className="h-10 w-10 rounded-full"
													/>
													<div>
														<div className="font-medium">
															{user.mainCharacterName || 'Unknown Character'}
														</div>
														<div className="text-xs text-muted-foreground">
															ID: {user.id.slice(0, 8)}...
														</div>
													</div>
												</div>
											</TableCell>
											<TableCell>
												<div className="text-sm">
													{user.characterCount} character{user.characterCount !== 1 ? 's' : ''}
												</div>
											</TableCell>
											<TableCell>
												<span className="text-sm text-muted-foreground">Not available</span>
											</TableCell>
											<TableCell>
												{user.is_admin && (
													<Badge variant="default" className="bg-primary/20 text-primary">
														Admin
													</Badge>
												)}
											</TableCell>
											<TableCell>
												<div className="text-sm" title={formatDateTime(user.updatedAt)}>
													{formatRelativeTime(user.updatedAt)}
												</div>
											</TableCell>
											<TableCell>
												<div className="text-sm" title={formatDateTime(user.createdAt)}>
													{formatRelativeTime(user.createdAt)}
												</div>
											</TableCell>
											<TableCell className="text-right">
												<Link to={`/admin/users/${user.id}`}>
													<Button variant="ghost" size="sm">
														<ExternalLink className="h-4 w-4" />
													</Button>
												</Link>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>

							{/* Pagination */}
							{pagination && pagination.totalPages > 1 && (
								<div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
									<div className="text-sm text-muted-foreground">
										Page {pagination.page} of {pagination.totalPages}
									</div>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={pagination.page === 1}
											onClick={() => setPage(page - 1)}
										>
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={pagination.page === pagination.totalPages}
											onClick={() => setPage(page + 1)}
										>
											Next
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			{/* Quick Search Dialog */}
			<UserSearchDialog open={searchDialogOpen} onOpenChange={setSearchDialogOpen} />
		</div>
	)
}
