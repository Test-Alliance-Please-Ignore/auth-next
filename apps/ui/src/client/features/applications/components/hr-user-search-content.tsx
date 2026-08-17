import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/ui/loading'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'

import { UserSearchCard } from '../../corporations/components/user-search-card'
import { useHrUserSearch } from '../../hr/hooks'

export function HrUserSearchContent({
	autoFocus = false,
	enabled = true,
	fillAvailableHeight = false,
}: {
	autoFocus?: boolean
	enabled?: boolean
	fillAvailableHeight?: boolean
}) {
	const [searchQuery, setSearchQuery] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(10)
	const debouncedQuery = useDebounce(searchQuery.trim(), 400)

	useEffect(() => {
		setPage(1)
	}, [debouncedQuery])

	const { data, isLoading, isFetching, error } = useHrUserSearch(
		{ search: debouncedQuery, limit: pageSize, offset: (page - 1) * pageSize },
		{ enabled: enabled && debouncedQuery.length >= 2 }
	)
	const users = data?.users ?? []
	const total = data?.total ?? 0
	const hasPagination = Math.ceil(total / pageSize) > 1
	const isSearching = isLoading || isFetching

	return (
		<div
			className={cn('space-y-4', fillAvailableHeight && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col')}
		>
			<Card>
				<CardContent className="pt-6">
					<div className="space-y-2">
						<div className="relative">
							<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								autoFocus={autoFocus}
								placeholder="Search character name, character ID, Discord username, or Discord ID"
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								className="pl-9"
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Search users and linked characters visible to your HR roles.
						</p>
					</div>
				</CardContent>
			</Card>

			<Card
				className={cn(
					fillAvailableHeight && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden'
				)}
			>
				<CardContent
					className={cn(
						'space-y-4 pt-6',
						fillAvailableHeight && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:pb-8'
					)}
				>
					{error ? (
						<p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
							{error instanceof Error ? error.message : 'Failed to search users'}
						</p>
					) : null}

					{debouncedQuery.length < 2 ? (
						<p className="py-10 text-center text-sm text-muted-foreground">
							Enter at least 2 characters to search the HR user directory.
						</p>
					) : isSearching ? (
						<div className="flex justify-center py-10">
							<LoadingSpinner size="md" />
						</div>
					) : users.length === 0 ? (
						<p className="py-10 text-center text-sm text-muted-foreground">
							No users matched that search.
						</p>
					) : (
						<div
							className={cn(
								'space-y-4',
								fillAvailableHeight && 'lg:flex lg:min-h-0 lg:flex-1 lg:flex-col'
							)}
						>
							<UserSearchPaginationControls
								totalCount={total}
								page={page}
								pageSize={pageSize}
								onPageChange={setPage}
								onPageSizeChange={(nextPageSize) => {
									setPageSize(nextPageSize)
									setPage(1)
								}}
								pageSizeOptions={[10, 25, 50]}
								itemLabel="users"
							/>
							<div
								className={cn(
									'space-y-3 pr-1',
									fillAvailableHeight && 'lg:min-h-0 lg:flex-1 lg:overflow-y-auto'
								)}
							>
								{users.map((user) => (
									<UserSearchCard key={user.summary.id} user={user} />
								))}
							</div>
							{hasPagination && (
								<div className="border-t border-border pt-4">
									<UserSearchPaginationControls
										totalCount={total}
										page={page}
										pageSize={pageSize}
										onPageChange={setPage}
										onPageSizeChange={(nextPageSize) => {
											setPageSize(nextPageSize)
											setPage(1)
										}}
										pageSizeOptions={[10, 25, 50]}
										itemLabel="users"
									/>
								</div>
							)}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
