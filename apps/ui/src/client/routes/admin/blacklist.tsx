import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, Search, ShieldBan, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'

import type { FormEvent } from 'react'
import type { SelectOption } from '@/components/ui/select'
import type { BlacklistEntry, BlacklistTargetType } from '@/lib/api'

type BlacklistCreateTargetType = 'user' | 'character_id' | 'character_name' | 'discord_id'

export default function BlacklistPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.blocklist.title'))
	const targetTypeLabels: Record<BlacklistTargetType, string> = {
		user: t('admin.blocklist.targets.user'),
		character_id: t('admin.blocklist.targets.character_id'),
		character_name: t('admin.blocklist.targets.character_name'),
		discord_id: t('admin.blocklist.targets.discord_id'),
		corporation_id: t('admin.blocklist.targets.corporation_id'),
		corporation_name: t('admin.blocklist.targets.corporation_name'),
		alliance_id: t('admin.blocklist.targets.alliance_id'),
		alliance_name: t('admin.blocklist.targets.alliance_name'),
	}

	const createTargetOptions: SelectOption[] = [
		{
			value: 'user',
			label: t('admin.blocklist.targets.user'),
			description: t('admin.blocklist.create.user.description'),
		},
		{
			value: 'character_id',
			label: t('admin.blocklist.targets.character_id'),
			description: t('admin.blocklist.create.character_id.description'),
		},
		{
			value: 'character_name',
			label: t('admin.blocklist.targets.character_name'),
			description: t('admin.blocklist.create.character_name.description'),
		},
		{
			value: 'discord_id',
			label: t('admin.blocklist.targets.discord_id'),
			description: t('admin.blocklist.create.discord_id.description'),
		},
	]

	const createFieldConfig: Record<
		BlacklistCreateTargetType,
		{ label: string; placeholder: string; helperText: string }
	> = {
		user: {
			label: t('admin.blocklist.create.user.label'),
			placeholder: t('admin.blocklist.create.user.placeholder'),
			helperText: t('admin.blocklist.create.user.helper'),
		},
		character_id: {
			label: t('admin.blocklist.targets.character_id'),
			placeholder: t('admin.blocklist.create.character_id.placeholder'),
			helperText: t('admin.blocklist.create.character_id.helper'),
		},
		character_name: {
			label: t('admin.blocklist.targets.character_name'),
			placeholder: t('admin.blocklist.create.character_name.placeholder'),
			helperText: t('admin.blocklist.create.character_name.helper'),
		},
		discord_id: {
			label: t('admin.blocklist.targets.discord_id'),
			placeholder: t('admin.blocklist.create.discord_id.placeholder'),
			helperText: t('admin.blocklist.create.discord_id.helper'),
		},
	}

	const queryClient = useQueryClient()

	// State
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(50)
	const [searchQuery, setSearchQuery] = useState('')
	const [appliedSearch, setAppliedSearch] = useState('')
	const [targetTypeFilter, setTargetTypeFilter] = useState<BlacklistTargetType | 'all'>('all')
	const [autoBlacklistFilter, setAutoBlacklistFilter] = useState<'all' | 'true' | 'false'>('all')

	const [addDialogOpen, setAddDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedEntry, setSelectedEntry] = useState<BlacklistEntry | null>(null)

	const { message, showSuccess, showError, clearMessage } = useMessage()

	// Form state
	const [formData, setFormData] = useState({
		targetType: 'user' as BlacklistCreateTargetType,
		targetValue: '',
		reason: '',
	})

	useEffect(() => {
		setPage(1)
	}, [appliedSearch, targetTypeFilter, autoBlacklistFilter])

	// Fetch blacklists
	const { data, isLoading, error } = useQuery({
		queryKey: [
			'blacklists',
			page,
			pageSize,
			targetTypeFilter === 'all' ? undefined : targetTypeFilter,
			autoBlacklistFilter === 'all' ? undefined : autoBlacklistFilter === 'true',
			appliedSearch.trim() || undefined,
		],
		queryFn: () =>
			api.getBlacklists({
				page,
				pageSize,
				targetType: targetTypeFilter === 'all' ? undefined : targetTypeFilter,
				isAutoBlacklist: autoBlacklistFilter === 'all' ? undefined : autoBlacklistFilter === 'true',
				search: appliedSearch.trim() || undefined,
			}),
	})

	type CreateBlacklistRequest = {
		targetType: BlacklistCreateTargetType
		targetValue: string
		reason: string
	}

	const resetAddForm = () => {
		setFormData({
			targetType: 'user',
			targetValue: '',
			reason: '',
		})
	}

	const createBlacklist = useMutation({
		mutationFn: async (data: CreateBlacklistRequest) => {
			switch (data.targetType) {
				case 'user':
					return {
						targetType: data.targetType,
						result: await api.createUserBlacklist({
							userId: data.targetValue,
							reason: data.reason,
						}),
					}
				case 'character_id':
					return {
						targetType: data.targetType,
						result: await api.createCharacterBlacklist({
							characterId: data.targetValue,
							reason: data.reason,
						}),
					}
				case 'character_name':
					return {
						targetType: data.targetType,
						result: await api.createCharacterBlacklist({
							characterName: data.targetValue,
							reason: data.reason,
						}),
					}
				case 'discord_id':
					return {
						targetType: data.targetType,
						result: await api.createDiscordBlacklist({
							discordUserId: data.targetValue,
							reason: data.reason,
						}),
					}
			}
		},
		onSuccess: ({ targetType, result }) => {
			void queryClient.invalidateQueries({ queryKey: ['blacklists'] })
			setAddDialogOpen(false)
			resetAddForm()

			showSuccess((t) => {
				const parts = [t(`admin.blocklist.success.${targetType}`)]
				if (
					targetType === 'user' &&
					'autoBlacklisted' in result &&
					result.autoBlacklisted.totalCount > 0
				) {
					parts.push(
						t('admin.blocklist.cascade', {
							characters: result.autoBlacklisted.characters.length,
							users: result.autoBlacklisted.users.length,
						})
					)
				} else if ('autoBlacklistedCount' in result) {
					parts.push(t('admin.blocklist.usersBlocked', { count: result.autoBlacklistedCount }))
				}
				return parts.join(' ')
			}, 5000)
		},
		onError: (error) => {
			showError((t) =>
				error instanceof Error && error.message ? error.message : t('admin.blocklist.createError')
			)
		},
	})

	// Remove blacklist mutation
	const removeBlacklist = useMutation({
		mutationFn: (id: string) => api.removeBlacklistEntry(id),
		onSuccess: (result) => {
			void queryClient.invalidateQueries({ queryKey: ['blacklists'] })
			setDeleteDialogOpen(false)
			setSelectedEntry(null)
			showSuccess((t) => {
				const removed = t('admin.blocklist.removed')
				return result.removedCount > 1
					? `${removed} ${t('admin.blocklist.cascadeRemoved', { count: result.removedCount - 1 })}`
					: removed
			}, 5000)
		},
		onError: (error) => {
			showError((t) =>
				error instanceof Error && error.message ? error.message : t('admin.blocklist.removeError')
			)
		},
	})

	const handleAdd = (e: FormEvent) => {
		e.preventDefault()

		if (!formData.targetValue.trim() || !formData.reason.trim()) {
			showError((t) => t(`admin.blocklist.required.${formData.targetType}`))
			return
		}

		createBlacklist.mutate({
			targetType: formData.targetType,
			targetValue: formData.targetValue.trim(),
			reason: formData.reason.trim(),
		})
	}

	const openDeleteDialog = (entry: BlacklistEntry) => {
		clearMessage()
		setSelectedEntry(entry)
		setDeleteDialogOpen(true)
	}

	const handleDelete = () => {
		if (selectedEntry) {
			removeBlacklist.mutate(selectedEntry.id)
		}
	}

	const clearFilters = () => {
		setTargetTypeFilter('all')
		setAutoBlacklistFilter('all')
		setSearchQuery('')
		setAppliedSearch('')
	}

	const hasActiveFilters =
		targetTypeFilter !== 'all' || autoBlacklistFilter !== 'all' || appliedSearch.trim() !== ''

	const filteredData = data?.data || []
	const totalCount = data?.pagination.totalCount ?? 0
	const hasPagination = (data?.pagination.totalPages ?? 0) > 1

	const handlePageSizeChange = (newSize: number) => {
		setPageSize(newSize)
		setPage(1)
	}

	const addBlacklistFieldConfig = createFieldConfig[formData.targetType]

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{t('admin.blocklist.title')}</h1>
					<p className="text-muted-foreground mt-1">{t('admin.blocklist.description')}</p>
				</div>
				<Button
					onClick={() => {
						clearMessage()
						setAddDialogOpen(true)
					}}
				>
					<Plus className="h-4 w-4" />
					{t('admin.blocklist.add')}
				</Button>
			</div>

			{/* Success/Error Message */}
			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Filters */}
			<Card>
				<CardContent className="pt-6">
					<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
						<div className="space-y-2">
							<Label htmlFor="search">{t('admin.blocklist.search')}</Label>
							<div className="relative">
								<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
								<Input
									id="search"
									placeholder={t('admin.blocklist.searchPlaceholder')}
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault()
											setAppliedSearch(searchQuery)
										}
									}}
									className="pl-9"
								/>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="targetType">{t('admin.blocklist.targetType')}</Label>
							<Select
								inputId="targetType"
								value={targetTypeFilter}
								onValueChange={(v) => setTargetTypeFilter(v as BlacklistTargetType | 'all')}
								options={[
									{ value: 'all', label: t('admin.blocklist.allTypes') },
									{ value: 'user', label: t('admin.blocklist.targets.user') },
									{ value: 'character_id', label: t('admin.blocklist.targets.character_id') },
									{ value: 'character_name', label: t('admin.blocklist.targets.character_name') },
									{ value: 'discord_id', label: t('admin.blocklist.targets.discord_id') },
									{ value: 'corporation_id', label: t('admin.blocklist.targets.corporation_id') },
									{
										value: 'corporation_name',
										label: t('admin.blocklist.targets.corporation_name'),
									},
									{ value: 'alliance_id', label: t('admin.blocklist.targets.alliance_id') },
									{ value: 'alliance_name', label: t('admin.blocklist.targets.alliance_name') },
								]}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="autoBlacklist">{t('admin.blocklist.autoBlocklist')}</Label>
							<Select
								value={autoBlacklistFilter}
								onValueChange={(v) => setAutoBlacklistFilter(v as 'all' | 'true' | 'false')}
								inputId="autoBlacklist"
								options={[
									{ value: 'all', label: t('admin.blocklist.all') },
									{ value: 'true', label: t('admin.blocklist.autoOnly') },
									{ value: 'false', label: t('admin.blocklist.manualOnly') },
								]}
							/>
						</div>
						<div className="space-y-2">
							<Label>&nbsp;</Label>
							<Button
								type="button"
								variant="secondary"
								className="w-full"
								onClick={() => setAppliedSearch(searchQuery)}
							>
								{t('admin.blocklist.search')}
							</Button>
						</div>
					</div>

					{hasActiveFilters && (
						<div className="mt-4 flex items-center justify-between">
							<p className="text-sm text-muted-foreground">{t('admin.blocklist.activeFilters')}</p>
							<Button variant="ghost" size="sm" onClick={clearFilters}>
								<X className="h-4 w-4" />
								{t('admin.blocklist.clearFilters')}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Blacklist Table */}
			<Card>
				<CardHeader>
					<div className="space-y-4">
						<div>
							<CardTitle>{t('admin.blocklist.entries')}</CardTitle>
							<CardDescription>
								{isLoading ? (
									<Skeleton className="h-4 w-32" />
								) : (
									t('admin.blocklist.summary', {
										count: filteredData.length,
										page: data?.pagination.page || 1,
										pages: data?.pagination.totalPages || 1,
									})
								)}
							</CardDescription>
						</div>
						<UserSearchPaginationControls
							totalCount={totalCount}
							page={page}
							pageSize={pageSize}
							onPageChange={setPage}
							onPageSizeChange={handlePageSizeChange}
							pageSizeOptions={[10, 25, 50, 100]}
							itemLabel={t('admin.blocklist.entryLabel', { count: totalCount })}
						/>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex justify-center py-8">
							<LoadingSpinner />
						</div>
					) : error ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<AlertTriangle className="h-12 w-12 text-destructive mb-4" />
							<h3 className="text-lg font-semibold">{t('admin.blocklist.loadTitle')}</h3>
							<p className="text-muted-foreground mt-1">
								{error instanceof Error ? error.message : t('admin.blocklist.loadError')}
							</p>
						</div>
					) : filteredData.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<ShieldBan className="h-12 w-12 text-muted-foreground mb-4" />
							<h3 className="text-lg font-semibold">{t('admin.blocklist.empty')}</h3>
							<p className="text-muted-foreground mt-1">
								{hasActiveFilters
									? t('admin.blocklist.emptyFiltered')
									: t('admin.blocklist.emptyHint')}
							</p>
							{!hasActiveFilters && (
								<Button
									className="mt-4"
									onClick={() => {
										clearMessage()
										setAddDialogOpen(true)
									}}
								>
									<Plus className="h-4 w-4" />
									{t('admin.blocklist.addFirst')}
								</Button>
							)}
						</div>
					) : (
						<div className="space-y-4">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t('admin.blocklist.type')}</TableHead>
										<TableHead>{t('admin.blocklist.targetValue')}</TableHead>
										<TableHead>{t('admin.blocklist.reason')}</TableHead>
										<TableHead>{t('admin.blocklist.added')}</TableHead>
										<TableHead>{t('admin.blocklist.mode')}</TableHead>
										<TableHead className="text-right">{t('admin.blocklist.actions')}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredData.map((entry) => (
										<TableRow key={entry.id}>
											<TableCell>
												<Badge
													variant={
														entry.targetType === 'character_id' ||
														entry.targetType === 'character_name'
															? 'default'
															: 'secondary'
													}
												>
													{targetTypeLabels[entry.targetType] ?? entry.targetType}
												</Badge>
											</TableCell>
											<TableCell className="font-mono text-sm">
												{entry.targetType === 'user' ? (
													<Link
														to={`/admin/users/${entry.targetValue}`}
														className="text-primary hover:underline"
													>
														{entry.targetValue.substring(0, 8)}...
													</Link>
												) : (
													entry.targetValue
												)}
											</TableCell>
											<TableCell className="max-w-md truncate" title={entry.reason}>
												{entry.reason}
											</TableCell>
											<TableCell>
												<span title={formatDateTime(entry.createdAt)}>
													{formatRelativeTime(entry.createdAt)}
												</span>
											</TableCell>
											<TableCell>
												<div className="flex flex-col gap-1">
													{entry.isAutoBlacklist ? (
														<Badge variant="ghost" className="gap-1 w-fit">
															<AlertTriangle className="h-3 w-3" />
															{t('admin.blocklist.auto')}
														</Badge>
													) : (
														<Badge variant="default" className="w-fit">
															{t('admin.blocklist.manual')}
														</Badge>
													)}
													{entry.triggeredBy && (
														<span
															className="text-xs text-muted-foreground font-mono"
															title={t('admin.blocklist.triggeredBy', { id: entry.triggeredBy })}
														>
															{t('admin.blocklist.via', { id: entry.triggeredBy.substring(0, 8) })}
														</span>
													)}
												</div>
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openDeleteDialog(entry)}
													aria-label={t('admin.blocklist.removeEntry', {
														target: entry.targetValue,
													})}
													className="text-destructive hover:text-destructive"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>

							{hasPagination && (
								<div className="mt-4 border-t border-border pt-4">
									<UserSearchPaginationControls
										totalCount={totalCount}
										page={page}
										pageSize={pageSize}
										onPageChange={setPage}
										onPageSizeChange={handlePageSizeChange}
										pageSizeOptions={[10, 25, 50, 100]}
										itemLabel={t('admin.blocklist.entryLabel', { count: totalCount })}
									/>
								</div>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Add Dialog */}
			<Dialog
				open={addDialogOpen}
				onOpenChange={(open) => {
					setAddDialogOpen(open)
					if (!open) {
						resetAddForm()
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.blocklist.add')}</DialogTitle>
						<DialogDescription>{t('admin.blocklist.addDescription')}</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleAdd}>
						{message?.type === 'error' && (
							<p role="alert" className="mb-4 text-sm text-destructive">
								{message.text}
							</p>
						)}
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="createTargetType">{t('admin.blocklist.targetType')}</Label>
								<Select
									value={formData.targetType}
									onValueChange={(v) =>
										setFormData({
											...formData,
											targetType: v as BlacklistCreateTargetType,
											targetValue: '',
										})
									}
									inputId="createTargetType"
									options={createTargetOptions}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="targetValue">{addBlacklistFieldConfig.label}</Label>
								<Input
									id="targetValue"
									placeholder={addBlacklistFieldConfig.placeholder}
									value={formData.targetValue}
									onChange={(e) => setFormData({ ...formData, targetValue: e.target.value })}
									required
								/>
								<p className="text-xs text-muted-foreground">
									{addBlacklistFieldConfig.helperText}
								</p>
							</div>

							<div className="space-y-2">
								<Label htmlFor="reason">{t('admin.blocklist.reason')}</Label>
								<Textarea
									id="reason"
									placeholder={t('admin.blocklist.reasonPlaceholder')}
									value={formData.reason}
									onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
									rows={3}
									required
								/>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button
								variant="cancel"
								type="button"
								onClick={() => {
									setAddDialogOpen(false)
									resetAddForm()
								}}
							>
								{t('common.cancel')}
							</Button>
							<Button
								variant="confirm"
								loading={createBlacklist.isPending}
								loadingText={t('admin.blocklist.adding')}
							>
								{t('admin.blocklist.add')}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('admin.blocklist.remove')}</DialogTitle>
						<DialogDescription>
							{t('admin.blocklist.removeConfirm', {
								type: selectedEntry
									? (targetTypeLabels[selectedEntry.targetType] ?? selectedEntry.targetType)
									: '',
							})}
							{selectedEntry?.isAutoBlacklist && (
								<span className="block mt-2 text-orange-500">
									{t('admin.blocklist.autoWarning')}
								</span>
							)}
						</DialogDescription>
					</DialogHeader>
					{message?.type === 'error' && (
						<p role="alert" className="text-sm text-destructive">
							{message.text}
						</p>
					)}
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteDialogOpen(false)}>
							{t('common.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							loading={removeBlacklist.isPending}
						>
							{t('admin.blocklist.remove')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
