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
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'

import type { SelectOption } from '@/components/ui/select'
import type { BlacklistEntry, BlacklistTargetType } from '@/lib/api'

const TARGET_TYPE_LABELS: Record<BlacklistTargetType, string> = {
	user: 'User',
	character_id: 'Character ID',
	character_name: 'Character Name',
	discord_id: 'Discord ID',
	corporation_id: 'Corporation ID',
	corporation_name: 'Corporation Name',
	alliance_id: 'Alliance ID',
	alliance_name: 'Alliance Name',
}

type BlacklistCreateTargetType = 'user' | 'character_id' | 'character_name' | 'discord_id'

const BLACKLIST_CREATE_TARGET_OPTIONS: SelectOption[] = [
	{
		value: 'user',
		label: 'User',
		description: 'Block a platform account from logging in.',
	},
	{
		value: 'character_id',
		label: 'Character ID',
		description: 'Block a specific EVE character and auto-blocklist linked users.',
	},
	{
		value: 'character_name',
		label: 'Character Name',
		description: 'Block a character name and auto-blocklist currently linked users.',
	},
	{
		value: 'discord_id',
		label: 'Discord ID',
		description: 'Block a Discord account from linking to the platform.',
	},
]

const BLACKLIST_CREATE_FIELD_CONFIG: Record<
	BlacklistCreateTargetType,
	{ label: string; placeholder: string; helperText: string }
> = {
	user: {
		label: 'User ID',
		placeholder: 'Enter user UUID',
		helperText: 'Find the user ID from the Users page or a user detail page.',
	},
	character_id: {
		label: 'Character ID',
		placeholder: 'Enter EVE character ID',
		helperText: 'This will also auto-blocklist users currently linked to that character.',
	},
	character_name: {
		label: 'Character Name',
		placeholder: 'Enter EVE character name',
		helperText: 'This will auto-blocklist users currently linked to that character name.',
	},
	discord_id: {
		label: 'Discord ID',
		placeholder: 'Enter Discord snowflake ID',
		helperText: 'This blocks the Discord account from linking, even if it is not linked yet.',
	},
}

export default function BlacklistPage() {
	usePageTitle('Blocklist Management')

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

	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

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

			let successMessage = `${TARGET_TYPE_LABELS[targetType]} blocklisted successfully.`
			if (targetType === 'user') {
				const autoBlacklisted = result as {
					autoBlacklisted: { characters: string[]; users: string[]; totalCount: number }
				}
				const cascadeMsg =
					autoBlacklisted.autoBlacklisted.totalCount > 0
						? ` Auto-blocklisted ${autoBlacklisted.autoBlacklisted.characters.length} character(s) and ${autoBlacklisted.autoBlacklisted.users.length} user(s).`
						: ''
				successMessage += cascadeMsg
			} else if (targetType === 'character_id' || targetType === 'character_name') {
				const characterResult = result as { autoBlacklistedCount: number }
				successMessage += ` ${characterResult.autoBlacklistedCount} user(s) auto-blocklisted.`
			}

			setMessage({ type: 'success', text: successMessage })
			setTimeout(() => setMessage(null), 5000)
		},
		onError: (error: any) => {
			setMessage({
				type: 'error',
				text: error.message || 'Failed to create blocklist entry',
			})
			setTimeout(() => setMessage(null), 5000)
		},
	})

	// Remove blacklist mutation
	const removeBlacklist = useMutation({
		mutationFn: (id: string) => api.removeBlacklistEntry(id),
		onSuccess: (result) => {
			void queryClient.invalidateQueries({ queryKey: ['blacklists'] })
			setDeleteDialogOpen(false)
			setSelectedEntry(null)
			const cascadeMsg =
				result.removedCount > 1
					? ` Also removed ${result.removedCount - 1} triggered blocklist(s).`
					: ''
			setMessage({ type: 'success', text: `Blocklist entry removed successfully.${cascadeMsg}` })
			setTimeout(() => setMessage(null), 5000)
		},
		onError: (error: any) => {
			setMessage({
				type: 'error',
				text: error.message || 'Failed to remove blocklist entry',
			})
			setTimeout(() => setMessage(null), 5000)
		},
	})

	const handleAdd = (e: React.FormEvent) => {
		e.preventDefault()

		if (!formData.targetValue.trim() || !formData.reason.trim()) {
			setMessage({
				type: 'error',
				text: `${BLACKLIST_CREATE_FIELD_CONFIG[formData.targetType].label} and reason are required`,
			})
			setTimeout(() => setMessage(null), 5000)
			return
		}

		createBlacklist.mutate({
			targetType: formData.targetType,
			targetValue: formData.targetValue.trim(),
			reason: formData.reason.trim(),
		})
	}

	const openDeleteDialog = (entry: BlacklistEntry) => {
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

	const addBlacklistFieldConfig = BLACKLIST_CREATE_FIELD_CONFIG[formData.targetType]

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Blocklist Management</h1>
					<p className="text-muted-foreground mt-1">
						Manage global blocklist for users and characters
					</p>
				</div>
				<Button onClick={() => setAddDialogOpen(true)}>
					<Plus className="h-4 w-4" />
					Add to Blocklist
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
							<Label htmlFor="search">Search</Label>
							<div className="relative">
								<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
								<Input
									id="search"
									placeholder="Search ID, reason..."
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
							<Label htmlFor="targetType">Target Type</Label>
							<Select
								inputId="targetType"
								value={targetTypeFilter}
								onValueChange={(v) => setTargetTypeFilter(v as BlacklistTargetType | 'all')}
								options={[
									{ value: 'all', label: 'All Types' },
									{ value: 'user', label: 'User' },
									{ value: 'character_id', label: 'Character ID' },
									{ value: 'character_name', label: 'Character Name' },
									{ value: 'discord_id', label: 'Discord ID' },
									{ value: 'corporation_id', label: 'Corporation ID' },
									{ value: 'corporation_name', label: 'Corporation Name' },
									{ value: 'alliance_id', label: 'Alliance ID' },
									{ value: 'alliance_name', label: 'Alliance Name' },
								]}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="autoBlacklist">Auto-Blocklist</Label>
							<Select
								value={autoBlacklistFilter}
								onValueChange={(v) => setAutoBlacklistFilter(v as 'all' | 'true' | 'false')}
								inputId="autoBlacklist"
								options={[
									{ value: 'all', label: 'All' },
									{ value: 'true', label: 'Auto Only' },
									{ value: 'false', label: 'Manual Only' },
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
								Search
							</Button>
						</div>
					</div>

					{hasActiveFilters && (
						<div className="mt-4 flex items-center justify-between">
							<p className="text-sm text-muted-foreground">Active filters applied</p>
							<Button variant="ghost" size="sm" onClick={clearFilters}>
								<X className="h-4 w-4" />
								Clear Filters
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
							<CardTitle>Blocklist Entries</CardTitle>
							<CardDescription>
								{isLoading ? (
									<Skeleton className="h-4 w-32" />
								) : (
									`${filteredData.length} ${filteredData.length === 1 ? 'entry' : 'entries'} • Page ${data?.pagination.page || 1} of ${data?.pagination.totalPages || 1}`
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
							itemLabel="entries"
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
							<h3 className="text-lg font-semibold">Error Loading Blocklist</h3>
							<p className="text-muted-foreground mt-1">
								{error instanceof Error ? error.message : 'Failed to load blocklist entries'}
							</p>
						</div>
					) : filteredData.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<ShieldBan className="h-12 w-12 text-muted-foreground mb-4" />
							<h3 className="text-lg font-semibold">No Blocklist Entries</h3>
							<p className="text-muted-foreground mt-1">
								{hasActiveFilters
									? 'No entries match your filters'
									: 'No users or characters have been blocklisted yet'}
							</p>
							{!hasActiveFilters && (
								<Button className="mt-4" onClick={() => setAddDialogOpen(true)}>
									<Plus className="h-4 w-4" />
									Add First Entry
								</Button>
							)}
						</div>
					) : (
						<div className="space-y-4">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Type</TableHead>
										<TableHead>Target Value</TableHead>
										<TableHead>Reason</TableHead>
										<TableHead>Added</TableHead>
										<TableHead>Entry Mode</TableHead>
										<TableHead className="text-right">Actions</TableHead>
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
													{TARGET_TYPE_LABELS[entry.targetType] ?? entry.targetType}
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
															Auto
														</Badge>
													) : (
														<Badge variant="default" className="w-fit">
															Manual
														</Badge>
													)}
													{entry.triggeredBy && (
														<span
															className="text-xs text-muted-foreground font-mono"
															title={`Triggered by entry: ${entry.triggeredBy}`}
														>
															via {entry.triggeredBy.substring(0, 8)}...
														</span>
													)}
												</div>
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openDeleteDialog(entry)}
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
										itemLabel="entries"
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
						<DialogTitle>Add to Blocklist</DialogTitle>
						<DialogDescription>
							Block a user account, character, or Discord account from accessing the platform
						</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleAdd}>
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="targetType">Target Type</Label>
								<Select
									value={formData.targetType}
									onValueChange={(v) =>
										setFormData({
											...formData,
											targetType: v as BlacklistCreateTargetType,
											targetValue: '',
										})
									}
									inputId="targetType"
									options={BLACKLIST_CREATE_TARGET_OPTIONS}
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
								<Label htmlFor="reason">Reason</Label>
								<Textarea
									id="reason"
									placeholder="Explain why this user/character is being blocklisted"
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
								Cancel
							</Button>
							<Button variant="confirm" loading={createBlacklist.isPending} loadingText="Adding...">
								Add to Blocklist
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove from Blocklist</DialogTitle>
						<DialogDescription>
							Are you sure you want to remove this{' '}
							{selectedEntry ? TARGET_TYPE_LABELS[selectedEntry.targetType] : ''} from the
							blocklist?
							{selectedEntry?.isAutoBlacklist && (
								<span className="block mt-2 text-orange-500">
									Warning: This is an auto-blocklist entry. The user may still be blocked if the
									triggering character is still blocklisted.
								</span>
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							loading={removeBlacklist.isPending}
						>
							Remove from Blocklist
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
