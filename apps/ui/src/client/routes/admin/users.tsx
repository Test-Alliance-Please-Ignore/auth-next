import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { UserSearchResultsTable } from '@/components/user-search-results-table'
import { useAdminUsers } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'

import type { AppTranslationKey } from '@/i18n'

export default function UsersPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.users.users.pageTitle'))
	const [searchQuery, setSearchQuery] = useState('')
	const [debouncedQuery, setDebouncedQuery] = useState('')
	const [adminFilter, setAdminFilter] = useState<string>('all')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)
	const [joiningUserId, setJoiningUserId] = useState<string | null>(null)
	const [joinMessage, setJoinMessage] = useState<{
		type: 'success' | 'error'
		key: AppTranslationKey
		values?: Record<string, unknown>
		detail?: string
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
			const trigger = await api.triggerDiscordJoin(userId)
			const result = await api.waitForAdminDiscordRefresh(userId, trigger.workflowInstanceId)
			const totalInvited = result.totalInvited ?? 0
			const totalFailed = result.totalFailed ?? 0

			if (result.status === 'failed') {
				setJoinMessage({
					type: 'error',
					key: result.error?.message
						? 'admin.users.feedback.discordFailedDetail'
						: 'admin.users.feedback.discordFailed',
					values: { error: result.error?.message },
				})
			} else if (totalInvited > 0) {
				setJoinMessage({
					type: 'success',
					key:
						totalFailed > 0
							? 'admin.users.feedback.discordJoinedPartial'
							: 'admin.users.feedback.discordJoined',
					values: { count: totalInvited, failed: totalFailed },
				})
			} else if (totalFailed > 0) {
				setJoinMessage({
					type: 'error',
					key: 'admin.users.feedback.discordJoinFailed',
					values: { count: totalFailed },
				})
			} else {
				setJoinMessage({
					type: 'success',
					key: 'admin.users.feedback.discordNone',
				})
			}

			setTimeout(() => setJoinMessage(null), 5000)
		} catch (error) {
			setJoinMessage({
				type: 'error',
				key: 'admin.users.feedback.discordJoinError',
				detail: error instanceof Error ? error.message : undefined,
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
				<h1 className="text-3xl font-bold gradient-text">{t('admin.users.users.title')}</h1>
				<p className="text-muted-foreground mt-1">{t('admin.users.users.description')}</p>
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
							{joinMessage.detail ?? t(joinMessage.key, joinMessage.values)}
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
									aria-label={t('admin.users.users.searchPlaceholder')}
									placeholder={t('admin.users.users.searchPlaceholder')}
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
									{ value: 'all', label: t('admin.users.users.all') },
									{ value: 'admin', label: t('admin.users.users.adminsOnly') },
									{ value: 'non-admin', label: t('admin.users.users.nonAdmins') },
								]}
								placeholder={t('admin.users.users.all')}
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
							<CardTitle>{t('admin.nav.users')}</CardTitle>
							<CardDescription>
								{isLoading
									? t('admin.users.users.loading')
									: debouncedQuery
										? t('admin.users.users.searchResults')
										: t('admin.users.users.allDescription')}
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
						<div className="text-center py-8 text-muted-foreground">
							{t('admin.users.users.loading')}
						</div>
					) : users.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							{t('admin.users.users.empty')}
						</div>
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
