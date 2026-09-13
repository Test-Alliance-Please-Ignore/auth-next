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
import { useAuth } from '@/hooks/useAuth'
import { useCategories } from '@/hooks/useCategories'
import { useCreateGroup, useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatNumber, useAppTranslation } from '@/i18n'

import type { MessageText } from '@/hooks/useMessage'
import type { CreateGroupRequest, GroupsFilters } from '@/lib/api'

export default function GroupsPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.organizations.group.pageTitle'))
	const { user } = useAuth()
	const [filters, setFilters] = useState<GroupsFilters>({})
	const { data: groups, isLoading: groupsLoading } = useGroups(filters)
	const { data: categories } = useCategories()
	const createGroup = useCreateGroup()

	// Dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false)

	// Filter state
	const [searchInput, setSearchInput] = useState('')

	// Error/success messages
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: MessageText } | null>(
		null
	)

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
			setMessage({ type: 'success', text: (t) => t('admin.organizations.feedback.groupCreated') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: (t) =>
					error instanceof Error
						? error.message
						: t('admin.organizations.feedback.groupCreateError'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">
						{t('admin.organizations.group.title')}
					</h1>
					<p className="text-muted-foreground mt-1">{t('admin.organizations.group.description')}</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)}>
					<Plus className="h-4 w-4" />
					{t('groups.form.create')}
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
							{typeof message.text === 'function' ? message.text(t) : message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Filters */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>{t('groups.filters')}</CardTitle>
							<CardDescription>{t('admin.organizations.group.filterDescription')}</CardDescription>
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
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						{/* Category Filter */}
						<div className="space-y-2">
							<Label htmlFor="group-filter-category">{t('groups.category')}</Label>
							<Select
								inputId="group-filter-category"
								value={filters.categoryId ?? 'all'}
								onValueChange={(value) =>
									updateFilter('categoryId', value === 'all' ? undefined : value)
								}
								searchable
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

						{/* Visibility Filter */}
						<div className="space-y-2">
							<Label htmlFor="group-filter-visibility">{t('groups.visibility')}</Label>
							<Select
								inputId="group-filter-visibility"
								value={filters.visibility ?? 'all'}
								onValueChange={(value) =>
									updateFilter('visibility', value === 'all' ? undefined : value)
								}
								searchable
								options={[
									{ value: 'all', label: t('admin.organizations.group.allVisibilities') },
									{ value: 'public', label: t('groups.badges.public') },
									{ value: 'hidden', label: t('groups.badges.hidden') },
									{ value: 'system', label: t('groups.badges.system') },
								]}
								placeholder={t('admin.organizations.group.allVisibilities')}
							/>
						</div>

						{/* Join Mode Filter */}
						<div className="space-y-2">
							<Label htmlFor="group-filter-joinMode">{t('groups.joinMode')}</Label>
							<Select
								inputId="group-filter-joinMode"
								value={filters.joinMode ?? 'all'}
								onValueChange={(value) =>
									updateFilter('joinMode', value === 'all' ? undefined : value)
								}
								searchable
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
							<Label htmlFor="group-filter-search">{t('groups.search')}</Label>
							<Input
								id="group-filter-search"
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
			<Card>
				<CardHeader>
					<CardTitle>
						{t('admin.nav.groups')}{' '}
						{groups && (
							<span className="text-muted-foreground font-normal">
								({formatNumber(displayedGroups.length)})
							</span>
						)}
					</CardTitle>
					<CardDescription>
						{hasActiveFilters
							? t('groups.filteredDescription')
							: t('admin.organizations.group.allDescription')}
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
						<DialogTitle>{t('groups.form.create')}</DialogTitle>
						<DialogDescription>
							{t('admin.organizations.group.createDescription')}
						</DialogDescription>
					</DialogHeader>
					<GroupForm
						categories={categories || []}
						onSubmit={handleCreate}
						onCancel={() => setCreateDialogOpen(false)}
						isSubmitting={createGroup.isPending}
						canEditAdminManaged={user?.is_admin ?? false}
					/>
				</DialogContent>
			</Dialog>
		</div>
	)
}
