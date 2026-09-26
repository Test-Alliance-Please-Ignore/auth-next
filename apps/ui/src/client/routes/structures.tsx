import { CircleHelp, Flame, Package, RefreshCcw, Shield, Snowflake } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'

import {
	hasAllStructureManagerPermission,
	hasAnyStructurePermission,
	hasStructureTabPermission,
} from '@repo/groups'
import {
	FUEL_BLOCK_TYPE_IDS,
	isReinforcedStructureState,
	isStructureTab,
	isStructureVulnerabilityState,
	SKYHOOK_MAGMATIC_GAS_TYPE_ID,
	SKYHOOK_SUPERIONIC_ICE_TYPE_ID,
	STRUCTURE_SYNC_ERROR_STALE_MS,
	STRUCTURE_SYNC_WARNING_STALE_MS,
	STRUCTURE_TABS,
} from '@repo/structures'

import { CorporationLogo } from '@/components/corporation-logo'
import { useLayoutScrollMode } from '@/components/layout-scroll-context'
import { SkyhookStateBadge } from '@/components/skyhook-state-badge'
import { StructureStateBadge } from '@/components/structure-state-badge'
import { StructureSyncStatusBadge } from '@/components/structure-sync-status-badge'
import { TableLayoutToggle } from '@/components/table-layout-toggle'
import { TableRefreshFrame } from '@/components/table-refresh-frame'
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DurationDisplay } from '@/components/ui/duration-display'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { FilterField } from '@/components/ui/filter-field'
import { HoverPopover } from '@/components/ui/hover-popover'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import {
	SortableTableHead,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { useAuth } from '@/hooks/useAuth'
import { useGroups } from '@/hooks/useGroups'
import { useNowMs } from '@/hooks/useNowMs'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { getActiveLocale, i18n, useAppTranslation } from '@/i18n'
import {
	type StructureListBaseItem,
	type StructureListFilterOptions,
	type StructureListItem,
	type StructureListQuery,
	type StructureListSortBy,
	type StructureListSummary,
	type StructureMiningCitadelListItem,
	type StructureMiningCitadelListQuery,
	type StructureMoonDrillListItem,
	type StructureMoonDrillListQuery,
	type StructureSkyhookListFilterOptions,
	type StructureSkyhookListItem,
	type StructureSkyhookListQuery,
	type StructureSovereigntyListFilterOptions,
	type StructureSovereigntyListItem,
	type StructureSovereigntyListQuery,
	type StructureSovereigntyListSummary,
} from '@/lib/api'
import { formatDateTimeLong } from '@/lib/date-utils'
import { formatDurationUntil } from '@/lib/duration-utils'
import { allianceLogoUrl, typeIconUrl } from '@/lib/eve-images'
import { getSkyhookVulnerabilityWindowDisplay } from '@/lib/skyhook-vulnerability-window'
import { formatStructureLabel } from '@/lib/structure-labels'
import { stripLeadingContextName } from '@/lib/structure-name-utils'
import { cn } from '@/lib/utils'

import {
	useMiningCitadelStructures,
	useMoonDrillStructures,
	usePosStructures,
	useSkyhookStructures,
	useSovereigntyStructures,
	useStructureAccess,
	useStructureModuleConfig,
	useStructures,
} from '../features/structures/hooks'
import {
	buildStructureListContentKey,
	getEffectiveStructureSortByForTab,
} from '../features/structures/query-utils'
import {
	clearStructureTableFilters,
	setStructureTableFilters,
	setStructureTablePage,
	setStructureTablePageSize,
	setStructureTableSort,
	setStructureTableTab,
	useStructureTableUiState,
} from '../features/structures/state/structure-table-store'

import type { KeyboardEvent, MouseEvent, ReactNode, UIEvent } from 'react'
import type { StructureCommonListSortBy } from '@repo/structures'
import type { SelectOption } from '@/components/ui/select'

const UNASSIGNED_GROUP_VALUE = '__unassigned__'
const BOOLEAN_FILTER_OPTIONS: SelectOption[] = [
	{
		value: 'true',
		get label() {
			return i18n.t('structures.yes')
		},
	},
	{
		value: 'false',
		get label() {
			return i18n.t('structures.no')
		},
	},
]
const FUEL_BLOCK_ICON_TYPE_ID = Array.from(FUEL_BLOCK_TYPE_IDS)[0] ?? '4051'
// EVE's Station Vault Container is a clear representative icon for stored Moon Goo.
const STATION_VAULT_ICON_TYPE_ID = '17367'

function structureSyncStatusDescription(
	structure: Pick<StructureListBaseItem, 'syncStatus' | 'syncFailureReason' | 'lastSyncedAt'>
) {
	const getStalenessNote = () => {
		if (!structure.lastSyncedAt) return null
		const ageMs = Math.max(0, Date.now() - new Date(structure.lastSyncedAt).getTime())
		if (ageMs >= STRUCTURE_SYNC_ERROR_STALE_MS) {
			return i18n.t('structures.thisSnapshotIsMoreThan24HoursOldAndShould')
		}
		if (ageMs >= STRUCTURE_SYNC_WARNING_STALE_MS) {
			return i18n.t('structures.thisSnapshotIsMoreThan12HoursOldAndMay')
		}
		return null
	}

	if (structure.syncFailureReason) {
		return structure.lastSyncedAt
			? i18n.t('structures.lastSyncAtValue1Value2', {
					value1: formatDateTimeLong(structure.lastSyncedAt),
					value2: structure.syncFailureReason,
				})
			: structure.syncFailureReason
	}

	if (structure.syncStatus === 'ok') {
		return structure.lastSyncedAt
			? i18n.t('structures.lastSuccessfulSyncAtValue1', {
					value1: formatDateTimeLong(structure.lastSyncedAt),
				})
			: i18n.t('structures.theLatestCorporationDataSyncCompletedSuccessfully')
	}

	if (structure.syncStatus === 'warning') {
		const stalenessNote = getStalenessNote()
		return structure.lastSyncedAt
			? i18n.t('structures.lastSyncAtValue1Value2', {
					value1: formatDateTimeLong(structure.lastSyncedAt),
					value2:
						stalenessNote ??
						i18n.t('structures.theLatestCorporationDataSyncCompletedWithWarningsSoSome2'),
				})
			: i18n.t('structures.theLatestCorporationDataSyncCompletedWithWarningsSoSome2')
	}

	if (structure.syncStatus === 'error') {
		const stalenessNote = getStalenessNote()
		return structure.lastSyncedAt
			? i18n.t('structures.lastSyncAtValue1Value2', {
					value1: formatDateTimeLong(structure.lastSyncedAt),
					value2:
						stalenessNote ??
						i18n.t('structures.theLatestCorporationDataSyncFailedSoThisSnapshotMay'),
				})
			: i18n.t('structures.theLatestCorporationDataSyncFailedSoThisSnapshotMay')
	}

	return structure.lastSyncedAt
		? i18n.t('structures.lastSyncAtValue1TheLatestCorporationDataSyncCompleted', {
				value1: formatDateTimeLong(structure.lastSyncedAt),
			})
		: i18n.t('structures.theLatestCorporationDataSyncCompletedSuccessfullyAndTheStored')
}

function withAllOption(options: SelectOption[], label: string): SelectOption[] {
	return [{ value: '', label }, ...options]
}

function toBooleanFilterValue(value: string): 'true' | 'false' | undefined {
	if (value === 'true' || value === 'false') return value
	return undefined
}

function parseMultiFilter(value: string | undefined): string[] {
	return [
		...new Set(
			(value ?? '')
				.split(',')
				.map((typeId) => typeId.trim())
				.filter(Boolean)
		),
	]
}

function serializeMultiFilter(values: string[]): string | undefined {
	const normalizedValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
	return normalizedValues.length > 0 ? normalizedValues.join(',') : undefined
}

function formatNullableDateTime(value: string | null | undefined): string {
	return value ? formatDateTimeLong(value) : '-'
}

function formatNullableNumber(value: number | null | undefined): string {
	if (value === null || value === undefined) return '-'
	return value.toLocaleString(getActiveLocale())
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
	return `${value.toLocaleString(getActiveLocale(), { maximumFractionDigits: 1 })}%`
}

function MoonDrillResourceCell({
	typeId,
	iconAlt,
	fallbackIcon: FallbackIcon,
	value,
	secondaryValue,
	secondarySuffix,
	depletionAt,
}: {
	typeId: string
	iconAlt: string
	fallbackIcon: typeof Package | typeof Flame
	value: number | null | undefined
	secondaryValue?: number | null | undefined
	secondarySuffix?: string
	depletionAt?: string | null
}) {
	const [failed, setFailed] = useState(false)

	return (
		<div className="flex items-center gap-2">
			{failed ? (
				<FallbackIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
			) : (
				<img
					src={typeIconUrl(typeId, 32)}
					alt={iconAlt}
					className="h-4 w-4 shrink-0 rounded-sm"
					loading="lazy"
					onError={() => setFailed(true)}
				/>
			)}
			<div className="flex flex-col">
				<span className="tabular-nums">{formatNullableNumber(value)}</span>
				{depletionAt && (
					<DurationDisplay endDate={depletionAt} maxUnits={2} durationStyle="compact" />
				)}
			</div>
			{secondaryValue !== undefined && (
				<span className="text-muted-foreground">
					({formatNullableDecimal(secondaryValue)} {secondarySuffix ?? ''})
				</span>
			)}
		</div>
	)
}

function LiveDurationUntilText({
	endDate,
	expiredLabel,
}: {
	endDate: string | null | undefined
	expiredLabel?: string
}) {
	const { t } = useAppTranslation()

	if (!endDate) {
		return '-'
	}

	return (
		<LiveDurationUntilTextValue
			endDate={endDate}
			expiredLabel={expiredLabel ?? t('structures.now')}
		/>
	)
}

function LiveDurationUntilTextValue({
	endDate,
	expiredLabel,
}: {
	endDate: string
	expiredLabel: string
}) {
	const nowMs = useNowMs()

	return formatDurationUntil(endDate, {
		referenceTimeMs: nowMs,
		expiredLabel,
		maxUnits: 2,
		style: 'compact',
	})
}

function StatCardHelp({ content }: { content: ReactNode }) {
	const { t } = useAppTranslation()

	return (
		<HoverPopover
			trigger={
				<Button
					type="button"
					variant="ghost"
					size="icon"
					showIcon={false}
					className="h-8 w-8 cursor-help rounded-full border border-border/60 bg-background/80 text-muted-foreground shadow-none hover:bg-muted/60"
					aria-label={t('structures.moreInformation')}
				>
					<CircleHelp className="h-4 w-4" />
				</Button>
			}
			triggerClassName="absolute right-2 top-2 z-10"
			side="bottom"
			align="end"
			className="max-w-sm border border-border bg-popover p-3 text-popover-foreground shadow-lg"
		>
			<div className="space-y-2 text-sm leading-relaxed text-popover-foreground">{content}</div>
		</HoverPopover>
	)
}

function StatCard({
	title,
	help,
	children,
}: {
	title: string
	help: ReactNode
	children: ReactNode
}) {
	return (
		<Card>
			<CardHeader className="relative pb-3 pr-10">
				<CardTitle className="text-base">{title}</CardTitle>
				<StatCardHelp content={help} />
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	)
}

function SkyhookFillBar({ value }: { value: number }) {
	const { t } = useAppTranslation()

	return (
		<div className="space-y-1.5">
			<div className="h-2 w-full overflow-hidden rounded-full bg-muted/30">
				<div
					className="h-full rounded-full bg-primary transition-all"
					style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
				/>
			</div>
			<div className="text-xs text-muted-foreground">
				{t('structures.fullnessPercent', { percent: formatPercent(value) })}
			</div>
		</div>
	)
}

function formatReagentBurnRate(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '-'
	return i18n.t('structures.perHour', {
		value1: value.toLocaleString(getActiveLocale(), { maximumFractionDigits: 2 }),
	})
}

function SovereigntyReagentAmount({ typeId, value }: { typeId: string; value: number }) {
	const [failed, setFailed] = useState(false)
	const isGas = typeId === SKYHOOK_MAGMATIC_GAS_TYPE_ID
	const FallbackIcon = isGas ? Flame : Snowflake

	return (
		<div className="flex items-center gap-2">
			{failed ? (
				<FallbackIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
			) : (
				<img
					src={typeIconUrl(typeId, 32)}
					alt=""
					className="h-4 w-4 shrink-0 rounded-sm"
					loading="lazy"
					onError={() => setFailed(true)}
				/>
			)}
			<span className="font-medium tabular-nums">{formatNullableNumber(value)}</span>
		</div>
	)
}

function SovereigntyReagentCell({
	typeId,
	quantity,
	burningPerHour,
	estimatedDepletionAt,
}: {
	typeId: string
	quantity: number
	burningPerHour: number
	estimatedDepletionAt: string | null
}) {
	const { t } = useAppTranslation()

	return (
		<div className="space-y-1.5">
			<SovereigntyReagentAmount typeId={typeId} value={quantity} />
			<div className="text-xs text-muted-foreground">
				{t('structures.burn')}
				{formatReagentBurnRate(burningPerHour)}
			</div>
			<div className="text-xs text-muted-foreground">
				{estimatedDepletionAt ? (
					<>
						<span className="mr-1">{t('structures.remaining')}</span>
						<DurationDisplay
							endDate={estimatedDepletionAt}
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

function SkyhookVulnerabilityWindowCell({ structure }: { structure: StructureSkyhookListItem }) {
	const vulnerabilityWindow = getSkyhookVulnerabilityWindowDisplay({
		theftVulnerabilityStart: structure.theftVulnerabilityStart,
		theftVulnerabilityEnd: structure.theftVulnerabilityEnd,
		isRaidable: structure.isRaidable,
		nowMs: useNowMs(),
	})

	return (
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
				) : structure.theftVulnerabilityStart ? (
					<EveTimeDisplay
						dateStr={structure.theftVulnerabilityStart}
						format="window"
						className="whitespace-nowrap"
					/>
				) : (
					'-'
				)}
			</div>
			{structure.theftVulnerabilityStart || structure.theftVulnerabilityEnd ? (
				<div className="text-xs text-muted-foreground">
					{vulnerabilityWindow.label}{' '}
					{vulnerabilityWindow.countdownTarget ? (
						<DurationDisplay
							endDate={vulnerabilityWindow.countdownTarget}
							maxUnits={2}
							durationStyle="compact"
							format="compact"
						/>
					) : null}
				</div>
			) : null}
		</div>
	)
}

function getSovereigntyVulnerabilityState(
	sovereignty:
		| Pick<StructureSovereigntyListItem, 'vulnerabilityWindowStart' | 'vulnerabilityWindowEnd'>
		| null
		| undefined
): { label: string; variant: 'ghost' | 'success' } {
	if (!sovereignty?.vulnerabilityWindowStart || !sovereignty?.vulnerabilityWindowEnd) {
		return { label: i18n.t('structures.unknown'), variant: 'ghost' }
	}

	const start = new Date(sovereignty.vulnerabilityWindowStart).getTime()
	const end = new Date(sovereignty.vulnerabilityWindowEnd).getTime()
	const now = Date.now()
	if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) {
		return { label: i18n.t('structures.vulnerable'), variant: 'success' }
	}

	return { label: i18n.t('structures.invulnerable'), variant: 'success' }
}

function AllianceLogo({
	allianceId,
	allianceName,
}: {
	allianceId: string
	allianceName?: string | null
}) {
	const { t } = useAppTranslation()

	const [failed, setFailed] = useState(false)

	if (failed) {
		return <Shield className="h-4 w-4 text-muted-foreground" />
	}

	return (
		<img
			src={allianceLogoUrl(allianceId, 32)}
			alt={
				allianceName
					? t('structures.value1Logo', { value1: allianceName })
					: t('structures.allianceLogo')
			}
			className="h-5 w-5 rounded-sm object-cover"
			loading="lazy"
			onError={() => setFailed(true)}
		/>
	)
}

type PrimaryStructureFilterSlot = 'type' | 'raidable' | null

export default function StructuresPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('structures.structures'))

	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const navigate = useNavigate()
	const { data: groups = [] } = useGroups({ limit: 100 })
	const { permissions, isLoading: permissionsLoading } = useUserPermissions()
	const { data: structureAccess, isLoading: structureAccessLoading } = useStructureAccess({
		enabled: isAuthenticated && !authLoading,
	})
	const hasImplicitSensitiveAccess = structureAccess?.hasImplicitSensitiveAccess === true
	const canViewStructures =
		user?.is_admin === true || hasAnyStructurePermission(permissions) || hasImplicitSensitiveAccess
	const canManageStructures =
		user?.is_admin === true || hasAllStructureManagerPermission(permissions)
	const tableState = useStructureTableUiState((state) => state)
	const { isPageScrollEnabled, setIsPageScrollEnabled } = useLayoutScrollMode()
	const isTableGridClamped = !isPageScrollEnabled
	const [areFiltersOpen, setAreFiltersOpen] = useState(true)
	const visibleTabs = useMemo(
		() =>
			user?.is_admin === true || hasImplicitSensitiveAccess
				? STRUCTURE_TABS
				: STRUCTURE_TABS.filter((tab) => hasStructureTabPermission(permissions, tab.tab)),
		[user, permissions, hasImplicitSensitiveAccess, t]
	)
	const activeTab = visibleTabs.some((tab) => tab.tab === tableState.tab)
		? tableState.tab
		: (visibleTabs[0]?.tab ?? tableState.tab)
	const { data: moduleConfig } = useStructureModuleConfig()
	const tableScrollContainerRef = useRef<HTMLDivElement | null>(null)
	const tableScrollLeftByTabRef = useRef<Record<string, number>>({})
	const sharedQuery = useMemo(
		() => ({
			page: tableState.page,
			pageSize: tableState.pageSize,
			sortDirection: tableState.sortDirection,
		}),
		[tableState.page, tableState.pageSize, tableState.sortDirection, t]
	)
	const commonSortBy = getEffectiveStructureSortByForTab('structures', tableState.sortBy)
	const sovereigntySortBy = getEffectiveStructureSortByForTab('sovereignty', tableState.sortBy)
	const skyhookSortBy = getEffectiveStructureSortByForTab('skyhooks', tableState.sortBy)
	const moonSortBy = getEffectiveStructureSortByForTab('moon-drills', tableState.sortBy)
	const posSortBy = getEffectiveStructureSortByForTab(
		'poses',
		tableState.sortBy
	) as StructureCommonListSortBy
	const commonQuery = useMemo<StructureListQuery>(
		() =>
			({
				...sharedQuery,
				sortBy: commonSortBy,
				corporationId: tableState.filters.corporationId,
				assignedGroupId: tableState.filters.assignedGroupId,
				lowPower: tableState.filters.lowPower,
				lowPowerAllowed: tableState.filters.lowPowerAllowed,
				regionId: tableState.filters.regionId,
				systemId: tableState.filters.systemId,
				state: tableState.filters.state,
				typeId: tableState.filters.typeId,
			}) as StructureListQuery,
		[sharedQuery, tableState.filters, commonSortBy, t]
	)
	const sovereigntyQuery = useMemo<StructureSovereigntyListQuery>(
		() =>
			({
				...sharedQuery,
				sortBy: sovereigntySortBy,
				corporationId: tableState.filters.corporationId,
				assignedGroupId: tableState.filters.assignedGroupId,
				regionId: tableState.filters.regionId,
				systemId: tableState.filters.systemId,
				controllerAllianceId: tableState.filters.controllerAllianceId,
				vulnerabilityState: tableState.filters.vulnerabilityState,
			}) as StructureSovereigntyListQuery,
		[sharedQuery, tableState.filters, sovereigntySortBy, t]
	)
	const skyhookQuery = useMemo<StructureSkyhookListQuery>(
		() =>
			({
				...sharedQuery,
				sortBy: skyhookSortBy,
				corporationId: tableState.filters.corporationId,
				assignedGroupId: tableState.filters.assignedGroupId,
				regionId: tableState.filters.regionId,
				systemId: tableState.filters.systemId,
				state: tableState.filters.state,
				typeId: tableState.filters.typeId,
				planetId: tableState.filters.planetId,
				isRaidable: tableState.filters.isRaidable,
			}) as StructureSkyhookListQuery,
		[sharedQuery, tableState.filters, skyhookSortBy, t]
	)
	const miningCitadelQuery = useMemo<StructureMiningCitadelListQuery>(
		() =>
			({
				...sharedQuery,
				sortBy: moonSortBy,
				corporationId: tableState.filters.corporationId,
				assignedGroupId: tableState.filters.assignedGroupId,
				lowPower: tableState.filters.lowPower,
				lowPowerAllowed: tableState.filters.lowPowerAllowed,
				regionId: tableState.filters.regionId,
				systemId: tableState.filters.systemId,
				state: tableState.filters.state,
				typeId: tableState.filters.typeId,
				planetId: tableState.filters.planetId,
			}) as StructureMiningCitadelListQuery,
		[sharedQuery, tableState.filters, moonSortBy, t]
	)
	const moonDrillQuery = useMemo<StructureMoonDrillListQuery>(
		() =>
			({
				...sharedQuery,
				sortBy: moonSortBy,
				corporationId: tableState.filters.corporationId,
				assignedGroupId: tableState.filters.assignedGroupId,
				lowPower: tableState.filters.lowPower,
				lowPowerAllowed: tableState.filters.lowPowerAllowed,
				regionId: tableState.filters.regionId,
				systemId: tableState.filters.systemId,
				state: tableState.filters.state,
				planetId: tableState.filters.planetId,
			}) as StructureMoonDrillListQuery,
		[sharedQuery, tableState.filters, moonSortBy, t]
	)

	const structuresResponseQuery = useStructures(commonQuery, {
		enabled:
			!authLoading &&
			!permissionsLoading &&
			!structureAccessLoading &&
			canViewStructures &&
			activeTab === 'structures',
	})
	const sovereigntyStructures = useSovereigntyStructures(sovereigntyQuery, {
		enabled:
			!authLoading &&
			!permissionsLoading &&
			!structureAccessLoading &&
			canViewStructures &&
			activeTab === 'sovereignty',
	})
	const skyhookStructures = useSkyhookStructures(skyhookQuery, {
		enabled:
			!authLoading &&
			!permissionsLoading &&
			!structureAccessLoading &&
			canViewStructures &&
			activeTab === 'skyhooks',
	})
	const miningCitadelStructures = useMiningCitadelStructures(miningCitadelQuery, {
		enabled:
			!authLoading &&
			!permissionsLoading &&
			!structureAccessLoading &&
			canViewStructures &&
			activeTab === 'mining-citadels',
	})
	const moonDrillStructures = useMoonDrillStructures(moonDrillQuery, {
		enabled:
			!authLoading &&
			!permissionsLoading &&
			!structureAccessLoading &&
			canViewStructures &&
			activeTab === 'moon-drills',
	})
	const posStructures = usePosStructures(
		{ ...commonQuery, sortBy: posSortBy },
		{
			enabled:
				!authLoading &&
				!permissionsLoading &&
				!structureAccessLoading &&
				canViewStructures &&
				activeTab === 'poses',
		}
	)

	const isSovereigntyTab = activeTab === 'sovereignty'
	const isSkyhooksTab = activeTab === 'skyhooks'
	const isMiningCitadelTab = activeTab === 'mining-citadels'
	const isMoonDrillsTab = activeTab === 'moon-drills'
	const activeResponse = (() => {
		switch (activeTab) {
			case 'structures':
				return structuresResponseQuery
			case 'sovereignty':
				return sovereigntyStructures
			case 'skyhooks':
				return skyhookStructures
			case 'mining-citadels':
				return miningCitadelStructures
			case 'moon-drills':
				return moonDrillStructures
			case 'poses':
				return posStructures
		}
	})()
	const structuresResponse = activeResponse.data
	const summary = structuresResponse?.summary
	const sovereigntySummary = isSovereigntyTab
		? (summary as StructureSovereigntyListSummary | undefined)
		: undefined
	const skyhookSummary = isSkyhooksTab ? (summary as StructureListSummary | undefined) : undefined
	const structures = structuresResponse?.items ?? []
	const pagination = structuresResponse?.pagination
	const commonFilterOptions: StructureListFilterOptions | undefined =
		activeTab === 'structures'
			? structuresResponseQuery.data?.filterOptions
			: activeTab === 'skyhooks'
				? skyhookStructures.data?.filterOptions
				: activeTab === 'mining-citadels'
					? miningCitadelStructures.data?.filterOptions
					: activeTab === 'moon-drills'
						? moonDrillStructures.data?.filterOptions
						: activeTab === 'poses'
							? posStructures.data?.filterOptions
							: undefined
	const sovereigntyFilterOptions: StructureSovereigntyListFilterOptions | undefined =
		activeTab === 'sovereignty' ? sovereigntyStructures.data?.filterOptions : undefined
	const skyhookFilterOptions: StructureSkyhookListFilterOptions | undefined =
		activeTab === 'skyhooks' ? skyhookStructures.data?.filterOptions : undefined
	const isInitialLoading = activeResponse.isLoading && !activeResponse.data
	const isSoftLoading = Boolean(activeResponse.data) && activeResponse.isFetching
	const structuresError = activeResponse.error
	const isStructuresFetching = activeResponse.isFetching
	const error = structuresError
	const isFetching = isStructuresFetching
	const refreshAll = () => {
		void activeResponse.refetch()
	}
	const getStructureRowProps = (
		structure: Pick<StructureListBaseItem, 'structureId' | 'canViewDetails'>
	) => {
		if (!structure.canViewDetails) return {}
		return {
			className: 'cursor-pointer transition-colors hover:bg-muted/40',
			onClick: (event: MouseEvent<HTMLTableRowElement>) => {
				if ((event.target as HTMLElement).closest('a,button')) return
				void navigate(`/structures/${structure.structureId}`)
			},
			onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
				if (event.key !== 'Enter' && event.key !== ' ') return
				event.preventDefault()
				void navigate(`/structures/${structure.structureId}`)
			},
			tabIndex: 0,
			role: 'link' as const,
		}
	}

	useEffect(() => {
		if (visibleTabs.length === 0) {
			return
		}

		if (!visibleTabs.some((tab) => tab.tab === tableState.tab)) {
			setStructureTableTab(visibleTabs[0]?.tab ?? 'structures')
		}
	}, [tableState.tab, visibleTabs])

	const corporationOptions = useMemo<SelectOption[]>(
		() =>
			(isSovereigntyTab
				? (sovereigntyFilterOptions?.corporations ?? [])
				: (commonFilterOptions?.corporations ?? [])
			).map((option) => ({
				value: option.value,
				label: option.label,
			})),
		[isSovereigntyTab, commonFilterOptions, sovereigntyFilterOptions, t]
	)
	const groupNameById = useMemo(
		() => new Map(groups.map((group) => [group.id, group.name])),
		[groups, t]
	)
	const assignedGroupOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				[
					{ value: UNASSIGNED_GROUP_VALUE, label: t('structures.unassigned') },
					...(commonFilterOptions?.assignedGroups ?? []).map((option) => ({
						value: option.value,
						label: groupNameById.get(option.value) ?? option.label ?? option.value,
					})),
				],
				t('structures.allGroups')
			),
		[commonFilterOptions, groupNameById, t]
	)
	const regionOptions = useMemo<SelectOption[]>(
		() =>
			(isSovereigntyTab
				? (sovereigntyFilterOptions?.regions ?? [])
				: (commonFilterOptions?.regions ?? [])
			).map((option) => ({
				value: option.value,
				label: option.label,
			})),
		[isSovereigntyTab, commonFilterOptions, sovereigntyFilterOptions, t]
	)
	const systemOptions = useMemo<SelectOption[]>(
		() =>
			(isSovereigntyTab
				? (sovereigntyFilterOptions?.systems ?? [])
				: (commonFilterOptions?.systems ?? [])
			).map((option) => ({
				value: option.value,
				label: option.label,
			})),
		[isSovereigntyTab, commonFilterOptions, sovereigntyFilterOptions, t]
	)
	const stateOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(isSovereigntyTab
					? (sovereigntyFilterOptions?.vulnerabilityStates ?? [])
					: (commonFilterOptions?.states ?? [])
				).map((option) => ({
					value: option.value,
					label: formatStructureLabel(option.value, option.label),
				})),
				isSovereigntyTab ? t('structures.allVulnerabilityStates') : t('structures.allStates')
			),
		[isSovereigntyTab, commonFilterOptions, sovereigntyFilterOptions, t]
	)
	const typeOptions = useMemo<SelectOption[]>(
		() =>
			(commonFilterOptions?.types ?? []).map((option) => ({
				value: option.value,
				label: option.label,
			})),
		[commonFilterOptions, t]
	)
	const allianceOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(isSovereigntyTab
					? (sovereigntyFilterOptions?.controllerAlliances ?? [])
					: (commonFilterOptions?.alliances ?? [])
				).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				isSovereigntyTab ? t('structures.allControllingAlliances') : t('structures.allAlliances')
			),
		[isSovereigntyTab, commonFilterOptions, sovereigntyFilterOptions, t]
	)
	const raidableStateOptions = useMemo<SelectOption[]>(
		() =>
			withAllOption(
				(skyhookFilterOptions?.raidableStates ?? []).map((option) => ({
					value: option.value,
					label: option.label,
				})),
				t('structures.allRaidableStates')
			),
		[skyhookFilterOptions, t]
	)
	const structuresContentKey = buildStructureListContentKey({
		tab: activeTab,
		page: tableState.page,
		pageSize: tableState.pageSize,
		sortBy: isSovereigntyTab
			? sovereigntySortBy
			: isSkyhooksTab
				? skyhookSortBy
				: isMoonDrillsTab
					? moonSortBy
					: commonSortBy,
		sortDirection: tableState.sortDirection,
		filters: tableState.filters,
	})

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
							tableState.filters.lowPower,
							tableState.filters.lowPowerAllowed,
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
	).reduce((count, value) => count + parseMultiFilter(value).length, 0)

	const renderStructureRows = (items: StructureListItem[]) =>
		items.map((structure) => {
			const fuelLabel = structure.fuelExpires ? (
				<DurationDisplay endDate={structure.fuelExpires} maxUnits={3} durationStyle="compact" />
			) : structure.fuelAmount != null ? (
				i18n.t('structures.fuelUnits', {
					value1: structure.fuelAmount.toLocaleString(getActiveLocale()),
				})
			) : (
				'-'
			)
			const groupLabel = structure.assignedGroupId
				? (groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId)
				: '-'

			return (
				<TableRow key={structure.structureId} {...getStructureRowProps(structure)}>
					<TableCell>
						<StructureStateBadge state={structure.state} />
					</TableCell>
					<TableCell className="font-medium">
						{structure.regionName ?? structure.regionId ?? '-'}
					</TableCell>
					<TableCell>{structure.systemName ?? structure.systemId}</TableCell>
					{!isSovereigntyTab && !isSkyhooksTab && !isMiningCitadelTab && !isMoonDrillsTab && (
						<TableCell className="max-w-[16rem]">
							<div className="flex min-w-0 items-center gap-2">
								<div className="truncate font-medium">{structure.name}</div>
								{structure.hidden && <Badge variant="ghost">{t('structures.hidden')}</Badge>}
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
					<TableCell>{structure.typeName ?? structure.typeId}</TableCell>
					<TableCell>{fuelLabel}</TableCell>
					<TableCell>
						<Badge variant={structure.lowPower ? 'warning' : 'ghost'}>
							{structure.lowPower ? t('structures.yes') : t('structures.no')}
						</Badge>
					</TableCell>
					<TableCell>
						<Badge variant={structure.lowPowerAllowed ? 'success' : 'ghost'}>
							{structure.lowPowerAllowed ? t('structures.yes') : t('structures.no')}
						</Badge>
					</TableCell>
					<TableCell>
						{structure.nextStateAt ? (
							<DurationDisplay
								endDate={structure.nextStateAt}
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
				</TableRow>
			)
		})

	const renderSovereigntyRows = (items: StructureSovereigntyListItem[]) =>
		items.map((structure) => {
			const vulnerabilityState = getSovereigntyVulnerabilityState(structure)
			return (
				<TableRow key={structure.structureId} {...getStructureRowProps(structure)}>
					<TableCell>
						<div className="space-y-1">
							<Badge variant={vulnerabilityState.variant}>{vulnerabilityState.label}</Badge>
							{isReinforcedStructureState(structure.state) && (
								<Badge variant="destructive" className="text-xs">
									{t('structures.reinforced')}
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
								<AllianceLogo
									allianceId={structure.allianceId}
									allianceName={structure.allianceName}
								/>
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
					<TableCell>
						{structure.assignedGroupId
							? (groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId)
							: '-'}
					</TableCell>
					<TableCell>{formatNullableDecimal(structure.activityDefenseMultiplier)}</TableCell>
					<TableCell>
						<SovereigntyReagentCell
							typeId={SKYHOOK_MAGMATIC_GAS_TYPE_ID}
							quantity={structure.magmaticGasQuantity}
							burningPerHour={structure.magmaticGasBurningPerHour}
							estimatedDepletionAt={structure.magmaticGasEstimatedDepletionAt}
						/>
					</TableCell>
					<TableCell>
						<SovereigntyReagentCell
							typeId={SKYHOOK_SUPERIONIC_ICE_TYPE_ID}
							quantity={structure.superionicIceQuantity}
							burningPerHour={structure.superionicIceBurningPerHour}
							estimatedDepletionAt={structure.superionicIceEstimatedDepletionAt}
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
				</TableRow>
			)
		})

	const renderSkyhookRows = (items: StructureSkyhookListItem[]) =>
		items.map((structure) => {
			return (
				<TableRow key={structure.structureId} {...getStructureRowProps(structure)}>
					<TableCell>
						<SkyhookStateBadge state={structure.state} />
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
							{structure.isRaidable ? t('structures.yes') : t('structures.no')}
						</Badge>
					</TableCell>
					<TableCell>
						<SkyhookVulnerabilityWindowCell structure={structure} />
					</TableCell>
					<TableCell>
						{structure.nextStateAt ? (
							<DurationDisplay
								endDate={structure.nextStateAt}
								maxUnits={3}
								durationStyle="compact"
								format="compact"
							/>
						) : (
							'-'
						)}
					</TableCell>
					<TableCell>
						{structure.assignedGroupId
							? (groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId)
							: '-'}
					</TableCell>
					<TableCell>
						<StructureSyncStatusBadge
							status={structure.syncStatus}
							description={structureSyncStatusDescription(structure)}
						/>
					</TableCell>
				</TableRow>
			)
		})

	const renderMiningCitadelRows = (items: StructureMiningCitadelListItem[]) =>
		items.map((structure) => {
			const displayMoonName = stripLeadingContextName(structure.moonName, structure.planetName)
			const displayStructureName = stripLeadingContextName(structure.name, structure.systemName)

			return (
				<TableRow key={structure.structureId} {...getStructureRowProps(structure)}>
					<TableCell>
						<StructureStateBadge state={structure.state} />
					</TableCell>
					<TableCell className="font-medium">
						{structure.regionName ?? structure.regionId ?? '-'}
					</TableCell>
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
								maxUnits={3}
								durationStyle="compact"
							/>
						) : structure.fuelAmount != null ? (
							i18n.t('structures.fuelUnits', {
								value1: structure.fuelAmount.toLocaleString(getActiveLocale()),
							})
						) : (
							'-'
						)}
					</TableCell>
					<TableCell>
						<Badge variant={structure.lowPower ? 'warning' : 'ghost'}>
							{structure.lowPower ? t('structures.yes') : t('structures.no')}
						</Badge>
					</TableCell>
					<TableCell>
						<Badge variant={structure.lowPowerAllowed ? 'success' : 'ghost'}>
							{structure.lowPowerAllowed ? t('structures.yes') : t('structures.no')}
						</Badge>
					</TableCell>
					<TableCell>
						{structure.nextStateAt ? (
							<DurationDisplay
								endDate={structure.nextStateAt}
								maxUnits={3}
								durationStyle="compact"
								format="compact"
							/>
						) : (
							'-'
						)}
					</TableCell>
					<TableCell>
						{structure.assignedGroupId
							? (groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId)
							: '-'}
					</TableCell>
					<TableCell>{formatNullableDateTime(structure.chunkArrivalTime)}</TableCell>
					<TableCell>{formatNullableDateTime(structure.naturalDecayTime)}</TableCell>
					<TableCell>
						<StructureSyncStatusBadge
							status={structure.syncStatus}
							description={structureSyncStatusDescription(structure)}
						/>
					</TableCell>
				</TableRow>
			)
		})

	const renderMoonDrillRows = (items: StructureMoonDrillListItem[]) =>
		items.map((structure) => {
			const displayMoonName = stripLeadingContextName(structure.moonName, structure.planetName)
			const displayStructureName = stripLeadingContextName(structure.name, structure.systemName)
			const groupLabel = structure.assignedGroupId
				? (groupNameById.get(structure.assignedGroupId) ?? structure.assignedGroupId)
				: '-'

			return (
				<TableRow key={structure.structureId} {...getStructureRowProps(structure)}>
					<TableCell>
						<StructureStateBadge state={structure.state} />
					</TableCell>
					<TableCell className="font-medium">
						{structure.regionName ?? structure.regionId ?? '-'}
					</TableCell>
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
					<TableCell>
						<MoonDrillResourceCell
							typeId={STATION_VAULT_ICON_TYPE_ID}
							iconAlt={t('structures.moonGoo1')}
							fallbackIcon={Package}
							value={structure.moonMaterialUnits}
							secondaryValue={structure.moonMaterialVolumeM3}
							secondarySuffix="m3"
						/>
					</TableCell>
					<TableCell>
						<MoonDrillResourceCell
							typeId={FUEL_BLOCK_ICON_TYPE_ID}
							iconAlt={t('structures.fuelBlock')}
							fallbackIcon={Package}
							value={structure.fuelBlockUnits}
							depletionAt={structure.fuelExpires}
						/>
					</TableCell>
					<TableCell>
						<MoonDrillResourceCell
							typeId={SKYHOOK_MAGMATIC_GAS_TYPE_ID}
							iconAlt={t('structures.magmaticGas2')}
							fallbackIcon={Flame}
							value={structure.magmaticGasUnits}
							depletionAt={structure.magmaticGasEstimatedDepletionAt}
						/>
					</TableCell>
					<TableCell>
						<Badge variant={structure.lowPower ? 'warning' : 'ghost'}>
							{structure.lowPower ? t('structures.yes') : t('structures.no')}
						</Badge>
					</TableCell>
					<TableCell>
						<Badge variant={structure.lowPowerAllowed ? 'success' : 'ghost'}>
							{structure.lowPowerAllowed ? t('structures.yes') : t('structures.no')}
						</Badge>
					</TableCell>
					<TableCell>
						{structure.nextStateAt ? (
							<DurationDisplay
								endDate={structure.nextStateAt}
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
				</TableRow>
			)
		})

	const renderStructuresTableBody = () => {
		switch (activeTab) {
			case 'structures':
				return (
					<TableBody>{renderStructureRows(structuresResponseQuery.data?.items ?? [])}</TableBody>
				)
			case 'sovereignty':
				return (
					<TableBody>{renderSovereigntyRows(sovereigntyStructures.data?.items ?? [])}</TableBody>
				)
			case 'skyhooks':
				return <TableBody>{renderSkyhookRows(skyhookStructures.data?.items ?? [])}</TableBody>
			case 'mining-citadels':
				return (
					<TableBody>
						{renderMiningCitadelRows(miningCitadelStructures.data?.items ?? [])}
					</TableBody>
				)
			case 'moon-drills':
				return <TableBody>{renderMoonDrillRows(moonDrillStructures.data?.items ?? [])}</TableBody>
			case 'poses':
				return <TableBody>{renderStructureRows(posStructures.data?.items ?? [])}</TableBody>
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
			<span className="ml-2">{t('structures.refresh')}</span>
		</Button>
	)
	const tableLayoutButton = (
		<TableLayoutToggle
			isClamped={isTableGridClamped}
			onToggle={() => setIsPageScrollEnabled(!isPageScrollEnabled)}
		/>
	)

	const handleSort = (field: StructureListSortBy) => {
		setStructureTableSort(field)
	}

	const renderSortIcon = (field: StructureListSortBy) => {
		return tableState.sortBy === field ? tableState.sortDirection : undefined
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
		<SortableTableHead
			className={className}
			onSort={() => handleSort(field)}
			direction={renderSortIcon(field)}
		>
			{label}
		</SortableTableHead>
	)

	const primaryFilterSlot: PrimaryStructureFilterSlot = (() => {
		switch (activeTab) {
			case 'sovereignty':
				return 'type'
			case 'skyhooks':
				return 'raidable'
			case 'structures':
			case 'mining-citadels':
			case 'poses':
				return 'type'
			case 'moon-drills':
				return null
		}
		throw new Error(`Unsupported structures tab for primary filter: ${activeTab}`)
	})()
	const primaryFilterControl = (() => {
		switch (primaryFilterSlot) {
			case 'raidable':
				return (
					<FilterField label={t('structures.raidable')}>
						<Select
							options={raidableStateOptions}
							value={tableState.filters.isRaidable ?? ''}
							onValueChange={(value) =>
								setStructureTableFilters({ isRaidable: toBooleanFilterValue(value) })
							}
							placeholder={t('structures.allRaidableStates')}
						/>
					</FilterField>
				)
			case 'type':
				return (
					<FilterField label={t('structures.type')}>
						<Select
							options={typeOptions}
							values={parseMultiFilter(tableState.filters.typeId)}
							onValuesChange={(values) =>
								setStructureTableFilters({ typeId: serializeMultiFilter(values) })
							}
							multiple
							placeholder={t('structures.allTypes')}
							searchable
						/>
					</FilterField>
				)
			case null:
				return null
		}
	})()
	const sovereigntyFilterControls = (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3">
			<FilterField label={t('structures.region')}>
				<Select
					options={regionOptions}
					values={parseMultiFilter(tableState.filters.regionId)}
					onValuesChange={(values) =>
						setStructureTableFilters({ regionId: serializeMultiFilter(values) })
					}
					multiple
					placeholder={t('structures.allRegions')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.system')}>
				<Select
					options={systemOptions}
					values={parseMultiFilter(tableState.filters.systemId)}
					onValuesChange={(values) =>
						setStructureTableFilters({ systemId: serializeMultiFilter(values) })
					}
					multiple
					placeholder={t('structures.allSystems')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.corporation')}>
				<Select
					options={corporationOptions}
					values={parseMultiFilter(tableState.filters.corporationId)}
					onValuesChange={(values) =>
						setStructureTableFilters({ corporationId: serializeMultiFilter(values) })
					}
					multiple
					placeholder={t('structures.allCorporations')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.controllingAlliance')}>
				<Select
					options={allianceOptions}
					value={tableState.filters.controllerAllianceId ?? ''}
					onValueChange={(value) =>
						setStructureTableFilters({ controllerAllianceId: value || undefined })
					}
					placeholder={t('structures.allControllingAlliances')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.vulnerabilityState')}>
				<Select
					options={stateOptions}
					value={tableState.filters.vulnerabilityState ?? ''}
					onValueChange={(value) =>
						setStructureTableFilters({
							vulnerabilityState: isStructureVulnerabilityState(value) ? value : undefined,
						})
					}
					placeholder={t('structures.allVulnerabilityStates')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.group')}>
				<Select
					options={assignedGroupOptions}
					value={tableState.filters.assignedGroupId ?? ''}
					onValueChange={(value) =>
						setStructureTableFilters({
							assignedGroupId: value || undefined,
						})
					}
					placeholder={t('structures.allGroups')}
					searchable
				/>
			</FilterField>
		</div>
	)
	const commonFilterControls = (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4">
			<FilterField label={t('structures.region')}>
				<Select
					options={regionOptions}
					values={parseMultiFilter(tableState.filters.regionId)}
					onValuesChange={(values) =>
						setStructureTableFilters({ regionId: serializeMultiFilter(values) })
					}
					multiple
					placeholder={t('structures.allRegions')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.system')}>
				<Select
					options={systemOptions}
					values={parseMultiFilter(tableState.filters.systemId)}
					onValuesChange={(values) =>
						setStructureTableFilters({ systemId: serializeMultiFilter(values) })
					}
					multiple
					placeholder={t('structures.allSystems')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.corporation')}>
				<Select
					options={corporationOptions}
					values={parseMultiFilter(tableState.filters.corporationId)}
					onValuesChange={(values) =>
						setStructureTableFilters({ corporationId: serializeMultiFilter(values) })
					}
					multiple
					placeholder={t('structures.allCorporations')}
					searchable
				/>
			</FilterField>
			{primaryFilterControl}
			<FilterField label={t('structures.state')}>
				<Select
					options={stateOptions}
					value={tableState.filters.state ?? ''}
					onValueChange={(value) => setStructureTableFilters({ state: value || undefined })}
					placeholder={t('structures.allStates')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.lowPower')}>
				<Select
					options={withAllOption(BOOLEAN_FILTER_OPTIONS, t('structures.allPowerStatuses'))}
					value={tableState.filters.lowPower ?? ''}
					onValueChange={(value) =>
						setStructureTableFilters({ lowPower: toBooleanFilterValue(value) })
					}
					placeholder={t('structures.allPowerStatuses')}
				/>
			</FilterField>
			<FilterField label={t('structures.lowPowerAllowed')}>
				<Select
					options={withAllOption(BOOLEAN_FILTER_OPTIONS, t('structures.allLpPreferences'))}
					value={tableState.filters.lowPowerAllowed ?? ''}
					onValueChange={(value) =>
						setStructureTableFilters({ lowPowerAllowed: toBooleanFilterValue(value) })
					}
					placeholder={t('structures.allLpPreferences')}
				/>
			</FilterField>
			<FilterField label={t('structures.group')}>
				<Select
					options={assignedGroupOptions}
					value={tableState.filters.assignedGroupId ?? ''}
					onValueChange={(value) =>
						setStructureTableFilters({
							assignedGroupId: value || undefined,
						})
					}
					placeholder={t('structures.allGroups')}
					searchable
				/>
			</FilterField>
		</div>
	)
	const specialFilterControls = (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4">
			<FilterField label={t('structures.region')}>
				<Select
					options={regionOptions}
					values={parseMultiFilter(tableState.filters.regionId)}
					onValuesChange={(values) =>
						setStructureTableFilters({ regionId: serializeMultiFilter(values) })
					}
					multiple
					placeholder={t('structures.allRegions')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.system')}>
				<Select
					options={systemOptions}
					values={parseMultiFilter(tableState.filters.systemId)}
					onValuesChange={(values) =>
						setStructureTableFilters({ systemId: serializeMultiFilter(values) })
					}
					multiple
					placeholder={t('structures.allSystems')}
					searchable
				/>
			</FilterField>
			<FilterField label={t('structures.corporation')}>
				<Select
					options={corporationOptions}
					values={parseMultiFilter(tableState.filters.corporationId)}
					onValuesChange={(values) =>
						setStructureTableFilters({ corporationId: serializeMultiFilter(values) })
					}
					multiple
					placeholder={t('structures.allCorporations')}
					searchable
				/>
			</FilterField>
			{primaryFilterControl}
			<FilterField label={t('structures.state')}>
				<Select
					options={stateOptions}
					value={tableState.filters.state ?? ''}
					onValueChange={(value) => setStructureTableFilters({ state: value || undefined })}
					placeholder={t('structures.allStates')}
					searchable
				/>
			</FilterField>
			{isMoonDrillsTab && (
				<>
					<FilterField label={t('structures.lowPower')}>
						<Select
							options={withAllOption(BOOLEAN_FILTER_OPTIONS, t('structures.allPowerStatuses'))}
							value={tableState.filters.lowPower ?? ''}
							onValueChange={(value) =>
								setStructureTableFilters({ lowPower: toBooleanFilterValue(value) })
							}
							placeholder={t('structures.allPowerStatuses')}
						/>
					</FilterField>
					<FilterField label={t('structures.lowPowerAllowed')}>
						<Select
							options={withAllOption(BOOLEAN_FILTER_OPTIONS, t('structures.allLpPreferences'))}
							value={tableState.filters.lowPowerAllowed ?? ''}
							onValueChange={(value) =>
								setStructureTableFilters({ lowPowerAllowed: toBooleanFilterValue(value) })
							}
							placeholder={t('structures.allLpPreferences')}
						/>
					</FilterField>
				</>
			)}
			<FilterField label={t('structures.group')}>
				<Select
					options={assignedGroupOptions}
					value={tableState.filters.assignedGroupId ?? ''}
					onValueChange={(value) =>
						setStructureTableFilters({
							assignedGroupId: value || undefined,
						})
					}
					placeholder={t('structures.allGroups')}
					searchable
				/>
			</FilterField>
		</div>
	)

	if (!authLoading && !permissionsLoading && !structureAccessLoading && !canViewStructures) {
		return <Navigate to="/dashboard" replace />
	}

	return (
		<Container
			className={cn(
				'flex min-h-0 flex-col space-y-6 py-0 2xl:!max-w-none',
				isTableGridClamped ? 'lg:h-full lg:overflow-hidden lg:py-0' : 'lg:overflow-visible'
			)}
		>
			<PageHeader
				className="!mb-section md:!mb-10"
				title={t('structures.structures')}
				description={t('structures.trackVisibleStructuresReviewTheirCurrentStateAndFuelPosture')}
				action={
					<div className="flex items-center gap-2">
						{canManageStructures && (
							<Button asChild variant="ghost" size="sm">
								<Link to="/structures/settings">{t('structures.settings')}</Link>
							</Button>
						)}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => refreshAll()}
							disabled={isFetching || isInitialLoading}
						>
							<RefreshCcw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
							{t('structures.refresh')}
						</Button>
					</div>
				}
			/>

			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
				<StatCard
					title={t('structures.totalStructures')}
					help={<p>{t('structures.matchesTheActiveTabAndFilters')}</p>}
				>
					<div className="text-3xl font-semibold">{summary?.total ?? '-'}</div>
				</StatCard>
				{isSkyhooksTab ? (
					<>
						<StatCard
							title={t('structures.highestFill')}
							help={
								<p>{t('structures.highestSecuredOrSurplusBayFullnessAmongTheFilteredSkyhooks')}</p>
							}
						>
							<div className="text-3xl font-semibold">
								{formatPercent(skyhookSummary?.skyhookHighestFillPercent)}
							</div>
						</StatCard>
						<StatCard
							title={t('structures.nextRaidable')}
							help={
								<>
									<p>{t('structures.timeUntilTheNextSkyhookBecomesTheftVulnerableOrRaidable')}</p>
									<p>
										{skyhookSummary?.skyhookNextRaidableAt
											? t('structures.nextRaidableSkyhook', {
													value1: skyhookSummary.skyhookNextRaidablePlanetName ?? '-',
													value2:
														skyhookSummary.skyhookCurrentRaidableCount &&
														skyhookSummary.skyhookCurrentRaidableCount > 1
															? t('structures.otherSkyhooks', {
																	value1: skyhookSummary.skyhookCurrentRaidableCount - 1,
																})
															: '',
												})
											: t('structures.noRaidableSkyhookIsCurrentlyAvailable')}
									</p>
								</>
							}
						>
							<div className="text-3xl font-semibold">
								<LiveDurationUntilText endDate={skyhookSummary?.skyhookNextRaidableAt} />
							</div>
						</StatCard>
					</>
				) : (
					<>
						<StatCard
							title={t('structures.lowFuel')}
							help={
								<p>
									{isSovereigntyTab
										? t('structures.sovereigntyHubsWithEitherReagentBelowHRemainingZeroQuantity', {
												value1: moduleConfig?.lowFuelTimeThresholdHours ?? '-',
											})
										: t('structures.lowFuelHOrUnitsRemaining', {
												value1: moduleConfig?.lowFuelTimeThresholdHours ?? '-',
												value2: moduleConfig?.lowFuelAmountThreshold ?? '-',
											})}
								</p>
							}
						>
							<div className="text-3xl font-semibold">{summary?.lowFuel ?? '-'}</div>
						</StatCard>
						{!isSovereigntyTab ? (
							<StatCard
								title={t('structures.lowPower')}
								help={<p>{t('structures.structuresInLowPowerWithoutSuppressionEnabled')}</p>}
							>
								<div className="text-3xl font-semibold">{summary?.lowPower ?? '-'}</div>
							</StatCard>
						) : null}
					</>
				)}
				<StatCard
					title={t('structures.reinforced')}
					help={<p>{t('structures.structuresCurrentlyInAReinforcedOrTransitionState')}</p>}
				>
					<div className="text-3xl font-semibold">{summary?.reinforced ?? '-'}</div>
				</StatCard>
				{isSovereigntyTab ? (
					<>
						<StatCard
							title={t('structures.magmaticGasBurn')}
							help={
								<>
									<p>
										{t('structures.aggregateHourlyMagmaticGasBurnAcrossTheFilteredSovereigntyHubs')}
									</p>
									<p>
										{sovereigntySummary
											? t('structures.hubsContributing', {
													value1: sovereigntySummary.magmaticGasBurningSampleCount,
												})
											: '-'}
									</p>
								</>
							}
						>
							<div className="text-3xl font-semibold">
								{formatNullableDecimal(sovereigntySummary?.magmaticGasBurningPerHour, 2)}
								{t('structures.hr')}
							</div>
						</StatCard>
						<StatCard
							title={t('structures.superionicIceBurn')}
							help={
								<>
									<p>
										{t(
											'structures.aggregateHourlySuperionicIceBurnAcrossTheFilteredSovereigntyHubs'
										)}
									</p>
									<p>
										{sovereigntySummary
											? t('structures.hubsContributing', {
													value1: sovereigntySummary.superionicIceBurningSampleCount,
												})
											: '-'}
									</p>
								</>
							}
						>
							<div className="text-3xl font-semibold">
								{formatNullableDecimal(sovereigntySummary?.superionicIceBurningPerHour, 2)}
								{t('structures.hr')}
							</div>
						</StatCard>
					</>
				) : isSkyhooksTab ? (
					<StatCard
						title={t('structures.totalWorkforce')}
						help={<p>{t('structures.totalEffectiveWorkforceAcrossTheFilteredSkyhooks')}</p>}
					>
						<div className="text-3xl font-semibold">
							{summary ? formatNullableNumber(skyhookSummary?.skyhookTotalWorkforce) : '-'}
						</div>
					</StatCard>
				) : (
					<StatCard
						title={t('structures.fuelBurnRate')}
						help={
							<>
								<p>{t('structures.estimatedAggregateBurnRateFromTheFilteredStructureSet')}</p>
								<p>
									{summary
										? t('structures.estimatedFromStructuresWithKnownServiceData', {
												value1: summary.fuelBurnRateKnownStructureCount,
											})
										: '-'}
								</p>
							</>
						}
					>
						<div className="text-3xl font-semibold">
							{summary?.estimatedFuelBurnRatePerHour
								? formatReagentBurnRate(Number(summary.estimatedFuelBurnRatePerHour))
								: '-'}
						</div>
					</StatCard>
				)}
			</div>

			<Card className={cn('flex flex-col', isTableGridClamped && 'lg:min-h-0 lg:flex-1')}>
				<CardContent
					className={cn(
						'flex flex-col space-y-4',
						isTableGridClamped && 'lg:min-h-0 lg:flex-1 lg:overflow-hidden'
					)}
				>
					<div className="flex items-start gap-4 pt-4">
						<Tabs
							value={activeTab}
							onValueChange={(value) => {
								if (isStructureTab(value)) {
									setStructureTableTab(value)
								}
							}}
							className="min-w-0 flex-1"
						>
							<TabsList className="flex w-full flex-wrap gap-1 border-b-0">
								{visibleTabs.map((tab) => (
									<TabsTrigger key={tab.tab} value={tab.tab}>
										{formatStructureLabel(tab.tab, tab.label)}
									</TabsTrigger>
								))}
							</TabsList>
						</Tabs>
						<div className="hidden shrink-0 lg:block">{tableLayoutButton}</div>
					</div>
					<Accordion
						type="single"
						collapsible
						defaultValue="structure-filters"
						onValueChange={(value) => setAreFiltersOpen(value === 'structure-filters')}
						className="w-full"
					>
						<AccordionItem
							value="structure-filters"
							className="w-full rounded-md border border-border/60 px-3"
						>
							<AccordionTrigger className="min-w-0 py-3 text-sm hover:no-underline">
								<span className="flex min-w-0 items-center gap-2">
									{t('structures.filters')}
									{activeFilterCount > 0 && (
										<Badge
											variant="secondary"
											className="h-5 min-w-5 justify-center px-1.5 text-xs"
										>
											{activeFilterCount}
										</Badge>
									)}
								</span>
								{activeFilterCount > 0 && (
									<Button
										variant="ghost"
										size="sm"
										className="ml-3 h-7 shrink-0 px-2 text-xs"
										onPointerDown={(event) => {
											event.preventDefault()
											event.stopPropagation()
										}}
										onClick={(event) => {
											event.preventDefault()
											event.stopPropagation()
											clearStructureTableFilters()
										}}
									>
										{t('structures.clearFilters')}
									</Button>
								)}
								<span className="ml-auto mr-3 hidden text-xs font-normal text-muted-foreground sm:inline">
									{areFiltersOpen ? t('structures.hideFilters') : t('structures.showFilters')}
								</span>
							</AccordionTrigger>
							<AccordionContent>
								<div className="space-y-4">
									{isSovereigntyTab
										? sovereigntyFilterControls
										: isSkyhooksTab || isMoonDrillsTab
											? specialFilterControls
											: commonFilterControls}
								</div>
							</AccordionContent>
						</AccordionItem>
					</Accordion>
					<div
						className={cn(
							'flex flex-col space-y-4 border-t border-border/60 pt-4',
							isTableGridClamped && 'lg:min-h-0 lg:flex-1'
						)}
					>
						<div className="border-b p-3">
							<UserSearchPaginationControls
								totalCount={pagination?.totalCount ?? 0}
								page={pagination?.page ?? tableState.page}
								pageSize={pagination?.pageSize ?? tableState.pageSize}
								onPageChange={setStructureTablePage}
								onPageSizeChange={setStructureTablePageSize}
								pageSizeOptions={[15, 25, 50, 100]}
								itemLabel={t('structures.structures2')}
								nextButtonLoading={isFetching}
								trailingAction={refreshButton}
							/>
						</div>
						<TableRefreshFrame
							className={cn('min-h-0', isTableGridClamped && 'lg:flex-1')}
							key={structuresContentKey}
							isRefreshing={isSoftLoading}
							refreshMessage={t('structures.refreshingStructureList')}
							errorMessage={
								error && structuresResponse
									? error instanceof Error
										? error.message
										: t('structures.failedToRefreshStructures')
									: null
							}
							onRetry={error && structuresResponse ? () => refreshAll() : undefined}
							retryDisabled={isFetching}
						>
							{error && !structuresResponse ? (
								<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-8 text-center text-sm text-destructive">
									<div className="font-medium">{t('structures.failedToLoadStructures')}</div>
									<div className="mt-1 text-destructive/80">
										{error instanceof Error ? error.message : t('structures.pleaseTryAgain')}
									</div>
									<div className="mt-4">
										<Button
											variant="secondary"
											size="sm"
											onClick={() => refreshAll()}
											disabled={isFetching}
										>
											{t('structures.retry')}
										</Button>
									</div>
								</div>
							) : isInitialLoading ? (
								<div className="p-4">
									<LoadingSpinner label={t('structures.loadingStructures')} />
								</div>
							) : structures.length === 0 ? (
								<div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
									{t('structures.noStructuresWereReturnedForTheSelectedFilters')}
								</div>
							) : (
								<Table
									containerRef={tableScrollContainerRef}
									onContainerScroll={handleTableScroll}
									containerClassName={cn('w-full', isTableGridClamped && 'lg:h-full lg:min-h-0')}
									className={cn(
										'min-w-[118rem] whitespace-nowrap',
										isSovereigntyTab && 'min-w-[136rem]',
										isSkyhooksTab && 'min-w-[132rem]',
										isMiningCitadelTab && 'min-w-[124rem]'
									)}
								>
									<TableHeader>
										<TableRow>
											{isSovereigntyTab ? (
												<>
													<SortableHead field="state" label={t('structures.state')} />
													<SortableHead field="region" label={t('structures.region')} />
													<SortableHead field="system" label={t('structures.system')} />
													<SortableHead field="corporation" label={t('structures.corporation')} />
													<TableHead>{t('structures.systemAlliance')}</TableHead>
													<TableHead>{t('structures.group')}</TableHead>
													<SortableHead field="activityDefenseMultiplier" label="ADM" />
													<SortableHead
														field="magmaticGasEstimatedDepletionAt"
														label={t('structures.magmaticGas')}
													/>
													<SortableHead
														field="superionicIceEstimatedDepletionAt"
														label={t('structures.superionicIce')}
													/>
													<TableHead>{t('structures.workforce')}</TableHead>
													<TableHead>{t('structures.power')}</TableHead>
													<TableHead>{t('structures.sync')}</TableHead>
												</>
											) : isSkyhooksTab ? (
												<>
													<SortableHead field="state" label={t('structures.state')} />
													<SortableHead field="region" label={t('structures.region')} />
													<SortableHead field="system" label={t('structures.system')} />
													<SortableHead field="planet" label={t('structures.planet')} />
													<SortableHead field="corporation" label={t('structures.corporation')} />
													<SortableHead
														field="skyhookSecureFullness"
														label={t('structures.fullnessSecure')}
													/>
													<SortableHead
														field="skyhookSurplusFullness"
														label={t('structures.fullnessSurplus')}
													/>
													<SortableHead field="workforce" label={t('structures.workforce')} />
													<SortableHead field="raidable" label={t('structures.raidable')} />
													<SortableHead
														field="theftVulnerabilityStart"
														label={t('structures.theftWindow')}
													/>
													<SortableHead field="nextStateAt" label={t('structures.nextStateIn')} />
													<SortableHead field="group" label={t('structures.group')} />
													<SortableHead field="syncStatus" label={t('structures.sync')} />
												</>
											) : isMoonDrillsTab ? (
												<>
													<SortableHead field="state" label={t('structures.state')} />
													<SortableHead field="region" label={t('structures.region')} />
													<SortableHead field="system" label={t('structures.system')} />
													<SortableHead field="planet" label={t('structures.planet')} />
													<TableHead>{t('structures.moon')}</TableHead>
													<SortableHead field="name" label={t('structures.name')} />
													<SortableHead field="corporation" label={t('structures.corporation')} />
													<SortableHead field="moonMaterials" label={t('structures.moonGoo')} />
													<SortableHead field="fuelBlocks" label={t('structures.fuelBlocks')} />
													<SortableHead field="magmaticGas" label={t('structures.magmaticGas')} />
													<TableHead>LP</TableHead>
													<TableHead>{t('structures.lpAllowed')}</TableHead>
													<SortableHead field="nextStateAt" label={t('structures.nextStateIn')} />
													<TableHead>{t('structures.group')}</TableHead>
													<TableHead>{t('structures.sync')}</TableHead>
												</>
											) : isMiningCitadelTab ? (
												<>
													<SortableHead field="state" label={t('structures.state')} />
													<SortableHead field="region" label={t('structures.region')} />
													<SortableHead field="system" label={t('structures.system')} />
													<SortableHead field="planet" label={t('structures.planet')} />
													<TableHead>{t('structures.moon')}</TableHead>
													<SortableHead field="name" label={t('structures.name')} />
													<SortableHead field="corporation" label={t('structures.corporation')} />
													<SortableHead field="type" label={t('structures.type')} />
													<SortableHead field="fuel" label={t('structures.fuel')} />
													<TableHead>LP</TableHead>
													<TableHead>{t('structures.lpAllowed')}</TableHead>
													<SortableHead field="nextStateAt" label={t('structures.nextStateIn')} />
													<TableHead>{t('structures.group')}</TableHead>
													<TableHead>{t('structures.chunkArrival')}</TableHead>
													<TableHead>{t('structures.naturalDecay')}</TableHead>
													<TableHead>{t('structures.sync')}</TableHead>
												</>
											) : (
												<>
													<SortableHead field="state" label={t('structures.state')} />
													<SortableHead field="region" label={t('structures.region')} />
													<SortableHead field="system" label={t('structures.system')} />
													<SortableHead field="name" label={t('structures.name')} />
													<SortableHead field="corporation" label={t('structures.corporation')} />
													<SortableHead field="type" label={t('structures.type')} />
													<SortableHead field="fuel" label={t('structures.fuel')} />
													<TableHead>LP</TableHead>
													<TableHead>{t('structures.lpAllowed')}</TableHead>
													<SortableHead field="nextStateAt" label={t('structures.nextStateIn')} />
													<TableHead>{t('structures.group')}</TableHead>
													<TableHead>{t('structures.sync')}</TableHead>
												</>
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
