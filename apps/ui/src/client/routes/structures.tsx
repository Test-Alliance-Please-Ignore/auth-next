import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	ArrowUpDown,
	Building2,
	Filter,
	RefreshCcw,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { hasAllStructureManagerPermission, hasAnyStructurePermission } from '@repo/groups'

import { TableRefreshFrame } from '@/components/table-refresh-frame'
import { CorporationLogo } from '@/components/corporation-logo'
import { StructureStateBadge } from '@/components/structure-state-badge'
import { DurationDisplay } from '@/components/ui/duration-display'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { FilterField } from '@/components/ui/filter-field'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useAuth } from '@/hooks/useAuth'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { type StructureListItem, type StructureListSortBy } from '@/lib/api'
import { cn } from '@/lib/utils'

import { useStructureModuleConfig, useStructures } from '../features/structures/hooks'
import {
	clearStructureTableFilters,
	setStructureTableFilters,
	setStructureTablePage,
	setStructureTablePageSize,
	setStructureTableSort,
	useStructureTableUiState,
} from '../features/structures/state/structure-table-store'

import type { SelectOption } from '@/components/ui/select'

const UNASSIGNED_GROUP_VALUE = '__unassigned__'
const BOOLEAN_FILTER_OPTIONS: SelectOption[] = [
	{ value: 'true', label: 'Yes' },
	{ value: 'false', label: 'No' },
]

function structureSyncBadgeVariant(status: StructureListItem['syncStatus']) {
	if (status === 'error') return 'destructive'
	if (status === 'warning') return 'warning'
	return 'success'
}

function withAllOption(options: SelectOption[], label: string): SelectOption[] {
	return [{ value: '', label }, ...options]
}

function toBooleanFilterValue(value: string): 'true' | 'false' | undefined {
	if (value === 'true' || value === 'false') return value
	return undefined
}

export default function StructuresPage() {
	usePageTitle('Structures')

	const { user, isLoading: authLoading } = useAuth()
	const { data: groups = [] } = useGroups({ limit: 100 })
	const { permissions, isLoading: permissionsLoading } = useUserPermissions()
	const canViewStructures = user?.is_admin === true || hasAnyStructurePermission(permissions)
	const canManageStructures =
		user?.is_admin === true || hasAllStructureManagerPermission(permissions)
	const tableState = useStructureTableUiState((state) => state)
	const [nowMs, setNowMs] = useState(() => Date.now())
	const { data: moduleConfig } = useStructureModuleConfig()

	const query = useMemo(
		() => ({
			page: tableState.page,
			pageSize: tableState.pageSize,
			corporationId: tableState.filters.corporationId,
			assignedGroupId: tableState.filters.assignedGroupId,
			lowPower: tableState.filters.lowPower,
			lowPowerAllowed: tableState.filters.lowPowerAllowed,
			regionId: tableState.filters.regionId,
			systemId: tableState.filters.systemId,
			state: tableState.filters.state,
			typeId: tableState.filters.typeId,
			sortBy: tableState.sortBy,
			sortDirection: tableState.sortDirection,
		}),
		[tableState]
	)

	const {
		data: structuresResponse,
		isLoading,
		error,
		refetch,
		isFetching,
	} = useStructures(query, {
		enabled: !authLoading && !permissionsLoading && canViewStructures,
	})

	const structures = structuresResponse?.items ?? []
	const summary = structuresResponse?.summary
	const pagination = structuresResponse?.pagination
	const filterOptions = structuresResponse?.filterOptions
	const isInitialLoading = isLoading && !structuresResponse
	const isSoftLoading = Boolean(structuresResponse) && isFetching

	useEffect(() => {
		const timer = window.setInterval(() => {
			setNowMs(Date.now())
		}, 60_000)
		return () => window.clearInterval(timer)
	}, [])

	const corporationOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(filterOptions?.corporations ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Corporations'
			),
		[filterOptions]
	)
	const groupNameById = useMemo(
		() => new Map(groups.map((group) => [group.id, group.name])),
		[groups]
	)
	const assignedGroupOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				[
					{ value: UNASSIGNED_GROUP_VALUE, label: 'Unassigned' },
					...(filterOptions?.assignedGroups ?? []).map((option) => ({
						value: option.value,
						label: groupNameById.get(option.value) ?? option.label ?? option.value,
					})),
				],
				'All Groups'
			),
		[filterOptions, groupNameById]
	)
	const regionOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(filterOptions?.regions ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Regions'
			),
		[filterOptions]
	)
	const systemOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(filterOptions?.systems ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Systems'
			),
		[filterOptions]
	)
	const stateOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(filterOptions?.states ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All States'
			),
		[filterOptions]
	)
	const typeOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(filterOptions?.types ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Types'
			),
		[filterOptions]
	)
	const structuresContentKey = [
		tableState.page,
		tableState.pageSize,
		tableState.sortBy,
		tableState.sortDirection,
		tableState.filters.corporationId ?? '',
		tableState.filters.assignedGroupId ?? '',
		tableState.filters.lowPower ?? '',
		tableState.filters.lowPowerAllowed ?? '',
		tableState.filters.regionId ?? '',
		tableState.filters.systemId ?? '',
		tableState.filters.state ?? '',
		tableState.filters.typeId ?? '',
	].join(':')

	const activeFilterCount = [
		tableState.filters.corporationId,
		tableState.filters.assignedGroupId,
		tableState.filters.lowPower,
		tableState.filters.lowPowerAllowed,
		tableState.filters.regionId,
		tableState.filters.systemId,
		tableState.filters.state,
		tableState.filters.typeId,
	].filter(Boolean).length

	const refreshButton = (
		<Button
			variant="secondary"
			size="sm"
			className="h-8"
			onClick={() => void refetch()}
			disabled={isFetching}
		>
			<RefreshCcw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
			<span className="ml-2">Refresh</span>
		</Button>
	)

	const handleSort = (field: StructureListSortBy) => {
		setStructureTableSort(field)
	}

	const renderSortIcon = (field: StructureListSortBy) => {
		if (tableState.sortBy !== field) {
			return <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
		}

		return tableState.sortDirection === 'asc' ? (
			<ArrowUp className="h-3.5 w-3.5" />
		) : (
			<ArrowDown className="h-3.5 w-3.5" />
		)
	}

	const SortableHead = ({
		field,
		label,
		className,
	}: {
		field: StructureListSortBy
		label: string
		className?: string
	}) => (
		<TableHead className={className}>
			<button
				type="button"
				onClick={() => handleSort(field)}
				className="inline-flex items-center gap-1 text-left text-muted-foreground hover:text-foreground"
			>
				<span>{label}</span>
				{renderSortIcon(field)}
			</button>
		</TableHead>
	)

	if (!authLoading && !permissionsLoading && !canViewStructures) {
		return <Navigate to="/dashboard" replace />
	}

	return (
		<Container className="space-y-6 py-6 2xl:!max-w-none">
			<PageHeader
				title="Structures"
				description="Track visible structures, review their current state, and fuel posture."
				action={
					<div className="flex items-center gap-2">
						{canManageStructures && (
							<Button asChild variant="ghost" size="sm">
								<Link to="/structures/settings">Settings</Link>
							</Button>
						)}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => void refetch()}
							disabled={isFetching || isInitialLoading}
						>
							<RefreshCcw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
							Refresh
						</Button>
					</div>
				}
			/>

			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Low Fuel</CardTitle>
						<CardDescription>
							Visible structures at or below the fuel warning threshold.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-semibold">{summary?.lowFuel ?? 0}</div>
						{moduleConfig && (
							<p className="text-xs text-muted-foreground">
								Current threshold: {moduleConfig.lowFuelTimeThresholdHours} hours for time-based
								structures, {moduleConfig.lowFuelAmountThreshold} units for amount-based structures.
							</p>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Low Power</CardTitle>
						<CardDescription>Structures in low power without suppression enabled.</CardDescription>
					</CardHeader>
					<CardContent className="text-3xl font-semibold">{summary?.lowPower ?? 0}</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Reinforced</CardTitle>
						<CardDescription>
							Structures currently in a reinforced or transition state.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-3xl font-semibold">{summary?.reinforced ?? 0}</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<CardTitle className="flex items-center gap-2">
								<Filter className="h-5 w-5" />
								Filters
							</CardTitle>
							<CardDescription>
								Refine the structures table without leaving the page.
							</CardDescription>
						</div>
						{activeFilterCount > 0 && (
							<Button variant="ghost" size="sm" onClick={() => clearStructureTableFilters()}>
								Clear Filters
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
						<FilterField label="Region">
							<Select
								options={regionOptions}
								value={tableState.filters.regionId ?? ''}
								onValueChange={(value) =>
									setStructureTableFilters({ regionId: value || undefined })
								}
								placeholder="All Regions"
								searchable
							/>
						</FilterField>
						<FilterField label="Corporation">
							<Select
								options={corporationOptions}
								value={tableState.filters.corporationId ?? ''}
								onValueChange={(value) =>
									setStructureTableFilters({ corporationId: value || undefined })
								}
								placeholder="All Corporations"
								searchable
							/>
						</FilterField>
						<FilterField label="Type">
							<Select
								options={typeOptions}
								value={tableState.filters.typeId ?? ''}
								onValueChange={(value) => setStructureTableFilters({ typeId: value || undefined })}
								placeholder="All Types"
								searchable
							/>
						</FilterField>
						<FilterField label="State">
							<Select
								options={stateOptions}
								value={tableState.filters.state ?? ''}
								onValueChange={(value) => setStructureTableFilters({ state: value || undefined })}
								placeholder="All States"
								searchable
							/>
						</FilterField>
						<FilterField label="Low Power">
							<Select
								options={withAllOption(BOOLEAN_FILTER_OPTIONS, 'All Power Statuses')}
								value={tableState.filters.lowPower ?? ''}
								onValueChange={(value) =>
									setStructureTableFilters({ lowPower: toBooleanFilterValue(value) })
								}
								placeholder="All Power Statuses"
							/>
						</FilterField>
						<FilterField label="Low Power Allowed">
							<Select
								options={withAllOption(BOOLEAN_FILTER_OPTIONS, 'All LP Preferences')}
								value={tableState.filters.lowPowerAllowed ?? ''}
								onValueChange={(value) =>
									setStructureTableFilters({ lowPowerAllowed: toBooleanFilterValue(value) })
								}
								placeholder="All LP Preferences"
							/>
						</FilterField>
						<FilterField label="Group">
							<Select
								options={assignedGroupOptions}
								value={tableState.filters.assignedGroupId ?? ''}
								onValueChange={(value) =>
									setStructureTableFilters({
										assignedGroupId: value || undefined,
									})
								}
								placeholder="All Groups"
								searchable
							/>
						</FilterField>
						<FilterField label="System">
							<Select
								options={systemOptions}
								value={tableState.filters.systemId ?? ''}
								onValueChange={(value) =>
									setStructureTableFilters({ systemId: value || undefined })
								}
								placeholder="All Systems"
								searchable
							/>
						</FilterField>
					</div>

					<div className="rounded-md border">
						<div className="border-b p-3">
							<UserSearchPaginationControls
								totalCount={pagination?.totalCount ?? 0}
								page={pagination?.page ?? tableState.page}
								pageSize={pagination?.pageSize ?? tableState.pageSize}
								onPageChange={setStructureTablePage}
								onPageSizeChange={setStructureTablePageSize}
								pageSizeOptions={[25, 50, 100]}
								itemLabel="structures"
								nextButtonLoading={isFetching}
								summaryAction={refreshButton}
							/>
						</div>
						<TableRefreshFrame
							key={structuresContentKey}
							isRefreshing={isSoftLoading}
							refreshMessage="Refreshing structure list..."
							errorMessage={
								error && structuresResponse
									? error instanceof Error
										? error.message
										: 'Failed to refresh structures.'
									: null
							}
							onRetry={error && structuresResponse ? () => void refetch() : undefined}
							retryDisabled={isFetching}
						>
							{error && !structuresResponse ? (
								<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-8 text-center text-sm text-destructive">
									<div className="font-medium">Failed to load structures.</div>
									<div className="mt-1 text-destructive/80">
										{error instanceof Error ? error.message : 'Please try again.'}
									</div>
									<div className="mt-4">
										<Button
											variant="secondary"
											size="sm"
											onClick={() => void refetch()}
											disabled={isFetching}
										>
											Retry
										</Button>
									</div>
								</div>
							) : isInitialLoading ? (
								<div className="p-4">
									<LoadingSpinner label="Loading structures..." />
								</div>
							) : structures.length === 0 ? (
								<div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
									No structures were returned for the selected filters.
								</div>
							) : (
								<Table className="min-w-[96rem]">
									<TableHeader>
										<TableRow>
											<SortableHead field="region" label="Region" />
											<SortableHead field="system" label="System" />
											<SortableHead field="name" label="Name" />
											<SortableHead field="corporation" label="Corporation" />
											<SortableHead field="type" label="Type" />
											<SortableHead field="state" label="State" />
											<SortableHead field="fuel" label="Fuel" />
											<TableHead>LP</TableHead>
											<TableHead>LP Allowed</TableHead>
											<SortableHead field="nextStateAt" label="Next State In" />
											<TableHead>Group</TableHead>
											<TableHead>Sync</TableHead>
											<TableHead className="sticky right-0 z-20 table-header-bg border-l border-border/50 text-right">
												Actions
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{structures.map((structure) => {
											const syncTitle =
												structure.syncFailureReason ?? 'Structure sync is healthy and up to date.'
											const fuelLabel = structure.fuelExpires ? (
												<DurationDisplay
													endDate={structure.fuelExpires}
													referenceTimeMs={nowMs}
													maxUnits={3}
													durationStyle="compact"
												/>
											) : structure.fuelAmount !== null ? (
												`${structure.fuelAmount.toLocaleString()} units`
											) : (
												'-'
											)
											const groupLabel = structure.assignedGroupId
												? (groupNameById.get(structure.assignedGroupId) ??
													structure.assignedGroupId)
												: '-'

											return (
												<TableRow key={structure.structureId}>
													<TableCell className="font-medium">
														{structure.regionName ?? structure.regionId ?? '-'}
													</TableCell>
													<TableCell>{structure.systemName ?? structure.systemId}</TableCell>
													<TableCell className="max-w-[16rem]">
														<div className="flex min-w-0 items-center gap-2">
															<div className="truncate font-medium">{structure.name}</div>
															{structure.hidden && <Badge variant="ghost">Hidden</Badge>}
														</div>
														<div className="text-xs text-muted-foreground">
															{structure.structureId}
														</div>
													</TableCell>
													<TableCell className="max-w-[18rem]">
														<div className="flex min-w-0 items-center gap-2">
															<CorporationLogo
																corporationId={structure.corporationId}
																corporationName={structure.corporationName}
															/>
															<span className="truncate font-medium" title={structure.corporationName}>
																{structure.corporationName}
															</span>
														</div>
													</TableCell>
													<TableCell>{structure.typeName ?? structure.typeId}</TableCell>
											<TableCell>
														<StructureStateBadge state={structure.state} />
													</TableCell>
													<TableCell>{fuelLabel}</TableCell>
													<TableCell>
														<Badge variant={structure.lowPower ? 'warning' : 'ghost'}>
															{structure.lowPower ? 'Yes' : 'No'}
														</Badge>
													</TableCell>
													<TableCell>
														<Badge variant={structure.lowPowerAllowed ? 'success' : 'ghost'}>
															{structure.lowPowerAllowed ? 'Yes' : 'No'}
														</Badge>
													</TableCell>
													<TableCell>
														{structure.nextStateAt ? (
															<DurationDisplay
																endDate={structure.nextStateAt}
																referenceTimeMs={nowMs}
																maxUnits={3}
																durationStyle="compact"
																format="compact"
															/>
														) : (
															'-'
														)}
													</TableCell>
													<TableCell>{groupLabel}</TableCell>
													<TableCell>
														<Badge
															variant={structureSyncBadgeVariant(structure.syncStatus)}
															title={syncTitle}
														>
															{structure.syncStatus}
														</Badge>
													</TableCell>
													<TableCell className="sticky right-0 z-10 border-l border-border/50 bg-card text-right">
														{structure.canEdit ? (
															<Button asChild size="sm" variant="ghost">
																<Link to={`/structures/${structure.structureId}`}>
																	<ArrowRight className="h-4 w-4" />
																	Details
																</Link>
															</Button>
														) : (
															<Badge variant="ghost" className="justify-center">
																<Building2 className="h-3 w-3" />
																View only
															</Badge>
														)}
													</TableCell>
												</TableRow>
											)
										})}
									</TableBody>
								</Table>
							)}
						</TableRefreshFrame>
					</div>
				</CardContent>
			</Card>
		</Container>
	)
}
