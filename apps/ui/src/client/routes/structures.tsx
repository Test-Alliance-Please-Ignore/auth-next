import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	ArrowUpDown,
	Building2,
	Filter,
	RefreshCcw,
	Shield,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import {
	hasAllStructureManagerPermission,
	hasAnyStructurePermission,
	hasStructureTabPermission,
} from '@repo/groups'
import { STRUCTURE_TABS, isReinforcedStructureState, type StructureTab } from '@repo/structures'

import { TableRefreshFrame } from '@/components/table-refresh-frame'
import { CorporationLogo } from '@/components/corporation-logo'
import { StructureSyncStatusBadge } from '@/components/structure-sync-status-badge'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTimeLong } from '@/lib/date-utils'
import { allianceLogoUrl } from '@/lib/eve-images'
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
import {
	type StructureListBaseItem,
	type StructureListFilterOptions,
	type StructureListSortBy,
	type StructureMiningListItem,
	type StructureSkyhookListItem,
	type StructureSovereigntyListFilterOptions,
	type StructureSovereigntyListItem,
} from '@/lib/api'
import { cn } from '@/lib/utils'

import { useStructureModuleConfig, useStructureOverviewMetrics, useStructuresForTab } from '../features/structures/hooks'
import {
	clearStructureTableFilters,
	setStructureTableFilters,
	setStructureTablePage,
	setStructureTablePageSize,
	setStructureTableTab,
	setStructureTableSort,
	useStructureTableUiState,
} from '../features/structures/state/structure-table-store'

import type { SelectOption } from '@/components/ui/select'

const UNASSIGNED_GROUP_VALUE = '__unassigned__'
const BOOLEAN_FILTER_OPTIONS: SelectOption[] = [
	{ value: 'true', label: 'Yes' },
	{ value: 'false', label: 'No' },
]

function structureSyncStatusDescription(structure: StructureListBaseItem) {
	const lastSyncText = structure.lastSyncedAt
		? `Last sync at ${formatDateTimeLong(structure.lastSyncedAt)}.`
		: ''
	const appendWithLastSync = (text: string) => (lastSyncText ? `${lastSyncText} ${text}` : text)

	if (structure.syncFailureReason) {
		return appendWithLastSync(structure.syncFailureReason)
	}

	if (structure.syncStatus === 'ok') {
		return structure.lastSyncedAt
			? `Last successful sync at ${formatDateTimeLong(structure.lastSyncedAt)}.`
			: 'The latest corporation-data sync completed successfully.'
	}

	if (structure.syncStatus === 'warning') {
		return appendWithLastSync(
			'The latest corporation-data sync completed with warnings, so some snapshot fields may be stale or incomplete.'
		)
	}

	if (structure.syncStatus === 'error') {
		return appendWithLastSync(
			'The latest corporation-data sync failed, so this snapshot may be stale until the next successful refresh.'
		)
	}

	return lastSyncText || 'The latest corporation-data sync completed successfully and the stored snapshot is current.'
}

function withAllOption(options: SelectOption[], label: string): SelectOption[] {
	return [{ value: '', label }, ...options]
}

function toBooleanFilterValue(value: string): 'true' | 'false' | undefined {
	if (value === 'true' || value === 'false') return value
	return undefined
}

function formatNullableDateTime(value: string | null | undefined): string {
	return value ? formatDateTimeLong(value) : '-'
}

function formatNullableNumber(value: number | null | undefined): string {
	if (value === null || value === undefined) return '-'
	return value.toLocaleString()
}

function formatNullableDecimal(
	value: string | number | null | undefined,
	fractionDigits = 2
): string {
	if (value === null || value === undefined || value === '') return '-'
	const numericValue = typeof value === 'number' ? value : Number.parseFloat(value)
	if (!Number.isFinite(numericValue)) return '-'
	return numericValue.toFixed(fractionDigits)
}

function getSovereigntyVulnerabilityState(
	sovereignty:
		| Pick<
				StructureSovereigntyListItem,
				'vulnerabilityWindowStart' | 'vulnerabilityWindowEnd'
		  >
		| null
		| undefined
): { label: string; variant: 'ghost' | 'warning' | 'success' } {
	if (!sovereignty?.vulnerabilityWindowStart || !sovereignty?.vulnerabilityWindowEnd) {
		return { label: 'Unknown', variant: 'ghost' }
	}

	const start = new Date(sovereignty.vulnerabilityWindowStart).getTime()
	const end = new Date(sovereignty.vulnerabilityWindowEnd).getTime()
	const now = Date.now()
	if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) {
		return { label: 'Vulnerable', variant: 'warning' }
	}

	return { label: 'Invulnerable', variant: 'success' }
}

function AllianceLogo({
	allianceId,
	allianceName,
}: {
	allianceId: string
	allianceName?: string | null
}) {
	const [failed, setFailed] = useState(false)

	if (failed) {
		return <Shield className="h-4 w-4 text-muted-foreground" />
	}

	return (
		<img
			src={allianceLogoUrl(allianceId, 32)}
			alt={allianceName ? `${allianceName} logo` : 'Alliance logo'}
			className="h-5 w-5 rounded-sm object-cover"
			loading="lazy"
			onError={() => setFailed(true)}
		/>
	)
}

type PrimaryStructureFilterSlot = 'type' | 'raidable'

export default function StructuresPage() {
	usePageTitle('Structures')

	const { user, isLoading: authLoading } = useAuth()
	const { data: groups = [] } = useGroups({ limit: 100 })
	const { permissions, isLoading: permissionsLoading } = useUserPermissions()
	const canViewStructures = user?.is_admin === true || hasAnyStructurePermission(permissions)
	const canManageStructures =
		user?.is_admin === true || hasAllStructureManagerPermission(permissions)
	const tableState = useStructureTableUiState((state) => state)
	const visibleTabs = useMemo(
		() =>
			user?.is_admin === true
				? STRUCTURE_TABS
				: STRUCTURE_TABS.filter((tab) => hasStructureTabPermission(permissions, tab.tab)),
		[user, permissions]
	)
	const activeTab = visibleTabs.some((tab) => tab.tab === tableState.tab)
		? tableState.tab
		: visibleTabs[0]?.tab ?? tableState.tab
	const isSovereigntyTab = activeTab === 'sovereignty'
	const isSkyhooksTab = activeTab === 'skyhooks'
	const isMiningCitadelTab = activeTab === 'mining-citadels'
	const [nowMs, setNowMs] = useState(() => Date.now())
	const { data: moduleConfig } = useStructureModuleConfig()
	const {
		data: overviewMetrics,
		isLoading: isOverviewLoading,
		isFetching: isOverviewFetching,
		refetch: refetchOverview,
	} = useStructureOverviewMetrics({
		enabled: !authLoading && !permissionsLoading && canViewStructures,
	})
	const query = useMemo(() => {
		const base = {
			page: tableState.page,
			pageSize: tableState.pageSize,
			sortBy: tableState.sortBy,
			sortDirection: tableState.sortDirection,
		}
		const common = {
			corporationId: tableState.filters.corporationId,
			assignedGroupId: tableState.filters.assignedGroupId,
			lowPower: tableState.filters.lowPower,
			lowPowerAllowed: tableState.filters.lowPowerAllowed,
			regionId: tableState.filters.regionId,
			systemId: tableState.filters.systemId,
			state: tableState.filters.state,
			typeId: tableState.filters.typeId,
		}

		switch (activeTab) {
			case 'citadels':
				return {
					...base,
					...common,
				}
			case 'navigation':
				return {
					...base,
					...common,
				}
			case 'sovereignty':
				return {
					...base,
					corporationId: tableState.filters.corporationId,
					assignedGroupId: tableState.filters.assignedGroupId,
					regionId: tableState.filters.regionId,
					systemId: tableState.filters.systemId,
					controllerAllianceId: tableState.filters.controllerAllianceId,
					vulnerabilityState: tableState.filters.vulnerabilityState,
				}
			case 'skyhooks':
				return {
					...base,
					...common,
					planetId: tableState.filters.planetId,
					isRaidable: tableState.filters.isRaidable,
				}
			case 'mining-citadels':
				return {
					...base,
					...common,
					planetId: tableState.filters.planetId,
				}
			case 'moon-drills':
				return {
					...base,
					...common,
				}
		}
		throw new Error(`Unknown structures tab: ${activeTab}`)
	}, [activeTab, tableState])

	const {
		data: structuresResponse,
		isLoading,
		error,
		refetch,
		isFetching,
	} = useStructuresForTab(activeTab, query, {
		enabled: !authLoading && !permissionsLoading && canViewStructures,
	})

	const structures = structuresResponse?.items ?? []
	const pagination = structuresResponse?.pagination
	const filterOptions = structuresResponse?.filterOptions
	const genericFilterOptions = filterOptions as StructureListFilterOptions | undefined
	const sovereigntyFilterOptions = isSovereigntyTab
		? (filterOptions as StructureSovereigntyListFilterOptions | undefined)
		: undefined
	const isInitialLoading = isLoading && !structuresResponse
	const isSoftLoading = Boolean(structuresResponse) && isFetching
	const refreshAll = () => {
		void Promise.all([refetch(), refetchOverview()])
	}

	useEffect(() => {
		const timer = window.setInterval(() => {
			setNowMs(Date.now())
		}, 60_000)
		return () => window.clearInterval(timer)
	}, [])

	useEffect(() => {
		if (visibleTabs.length === 0) {
			return
		}

		if (!visibleTabs.some((tab) => tab.tab === tableState.tab)) {
			setStructureTableTab(visibleTabs[0]?.tab ?? 'citadels')
		}
	}, [tableState.tab, visibleTabs])

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
				((isSovereigntyTab
					? sovereigntyFilterOptions?.vulnerabilityStates ?? []
					: genericFilterOptions?.states ?? []
				).map(
					(option) => ({
						value: option.value,
						label: option.label,
					})
				)),
				isSovereigntyTab ? 'All Vulnerability States' : 'All States'
			),
		[genericFilterOptions, isSovereigntyTab, sovereigntyFilterOptions]
	)
	const typeOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(genericFilterOptions?.types ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Types'
			),
		[genericFilterOptions]
	)
	const allianceOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(
					isSovereigntyTab
						? sovereigntyFilterOptions?.controllerAlliances ?? []
						: genericFilterOptions?.alliances ?? []
				).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				isSovereigntyTab ? 'All Controlling Alliances' : 'All Alliances'
			),
		[genericFilterOptions, isSovereigntyTab, sovereigntyFilterOptions]
	)
	const raidableStateOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(genericFilterOptions?.raidableStates ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Raidable States'
			),
		[genericFilterOptions]
	)
	const structuresContentKey = [
		activeTab,
		tableState.page,
		tableState.pageSize,
		tableState.sortBy,
		tableState.sortDirection,
		...(isSovereigntyTab
			? [
					tableState.filters.corporationId ?? '',
					tableState.filters.assignedGroupId ?? '',
					tableState.filters.regionId ?? '',
					tableState.filters.systemId ?? '',
					tableState.filters.controllerAllianceId ?? '',
					tableState.filters.vulnerabilityState ?? '',
				]
			: [
					tableState.filters.corporationId ?? '',
					tableState.filters.assignedGroupId ?? '',
					tableState.filters.regionId ?? '',
					tableState.filters.systemId ?? '',
					tableState.filters.state ?? '',
					tableState.filters.lowPower ?? '',
					tableState.filters.lowPowerAllowed ?? '',
					tableState.filters.typeId ?? '',
					tableState.filters.planetId ?? '',
					tableState.filters.isRaidable ?? '',
				]),
	].join(':')

	const activeFilterCount = (
		isSovereigntyTab
			? [
					tableState.filters.corporationId,
					tableState.filters.assignedGroupId,
					tableState.filters.regionId,
					tableState.filters.systemId,
					tableState.filters.controllerAllianceId,
					tableState.filters.vulnerabilityState,
				]
			: [
					tableState.filters.corporationId,
					tableState.filters.assignedGroupId,
					tableState.filters.regionId,
					tableState.filters.systemId,
					tableState.filters.state,
					tableState.filters.lowPower,
					tableState.filters.lowPowerAllowed,
					tableState.filters.typeId,
					tableState.filters.planetId,
					tableState.filters.isRaidable,
				]
	).filter(Boolean).length

	const refreshButton = (
		<Button
			variant="secondary"
			size="sm"
			className="h-8"
			onClick={() => refreshAll()}
			disabled={isFetching || isOverviewFetching || isInitialLoading || isOverviewLoading}
		>
			<RefreshCcw className={cn('h-4 w-4', (isFetching || isOverviewFetching) && 'animate-spin')} />
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

	const primaryFilterSlot: PrimaryStructureFilterSlot = (() => {
		switch (activeTab) {
			case 'sovereignty':
				return 'type'
			case 'skyhooks':
				return 'raidable'
			case 'citadels':
			case 'navigation':
			case 'mining-citadels':
			case 'moon-drills':
				return 'type'
		}
		throw new Error(`Unsupported structures tab for primary filter: ${activeTab}`)
	})()
	const primaryFilterControl = (() => {
		switch (primaryFilterSlot) {
			case 'raidable':
				return (
					<FilterField label="Raidable">
						<Select
							options={raidableStateOptions}
							value={tableState.filters.isRaidable ?? ''}
							onValueChange={(value) =>
								setStructureTableFilters({ isRaidable: toBooleanFilterValue(value) })
							}
							placeholder="All Raidable States"
						/>
					</FilterField>
				)
			case 'type':
				return (
					<FilterField label="Type">
						<Select
							options={typeOptions}
							value={tableState.filters.typeId ?? ''}
							onValueChange={(value) => setStructureTableFilters({ typeId: value || undefined })}
							placeholder="All Types"
							searchable
						/>
					</FilterField>
				)
		}
	})()
	const sovereigntyFilterControls = (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3">
			<FilterField label="Region">
				<Select
					options={regionOptions}
					value={tableState.filters.regionId ?? ''}
					onValueChange={(value) => setStructureTableFilters({ regionId: value || undefined })}
					placeholder="All Regions"
					searchable
				/>
			</FilterField>
			<FilterField label="System">
				<Select
					options={systemOptions}
					value={tableState.filters.systemId ?? ''}
					onValueChange={(value) => setStructureTableFilters({ systemId: value || undefined })}
					placeholder="All Systems"
					searchable
				/>
			</FilterField>
			<FilterField label="Corporation">
				<Select
					options={corporationOptions}
					value={tableState.filters.corporationId ?? ''}
					onValueChange={(value) => setStructureTableFilters({ corporationId: value || undefined })}
					placeholder="All Corporations"
					searchable
				/>
			</FilterField>
			<FilterField label="Controlling Alliance">
				<Select
					options={allianceOptions}
					value={tableState.filters.controllerAllianceId ?? ''}
					onValueChange={(value) =>
						setStructureTableFilters({ controllerAllianceId: value || undefined })
					}
					placeholder="All Controlling Alliances"
					searchable
				/>
			</FilterField>
			<FilterField label="Vulnerability State">
				<Select
					options={stateOptions}
					value={tableState.filters.vulnerabilityState ?? ''}
					onValueChange={(value) =>
						setStructureTableFilters({
							vulnerabilityState: value
								? (value as 'vulnerable' | 'invulnerable' | 'reinforced')
								: undefined,
						})
					}
					placeholder="All Vulnerability States"
					searchable
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
		</div>
	)
	const commonFilterControls = (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4">
			<FilterField label="Region">
				<Select
					options={regionOptions}
					value={tableState.filters.regionId ?? ''}
					onValueChange={(value) => setStructureTableFilters({ regionId: value || undefined })}
					placeholder="All Regions"
					searchable
				/>
			</FilterField>
			<FilterField label="System">
				<Select
					options={systemOptions}
					value={tableState.filters.systemId ?? ''}
					onValueChange={(value) => setStructureTableFilters({ systemId: value || undefined })}
					placeholder="All Systems"
					searchable
				/>
			</FilterField>
			<FilterField label="Corporation">
				<Select
					options={corporationOptions}
					value={tableState.filters.corporationId ?? ''}
					onValueChange={(value) => setStructureTableFilters({ corporationId: value || undefined })}
					placeholder="All Corporations"
					searchable
				/>
			</FilterField>
			{primaryFilterControl}
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
					onValueChange={(value) => setStructureTableFilters({ lowPower: toBooleanFilterValue(value) })}
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
		</div>
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
							onClick={() => refreshAll()}
							disabled={isFetching || isOverviewFetching || isInitialLoading || isOverviewLoading}
						>
							<RefreshCcw className={cn('h-4 w-4', (isFetching || isOverviewFetching) && 'animate-spin')} />
							Refresh
						</Button>
					</div>
				}
			/>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Total Structures</CardTitle>
						<CardDescription>
							All structures visible to your current permission scope.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-3xl font-semibold">
						{overviewMetrics ? overviewMetrics.total : '-'}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Low Fuel</CardTitle>
						<CardDescription>
							Low fuel: {moduleConfig?.lowFuelTimeThresholdHours ?? '-'}h or{' '}
							{moduleConfig?.lowFuelAmountThreshold ?? '-'} units remaining.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-semibold">
							{overviewMetrics ? overviewMetrics.lowFuel : '-'}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Low Power</CardTitle>
						<CardDescription>Structures in low power without suppression enabled.</CardDescription>
					</CardHeader>
					<CardContent className="text-3xl font-semibold">
						{overviewMetrics ? overviewMetrics.lowPower : '-'}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Reinforced</CardTitle>
						<CardDescription>
							Structures currently in a reinforced or transition state.
						</CardDescription>
					</CardHeader>
					<CardContent className="text-3xl font-semibold">
						{overviewMetrics ? overviewMetrics.reinforced : '-'}
					</CardContent>
				</Card>
				<Card>
						<CardHeader>
							<CardTitle className="text-base">Fuel Burn Rate</CardTitle>
							<CardDescription>
								Estimated aggregate burn rate from structure fuel history.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-1">
						<div className="text-3xl font-semibold">
							{overviewMetrics?.estimatedFuelBurnRatePerHour
								? `${Number(overviewMetrics.estimatedFuelBurnRatePerHour).toLocaleString(undefined, {
										maximumFractionDigits: 2,
									})}/hr`
								: '-'}
						</div>
						{overviewMetrics && (
							<p className="text-xs text-muted-foreground">
								Estimated from {overviewMetrics.fuelBurnRateSampleCount} structures with usable fuel
								history.
							</p>
						)}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader className="pb-3">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div>
							<CardTitle className="flex items-center gap-2 text-base">
								<Filter className="h-5 w-5" />
								Filters
							</CardTitle>
							<CardDescription>
								Choose a structure family to switch the list preset and filters.
							</CardDescription>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<Tabs
						value={activeTab}
						onValueChange={(value) => setStructureTableTab(value as StructureTab)}
					>
						<TabsList className="flex w-full flex-wrap gap-1 border-b-0">
							{visibleTabs.map((tab) => (
								<TabsTrigger key={tab.tab} value={tab.tab}>
									{tab.label}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
					{activeFilterCount > 0 && (
						<div className="flex justify-end">
							<Button variant="ghost" size="sm" onClick={() => clearStructureTableFilters()}>
								Clear Filters
							</Button>
						</div>
					)}
					<div className="space-y-4">
						{isSovereigntyTab ? sovereigntyFilterControls : commonFilterControls}
					</div>
					<div className="space-y-4 border-t border-border/60 pt-4">
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
							onRetry={error && structuresResponse ? () => refreshAll() : undefined}
							retryDisabled={isFetching || isOverviewFetching}
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
											onClick={() => refreshAll()}
											disabled={isFetching || isOverviewFetching}
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
							<Table
								className={cn(
									'min-w-[118rem]',
									isSovereigntyTab && 'min-w-[128rem]',
									isSkyhooksTab && 'min-w-[126rem]',
									isMiningCitadelTab && 'min-w-[124rem]'
								)}
							>
								<TableHeader>
									<TableRow>
										<SortableHead field="region" label="Region" />
										<SortableHead field="system" label="System" />
										{isSovereigntyTab ? null : <SortableHead field="name" label="Name" />}
										<SortableHead field="corporation" label="Corporation" />
										{isSovereigntyTab ? null : <SortableHead field="type" label="Type" />}
										<SortableHead field="state" label="State" />
										{isSovereigntyTab ? (
											<TableHead>Controlling Alliance</TableHead>
										) : (
											<>
												<SortableHead field="fuel" label="Fuel" />
												<TableHead>LP</TableHead>
												<TableHead>LP Allowed</TableHead>
												<SortableHead field="nextStateAt" label="Next State In" />
											</>
										)}
										<TableHead>Group</TableHead>
										{isSovereigntyTab ? (
											<>
												<SortableHead field="activityDefenseMultiplier" label="ADM" />
												<TableHead>Workforce</TableHead>
												<TableHead>Power</TableHead>
											</>
										) : isSkyhooksTab ? (
											<>
												<TableHead>Planet</TableHead>
												<TableHead>Workforce</TableHead>
												<TableHead>Raidable</TableHead>
												<TableHead>Vulnerable</TableHead>
											</>
										) : isMiningCitadelTab ? (
											<>
												<TableHead>Moon</TableHead>
												<TableHead>Planet</TableHead>
												<TableHead>Chunk Arrival</TableHead>
												<TableHead>Natural Decay</TableHead>
											</>
										) : null}
										<TableHead>Sync</TableHead>
										<TableHead className="sticky right-0 z-20 table-header-bg border-l border-border/50 text-right">
											Actions
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{structures.map((structure) => {
												const structureBase = structure as StructureListBaseItem
												const sovereigntyStructure = structure as StructureSovereigntyListItem
												const skyhookStructure = structure as StructureSkyhookListItem
												const miningStructure = structure as StructureMiningListItem
											const fuelLabel = structureBase.fuelExpires ? (
												<DurationDisplay
													endDate={structureBase.fuelExpires}
													referenceTimeMs={nowMs}
													maxUnits={3}
													durationStyle="compact"
												/>
											) : structureBase.fuelAmount != null ? (
												`${structureBase.fuelAmount.toLocaleString()} units`
											) : (
												'-'
											)
											const groupLabel = structureBase.assignedGroupId
												? (groupNameById.get(structureBase.assignedGroupId) ??
													structureBase.assignedGroupId)
												: '-'
											const isHidden = structureBase.hidden
											const sovereigntyVulnerabilityState = getSovereigntyVulnerabilityState(
												sovereigntyStructure
											)

												return (
													<TableRow key={structure.structureId}>
														<TableCell className="font-medium">
															{structure.regionName ?? structure.regionId ?? '-'}
														</TableCell>
														<TableCell>{structure.systemName ?? structure.systemId}</TableCell>
														{!isSovereigntyTab && (
															<TableCell className="max-w-[16rem]">
																<div className="flex min-w-0 items-center gap-2">
																	<div className="truncate font-medium">{structure.name}</div>
																	{isHidden && <Badge variant="ghost">Hidden</Badge>}
																</div>
																<div className="text-xs text-muted-foreground">
																	{structure.structureId}
																</div>
															</TableCell>
														)}
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
														{isSovereigntyTab ? (
															<>
																<TableCell>
																	<div className="space-y-1">
																		<Badge variant={sovereigntyVulnerabilityState.variant}>
																			{sovereigntyVulnerabilityState.label}
																		</Badge>
																		{isReinforcedStructureState(structureBase.state) && (
																			<div className="text-xs text-muted-foreground">Reinforced</div>
																		)}
																	</div>
																</TableCell>
																<TableCell className="max-w-[18rem]">
																	<div className="flex min-w-0 items-center gap-2">
																		{sovereigntyStructure.controllerAllianceId ? (
																			<AllianceLogo
																				allianceId={sovereigntyStructure.controllerAllianceId}
																				allianceName={sovereigntyStructure.controllerAllianceName}
																			/>
																		) : (
																			<div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-muted-foreground">
																				<Shield className="h-3 w-3" />
																			</div>
																		)}
																		<span
																			className="truncate font-medium"
																			title={
																				sovereigntyStructure.controllerAllianceName ??
																				sovereigntyStructure.controllerAllianceId ??
																				'-'
																			}
																		>
																			{sovereigntyStructure.controllerAllianceName ??
																				sovereigntyStructure.controllerAllianceId ??
																				'-'}
																		</span>
																</div>
															</TableCell>
															<TableCell>{groupLabel}</TableCell>
															<TableCell>
																{formatNullableDecimal(
																	sovereigntyStructure.activityDefenseMultiplier
																)}
															</TableCell>
															<TableCell>
																{formatNullableNumber(sovereigntyStructure.resourceWorkforceAllocated)} /{' '}
																	{formatNullableNumber(sovereigntyStructure.resourceWorkforceAvailable)}
																</TableCell>
																<TableCell>
																	{formatNullableNumber(sovereigntyStructure.resourcePowerAllocated)} /{' '}
																	{formatNullableNumber(sovereigntyStructure.resourcePowerAvailable)}
																</TableCell>
															</>
														) : (
															<>
																<TableCell>{structure.typeName ?? structure.typeId}</TableCell>
																<TableCell>
																	<StructureStateBadge state={structure.state} />
																</TableCell>
																<TableCell>{fuelLabel}</TableCell>
																<TableCell>
																	<Badge variant={structureBase.lowPower ? 'warning' : 'ghost'}>
																		{structureBase.lowPower ? 'Yes' : 'No'}
																	</Badge>
																</TableCell>
																<TableCell>
																	<Badge variant={structureBase.lowPowerAllowed ? 'success' : 'ghost'}>
																		{structureBase.lowPowerAllowed ? 'Yes' : 'No'}
																	</Badge>
																</TableCell>
																<TableCell>
																	{structureBase.nextStateAt ? (
																		<DurationDisplay
																			endDate={structureBase.nextStateAt}
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
															</>
														)}
														{isSovereigntyTab ? null : isSkyhooksTab ? (
															<>
																<TableCell>{skyhookStructure.planetName ?? skyhookStructure.planetId}</TableCell>
																<TableCell>
																	{formatNullableNumber(skyhookStructure.effectiveWorkforce)}
																</TableCell>
																<TableCell>
																	<Badge variant={skyhookStructure.isRaidable ? 'warning' : 'ghost'}>
																		{skyhookStructure.isRaidable ? 'Yes' : 'No'}
																	</Badge>
																</TableCell>
																<TableCell>
																	{skyhookStructure.theftVulnerabilityStart &&
																	skyhookStructure.theftVulnerabilityEnd
																		? `${formatDateTimeLong(skyhookStructure.theftVulnerabilityStart)} - ${formatDateTimeLong(skyhookStructure.theftVulnerabilityEnd)}`
																	: formatNullableDateTime(skyhookStructure.vulnerableAt)}
																</TableCell>
															</>
														) : isMiningCitadelTab ? (
															<>
																<TableCell>
																	{(miningStructure.moonName ?? miningStructure.moonId) || '-'}
																</TableCell>
																<TableCell>
																	{miningStructure.planetName ?? miningStructure.planetId ?? '-'}
																</TableCell>
																<TableCell>{formatNullableDateTime(miningStructure.chunkArrivalTime)}</TableCell>
																<TableCell>{formatNullableDateTime(miningStructure.naturalDecayTime)}</TableCell>
															</>
														) : null}
														<TableCell>
															<StructureSyncStatusBadge
																status={structure.syncStatus}
																description={structureSyncStatusDescription(structure)}
															/>
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
