import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, Search, ShieldBan, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

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
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'
import { api } from '@/lib/api'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'

import type { BlacklistEntry, BlacklistTargetType } from '@/lib/api'

export default function BlacklistPage() {
	usePageTitle('Blacklist Management')

	const queryClient = useQueryClient()

	// State
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(50)
	const [searchQuery, setSearchQuery] = useState('')
	const [targetTypeFilter, setTargetTypeFilter] = useState<BlacklistTargetType | 'all'>('all')
	const [autoBlacklistFilter, setAutoBlacklistFilter] = useState<'all' | 'true' | 'false'>('all')

	const [addDialogOpen, setAddDialogOpen] = useState(false)
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [selectedEntry, setSelectedEntry] = useState<BlacklistEntry | null>(null)

	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Form state
	const [formData, setFormData] = useState({
		targetType: 'user' as 'user' | 'character',
		userId: '',
		characterId: '',
		reason: '',
	})

	const debouncedSearch = useDebounce(searchQuery, 500)

	// Fetch blacklists
	const { data, isLoading, error } = useQuery({
		queryKey: [
			'blacklists',
			page,
			pageSize,
			targetTypeFilter === 'all' ? undefined : targetTypeFilter,
			autoBlacklistFilter === 'all' ? undefined : autoBlacklistFilter === 'true',
		],
		queryFn: () =>
			api.getBlacklists({
				page,
				pageSize,
				targetType: targetTypeFilter === 'all' ? undefined : targetTypeFilter,
				isAutoBlacklist: autoBlacklistFilter === 'all' ? undefined : autoBlacklistFilter === 'true',
			}),
	})

	// Create user blacklist mutation
	const createUserBlacklist = useMutation({
		mutationFn: (data: { userId: string; reason: string }) => api.createUserBlacklist(data),
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: ['blacklists'] })
			setAddDialogOpen(false)
			setFormData({ targetType: 'user', userId: '', characterId: '', reason: '' })
			const cascadeMsg =
				result.autoBlacklisted.totalCount > 0
					? ` Auto-blacklisted ${result.autoBlacklisted.characters.length} character(s) and ${result.autoBlacklisted.users.length} user(s).`
					: ''
			setMessage({ type: 'success', text: `User blacklisted successfully.${cascadeMsg}` })
			setTimeout(() => setMessage(null), 5000)
		},
		onError: (error: any) => {
			setMessage({
				type: 'error',
				text: error.message || 'Failed to blacklist user',
			})
			setTimeout(() => setMessage(null), 5000)
		},
	})

	// Create character blacklist mutation
	const createCharacterBlacklist = useMutation({
		mutationFn: (data: { characterId: string; reason: string }) =>
			api.createCharacterBlacklist(data),
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: ['blacklists'] })
			setAddDialogOpen(false)
			setFormData({ targetType: 'user', userId: '', characterId: '', reason: '' })
			setMessage({
				type: 'success',
				text: `Character blacklisted successfully. ${result.autoBlacklistedCount} user(s) auto-blacklisted.`,
			})
			setTimeout(() => setMessage(null), 5000)
		},
		onError: (error: any) => {
			setMessage({
				type: 'error',
				text: error.message || 'Failed to blacklist character',
			})
			setTimeout(() => setMessage(null), 5000)
		},
	})

	// Remove blacklist mutation
	const removeBlacklist = useMutation({
		mutationFn: (id: string) => api.removeBlacklistEntry(id),
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: ['blacklists'] })
			setDeleteDialogOpen(false)
			setSelectedEntry(null)
			const cascadeMsg =
				result.removedCount > 1
					? ` Also removed ${result.removedCount - 1} triggered blacklist(s).`
					: ''
			setMessage({ type: 'success', text: `Blacklist entry removed successfully.${cascadeMsg}` })
			setTimeout(() => setMessage(null), 5000)
		},
		onError: (error: any) => {
			setMessage({
				type: 'error',
				text: error.message || 'Failed to remove blacklist entry',
			})
			setTimeout(() => setMessage(null), 5000)
		},
	})

	const handleAdd = (e: React.FormEvent) => {
		e.preventDefault()

		if (formData.targetType === 'user') {
			if (!formData.userId.trim() || !formData.reason.trim()) {
				setMessage({ type: 'error', text: 'User ID and reason are required' })
				setTimeout(() => setMessage(null), 5000)
				return
			}
			createUserBlacklist.mutate({
				userId: formData.userId.trim(),
				reason: formData.reason.trim(),
			})
		} else {
			if (!formData.characterId.trim() || !formData.reason.trim()) {
				setMessage({ type: 'error', text: 'Character ID and reason are required' })
				setTimeout(() => setMessage(null), 5000)
				return
			}
			createCharacterBlacklist.mutate({
				characterId: formData.characterId.trim(),
				reason: formData.reason.trim(),
			})
		}
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
	}

	const hasActiveFilters =
		targetTypeFilter !== 'all' || autoBlacklistFilter !== 'all' || searchQuery.trim() !== ''

	// Filter data client-side for search
	const filteredData =
		data?.data.filter((entry) => {
			if (!debouncedSearch.trim()) return true
			const search = debouncedSearch.toLowerCase()
			return (
				entry.reason.toLowerCase().includes(search) ||
				entry.userId?.toLowerCase().includes(search) ||
				entry.characterId?.toLowerCase().includes(search) ||
				entry.id.toLowerCase().includes(search)
			)
		}) || []

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Blacklist Management</h1>
					<p className="text-muted-foreground mt-1">
						Manage global blacklist for users and characters
					</p>
				</div>
				<Button onClick={() => setAddDialogOpen(true)}>
					<Plus className="h-4 w-4" />
					Add to Blacklist
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
			<Card variant="interactive">
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
									{ value: 'character', label: 'Character' },
								]}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="autoBlacklist">Auto-Blacklist</Label>
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
							<Label htmlFor="pageSize">Page Size</Label>
							<Select
								inputId="pageSize"
								value={String(pageSize)}
								onValueChange={(v) => setPageSize(Number(v))}
								options={[
									{ value: '25', label: '25' },
									{ value: '50', label: '50' },
									{ value: '100', label: '100' },
								]}
							/>
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
					<CardTitle>Blacklist Entries</CardTitle>
					<CardDescription>
						{isLoading ? (
							<Skeleton className="h-4 w-32" />
						) : (
							`${filteredData.length} entry(ies) • Page ${data?.pagination.page || 1} of ${data?.pagination.totalPages || 1}`
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex justify-center py-8">
							<LoadingSpinner />
						</div>
					) : error ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<AlertTriangle className="h-12 w-12 text-destructive mb-4" />
							<h3 className="text-lg font-semibold">Error Loading Blacklist</h3>
							<p className="text-muted-foreground mt-1">
								{error instanceof Error ? error.message : 'Failed to load blacklist entries'}
							</p>
						</div>
					) : filteredData.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<ShieldBan className="h-12 w-12 text-muted-foreground mb-4" />
							<h3 className="text-lg font-semibold">No Blacklist Entries</h3>
							<p className="text-muted-foreground mt-1">
								{hasActiveFilters
									? 'No entries match your filters'
									: 'No users or characters have been blacklisted yet'}
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
										<TableHead>Target ID</TableHead>
										<TableHead>Reason</TableHead>
										<TableHead>Added</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredData.map((entry) => (
										<TableRow key={entry.id}>
											<TableCell>
												<Badge variant={entry.targetType === 'character' ? 'default' : 'secondary'}>
													{entry.targetType}
												</Badge>
											</TableCell>
											<TableCell className="font-mono text-sm">
												{entry.targetType === 'user' ? (
													<Link
														to={`/admin/users/${entry.userId}`}
														className="text-primary hover:underline"
													>
														{entry.userId?.substring(0, 8)}...
													</Link>
												) : (
													entry.characterId
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
												{entry.isAutoBlacklist ? (
													<Badge variant="ghost" className="gap-1">
														<AlertTriangle className="h-3 w-3" />
														Auto
													</Badge>
												) : (
													<Badge variant="default">Manual</Badge>
												)}
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

							{/* Pagination */}
							{data && data.pagination.totalPages > 1 && (
								<div className="flex items-center justify-between pt-4">
									<p className="text-sm text-muted-foreground">
										Showing {(page - 1) * pageSize + 1} to{' '}
										{Math.min(page * pageSize, data.pagination.totalCount)} of{' '}
										{data.pagination.totalCount} entries
									</p>
									<div className="flex gap-2">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setPage(page - 1)}
											disabled={page === 1}
										>
											Previous
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setPage(page + 1)}
											disabled={page === data.pagination.totalPages}
										>
											Next
										</Button>
									</div>
								</div>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Add Dialog */}
			<Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add to Blacklist</DialogTitle>
						<DialogDescription>
							Block a user or character from accessing the platform
						</DialogDescription>
					</DialogHeader>
					<form onSubmit={handleAdd}>
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="targetType">Target Type</Label>
								<Select
									value={formData.targetType}
									onValueChange={(v) =>
										setFormData({ ...formData, targetType: v as 'user' | 'character' })
									}
									inputId="targetType"
									options={[
										{ value: 'user', label: 'User' },
										{ value: 'character',
											label: 'Character (Auto-blacklists linked users)',
										},
									]}
								/>
							</div>

							{formData.targetType === 'user' ? (
								<div className="space-y-2">
									<Label htmlFor="userId">User ID</Label>
									<Input
										id="userId"
										placeholder="Enter user UUID"
										value={formData.userId}
										onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
										required
									/>
									<p className="text-xs text-muted-foreground">
										Find user ID from the Users page or user detail page
									</p>
								</div>
							) : (
								<div className="space-y-2">
									<Label htmlFor="characterId">Character ID</Label>
									<Input
										id="characterId"
										placeholder="Enter EVE character ID"
										value={formData.characterId}
										onChange={(e) => setFormData({ ...formData, characterId: e.target.value })}
										required
									/>
									<p className="text-xs text-muted-foreground">
										All users with this character will be auto-blacklisted
									</p>
								</div>
							)}

							<div className="space-y-2">
								<Label htmlFor="reason">Reason</Label>
								<Textarea
									id="reason"
									placeholder="Explain why this user/character is being blacklisted"
									value={formData.reason}
									onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
									rows={3}
									required
								/>
							</div>
						</div>
						<DialogFooter className="mt-6">
							<Button variant="cancel" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
							<Button variant="confirm"
								loading={createUserBlacklist.isPending || createCharacterBlacklist.isPending}
								loadingText="Adding..."
							>
								Add to Blacklist
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove from Blacklist</DialogTitle>
						<DialogDescription>
							Are you sure you want to remove this {selectedEntry?.targetType} from the blacklist?
							{selectedEntry?.isAutoBlacklist && (
								<span className="block mt-2 text-orange-500">
									Warning: This is an auto-blacklist entry. The user may still be blocked if the
									triggering character is still blacklisted.
								</span>
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
						<Button variant="destructive" onClick={handleDelete} loading={removeBlacklist.isPending}>
							Remove from Blacklist
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
