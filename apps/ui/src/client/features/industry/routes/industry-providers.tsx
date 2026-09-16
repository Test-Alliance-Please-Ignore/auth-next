import { CheckCircle, Edit, Plus, Power, PowerOff, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
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
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'

import { EntityTypeBadge, StatsDashboard } from '../components'
import { useIndustryProviders, useIndustryStats, useSetProviderAcceptingOrders } from '../hooks'
import { ENTITY_TYPE_LABELS } from '../types'

import type { IndustryEntityType, IndustryProviderFilters } from '../types'

export default function IndustryProvidersPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('industry.adminIndustryProviders'))

	const [entityTypeFilter, setEntityTypeFilter] = useState<IndustryEntityType | 'all'>('all')
	const [acceptingOrdersFilter, setAcceptingOrdersFilter] = useState<'all' | 'yes' | 'no'>('all')

	// Build filters
	const filters: IndustryProviderFilters = {}
	if (entityTypeFilter !== 'all') {
		filters.ownerEntityType = entityTypeFilter
	}
	if (acceptingOrdersFilter !== 'all') {
		filters.acceptingOrders = acceptingOrdersFilter === 'yes'
	}

	const { data: providers, isLoading } = useIndustryProviders(
		Object.keys(filters).length > 0 ? filters : undefined
	)
	const { data: stats, isLoading: isLoadingStats } = useIndustryStats()
	const setAcceptingOrders = useSetProviderAcceptingOrders()

	const handleToggleAcceptingOrders = async (providerId: string, currentStatus: boolean) => {
		const confirmation = currentStatus
			? t('industry.stopOrdersConfirm')
			: t('industry.startOrdersConfirm')
		if (!confirm(confirmation)) return
		try {
			await setAcceptingOrders.mutateAsync({
				id: providerId,
				acceptingOrders: !currentStatus,
			})
		} catch (error) {
			console.error('Failed to toggle accepting orders:', error)
		}
	}

	const hasActiveFilters = entityTypeFilter !== 'all' || acceptingOrdersFilter !== 'all'

	const clearFilters = () => {
		setEntityTypeFilter('all')
		setAcceptingOrdersFilter('all')
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{t('industry.industryProviders')}</h1>
					<p className="text-muted-foreground mt-1">
						{t('industry.manageServiceProvidersAndTheirOfferedServices')}
					</p>
				</div>
				<Button asChild>
					<Link to="/admin/industry-providers/new">
						<Plus className="h-4 w-4" />
						{t('industry.createProvider')}
					</Link>
				</Button>
			</div>

			{/* Statistics Dashboard */}
			<StatsDashboard stats={stats} isLoading={isLoadingStats} />

			{/* Filters */}
			<Card>
				<CardHeader>
					<CardTitle>{t('industry.filters')}</CardTitle>
					<CardDescription>{t('industry.filterProvidersByTypeAndStatus')}</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap items-end gap-4">
						<div className="w-full md:w-48 space-y-2">
							<Label htmlFor="entityType">{t('industry.ownerType2')}</Label>
							<Select
								value={entityTypeFilter}
								onValueChange={(value) => setEntityTypeFilter(value as IndustryEntityType | 'all')}
								inputId="entityType"
								options={[
									{ value: 'all', label: t('industry.allTypes') },
									...Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => ({
										value,
										label,
									})),
								]}
								placeholder={t('industry.allTypes')}
							/>
						</div>

						<div className="w-full md:w-48 space-y-2">
							<Label htmlFor="acceptingOrders">{t('industry.acceptingOrders')}</Label>
							<Select
								value={acceptingOrdersFilter}
								onValueChange={(value) => setAcceptingOrdersFilter(value as 'all' | 'yes' | 'no')}
								inputId="acceptingOrders"
								options={[
									{ value: 'all', label: t('industry.all') },
									{ value: 'yes', label: t('industry.yes') },
									{ value: 'no', label: t('industry.no') },
								]}
								placeholder={t('industry.all')}
							/>
						</div>

						{hasActiveFilters && (
							<Button variant="ghost" onClick={clearFilters}>
								{t('industry.clearFilters')}
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Providers Table */}
			<Card>
				<CardHeader>
					<CardTitle>{t('industry.providers')}</CardTitle>
					<CardDescription>
						{t('industry.providerCount', { count: providers?.length ?? 0 })}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-3">
							{[...Array(5)].map((_, i) => (
								<Skeleton key={i} className="h-16 w-full" />
							))}
						</div>
					) : !providers || providers.length === 0 ? (
						<div className="text-center py-12">
							<p className="text-muted-foreground mb-4">{t('industry.noProvidersFound')}</p>
							<Button asChild>
								<Link to="/admin/industry-providers/new">
									<Plus className="h-4 w-4" />
									{t('industry.createYourFirstProvider')}
								</Link>
							</Button>
						</div>
					) : (
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t('industry.name2')}</TableHead>
										<TableHead>{t('industry.ownerType2')}</TableHead>
										<TableHead>{t('industry.acceptingOrders')}</TableHead>
										<TableHead className="text-right">{t('industry.actions')}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{providers.map((provider) => (
										<TableRow key={provider.id}>
											<TableCell>
												<Link
													to={`/admin/industry-providers/${provider.id}`}
													className="font-medium hover:underline"
												>
													{provider.name}
												</Link>
												{provider.description && (
													<p className="text-sm text-muted-foreground truncate max-w-md">
														{provider.description}
													</p>
												)}
											</TableCell>
											<TableCell>
												<EntityTypeBadge type={provider.ownerEntityType} />
											</TableCell>
											<TableCell>
												{provider.acceptingOrders ? (
													<Badge variant="success">
														<CheckCircle className="mr-1 h-3 w-3" />
														{t('industry.yes')}
													</Badge>
												) : (
													<Badge variant="destructive">
														<XCircle className="mr-1 h-3 w-3" />
														{t('industry.no')}
													</Badge>
												)}
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-2">
													<Button
														variant="ghost"
														size="sm"
														onClick={() =>
															handleToggleAcceptingOrders(provider.id, provider.acceptingOrders)
														}
														disabled={setAcceptingOrders.isPending}
														title={
															provider.acceptingOrders
																? t('industry.stopAcceptingOrders2')
																: t('industry.startAcceptingOrders2')
														}
													>
														{provider.acceptingOrders ? (
															<PowerOff className="h-4 w-4" />
														) : (
															<Power className="h-4 w-4" />
														)}
													</Button>
													<Button variant="ghost" size="sm" asChild>
														<Link to={`/admin/industry-providers/${provider.id}`}>
															<Edit className="h-4 w-4" />
														</Link>
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
