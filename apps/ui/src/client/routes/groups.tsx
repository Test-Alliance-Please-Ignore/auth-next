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
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { useCategories } from '@/hooks/useCategories'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, useAppTranslation } from '@/i18n'

import type { GroupsFilters } from '@/lib/api'

export default function GroupsPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('groups.title'))
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
			<PageHeader title={t('groups.title')} description={t('groups.description')} />

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
								<CardTitle>{t('groups.filters')}</CardTitle>
								<CardDescription>{t('groups.filterDescription')}</CardDescription>
							</div>
							{hasActiveFilters && (
								<Button variant="ghost" size="sm" onClick={clearFilters}>
									<X className="h-4 w-4" />
									{t('groups.clearFilters')}
								</Button>
							)}
						</div>
					</CardHeader>
					<CardContent>
						<div className="grid gap-4 md:grid-cols-3">
							{/* Category Filter */}
							<div className="space-y-2">
								<Label htmlFor="groups-category">{t('groups.category')}</Label>
								<Select
									inputId="groups-category"
									value={filters.categoryId ?? 'all'}
									onValueChange={(value) =>
										updateFilter('categoryId', value === 'all' ? undefined : value)
									}
									options={[
										{ value: 'all', label: t('groups.allCategories') },
										...(categories?.map((category) => ({
											value: category.id,
											label: category.name,
										})) ?? []),
									]}
									placeholder={t('groups.allCategories')}
								/>
							</div>

							{/* Join Mode Filter */}
							<div className="space-y-2">
								<Label htmlFor="groups-join-mode">{t('groups.joinMode')}</Label>
								<Select
									inputId="groups-join-mode"
									value={filters.joinMode ?? 'all'}
									onValueChange={(value) =>
										updateFilter('joinMode', value === 'all' ? undefined : value)
									}
									options={[
										{ value: 'all', label: t('groups.allJoinModes') },
										{ value: 'open', label: t('groups.badges.open') },
										{ value: 'approval', label: t('groups.badges.approval') },
										{ value: 'invitation_only', label: t('groups.badges.invitationOnly') },
									]}
									placeholder={t('groups.allJoinModes')}
								/>
							</div>

							{/* Search Input */}
							<div className="space-y-2">
								<Label htmlFor="groups-search">{t('groups.search')}</Label>
								<Input
									id="groups-search"
									type="text"
									placeholder={t('groups.searchPlaceholder')}
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
							{t('groups.available')}{' '}
							{groups && (
								<span className="text-muted-foreground font-normal">
									({formatNumber(displayedGroups.length)})
								</span>
							)}
						</CardTitle>
						<CardDescription>
							{hasActiveFilters ? t('groups.filteredDescription') : t('groups.allDescription')}
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
