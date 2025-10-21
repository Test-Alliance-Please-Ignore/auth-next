import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { GroupList } from '@/components/group-list'
import { InviteCodeRedemption } from '@/components/invite-code-redemption'
import { useGroups } from '@/hooks/useGroups'
import { useCategories } from '@/hooks/useCategories'
import type { GroupsFilters } from '@/lib/api'

export default function GroupsPage() {
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

	// Handle search
	const handleSearch = () => {
		updateFilter('search', searchInput || undefined)
	}

	const handleSearchKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			handleSearch()
		}
	}

	// Clear all filters
	const clearFilters = () => {
		setFilters({})
		setSearchInput('')
	}

	const hasActiveFilters = Object.keys(filters).length > 0

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div>
				<h1 className="text-4xl md:text-5xl font-bold gradient-text">Discover Groups</h1>
				<p className="text-muted-foreground mt-2">Find and join groups that match your interests</p>
			</div>

			{/* Invite Code Redemption */}
			<InviteCodeRedemption
				onSuccess={(groupName) => {
					alert(`Successfully joined ${groupName}!`)
					navigate('/my-groups')
				}}
			/>

			{/* Filters */}
			<Card className="glow">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Filters</CardTitle>
							<CardDescription>Filter groups by category, join mode, or search</CardDescription>
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
					<div className="grid gap-4 md:grid-cols-3">
						{/* Category Filter */}
						<div className="space-y-2">
							<Label>Category</Label>
							<Select
								value={filters.categoryId}
								onValueChange={(value) => updateFilter('categoryId', value || undefined)}
							>
								<SelectTrigger>
									<SelectValue placeholder="All categories" />
								</SelectTrigger>
								<SelectContent>
									{categories?.map((category) => (
										<SelectItem key={category.id} value={category.id}>
											{category.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Join Mode Filter */}
						<div className="space-y-2">
							<Label>Join Mode</Label>
							<Select
								value={filters.joinMode}
								onValueChange={(value) => updateFilter('joinMode', value || undefined)}
							>
								<SelectTrigger>
									<SelectValue placeholder="All join modes" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="open">Open</SelectItem>
									<SelectItem value="approval">Approval</SelectItem>
									<SelectItem value="invitation_only">Invitation Only</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{/* Search Input */}
						<div className="space-y-2">
							<Label>Search</Label>
							<div className="flex gap-2">
								<Input
									type="text"
									placeholder="Search by name..."
									value={searchInput}
									onChange={(e) => setSearchInput(e.target.value)}
									onKeyPress={handleSearchKeyPress}
								/>
								<Button onClick={handleSearch} size="icon">
									<Search className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Groups List */}
			<Card className="glow">
				<CardHeader>
					<CardTitle>
						Available Groups{' '}
						{groups && <span className="text-muted-foreground font-normal">({groups.length})</span>}
					</CardTitle>
					<CardDescription>
						{hasActiveFilters
							? 'Filtered results - click a row to view details'
							: 'All available groups - click a row to view details'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<GroupList groups={groups || []} isLoading={groupsLoading} />
				</CardContent>
			</Card>
		</div>
	)
}
