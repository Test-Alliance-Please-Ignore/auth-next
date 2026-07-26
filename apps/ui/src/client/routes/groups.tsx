import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { GroupList } from '@/components/group-list'
import { InviteCodeRedemption } from '@/components/invite-code-redemption'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Section } from '@/components/ui/section'
import { useCategories } from '@/hooks/useCategories'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { GroupsFilters } from '@/lib/api'

export default function GroupsPage() {
	usePageTitle('Discover Groups')
	const navigate = useNavigate()
	const [filters, setFilters] = useState<GroupsFilters>({})
	const { data: groups, isLoading: groupsLoading } = useGroups(filters)
	const { data: categories } = useCategories()

	// Filter state
	const [searchInput, setSearchInput] = useState('')

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

	return (
		<Container>
			<PageHeader
				title="Discover Groups"
				description="Find and join groups that match your interests"
			/>

			<Section>
				{/* Invite Code Redemption */}
				<InviteCodeRedemption
					onSuccess={() => {
						void navigate('/my-groups')
					}}
				/>

				{/* Filters */}
				<Card variant="default">
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle>Filters</CardTitle>
								<CardDescription>Filter groups by category, join mode, or search</CardDescription>
							</div>
							{hasActiveFilters && (
								<Button variant="ghost" size="sm" onClick={clearFilters}>
									<X className="h-4 w-4" />
									Clear Filters
								</Button>
							)}
						</div>
					</CardHeader>
					<CardContent>
						<div className="grid gap-4 md:grid-cols-3">
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

							{/* Join Mode Filter */}
							<div className="space-y-2">
								<Label>Join Mode</Label>
								<Select
									value={filters.joinMode ?? 'all'}
									onValueChange={(value) =>
										updateFilter('joinMode', value === 'all' ? undefined : value)
									}
									options={[
										{ value: 'all', label: 'All join modes' },
										{ value: 'open', label: 'Open' },
										{ value: 'approval', label: 'Approval' },
										{ value: 'invitation_only',
											label: 'Invitation Only',
										},
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
				<Card variant="default">
					<CardHeader>
						<CardTitle>
							Available Groups{' '}
							{groups && (
								<span className="text-muted-foreground font-normal">
									({displayedGroups.length})
								</span>
							)}
						</CardTitle>
						<CardDescription>
							{hasActiveFilters
								? 'Filtered results - click a row to view details'
								: 'All available groups - click a row to view details'}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<GroupList groups={displayedGroups} isLoading={groupsLoading} />
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
