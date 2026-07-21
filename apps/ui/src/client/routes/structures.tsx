import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	ArrowUpDown,
	Filter,
	RefreshCcw,
	Shield,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'

import {
	hasAllStructureManagerPermission,
	hasAnyStructurePermission,
	hasStructureDetailsPermission,
	hasStructureTabPermission,
} from '@repo/groups'
import {
	STRUCTURE_TABS,
	isReinforcedStructureState,
	isStructureTab,
	isStructureVulnerabilityState,
	STRUCTURE_SYNC_ERROR_STALE_MS,
	STRUCTURE_SYNC_WARNING_STALE_MS,
} from '@repo/structures'

import { TableRefreshFrame } from '@/components/table-refresh-frame'
import { CorporationLogo } from '@/components/corporation-logo'
import { SkyhookStateBadge } from '@/components/skyhook-state-badge'
import { StructureSyncStatusBadge } from '@/components/structure-sync-status-badge'
import { StructureStateBadge } from '@/components/structure-state-badge'
import { DurationDisplay } from '@/components/ui/duration-display'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { FilterField } from '@/components/ui/filter-field'
import { LoadingSpinner } from '@/components/ui/loading'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTimeLong } from '@/lib/date-utils'
import { allianceLogoUrl } from '@/lib/eve-images'
import { getSkyhookVulnerabilityWindowDisplay } from '@/lib/skyhook-vulnerability-window'
import { stripLeadingContextName } from '@/lib/structure-name-utils'
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
	type StructureCitadelListItem,
	type StructureCitadelListQuery,
	type StructureListBaseItem,
	type StructureListFilterOptions,
	type StructureListSortBy,
	type StructureMoonDrillListItem,
	type StructureMoonDrillListQuery,
	type StructureMiningCitadelListQuery,
	type StructureMiningCitadelListItem,
	type StructureNavigationListItem,
	type StructureSkyhookListItem,
	type StructureSkyhookListQuery,
	type StructureSovereigntyListFilterOptions,
	type StructureSovereigntyListItem,
	type StructureSovereigntyListQuery,
} from '@/lib/api'
import { cn } from '@/lib/utils'

import {
	useCitadelStructures,
	useMiningCitadelStructures,
	useMoonDrillStructures,
	useNavigationStructures,
	useSkyhookStructures,
	useSovereigntyStructures,
	useStructureModuleConfig,
} from '../features/structures/hooks'
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

function structureSyncStatusDescription(
	structure: Pick<StructureListBaseItem, 'syncStatus' | 'syncFailureReason' | 'lastSyncedAt'>
) {
	const getStalenessNote = () => {
		if (!structure.lastSyncedAt) return null
		const ageMs = Math.max(0, Date.now() - new Date(structure.lastSyncedAt).getTime())
		if (ageMs >= STRUCTURE_SYNC_ERROR_STALE_MS) {
			return 'This snapshot is more than 24 hours old and should be treated as stale.'
		}
		if (ageMs >= STRUCTURE_SYNC_WARNING_STALE_MS) {
			return 'This snapshot is more than 12 hours old and may be stale.'
		}
		return null
	}

	if (structure.syncFailureReason) {
		return structure.lastSyncedAt
			? `Last sync at ${formatDateTimeLong(structure.lastSyncedAt)}. ${structure.syncFailureReason}`
			: structure.syncFailureReason
	}

	if (structure.syncStatus === 'ok') {
		return structure.lastSyncedAt
			? `Last successful sync at ${formatDateTimeLong(structure.lastSyncedAt)}.`
			: 'The latest corporation-data sync completed successfully.'
	}

	if (structure.syncStatus === 'warning') {
		const stalenessNote = getStalenessNote()
		return structure.lastSyncedAt
			? `Last sync at ${formatDateTimeLong(structure.lastSyncedAt)}. ${stalenessNote ?? 'The latest corporation-data sync completed with warnings, so some snapshot fields may be stale or incomplete.'}`
			: 'The latest corporation-data sync completed with warnings, so some snapshot fields may be stale or incomplete.'
	}

	if (structure.syncStatus === 'error') {
		const stalenessNote = getStalenessNote()
		return structure.lastSyncedAt
			? `Last sync at ${formatDateTimeLong(structure.lastSyncedAt)}. ${stalenessNote ?? 'The latest corporation-data sync failed, so this snapshot may be stale until the next successful refresh.'}`
			: 'The latest corporation-data sync failed, so this snapshot may be stale until the next successful refresh.'
	}

	return structure.lastSyncedAt
		? `Last sync at ${formatDateTimeLong(structure.lastSyncedAt)}. The latest corporation-data sync completed successfully and the stored snapshot is current.`
		: 'The latest corporation-data sync completed successfully and the stored snapshot is current.'
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

function formatPercent(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return '-'
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function SkyhookFillBar({ value }: { value: number }) {
	return (
		<div className="space-y-1.5">
			<div className="h-2 w-full overflow-hidden rounded-full bg-muted/30">
				<div
					className="h-full rounded-full bg-primary transition-all"
					style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
				/>
			</div>
			<div className="text-xs text-muted-foreground">{formatPercent(value)} full</div>
		</div>
	)
}

function formatReagentBurnRate(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '-'
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}/hr`
}

function SovereigntyReagentCell({
	quantity,
	burningPerHour,
	estimatedDepletionAt,
	nowMs,
}: {
	quantity: number
	burningPerHour: number
	estimatedDepletionAt: string | null
	nowMs: number
}) {
	return (
		<div className="space-y-1.5">
			<div className="font-medium tabular-nums">{formatNullableNumber(quantity)}</div>
			<div className="text-xs text-muted-foreground">
				Burn {formatReagentBurnRate(burningPerHour)}
			</div>
			<div className="text-xs text-muted-foreground">
				{estimatedDepletionAt ? (
					<>
						<span className="mr-1">Remaining</span>
						<DurationDisplay
							endDate={estimatedDepletionAt}
							referenceTimeMs={nowMs}
							maxUnits={3}
							durationStyle="compact"
							format="compact"
						/>
					</>
				) : (
					'-'
				)}
			</div>
		</div>
	)
}

function getSovereigntyVulnerabilityState(
	sovereignty:
		| Pick<
				StructureSovereigntyListItem,
				'vulnerabilityWindowStart' | 'vulnerabilityWindowEnd'
		  >
		| null
		| undefined
): { label: string; variant: 'ghost' | 'success' } {
	if (!sovereignty?.vulnerabilityWindowStart || !sovereignty?.vulnerabilityWindowEnd) {
		return { label: 'Unknown', variant: 'ghost' }
	}

	const start = new Date(sovereignty.vulnerabilityWindowStart).getTime()
	const end = new Date(sovereignty.vulnerabilityWindowEnd).getTime()
	const now = Date.now()
	if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) {
		return { label: 'Vulnerable', variant: 'success' }
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
	const canViewStructureDetails = user?.is_admin === true || hasStructureDetailsPermission(permissions)
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
	const [nowMs, setNowMs] = useState(() => Date.now())
	const { data: moduleConfig } = useStructureModuleConfig()
	const tableScrollContainerRef = useRef<HTMLDivElement | null>(null)
	const tableScrollLeftByTabRef = useRef<Record<string, number>>({})
	const sharedQuery = useMemo(
		() => ({
			page: tableState.page,
			pageSize: tableState.pageSize,
			sortBy: tableState.sortBy,
			sortDirection: tableState.sortDirection,
		}),
		[tableState.page, tableState.pageSize, tableState.sortBy, tableState.sortDirection]
	)
	const operationalQuery = useMemo<StructureCitadelListQuery>(
		() => ({
			...sharedQuery,
			corporationId: tableState.filters.corporationId,
			assignedGroupId: tableState.filters.assignedGroupId,
			lowPower: tableState.filters.lowPower,
			lowPowerAllowed: tableState.filters.lowPowerAllowed,
			regionId: tableState.filters.regionId,
			systemId: tableState.filters.systemId,
			state: tableState.filters.state,
			typeId: tableState.filters.typeId,
		}),
		[sharedQuery, tableState.filters]
	)
	const sovereigntyQuery = useMemo<StructureSovereigntyListQuery>(
		() => ({
			...sharedQuery,
			corporationId: tableState.filters.corporationId,
			assignedGroupId: tableState.filters.assignedGroupId,
			regionId: tableState.filters.regionId,
			systemId: tableState.filters.systemId,
			controllerAllianceId: tableState.filters.controllerAllianceId,
			vulnerabilityState: tableState.filters.vulnerabilityState,
		}),
		[sharedQuery, tableState.filters]
	)
	const skyhookQuery = useMemo<StructureSkyhookListQuery>(
		() => ({
			...sharedQuery,
			corporationId: tableState.filters.corporationId,
			assignedGroupId: tableState.filters.assignedGroupId,
			regionId: tableState.filters.regionId,
			systemId: tableState.filters.systemId,
			state: tableState.filters.state,
			typeId: tableState.filters.typeId,
			planetId: tableState.filters.planetId,
			isRaidable: tableState.filters.isRaidable,
		}),
		[sharedQuery, tableState.filters]
	)
	const miningCitadelQuery = useMemo<StructureMiningCitadelListQuery>(
		() => ({
			...sharedQuery,
			corporationId: tableState.filters.corporationId,
			assignedGroupId: tableState.filters.assignedGroupId,
			lowPower: tableState.filters.lowPower,
			lowPowerAllowed: tableState.filters.lowPowerAllowed,
			regionId: tableState.filters.regionId,
			systemId: tableState.filters.systemId,
			state: tableState.filters.state,
			typeId: tableState.filters.typeId,
			planetId: tableState.filters.planetId,
		}),
		[sharedQuery, tableState.filters]
	)
	const moonDrillQuery = useMemo<StructureMoonDrillListQuery>(
		() => ({
			...sharedQuery,
			corporationId: tableState.filters.corporationId,
			assignedGroupId: tableState.filters.assignedGroupId,
			regionId: tableState.filters.regionId,
			systemId: tableState.filters.systemId,
			state: tableState.filters.state,
			typeId: tableState.filters.typeId,
			planetId: tableState.filters.planetId,
		}),
		[sharedQuery, tableState.filters]
	)

	const citadelStructures = useCitadelStructures(operationalQuery, {
		enabled: !authLoading && !permissionsLoading && canViewStructures && activeTab === 'citadels',
	})
	const navigationStructures = useNavigationStructures(operationalQuery, {
		enabled: !authLoading && !permissionsLoading && canViewStructures && activeTab === 'navigation',
	})
	const sovereigntyStructures = useSovereigntyStructures(sovereigntyQuery, {
		enabled: !authLoading && !permissionsLoading && canViewStructures && activeTab === 'sovereignty',
	})
	const skyhookStructures = useSkyhookStructures(skyhookQuery, {
		enabled: !authLoading && !permissionsLoading && canViewStructures && activeTab === 'skyhooks',
	})
	const miningCitadelStructures = useMiningCitadelStructures(miningCitadelQuery, {
		enabled:
			!authLoading &&
			!permissionsLoading &&
			canViewStructures &&
			activeTab === 'mining-citadels',
	})
	const moonDrillStructures = useMoonDrillStructures(moonDrillQuery, {
		enabled: !authLoading && !permissionsLoading && canViewStructures && activeTab === 'moon-drills',
	})

	const isSovereigntyTab = activeTab === 'sovereignty'
	const isSkyhooksTab = activeTab === 'skyhooks'
	const isMiningCitadelTab = activeTab === 'mining-citadels'
	const isMoonDrillsTab = activeTab === 'moon-drills'
	const activeResponse = (() => {
		switch (activeTab) {
			case 'citadels':
				return citadelStructures
			case 'navigation':
				return navigationStructures
			case 'sovereignty':
				return sovereigntyStructures
			case 'skyhooks':
				return skyhookStructures
			case 'mining-citadels':
				return miningCitadelStructures
			case 'moon-drills':
				return moonDrillStructures
		}
	})()
	const structuresResponse = activeResponse.data
	const structures = structuresResponse?.items ?? []
	const pagination = structuresResponse?.pagination
	const operationalFilterOptions: StructureListFilterOptions | undefined =
		activeTab === 'citadels'
			? citadelStructures.data?.filterOptions
			: activeTab === 'navigation'
				? navigationStructures.data?.filterOptions
				: activeTab === 'skyhooks'
					? skyhookStructures.data?.filterOptions
					: activeTab === 'mining-citadels'
						? miningCitadelStructures.data?.filterOptions
						: activeTab === 'moon-drills'
							? moonDrillStructures.data?.filterOptions
							: undefined
	const sovereigntyFilterOptions: StructureSovereigntyListFilterOptions | undefined =
		activeTab === 'sovereignty' ? sovereigntyStructures.data?.filterOptions : undefined
	const isInitialLoading = activeResponse.isLoading && !activeResponse.data
	const isSoftLoading = Boolean(activeResponse.data) && activeResponse.isFetching
	const structuresError = activeResponse.error
	const isStructuresFetching = activeResponse.isFetching
	const error = structuresError
	const isFetching = isStructuresFetching
	const refreshAll = () => {
		void activeResponse.refetch()
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
				(operationalFilterOptions?.corporations ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Corporations'
			),
		[operationalFilterOptions]
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
					...(operationalFilterOptions?.assignedGroups ?? []).map((option) => ({
						value: option.value,
						label: groupNameById.get(option.value) ?? option.label ?? option.value,
					})),
				],
				'All Groups'
			),
		[operationalFilterOptions, groupNameById]
	)
	const regionOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(operationalFilterOptions?.regions ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Regions'
			),
		[operationalFilterOptions]
	)
	const systemOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(operationalFilterOptions?.systems ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Systems'
			),
		[operationalFilterOptions]
	)
	const stateOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				((isSovereigntyTab
					? sovereigntyFilterOptions?.vulnerabilityStates ?? []
					: operationalFilterOptions?.states ?? []
				).map(
					(option) => ({
						value: option.value,
						label: option.label,
					})
				)),
				isSovereigntyTab ? 'All Vulnerability States' : 'All States'
			),
		[isSovereigntyTab, operationalFilterOptions, sovereigntyFilterOptions]
	)
	const typeOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(operationalFilterOptions?.types ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Types'
			),
		[operationalFilterOptions]
	)
	const allianceOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(
					isSovereigntyTab
						? sovereigntyFilterOptions?.controllerAlliances ?? []
						: operationalFilterOptions?.alliances ?? []
				).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				isSovereigntyTab ? 'All Controlling Alliances' : 'All Alliances'
			),
		[isSovereigntyTab, operationalFilterOptions, sovereigntyFilterOptions]
	)
	const raidableStateOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(operationalFilterOptions?.raidableStates ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				'All Raidable States'
			),
		[operationalFilterOptions]
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
			: isSkyhooksTab
				? [
						tableState.filters.corporationId ?? '',
						tableState.filters.assignedGroupId ?? '',
						tableState.filters.regionId ?? '',
						tableState.filters.systemId ?? '',
						tableState.filters.state ?? '',
						tableState.filters.typeId ?? '',
						tableState.filters.planetId ?? '',
						tableState.filters.isRaidable ?? '',
					]
				: isMoonDrillsTab
					? [
							tableState.filters.corporationId ?? '',
							tableState.filters.assignedGroupId ?? '',
							tableState.filters.regionId ?? '',
							tableState.filters.systemId ?? '',
							tableState.filters.state ?? '',
							tableState.filters.typeId ?? '',
							tableState.filters.planetId ?? '',
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
		]),
	].join(':')

	useLayoutEffect(() => {
		const container = tableScrollContainerRef.current
		if (!container) {
			return
		}

		const savedScrollLeft = tableScrollLeftByTabRef.current[activeTab] ?? 0
		const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth)
		container.scrollLeft = Math.min(savedScrollLeft, maxScrollLeft)
	}, [activeTab, structuresContentKey, activeResponse.dataUpdatedAt])

	const handleTableScroll = (event: UIEvent<HTMLDivElement>) => {
		tableScrollLeftByTabRef.current[activeTab] = event.currentTarget.scrollLeft
	}

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
			: isSkyhooksTab
				? [
						tableState.filters.corporationId,
						tableState.filters.assignedGroupId,
						tableState.filters.regionId,
						tableState.filters.systemId,
						tableState.filters.state,
						tableState.filters.typeId,
						tableState.filters.planetId,
						tableState.filters.isRaidable,
					]
				: isMoonDrillsTab
					? [
							tableState.filters.corporationId,
							tableState.filters.assignedGroupId,
							tableState.filters.regionId,
							tableState.filters.systemId,
							tableState.filters.state,
							tableState.filters.typeId,
							tableState.filters.planetId,
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
				]
	).filter(Boolean).length

	const renderStructureRows = <T extends StructureCitadelListItem | StructureNavigationListItem>(
		items: T[]
	) =>
		items.map((structure) => {
			const fuelLabel = structure.fuelExpires ? (
				<DurationDisplay
					endDate={structure.fuelExpires}
					referenceTimeMs={nowMs}
					maxUnits={3}
					durationStyle="compact"
				/>
			) : structure.fuelAmount != null ? (
				`${structure.fuelAmount.toLocaleString()} units`
			) : (
				'-'
			)
			const groupLabel = structure.assignedGroupId
				? (groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId)
				: '-'

			return (
				<TableRow key={structure.structureId}>
					<TableCell>
						<SkyhookStateBadge state={structure.state} />
					</TableCell>
					<TableCell className="font-medium">
						{structure.regionName ?? structure.regionId ?? '-'}
					</TableCell>
					<TableCell>{structure.systemName ?? structure.systemId}</TableCell>
					{!isSovereigntyTab && !isSkyhooksTab && !isMiningCitadelTab && !isMoonDrillsTab && (
						<TableCell className="max-w-[16rem]">
							<div className="flex min-w-0 items-center gap-2">
								<div className="truncate font-medium">{structure.name}</div>
								{structure.hidden && <Badge variant="ghost">Hidden</Badge>}
							</div>
							<div className="text-xs text-muted-foreground">{structure.structureId}</div>
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
					<TableCell>{structure.typeName ?? structure.typeId}</TableCell>
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
						<StructureSyncStatusBadge
							status={structure.syncStatus}
							description={structureSyncStatusDescription(structure)}
						/>
					</TableCell>
					{canViewStructureDetails && (
						<TableCell className="sticky right-0 z-10 border-l border-border/50 bg-card text-right">
							{structure.canViewDetails ? (
								<Button asChild size="sm" variant="ghost">
									<Link to={`/structures/${structure.structureId}`}>
										<ArrowRight className="h-4 w-4" />
										Details
									</Link>
								</Button>
							) : (
								<span className="text-sm text-muted-foreground">-</span>
							)}
						</TableCell>
					)}
				</TableRow>
			)
		})

	const renderCitadelRows = (items: StructureCitadelListItem[]) => renderStructureRows(items)

	const renderNavigationRows = (items: StructureNavigationListItem[]) => renderStructureRows(items)

	const renderSovereigntyRows = (items: StructureSovereigntyListItem[]) =>
		items.map((structure) => {
			const vulnerabilityState = getSovereigntyVulnerabilityState(structure)
			return (
				<TableRow key={structure.structureId}>
					<TableCell>
						<div className="space-y-1">
							<Badge variant={vulnerabilityState.variant}>{vulnerabilityState.label}</Badge>
							{isReinforcedStructureState(structure.state) && (
								<Badge variant="destructive" className="text-xs">
									Reinforced
								</Badge>
							)}
						</div>
					</TableCell>
					<TableCell className="font-medium">
						{structure.regionName ?? structure.regionId ?? '-'}
					</TableCell>
					<TableCell>{structure.systemName ?? structure.systemId}</TableCell>
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
					<TableCell className="max-w-[18rem]">
						<div className="flex min-w-0 items-center gap-2">
							{structure.allianceId ? (
								<AllianceLogo allianceId={structure.allianceId} allianceName={structure.allianceName} />
							) : (
								<div className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-muted-foreground">
									<Shield className="h-3 w-3" />
								</div>
							)}
							<span
								className="truncate font-medium"
								title={structure.allianceName ?? structure.allianceId ?? '-'}
							>
								{structure.allianceName ?? structure.allianceId ?? '-'}
							</span>
						</div>
					</TableCell>
					<TableCell>{structure.assignedGroupId ? groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId : '-'}</TableCell>
					<TableCell>{formatNullableDecimal(structure.activityDefenseMultiplier)}</TableCell>
					<TableCell>
						<SovereigntyReagentCell
							quantity={structure.magmaticGasQuantity}
							burningPerHour={structure.magmaticGasBurningPerHour}
							estimatedDepletionAt={structure.magmaticGasEstimatedDepletionAt}
							nowMs={nowMs}
						/>
					</TableCell>
					<TableCell>
						<SovereigntyReagentCell
							quantity={structure.superionicIceQuantity}
							burningPerHour={structure.superionicIceBurningPerHour}
							estimatedDepletionAt={structure.superionicIceEstimatedDepletionAt}
							nowMs={nowMs}
						/>
					</TableCell>
					<TableCell>
						{formatNullableNumber(structure.resourceWorkforceAllocated)} /{' '}
						{formatNullableNumber(structure.resourceWorkforceAvailable)}
					</TableCell>
					<TableCell>
						{formatNullableNumber(structure.resourcePowerAllocated)} /{' '}
						{formatNullableNumber(structure.resourcePowerAvailable)}
					</TableCell>
					<TableCell>
						<StructureSyncStatusBadge
							status={structure.syncStatus}
							description={structureSyncStatusDescription(structure)}
						/>
					</TableCell>
					{canViewStructureDetails && (
						<TableCell className="sticky right-0 z-10 border-l border-border/50 bg-card text-right">
							{structure.canViewDetails ? (
								<Button asChild size="sm" variant="ghost">
									<Link to={`/structures/${structure.structureId}`}>
										<ArrowRight className="h-4 w-4" />
										Details
									</Link>
								</Button>
							) : (
								<span className="text-sm text-muted-foreground">-</span>
							)}
						</TableCell>
					)}
				</TableRow>
			)
		})

	const renderSkyhookRows = (items: StructureSkyhookListItem[]) =>
		items.map((structure) => {
			const vulnerabilityWindow = getSkyhookVulnerabilityWindowDisplay({
				theftVulnerabilityStart: structure.theftVulnerabilityStart,
				theftVulnerabilityEnd: structure.theftVulnerabilityEnd,
				vulnerableAt: structure.vulnerableAt,
				isRaidable: structure.isRaidable,
				nowMs,
			})

			return (
				<TableRow key={structure.structureId}>
					<TableCell>
						<StructureStateBadge state={structure.state} />
					</TableCell>
					<TableCell className="font-medium">
						{structure.regionName ?? structure.regionId ?? '-'}
					</TableCell>
					<TableCell>{structure.systemName ?? structure.systemId}</TableCell>
					<TableCell>{structure.planetName ?? structure.planetId}</TableCell>
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
					<TableCell>
						<SkyhookFillBar value={structure.securedFillPercent} />
					</TableCell>
					<TableCell>
						<SkyhookFillBar value={structure.unsecuredFillPercent} />
					</TableCell>
					<TableCell>{formatNullableNumber(structure.effectiveWorkforce)}</TableCell>
					<TableCell>
						<Badge variant={structure.isRaidable ? 'warning' : 'success'}>
							{structure.isRaidable ? 'Yes' : 'No'}
						</Badge>
					</TableCell>
					<TableCell>
						<div className="space-y-1">
							<div>
								{structure.theftVulnerabilityStart && structure.theftVulnerabilityEnd ? (
									<span className="inline-flex flex-wrap items-center gap-1">
										<EveTimeDisplay
											dateStr={structure.theftVulnerabilityStart}
											format="window"
											className="whitespace-nowrap"
										/>
										<span>-</span>
										<EveTimeDisplay
											dateStr={structure.theftVulnerabilityEnd}
											format="window"
											className="whitespace-nowrap"
										/>
									</span>
								) : structure.vulnerableAt ? (
									<EveTimeDisplay
										dateStr={structure.vulnerableAt}
										format="window"
										className="whitespace-nowrap"
									/>
								) : (
									'-'
								)}
							</div>
							{structure.theftVulnerabilityStart ||
							structure.theftVulnerabilityEnd ||
							structure.vulnerableAt ? (
								<div className="text-xs text-muted-foreground">
									{vulnerabilityWindow.label}{" "}
									{vulnerabilityWindow.countdownTarget ? (
										<DurationDisplay
											endDate={vulnerabilityWindow.countdownTarget}
											referenceTimeMs={nowMs}
											maxUnits={2}
											durationStyle="compact"
											format="compact"
										/>
									) : null}
								</div>
							) : null}
						</div>
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
					<TableCell>{structure.assignedGroupId ? groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId : '-'}</TableCell>
					<TableCell>
						<StructureSyncStatusBadge
							status={structure.syncStatus}
							description={structureSyncStatusDescription(structure)}
						/>
					</TableCell>
					{canViewStructureDetails && (
						<TableCell className="sticky right-0 z-10 border-l border-border/50 bg-card text-right">
							{structure.canViewDetails ? (
								<Button asChild size="sm" variant="ghost">
									<Link to={`/structures/${structure.structureId}`}>
										<ArrowRight className="h-4 w-4" />
										Details
									</Link>
								</Button>
							) : (
								<span className="text-sm text-muted-foreground">-</span>
							)}
						</TableCell>
					)}
				</TableRow>
			)
		})

	const renderMiningCitadelRows = (items: StructureMiningCitadelListItem[]) =>
		items.map((structure) => {
			const displayMoonName = stripLeadingContextName(structure.moonName, structure.planetName)
			const displayStructureName = stripLeadingContextName(structure.name, structure.systemName)

			return (
				<TableRow key={structure.structureId}>
					<TableCell>
						<StructureStateBadge state={structure.state} />
					</TableCell>
					<TableCell className="font-medium">{structure.regionName ?? structure.regionId ?? '-'}</TableCell>
					<TableCell>{structure.systemName ?? structure.systemId}</TableCell>
					<TableCell>{structure.planetName ?? structure.planetId ?? '-'}</TableCell>
					<TableCell title={structure.moonName ?? structure.moonId}>{displayMoonName}</TableCell>
					<TableCell className="max-w-[18rem]">
						<span className="truncate font-medium" title={structure.name}>
							{displayStructureName}
						</span>
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
						{structure.fuelExpires ? (
							<DurationDisplay
								endDate={structure.fuelExpires}
								referenceTimeMs={nowMs}
								maxUnits={3}
								durationStyle="compact"
							/>
						) : structure.fuelAmount != null ? (
							`${structure.fuelAmount.toLocaleString()} units`
						) : (
							'-'
						)}
					</TableCell>
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
					<TableCell>
						{structure.assignedGroupId ? groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId : '-'}
					</TableCell>
					<TableCell>{formatNullableDateTime(structure.chunkArrivalTime)}</TableCell>
					<TableCell>{formatNullableDateTime(structure.naturalDecayTime)}</TableCell>
					<TableCell>
						<StructureSyncStatusBadge
							status={structure.syncStatus}
							description={structureSyncStatusDescription(structure)}
						/>
					</TableCell>
					{canViewStructureDetails && (
						<TableCell className="sticky right-0 z-10 border-l border-border/50 bg-card text-right">
							{structure.canViewDetails ? (
								<Button asChild size="sm" variant="ghost">
									<Link to={`/structures/${structure.structureId}`}>
										<ArrowRight className="h-4 w-4" />
										Details
									</Link>
								</Button>
							) : (
								<span className="text-sm text-muted-foreground">-</span>
							)}
						</TableCell>
					)}
				</TableRow>
			)
		})

	const renderMoonDrillRows = (items: StructureMoonDrillListItem[]) =>
		items.map((structure) => {
			const displayMoonName = stripLeadingContextName(structure.moonName, structure.planetName)
			const displayStructureName = stripLeadingContextName(structure.name, structure.systemName)
			const fuelLabel = structure.fuelExpires ? (
				<DurationDisplay
					endDate={structure.fuelExpires}
					referenceTimeMs={nowMs}
					maxUnits={3}
					durationStyle="compact"
				/>
			) : structure.fuelAmount != null ? (
				`${structure.fuelAmount.toLocaleString()} units`
			) : (
				'-'
			)
			const groupLabel = structure.assignedGroupId
				? (groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId)
				: '-'

			return (
				<TableRow key={structure.structureId}>
					<TableCell>
						<StructureStateBadge state={structure.state} />
					</TableCell>
					<TableCell className="font-medium">{structure.regionName ?? structure.regionId ?? '-'}</TableCell>
					<TableCell>{structure.systemName ?? structure.systemId}</TableCell>
					<TableCell>{structure.planetName ?? structure.planetId ?? '-'}</TableCell>
					<TableCell title={structure.moonName ?? structure.moonId}>{displayMoonName}</TableCell>
					<TableCell className="max-w-[18rem]">
						<span className="truncate font-medium" title={structure.name}>
							{displayStructureName}
						</span>
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
					<TableCell>{fuelLabel}</TableCell>
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
						<StructureSyncStatusBadge
							status={structure.syncStatus}
							description={structureSyncStatusDescription(structure)}
						/>
					</TableCell>
					{canViewStructureDetails && (
						<TableCell className="sticky right-0 z-10 border-l border-border/50 bg-card text-right">
							{structure.canViewDetails ? (
								<Button asChild size="sm" variant="ghost">
									<Link to={`/structures/${structure.structureId}`}>
										<ArrowRight className="h-4 w-4" />
										Details
									</Link>
								</Button>
							) : (
								<span className="text-sm text-muted-foreground">-</span>
							)}
						</TableCell>
					)}
				</TableRow>
			)
		})

	const renderStructuresTableBody = () => {
		switch (activeTab) {
			case 'citadels':
				return <TableBody>{renderCitadelRows(citadelStructures.data?.items ?? [])}</TableBody>
			case 'navigation':
				return <TableBody>{renderNavigationRows(navigationStructures.data?.items ?? [])}</TableBody>
			case 'sovereignty':
				return <TableBody>{renderSovereigntyRows(sovereigntyStructures.data?.items ?? [])}</TableBody>
			case 'skyhooks':
				return <TableBody>{renderSkyhookRows(skyhookStructures.data?.items ?? [])}</TableBody>
			case 'mining-citadels':
				return (
					<TableBody>{renderMiningCitadelRows(miningCitadelStructures.data?.items ?? [])}</TableBody>
				)
			case 'moon-drills':
				return <TableBody>{renderMoonDrillRows(moonDrillStructures.data?.items ?? [])}</TableBody>
		}
	}

	const refreshButton = (
		<Button
			variant="secondary"
			size="sm"
			className="h-8"
			onClick={() => refreshAll()}
			disabled={isFetching || isInitialLoading}
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
							vulnerabilityState: isStructureVulnerabilityState(value) ? value : undefined,
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
	const operationalFilterControls = (
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
	const specialFilterControls = (
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
							disabled={isFetching || isInitialLoading}
						>
							<RefreshCcw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
							Refresh
						</Button>
					</div>
				}
			/>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Total Structures</CardTitle>
						<CardDescription>Matches the active tab and filters.</CardDescription>
					</CardHeader>
					<CardContent className="text-3xl font-semibold">
						{activeResponse.data?.summary.total ?? '-'}
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
							{activeResponse.data?.summary.lowFuel ?? '-'}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Low Power</CardTitle>
						<CardDescription>Structures in low power without suppression enabled.</CardDescription>
					</CardHeader>
					<CardContent className="text-3xl font-semibold">
						{activeResponse.data?.summary.lowPower ?? '-'}
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
						{activeResponse.data?.summary.reinforced ?? '-'}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Fuel Burn Rate</CardTitle>
						<CardDescription>
							Estimated aggregate burn rate from the filtered structure set.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-semibold">
							{activeResponse.data?.summary.estimatedFuelBurnRatePerHour
								? `${Number(activeResponse.data.summary.estimatedFuelBurnRatePerHour).toLocaleString(undefined, {
										maximumFractionDigits: 2,
									})}/hr`
								: '-'}
						</div>
						{activeResponse.data?.summary && (
							<p className="text-xs text-muted-foreground">
								Estimated from {activeResponse.data.summary.fuelBurnRateSampleCount} structures with usable fuel
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
						onValueChange={(value) => {
							if (isStructureTab(value)) {
								setStructureTableTab(value)
							}
						}}
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
						{isSovereigntyTab
							? sovereigntyFilterControls
							: isSkyhooksTab || isMoonDrillsTab
								? specialFilterControls
								: operationalFilterControls}
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
								trailingAction={refreshButton}
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
											onClick={() => refreshAll()}
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
							<Table
								containerRef={tableScrollContainerRef}
								onContainerScroll={handleTableScroll}
								className={cn(
									'min-w-[118rem]',
									isSovereigntyTab && 'min-w-[136rem]',
									isSkyhooksTab && 'min-w-[132rem]',
									isMiningCitadelTab && 'min-w-[124rem]'
								)}
							>
								<TableHeader>
									<TableRow>
										{isSovereigntyTab ? (
											<>
												<SortableHead field="state" label="State" />
												<SortableHead field="region" label="Region" />
												<SortableHead field="system" label="System" />
												<SortableHead field="corporation" label="Corporation" />
												<TableHead>System Alliance</TableHead>
												<TableHead>Group</TableHead>
												<SortableHead field="activityDefenseMultiplier" label="ADM" />
												<SortableHead
													field="magmaticGasEstimatedDepletionAt"
													label="Magmatic Gas"
												/>
												<SortableHead
													field="superionicIceEstimatedDepletionAt"
													label="Superionic Ice"
												/>
												<TableHead>Workforce</TableHead>
												<TableHead>Power</TableHead>
												<TableHead>Sync</TableHead>
											</>
										) : isSkyhooksTab ? (
											<>
												<SortableHead field="state" label="State" />
												<SortableHead field="region" label="Region" />
												<SortableHead field="system" label="System" />
												<SortableHead field="planet" label="Planet" />
												<SortableHead field="corporation" label="Corporation" />
												<SortableHead field="skyhookSecureFullness" label="Fullness (Secure)" />
												<SortableHead field="skyhookSurplusFullness" label="Fullness (Surplus)" />
												<SortableHead field="workforce" label="Workforce" />
												<SortableHead field="raidable" label="Raidable" />
												<SortableHead field="theftVulnerabilityStart" label="Theft Window" />
												<SortableHead field="nextStateAt" label="Next State In" />
												<SortableHead field="group" label="Group" />
												<SortableHead field="syncStatus" label="Sync" />
											</>
										) : isMoonDrillsTab ? (
											<>
												<SortableHead field="state" label="State" />
												<SortableHead field="region" label="Region" />
												<SortableHead field="system" label="System" />
												<SortableHead field="planet" label="Planet" />
												<TableHead>Moon</TableHead>
												<SortableHead field="name" label="Name" />
												<SortableHead field="corporation" label="Corporation" />
												<SortableHead field="fuel" label="Fuel" />
												<SortableHead field="nextStateAt" label="Next State In" />
												<TableHead>Group</TableHead>
												<TableHead>Sync</TableHead>
											</>
										) : isMiningCitadelTab ? (
											<>
												<SortableHead field="state" label="State" />
												<SortableHead field="region" label="Region" />
												<SortableHead field="system" label="System" />
												<SortableHead field="planet" label="Planet" />
												<TableHead>Moon</TableHead>
												<SortableHead field="name" label="Name" />
												<SortableHead field="corporation" label="Corporation" />
												<SortableHead field="type" label="Type" />
												<SortableHead field="fuel" label="Fuel" />
												<TableHead>LP</TableHead>
												<TableHead>LP Allowed</TableHead>
												<SortableHead field="nextStateAt" label="Next State In" />
												<TableHead>Group</TableHead>
												<TableHead>Chunk Arrival</TableHead>
												<TableHead>Natural Decay</TableHead>
												<TableHead>Sync</TableHead>
											</>
										) : (
											<>
												<SortableHead field="state" label="State" />
												<SortableHead field="region" label="Region" />
												<SortableHead field="system" label="System" />
												<SortableHead field="name" label="Name" />
												<SortableHead field="corporation" label="Corporation" />
												<SortableHead field="type" label="Type" />
												<SortableHead field="fuel" label="Fuel" />
												<TableHead>LP</TableHead>
												<TableHead>LP Allowed</TableHead>
												<SortableHead field="nextStateAt" label="Next State In" />
												<TableHead>Group</TableHead>
												<TableHead>Sync</TableHead>
											</>
										)}
										{canViewStructureDetails && (
											<TableHead className="sticky right-0 z-20 table-header-bg border-l border-border/50 text-right">
												Actions
											</TableHead>
										)}
									</TableRow>
								</TableHeader>
								{renderStructuresTableBody()}
							</Table>
						)}
					</TableRefreshFrame>
					</div>
				</CardContent>
			</Card>
			</Container>
		)
	}
