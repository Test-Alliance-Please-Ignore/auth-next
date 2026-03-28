import { Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { GroupForm } from '@/components/group-form'
import { GroupList } from '@/components/group-list'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useCategories } from '@/hooks/useCategories'
import { useCreateGroup, useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { CreateGroupRequest, GroupsFilters } from '@/lib/api'

export default function GroupsPage() {
	usePageTitle('Admin - Groups')
	const [filters, setFilters] = useState<GroupsFilters>({})
	const { data: groups, isLoading: groupsLoading } = useGroups(filters)
	const { data: categories } = useCategories()
	const createGroup = useCreateGroup()

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)

	// Filter state
	const [searchInput, setSearchInput] = useState('')

	// Error/success messages
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Update filter
	const updateFilter = (key: keyof GroupsFilters, value: string | undefined) => {
		setFilters((prev) => {
			if (!value) {
				const { [key]: _, ...rest } = prev
				return rest
			}
			return { ...prev, [key]: value }
		})
	}

	// Clear all filters
	const clearFilters = () => {
		setFilters({})
		setSearchInput('')
	}

	useEffect(() => {
		const timer = setTimeout(() => {
			const query = searchInput.trim()
			setFilters((prev) => {
				if (!query) {
					const { search: _search, ...rest } = prev
					return rest
				}
				return { ...prev, search: query }
			})
		}, 300)

		return () => clearTimeout(timer)
	}, [searchInput])

	const optimisticSearch = searchInput.trim().toLowerCase()
	const displayedGroups = (groups || []).filter((group) =>
		optimisticSearch ? group.name.toLowerCase().includes(optimisticSearch) : true
	)

	const hasActiveFilters = Object.keys(filters).length > 0

	// Handlers
	const handleCreate = async (data: CreateGroupRequest) => {
		try {
			await createGroup.mutateAsync(data)
			setCreateDialogOpen(false)
			setMessage({ type: 'success', text: 'Group created successfully!' })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : 'Failed to create group',
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Groups Overview</h1>
					<p className="text-muted-foreground mt-1">View and manage all groups</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Create Group
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
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Filters</CardTitle>
							<CardDescription>
								Filter groups by category, visibility, join mode, or search
							</CardDescription>
						</div>
						{hasActiveFilters && (
							<Button variant="ghost" size="sm" onClick={clearFilters}>
								<X className="mr-2 h-4 w-4" />
								Clear Filters
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						{/* Category Filter */}
						<div className="space-y-2">
							<Label>Category</Label>
							<Select
								value={filters.categoryId ?? 'all'}
								onValueChange={(value) =>
									updateFilter('categoryId', value === 'all' ? undefined : value)
								}
								options={[
									{ value: 'all', label: 'All categories' },
									...(categories?.map((category) => ({ value: category.id,
										label: category.name,
									})) ?? []),
								]}
								placeholder="All categories"
							/>
						</div>

						{/* Visibility Filter */}
						<div className="space-y-2">
							<Label>Visibility</Label>
							<Select
								value={filters.visibility ?? 'all'}
								onValueChange={(value) =>
									updateFilter('visibility', value === 'all' ? undefined : value)
								}
								options={[
									{ value: 'all', label: 'All visibilities' },
									{ value: 'public', label: 'Public' },
									{ value: 'hidden', label: 'Hidden' },
									{ value: 'system', label: 'System' },
								]}
								placeholder="All visibilities"
							/>
						</div>

						{/* Join Mode Filter */}
						<div className="space-y-2">
							<Label>Join Mode</Label>
							<Select
								value={filters.joinMode ?? 'all'}
								onValueChange={(value) =>
									updateFilter('joinMode', value === 'all' ? undefined : value)
								}
								options={[
									{ value: 'all', label: 'All modes' },
									{ value: 'open', label: 'Open' },
									{ value: 'approval', label: 'Approval' },
									{ value: 'invitation_only', label: 'Invitation Only' },
								]}
								placeholder="All join modes"
							/>
						</div>

						{/* Search Input */}
						<div className="space-y-2">
							<Label>Search</Label>
							<Input
								type="text"
								placeholder="Search by name..."
								value={searchInput}
								onChange={(e) => setSearchInput((e.target as HTMLInputElement).value)}
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Groups List */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>
						Groups{' '}
						{groups && (
							<span className="text-muted-foreground font-normal">({displayedGroups.length})</span>
						)}
					</CardTitle>
					<CardDescription>
						{hasActiveFilters
							? 'Filtered results - click a row to view details'
							: 'All groups - click a row to view details'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<GroupList groups={displayedGroups} isLoading={groupsLoading} isAdminContext={true} />
				</CardContent>
			</Card>

			{/* Create Group Dialog */}
			<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create Group</DialogTitle>
						<DialogDescription>Create a new group for organizing users</DialogDescription>
					</DialogHeader>
					<GroupForm
						categories={categories || []}
						onSubmit={handleCreate}
						onCancel={() => setCreateDialogOpen(false)}
						isSubmitting={createGroup.isPending}
					/>
				</DialogContent>
			</Dialog>
		</div>
	)
}
