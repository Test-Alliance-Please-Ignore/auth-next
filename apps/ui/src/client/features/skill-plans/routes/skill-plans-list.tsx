import { useQueries } from '@tanstack/react-query'
import { Plus, Search, Settings } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Container } from '../../../components/ui/container'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'
import { Select } from '../../../components/ui/select'
import { useAuth } from '../../../hooks/useAuth'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { useUserPermissions } from '../../../hooks/useUserPermissions'
import { skillPlansApi } from '../api'
import { CategorySectionHeader } from '../components/category-section-header'
import { SkillPlanCard } from '../components/skill-plan-card'
import {
	skillPlanKeys,
	useCharacterSkillLevelsForCharacters,
	useMySkillPlans,
	useSkillPlanCategories,
	useSkillPlans,
} from '../hooks'
import { groupPlansByCategory } from '../utils/group-by-category'
import {
	calculateCharacterProgress,
	deriveReadinessStatus,
	summarizeReadinessStatuses,
} from '../utils/readiness'

import type { SkillPlansFilter } from '../types'

export default function SkillPlansList() {
	usePageTitle('Skill Plans')

	const { user } = useAuth()
	const { hasPermission } = useUserPermissions()
	const canCreatePlans = !!user && (user.is_admin || hasPermission('urn:skill-plans:create'))
	const canManageCategories =
		!!user &&
		(user.is_admin ||
			hasPermission('urn:skill-plans:categories:create') ||
			hasPermission('urn:skill-plans:categories:manage'))
	const canEditSkillPlans =
		!!user && (canCreatePlans || canManageCategories || hasPermission('urn:skill-plans:manage-all'))
	const [filters, setFilters] = useState<SkillPlansFilter>({
		published: undefined, // The backend limits this to statuses the user may see.
		search: '',
		categoryId: undefined,
		maintainer: 'all',
	})
	const [selectedCharacterId, setSelectedCharacterId] = useState<string>('all')

	const { data: plansResponse, isLoading: plansLoading } = useSkillPlans({
		categoryId: filters.categoryId,
	})
	const { data: myPlansResponse } = useMySkillPlans(undefined, {
		enabled: !!user,
	})

	const { data: categories, isLoading: categoriesLoading } = useSkillPlanCategories()
	// Merge default published feed with user's maintained plans (including drafts), deduped by plan id.
	const mergedPlans = useMemo(() => {
		const published = plansResponse?.items ?? []
		const myPlans = myPlansResponse?.items ?? []
		const byId = new Map<string, (typeof published)[number]>()
		for (const plan of published) {
			byId.set(plan.id, plan)
		}
		for (const plan of myPlans) {
			byId.set(plan.id, plan)
		}
		return Array.from(byId.values())
	}, [myPlansResponse?.items, plansResponse?.items])

	const myPlanIds = useMemo(() => {
		return new Set((myPlansResponse?.items ?? []).map((plan) => plan.id))
	}, [myPlansResponse?.items])

	const maintainerOptions = useMemo(() => {
		const options = new Map<string, { value: string; label: string; description: string }>()
		for (const plan of mergedPlans) {
			if (!plan.maintainerId) {
				continue
			}
			const type = plan.maintainerType ?? 'user'
			const value = `${type}:${plan.maintainerId}`
			const name = plan.maintainerName || plan.ownerCharacterName || 'Unknown Maintainer'
			options.set(value, {
				value,
				label: name,
				description: type === 'group' ? 'Group' : 'User',
			})
		}
		return [{ value: 'all', label: 'All maintainers' }, ...Array.from(options.values())]
	}, [mergedPlans])

	// Filter plans client-side because backend list endpoint only supports category filtering
	const filteredPlans = useMemo(() => {
		return mergedPlans.filter((plan) => {
			// Draft visibility is decided by the backend. Keep only a defensive
			// client-side guard for responses that do not grant modification access.
			if (!plan.isPublished && !plan.canModify) {
				return false
			}

			if (filters.myPlansOnly && !myPlanIds.has(plan.id)) {
				return false
			}

			if (filters.search?.trim()) {
				const search = filters.search.trim().toLowerCase()
				const matchesSearch =
					plan.name.toLowerCase().includes(search) ||
					plan.description.toLowerCase().includes(search)
				if (!matchesSearch) {
					return false
				}
			}

			if (filters.categoryId) {
				const belongsToCategory = plan.categories?.some(
					(category) => category.id === filters.categoryId
				)
				if (!belongsToCategory) {
					return false
				}
			}

			if (filters.published !== undefined) {
				const normalizedIsPublished = Boolean(plan.isPublished)
				if (normalizedIsPublished !== filters.published) {
					return false
				}
			}

			if (!filters.maintainer || filters.maintainer === 'all') {
				return true
			}

			if (!plan.maintainerId) {
				return false
			}
			const type = plan.maintainerType ?? 'user'
			return `${type}:${plan.maintainerId}` === filters.maintainer
		})
	}, [
		filters.categoryId,
		filters.maintainer,
		filters.myPlansOnly,
		filters.published,
		filters.search,
		mergedPlans,
		myPlanIds,
	])

	const totalPlans = mergedPlans.length
	const showPublicationState =
		canEditSkillPlans || mergedPlans.some((plan) => plan.canModify && !plan.isPublished)

	// Group filtered plans by category
	const groupedPlans = useMemo(() => {
		return groupPlansByCategory(filteredPlans)
	}, [filteredPlans])

	const selectedCharacters = useMemo(() => {
		if (!user?.characters?.length) return []
		if (selectedCharacterId === 'all') return user.characters
		return user.characters.filter((character) => character.characterId === selectedCharacterId)
	}, [selectedCharacterId, user?.characters])

	const characterSkillQueries = useCharacterSkillLevelsForCharacters(selectedCharacters)

	const planSkillsQueries = useQueries({
		queries: filteredPlans.map((plan) => ({
			queryKey: skillPlanKeys.skills(plan.id),
			queryFn: () => skillPlansApi.getPlanSkills(plan.id),
			enabled: !!user && !plan.skills,
			staleTime: 1000 * 60 * 5,
		})),
	})

	const readinessByPlanId = useMemo(() => {
		const result = new Map<
			string,
			ReturnType<typeof summarizeReadinessStatuses> & { hasNoSkills: boolean }
		>()

		if (!selectedCharacters.length) {
			return result
		}

		for (let index = 0; index < filteredPlans.length; index++) {
			const plan = filteredPlans[index]
			const planSkills = plan.skills ?? planSkillsQueries[index]?.data

			if (!planSkills) {
				continue
			}

			if (planSkills.length === 0) {
				result.set(plan.id, {
					completed: 0,
					meetsRequirements: 0,
					incomplete: 0,
					total: 0,
					hasNoSkills: true,
				})
				continue
			}

			const statuses = selectedCharacters.map((character, characterIndex) => {
				if (!character.hasValidToken) {
					return 'incomplete' as const
				}

				const characterSkills = characterSkillQueries[characterIndex]?.data
				if (!characterSkills) {
					return 'incomplete' as const
				}

				const progress = calculateCharacterProgress({
					planId: plan.id,
					planName: plan.name,
					characterId: character.characterId,
					characterName: character.characterName,
					planSkills,
					characterSkillLevels: characterSkills.levels,
				})

				return deriveReadinessStatus({
					percentageRequired: progress.percentageRequired,
					percentageRecommended: progress.percentageRecommended,
					totalSkills: progress.totalSkills,
				})
			})

			result.set(plan.id, {
				...summarizeReadinessStatuses(statuses),
				hasNoSkills: false,
			})
		}

		return result
	}, [characterSkillQueries, filteredPlans, planSkillsQueries, selectedCharacters])

	const readinessLoadingByPlanId = useMemo(() => {
		const loading = new Map<string, boolean>()
		for (let index = 0; index < filteredPlans.length; index++) {
			const plan = filteredPlans[index]
			const query = planSkillsQueries[index]
			const areCharacterSkillsLoading = characterSkillQueries.some(
				(characterQuery) => characterQuery.isPending
			)
			const isLoading = !plan.skills && !!user && (query?.isPending ?? false)
			loading.set(plan.id, areCharacterSkillsLoading || isLoading)
		}
		return loading
	}, [characterSkillQueries, filteredPlans, planSkillsQueries, user])

	const readinessIndicatorByPlanId = useMemo(() => {
		const indicator = new Map<string, 'recommended' | 'required' | 'incomplete'>()
		for (const plan of filteredPlans) {
			const readiness = readinessByPlanId.get(plan.id)
			if (!readiness || readiness.total === 0) {
				continue
			}
			if (readiness.completed > 0) {
				indicator.set(plan.id, 'recommended')
			} else if (readiness.meetsRequirements > 0) {
				indicator.set(plan.id, 'required')
			} else {
				indicator.set(plan.id, 'incomplete')
			}
		}
		return indicator
	}, [filteredPlans, readinessByPlanId])

	if ((plansLoading && !plansResponse) || categoriesLoading) {
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
					{user && canEditSkillPlans && (
						<div className="flex gap-2">
							{canManageCategories && (
								<Button variant="ghost" asChild>
									<Link to="/skill-plans/categories/manage">
										<Settings className="h-4 w-4" />
										Manage Categories
									</Link>
								</Button>
							)}
							<Button variant="ghost" asChild>
								<Link to="/skill-plans/my">My Plans</Link>
							</Button>
							{canCreatePlans && (
								<Button asChild>
									<Link to="/skill-plans/create">
										<Plus className="h-4 w-4" />
										Create Plan
									</Link>
								</Button>
							)}
						</div>
					)}
				</div>

				{/* Filters */}
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>Filters</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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

							{/* Character filter */}
							<div className="space-y-2">
								<Label htmlFor="character-filter">Character</Label>
								<Select
									value={selectedCharacterId}
									onValueChange={setSelectedCharacterId}
									inputId="character-filter"
									searchable
									options={[
										{ value: 'all', label: 'All Characters' },
										...(user?.characters ?? []).map((character) => ({
											value: character.characterId,
											label: character.characterName,
										})),
									]}
									placeholder="All Characters"
								/>
							</div>

							{/* Category filter */}
							<div className="space-y-2">
								<Label htmlFor="category">Category</Label>
								<Select
									value={filters.categoryId || 'all'}
									onValueChange={(value) =>
										setFilters({
											...filters,
											categoryId: value === 'all' ? undefined : value,
										})
									}
									inputId="category"
									options={[
										{ value: 'all', label: 'All categories' },
										...(categories?.map((category) => ({
											value: category.id,
											label: category.name,
										})) ?? []),
									]}
									placeholder="All categories"
								/>
							</div>

							{/* Maintainer filter */}
							<div className="space-y-2">
								<Label htmlFor="maintainer">Maintainer</Label>
								<Select
									value={filters.maintainer || 'all'}
									onValueChange={(value) =>
										setFilters({
											...filters,
											maintainer: value,
										})
									}
									inputId="maintainer"
									searchable
									options={maintainerOptions}
									placeholder="All maintainers"
								/>
							</div>

							{canEditSkillPlans && (
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
							)}
						</div>

						{/* My plans toggle */}
						{user && canEditSkillPlans && (
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
													characterReadiness={readinessByPlanId.get(plan.id)}
													hasNoSkills={readinessByPlanId.get(plan.id)?.hasNoSkills || false}
													isReadinessLoading={readinessLoadingByPlanId.get(plan.id) || false}
													showPublicationState={showPublicationState}
													readinessIndicator={readinessIndicatorByPlanId.get(plan.id)}
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
								{canCreatePlans && (
									<div className="mt-4">
										<Button asChild>
											<Link to="/skill-plans/create">
												<Plus className="h-4 w-4" />
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
