import { Plus, Search, Settings } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Container } from '../../../components/ui/container'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Select } from '../../../components/ui/select'
import { Section } from '../../../components/ui/section'
import { useAuth } from '../../../hooks/useAuth'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { CategorySectionHeader } from '../components/category-section-header'
import { SkillPlanCard } from '../components/skill-plan-card'
import { useDeleteSkillPlan, useSkillPlanCategories, useSkillPlans } from '../hooks'
import { groupPlansByCategory } from '../utils/group-by-category'

import type { SkillPlansFilter } from '../types'

export default function SkillPlansList() {
	usePageTitle('Skill Plans')

	const { user } = useAuth()
	const [filters, setFilters] = useState<SkillPlansFilter>({
		published: true, // Default to published plans
		search: '',
		categoryId: undefined,
		maintainerType: 'all',
	})

	const { data: plansResponse, isLoading: plansLoading } = useSkillPlans({
		search: filters.search || undefined,
		categoryId: filters.categoryId,
		published: filters.published,
		maintainerId: filters.myPlansOnly ? user?.id : undefined,
	})

	const { data: categories, isLoading: categoriesLoading } = useSkillPlanCategories()
	const deletePlan = useDeleteSkillPlan()

	const handleDelete = async (planId: string) => {
		if (confirm('Are you sure you want to delete this skill plan?')) {
			try {
				await deletePlan.mutateAsync(planId)
			} catch (error) {
				console.error('Failed to delete plan:', error)
				// In a real app, show a toast notification
			}
		}
	}

	const handleClone = (planId: string) => {
		// TODO: Implement clone functionality
		console.log('Clone plan:', planId)
	}

	// Extract plans from paginated response
	const plans = plansResponse?.items || []
	const totalPlans = plansResponse?.total || 0

	// Filter plans based on maintainer type
	const filteredPlans = useMemo(() => {
		if (!plans) return []

		if (filters.maintainerType === 'all') return plans

		return plans.filter((plan) => {
			if (filters.maintainerType === 'user') {
				return plan.maintainerType === 'user' || !plan.maintainerType
			}
			return plan.maintainerType === filters.maintainerType
		})
	}, [plans, filters.maintainerType])

	// Group filtered plans by category
	const groupedPlans = useMemo(() => {
		return groupPlansByCategory(filteredPlans)
	}, [filteredPlans])

	if (plansLoading || categoriesLoading) {
		return <LoadingPage />
	}

	return (
		<Container>
			<PageHeader
				title="Skill Plans"
				description="Browse and manage skill training plans for EVE Online"
			/>

			<Section>
				{/* Actions bar */}
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-xl font-semibold">Available Plans</h2>
					{user && (
						<div className="flex gap-2">
							{user.is_admin && (
								<Button variant="ghost" asChild>
									<Link to="/skill-plans/categories/manage">
										<Settings className="h-4 w-4 mr-2" />
										Manage Categories
									</Link>
								</Button>
							)}
							<Button variant="ghost" asChild>
								<Link to="/skill-plans/my">My Plans</Link>
							</Button>
							<Button asChild>
								<Link to="/skill-plans/create">
									<Plus className="h-4 w-4 mr-2" />
									Create Plan
								</Link>
							</Button>
						</div>
					)}
				</div>

				{/* Filters */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>Filters</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
							{/* Search */}
							<div className="space-y-2">
								<Label htmlFor="search">Search</Label>
								<div className="relative">
									<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
									<Input
										id="search"
										placeholder="Search plans..."
										value={filters.search}
										onChange={(e) => setFilters({ ...filters, search: e.target.value })}
										className="pl-8"
									/>
								</div>
							</div>

							{/* Category filter */}
							<div className="space-y-2">
								<Label htmlFor="category">Category</Label>
								<Select
									value={filters.categoryId || 'all'}
									onValueChange={(value) =>
										setFilters({ ...filters, categoryId: value === 'all' ? undefined : value })
									}
									inputId="category"
									options={[
										{ value: 'all', label: 'All categories' },
										...(categories?.map((category) => ({ value: category.id,
											label: category.name,
										})) ?? []),
									]}
									placeholder="All categories"
								/>
							</div>

							{/* Status filter */}
							<div className="space-y-2">
								<Label htmlFor="status">Status</Label>
								<Select
									value={filters.published === undefined ? 'all' : String(filters.published)}
									onValueChange={(value) =>
										setFilters({
											...filters,
											published: value === 'all' ? undefined : value === 'true',
										})
									}
									inputId="status"
									options={[
										{ value: 'all', label: 'All statuses' },
										{ value: 'true', label: 'Published' },
										{ value: 'false', label: 'Draft' },
									]}
									placeholder="All statuses"
								/>
							</div>

							{/* Maintainer type filter */}
							<div className="space-y-2">
								<Label htmlFor="maintainer">Maintainer</Label>
								<Select
									value={filters.maintainerType}
									onValueChange={(value) =>
										setFilters({
											...filters,
											maintainerType: value as SkillPlansFilter['maintainerType'],
										})
									}
									inputId="maintainer"
									options={[
										{ value: 'all', label: 'All maintainers' },
										{ value: 'user', label: 'User maintained' },
										{ value: 'group', label: 'Group maintained' },
									]}
									placeholder="All maintainers"
								/>
							</div>
						</div>

						{/* My plans toggle */}
						{user && (
							<div className="mt-4 flex items-center gap-2">
								<input
									type="checkbox"
									id="my-plans"
									checked={filters.myPlansOnly || false}
									onChange={(e) => setFilters({ ...filters, myPlansOnly: e.target.checked })}
									className="h-4 w-4 rounded border-gray-300"
								/>
								<Label htmlFor="my-plans" className="cursor-pointer">
									Show only my plans
								</Label>
							</div>
						)}
					</CardContent>
				</Card>

				{/* Results */}
				<div className="space-y-4">
					{filteredPlans && filteredPlans.length > 0 ? (
						<>
							<div className="text-sm text-muted-foreground">
								Showing {filteredPlans.length} of {totalPlans} plan{totalPlans !== 1 ? 's' : ''}
							</div>
							<div className="space-y-6">
								{groupedPlans.map((group) => (
									<div key={group.category?.id || 'uncategorized'}>
										<CategorySectionHeader name={group.category?.name || 'Uncategorized'} />
										<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
											{group.plans.map((plan) => (
												<SkillPlanCard
													key={`${group.category?.id || 'uncategorized'}-${plan.id}`}
													plan={plan}
												/>
											))}
										</div>
									</div>
								))}
							</div>
						</>
					) : (
						<Card>
							<CardContent className="py-8 text-center text-muted-foreground">
								No skill plans found matching your filters.
								{user && (
									<div className="mt-4">
										<Button asChild>
											<Link to="/skill-plans/create">
												<Plus className="h-4 w-4 mr-2" />
												Create your first plan
											</Link>
										</Button>
									</div>
								)}
							</CardContent>
						</Card>
					)}
				</div>
			</Section>
		</Container>
	)
}
