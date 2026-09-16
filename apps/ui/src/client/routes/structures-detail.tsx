import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
	ArrowLeft,
	CircleHelp,
	Factory,
	Package,
	Recycle,
	Save,
	Search,
	Shield,
	Store,
	Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { FittingPanel } from '@repo/eve-fitting/fitting-panel'
import { FittingSlotTable } from '@repo/eve-fitting/fitting-slot-table'
import { hasAnyStructurePermission, hasStructureDetailsPermission } from '@repo/groups'
import {
	getStructureTabForTypeId,
	isReinforcedStructureState,
	STRUCTURE_SYNC_ERROR_STALE_MS,
	STRUCTURE_SYNC_WARNING_STALE_MS,
} from '@repo/structures'

import { CorporationLogo } from '@/components/corporation-logo'
import { InventoryBaysTable } from '@/components/inventory-bays-table'
import { MoonCompositionCard } from '@/components/moon-composition-card'
import { SkyhookStateBadge } from '@/components/skyhook-state-badge'
import { StructureStateBadge } from '@/components/structure-state-badge'
import { StructureSyncStatusBadge } from '@/components/structure-sync-status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DurationDisplay } from '@/components/ui/duration-display'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { FilterField } from '@/components/ui/filter-field'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Progress } from '@/components/ui/progress'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useAuth } from '@/hooks/useAuth'
import { useGroups } from '@/hooks/useGroups'
import { useSystemDetails } from '@/hooks/useLocationSearch'
import { useNowMs } from '@/hooks/useNowMs'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { getActiveLocale, i18n, useAppTranslation } from '@/i18n'
import { api } from '@/lib/api'
import { formatDateTimeLong, formatUtcDateTime } from '@/lib/date-utils'
import { formatDurationMs } from '@/lib/duration-utils'
import { allianceLogoUrl, typeIconUrl, typeImageUrl, typeRenderUrl } from '@/lib/eve-images'
import { getSovereigntyVulnerabilityWindowDisplay } from '@/lib/sovereignty-vulnerability-window'
import { stripLeadingContextName } from '@/lib/structure-name-utils'
import toast from '@/lib/toast'

import { useStructureAccess } from '../features/structures/hooks'

import type { FittingDisplayItem, FittingShipSlotType } from '@repo/eve-fitting/flags'
import type { StructureSovereigntyTransportSection } from '@repo/structures'
import type { BadgeVariant } from '@/components/ui/badge'
import type { SelectOption } from '@/components/ui/select'
import type {
	StructureAssetsDebugResult,
	StructureDetailResult,
	StructureSovereigntyListItem,
} from '@/lib/api'

function structureSyncStatusDescription(
	syncStatus: StructureDetailResult['syncStatus'],
	syncFailureReason: string | null,
	lastSyncedAt: string | null
) {
	const getStalenessNote = () => {
		if (!lastSyncedAt) return null
		const ageMs = Math.max(0, Date.now() - new Date(lastSyncedAt).getTime())
		if (ageMs >= STRUCTURE_SYNC_ERROR_STALE_MS) {
			return i18n.t('structures.thisSnapshotIsMoreThan24HoursOldAndShould')
		}
		if (ageMs >= STRUCTURE_SYNC_WARNING_STALE_MS) {
			return i18n.t('structures.thisSnapshotIsMoreThan12HoursOldAndMay')
		}
		return null
	}

	if (syncFailureReason) {
		return lastSyncedAt
			? i18n.t('structures.lastSyncAtValue1Value2', {
					value1: formatDateTimeLong(lastSyncedAt),
					value2: syncFailureReason,
				})
			: syncFailureReason
	}

	if (syncStatus === 'ok') {
		return lastSyncedAt
			? i18n.t('structures.lastSuccessfulSyncAtValue1', {
					value1: formatDateTimeLong(lastSyncedAt),
				})
			: i18n.t('structures.theLatestCorporationDataSyncCompletedSuccessfully')
	}

	if (syncStatus === 'warning') {
		const stalenessNote = getStalenessNote()
		return lastSyncedAt
			? i18n.t('structures.lastSyncAtValue1Value2', {
					value1: formatDateTimeLong(lastSyncedAt),
					value2:
						stalenessNote ??
						i18n.t('structures.theLatestCorporationDataSyncCompletedWithWarningsSoSome'),
				})
			: i18n.t('structures.theLatestCorporationDataSyncCompletedWithWarningsSoSome')
	}

	if (syncStatus === 'error') {
		const stalenessNote = getStalenessNote()
		return lastSyncedAt
			? i18n.t('structures.lastSyncAtValue1Value2', {
					value1: formatDateTimeLong(lastSyncedAt),
					value2:
						stalenessNote ??
						i18n.t('structures.theLatestCorporationDataSyncFailedSoThisSnapshotMay'),
				})
			: i18n.t('structures.theLatestCorporationDataSyncFailedSoThisSnapshotMay')
	}

	return lastSyncedAt
		? i18n.t('structures.lastSyncAtValue1TheLatestCorporationDataSyncCompleted', {
				value1: formatDateTimeLong(lastSyncedAt),
			})
		: i18n.t('structures.theLatestCorporationDataSyncCompletedSuccessfullyAndTheStored')
}

type AssetSyncStatus = 'ok' | 'warning' | 'error' | 'disabled'

function assetSyncStatus(enabled: boolean, lastAssetSnapshotAt: string | null): AssetSyncStatus {
	if (!enabled) return 'disabled'
	return snapshotSyncStatus(lastAssetSnapshotAt)
}

function snapshotSyncStatus(lastSnapshotAt: string | null): Exclude<AssetSyncStatus, 'disabled'> {
	if (!lastSnapshotAt) return 'error'

	const parsed = new Date(lastSnapshotAt)
	if (Number.isNaN(parsed.getTime())) return 'error'

	const ageMs = Math.max(0, Date.now() - parsed.getTime())
	if (ageMs >= STRUCTURE_SYNC_ERROR_STALE_MS) return 'error'
	if (ageMs >= STRUCTURE_SYNC_WARNING_STALE_MS) return 'warning'
	return 'ok'
}

function assetSyncStatusDescription(enabled: boolean, lastAssetSnapshotAt: string | null): string {
	if (!enabled) return i18n.t('structures.assetSyncIsDisabledForThisCorporation')
	return snapshotSyncStatusDescription('asset', lastAssetSnapshotAt)
}

function snapshotSyncStatusDescription(label: string, lastSnapshotAt: string | null): string {
	if (!lastSnapshotAt) {
		return i18n.t('structures.noValue1SnapshotTimestampHasBeenRecorded', { value1: label })
	}

	const parsed = new Date(lastSnapshotAt)
	if (Number.isNaN(parsed.getTime())) {
		return i18n.t('structures.theLastValue1SnapshotTimestampWasInvalidSoTheSnapshot', {
			value1: label,
		})
	}

	const ageMs = Math.max(0, Date.now() - parsed.getTime())
	const stalenessNote =
		ageMs >= STRUCTURE_SYNC_ERROR_STALE_MS
			? i18n.t('structures.thisSnapshotIsMoreThan24HoursOldAndShould')
			: ageMs >= STRUCTURE_SYNC_WARNING_STALE_MS
				? i18n.t('structures.thisSnapshotIsMoreThan12HoursOldAndMay')
				: i18n.t('structures.theStoredValue1SnapshotIsCurrent', { value1: label })

	return i18n.t('structures.lastValue1SnapshotAtValue2Value3', {
		value1: label,
		value2: formatDateTimeLong(lastSnapshotAt),
		value3: stalenessNote,
	})
}

function serviceBadgeVariant(state: string): BadgeVariant {
	const normalized = state.trim().toLowerCase()
	if (normalized === 'online') return 'success'
	if (normalized === 'offline') return 'destructive'
	if (normalized.includes('error') || normalized.includes('fault')) return 'destructive'
	return 'ghost'
}

function renderServiceIcon(name: string) {
	const normalized = name.trim().toLowerCase()

	if (normalized.includes('manufactur')) {
		return <Factory className="h-4 w-4 shrink-0" />
	}

	if (normalized.includes('reprocess')) {
		return <Recycle className="h-4 w-4 shrink-0" />
	}

	if (normalized.includes('market')) {
		return <Store className="h-4 w-4 shrink-0" />
	}

	if (normalized.includes('clone')) {
		return <Users className="h-4 w-4 shrink-0" />
	}

	return <CircleHelp className="h-4 w-4 shrink-0" />
}

function formatServiceStateLabel(state: string): string {
	return state
		.split('_')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(' ')
}

function formatReinforcementHourUtc(hour: number | null): string {
	if (hour === null) {
		return '-'
	}
	return i18n.t('structures.value100EveTime', { value1: hour.toString().padStart(2, '0') })
}

function formatNullableDateTime(value: string | null | undefined): string {
	return value ? formatDateTimeLong(value) : '-'
}

function formatEveTimeLabel(value: string | null | undefined): string {
	return value ? `${formatUtcDateTime(value, true)} EVE` : '-'
}

function formatNullableNumber(value: number | null | undefined): string {
	if (value === null || value === undefined) return '-'
	return value.toLocaleString(getActiveLocale())
}

function formatApproximateNumber(value: number | null | undefined): string {
	if (value === null || value === undefined) return '-'
	return `~${value.toLocaleString(getActiveLocale())}`
}

function formatEstimatedRemaining(
	amount: number | null | undefined,
	burningPerHour: number | null | undefined
): string {
	const amountValue = toFiniteNumber(amount)
	const burnRate = toFiniteNumber(burningPerHour)

	if (
		amount === null ||
		amount === undefined ||
		burningPerHour === null ||
		burningPerHour === undefined
	) {
		return '-'
	}

	if (burnRate <= 0) {
		return amountValue > 0 ? i18n.t('structures.notBurning') : '0s'
	}

	const remainingMs = (amountValue / burnRate) * 60 * 60 * 1000
	return formatDurationMs(remainingMs, { style: 'compact', maxUnits: 2 })
}

function getSovereigntyVulnerabilityState(
	sovereignty: StructureDetailResult['sovereignty'] | null | undefined
): { label: string; variant: BadgeVariant } {
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

function LiveSovereigntyVulnerabilityWindow({
	vulnerabilityWindowStart,
	vulnerabilityWindowEnd,
}: {
	vulnerabilityWindowStart: string | null | undefined
	vulnerabilityWindowEnd: string | null | undefined
}) {
	const nowMs = useNowMs()
	const sovereigntyVulnerabilityWindow = getSovereigntyVulnerabilityWindowDisplay({
		vulnerabilityWindowStart: vulnerabilityWindowStart ?? null,
		vulnerabilityWindowEnd: vulnerabilityWindowEnd ?? null,
		nowMs,
	})

	return (
		<>
			{sovereigntyVulnerabilityWindow.label}{' '}
			{sovereigntyVulnerabilityWindow.countdownTarget ? (
				<DurationDisplay
					endDate={sovereigntyVulnerabilityWindow.countdownTarget}
					maxUnits={2}
					durationStyle="compact"
					format="compact"
				/>
			) : null}
		</>
	)
}

function toFiniteNumber(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

function formatBurnRate(value: number | null | undefined): string {
	if (value === null || value === undefined) return '-'
	return `${value.toLocaleString(getActiveLocale(), { maximumFractionDigits: 2 })}/hr`
}

function formatVolumeM3(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return '-'
	}
	return `${value.toLocaleString(getActiveLocale(), { maximumFractionDigits: 2 })} m3`
}

function formatPercent(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return '-'
	}
	return `${value.toLocaleString(getActiveLocale(), { maximumFractionDigits: 1 })}%`
}

function getSkyhookFullnessPercent(structure: {
	totalSecuredVolumeM3?: number | null
	totalUnsecuredVolumeM3?: number | null
	securedCapacityM3?: number | null
	unsecuredCapacityM3?: number | null
}): number {
	const totalVolume =
		Number(structure.totalSecuredVolumeM3 ?? 0) + Number(structure.totalUnsecuredVolumeM3 ?? 0)
	const totalCapacity =
		Number(structure.securedCapacityM3 ?? 0) + Number(structure.unsecuredCapacityM3 ?? 0)
	if (!Number.isFinite(totalVolume) || !Number.isFinite(totalCapacity) || totalCapacity <= 0) {
		return 0
	}
	return (totalVolume / totalCapacity) * 100
}

function SkyhookFullnessBar({
	volumeM3,
	capacityM3,
	fillPercent,
}: {
	volumeM3: number
	capacityM3: number
	fillPercent: number
}) {
	const { t } = useAppTranslation()

	return (
		<div className="space-y-1.5">
			<div className="font-medium tabular-nums">
				{formatVolumeM3(volumeM3)} / {formatVolumeM3(capacityM3)}
			</div>
			<Progress value={Math.min(100, Math.max(0, fillPercent))} className="h-2 bg-muted/30" />
			<div className="text-xs text-muted-foreground">
				{t('structures.fullnessPercent', { percent: formatPercent(fillPercent) })}
			</div>
		</div>
	)
}

function SkyhookBayFillCell({
	stock,
	volumeM3,
	capacityM3,
	fillPercent,
}: {
	stock: number
	volumeM3: number
	capacityM3: number
	fillPercent: number
}) {
	const { t } = useAppTranslation()

	return (
		<div className="space-y-1.5">
			<div className="font-medium tabular-nums">{stock.toLocaleString(getActiveLocale())}</div>
			<div className="text-xs text-muted-foreground">
				{formatVolumeM3(volumeM3)} / {formatVolumeM3(capacityM3)}
			</div>
			<Progress value={Math.min(100, Math.max(0, fillPercent))} className="h-2 bg-muted/30" />
			<div className="text-xs text-muted-foreground">
				{t('structures.fullnessPercent', { percent: formatPercent(fillPercent) })}
			</div>
		</div>
	)
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
			className="h-4 w-4 rounded-sm object-cover"
			loading="lazy"
			onError={() => setFailed(true)}
		/>
	)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type WorkforceTransportEntry = {
	solarSystemId: string
	amount: number | null
}

type ParsedWorkforceTransportSection =
	| {
			mode: 'import' | 'export'
			systems: WorkforceTransportEntry[]
	  }
	| {
			mode: 'transit'
			systems: []
	  }
	| {
			mode: 'unknown'
			systems: []
	  }

function parseWorkforceTransportSystems(
	value: unknown,
	defaultAmount: number | null = null
): WorkforceTransportEntry[] {
	if (!Array.isArray(value)) {
		return []
	}

	return value.flatMap((entry) => {
		if (!isRecord(entry)) {
			return []
		}

		const sourceId = entry.solar_system_id ?? entry.solarSystemId
		if (sourceId === null || sourceId === undefined) {
			return []
		}

		const amount =
			typeof entry.amount === 'number'
				? entry.amount
				: typeof entry.amount === 'string' &&
					  entry.amount.trim() !== '' &&
					  Number.isFinite(Number(entry.amount))
					? Number(entry.amount)
					: defaultAmount
		return [
			{
				solarSystemId: String(sourceId),
				amount,
			},
		]
	})
}

function parseWorkforceTransportSection(section: unknown): ParsedWorkforceTransportSection {
	if (!isRecord(section)) {
		return { mode: 'unknown', systems: [] }
	}

	if ('mode' in section && Array.isArray(section.systems)) {
		const mode = section.mode
		if (mode === 'import' || mode === 'export') {
			return {
				mode,
				systems: parseWorkforceTransportSystems(section.systems),
			}
		}

		if (mode === 'transit') {
			return { mode: 'transit', systems: [] }
		}
	}

	if ('import' in section && isRecord(section.import)) {
		return {
			mode: 'import',
			systems: parseWorkforceTransportSystems(section.import.sources),
		}
	}

	if ('export' in section && isRecord(section.export)) {
		if (Array.isArray(section.export.sources)) {
			return {
				mode: 'export',
				systems: parseWorkforceTransportSystems(section.export.sources, null),
			}
		}

		const exportSystemId = section.export.solar_system_id ?? section.export.solarSystemId
		if (exportSystemId !== null && exportSystemId !== undefined) {
			return {
				mode: 'export',
				systems: parseWorkforceTransportSystems(
					[
						{
							solar_system_id: exportSystemId,
							amount: section.export.amount,
						},
					],
					null
				),
			}
		}
	}

	if (section.transit === true || section.mode === 'transit') {
		return { mode: 'transit', systems: [] }
	}

	return { mode: 'unknown', systems: [] }
}

function formatWorkforceTransportMode(mode: ParsedWorkforceTransportSection['mode']): string {
	switch (mode) {
		case 'import':
			return i18n.t('structures.import')
		case 'export':
			return i18n.t('structures.export')
		case 'transit':
			return i18n.t('structures.transit')
		default:
			return i18n.t('structures.unrecognized')
	}
}

function workforceTransportBadgeVariant(
	mode: ParsedWorkforceTransportSection['mode']
): BadgeVariant {
	return mode === 'unknown' ? 'ghost' : 'success'
}

function WorkforceTransportSystemName({
	systemId,
	linkTo,
}: {
	systemId: string
	linkTo: string | null
}) {
	const { t } = useAppTranslation()

	const { data: systemDetails, isLoading } = useSystemDetails(systemId)

	if (isLoading) {
		return <Skeleton className="h-8 w-32" />
	}

	return (
		<div className="space-y-0.5">
			<div className="font-medium">
				{linkTo ? (
					<Link to={linkTo} className="text-primary hover:underline">
						{systemDetails?.name ?? systemId}
					</Link>
				) : (
					(systemDetails?.name ?? systemId)
				)}
			</div>
			<div className="text-xs text-muted-foreground">
				{t('structures.systemId')}
				{systemId}
			</div>
		</div>
	)
}

function WorkforceTransportSection({
	label,
	section,
	systemLinkById,
}: {
	label: string
	section: StructureSovereigntyTransportSection | null | undefined
	systemLinkById: Map<string, string>
}) {
	const { t } = useAppTranslation()

	const parsed = parseWorkforceTransportSection(section)
	const hasSystems = parsed.mode !== 'unknown' && parsed.systems.length > 0

	return (
		<div className="rounded-lg border border-border/60 bg-muted/20 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="font-medium">{label}</div>
				</div>
				<Badge variant={workforceTransportBadgeVariant(parsed.mode)}>
					{formatWorkforceTransportMode(parsed.mode)}
				</Badge>
			</div>

			{hasSystems ? (
				<div className="mt-4 overflow-hidden rounded-md border border-border/60 bg-background">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t('structures.system')}</TableHead>
								<TableHead>{t('structures.amount')}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{parsed.systems.map((source) => (
								<TableRow key={`${label}-${source.solarSystemId}`}>
									<TableCell>
										<WorkforceTransportSystemName
											systemId={source.solarSystemId}
											linkTo={systemLinkById.get(source.solarSystemId) ?? null}
										/>
									</TableCell>
									<TableCell>{formatNullableNumber(source.amount)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			) : (
				<div className="mt-4 rounded-md border border-dashed border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground">
					{parsed.mode === 'transit'
						? t('structures.transitModeDoesNotListSystems')
						: t('structures.noSystemsRecorded')}
				</div>
			)}
		</div>
	)
}

function ResourceAllocationCard({
	label,
	allocated,
	available,
}: {
	label: string
	allocated: number | null | undefined
	available: number | null | undefined
}) {
	const allocatedValue = toFiniteNumber(allocated)
	const availableValue = toFiniteNumber(available)
	const percentage =
		availableValue > 0 ? Math.min(100, Math.max(0, (allocatedValue / availableValue) * 100)) : 0

	return (
		<div className="rounded-lg border border-border/60 bg-muted/20 p-4">
			<div className="flex items-center justify-between gap-3">
				<div className="font-medium">{label}</div>
				<div className="font-mono text-sm tabular-nums">
					<span>{formatNullableNumber(allocatedValue)}</span>
					<span className="mx-1 text-muted-foreground">/</span>
					<span>{formatNullableNumber(availableValue)}</span>
				</div>
			</div>
			<Progress value={percentage} className="mt-3 h-2 bg-border/60" />
		</div>
	)
}

function InventoryItemIcon({ typeId }: { typeId: string }) {
	const [failed, setFailed] = useState(false)

	if (failed) {
		return (
			<div className="flex h-5 w-5 items-center justify-center rounded bg-muted">
				<Package className="h-3 w-3 text-muted-foreground" />
			</div>
		)
	}

	return (
		<img
			src={typeImageUrl(typeId, 'icon', 32)}
			alt=""
			className="h-5 w-5 rounded"
			loading="lazy"
			onError={() => setFailed(true)}
		/>
	)
}

const FITTING_SLOT_TYPE_BY_NAME: Record<string, FittingShipSlotType> = {
	'High Slot': 'high',
	'Mid Slot': 'mid',
	'Low Slot': 'low',
	'Rig Slot': 'rig',
	'Subsystem Slot': 'sub',
}

const STRUCTURE_SLOT_TABLE_TYPES: FittingShipSlotType[] = ['high', 'mid', 'low', 'rig']

function structureFittingItemsToDisplayItems(
	structure: StructureDetailResult
): FittingDisplayItem[] {
	return (structure.fittingItems ?? []).map((item, index) => ({
		typeId: item.typeId,
		typeName: item.typeName ?? item.typeId,
		quantity: Math.max(1, item.quantity),
		slotType: FITTING_SLOT_TYPE_BY_NAME[item.flagName],
		slotIndex: item.slotIndex ?? index,
		...(item.isConsumable ? { isConsumable: true } : {}),
	}))
}

export default function StructuresDetailPage() {
	const { t } = useAppTranslation()

	const { structureId } = useParams<{ structureId: string }>()
	const queryClient = useQueryClient()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { permissions, isLoading: permissionsLoading } = useUserPermissions()
	const { data: structureAccess, isLoading: structureAccessLoading } = useStructureAccess({
		enabled: isAuthenticated && !authLoading,
	})
	const hasImplicitSensitiveAccess = structureAccess?.hasImplicitSensitiveAccess === true
	const canViewStructures =
		user?.is_admin === true || hasAnyStructurePermission(permissions) || hasImplicitSensitiveAccess
	const canViewStructureDetails =
		user?.is_admin === true ||
		hasStructureDetailsPermission(permissions) ||
		hasImplicitSensitiveAccess
	const canAccess = !structureAccessLoading && canViewStructureDetails && Boolean(structureId)
	const {
		data: structure,
		isLoading,
		error,
	} = useQuery({
		queryKey: ['structures', structureId],
		queryFn: () => api.getStructure(structureId!),
		enabled: canAccess,
	})

	const { data: groups = [] } = useGroups({ limit: 100 })
	const [hidden, setHidden] = useState(false)
	const [lowPowerAllowed, setLowPowerAllowed] = useState(false)
	const [assignedGroupId, setAssignedGroupId] = useState('')
	const [assetsDebug, setAssetsDebug] = useState<StructureAssetsDebugResult | null>(null)
	const [pendingAssetsDebug, setPendingAssetsDebug] = useState<{
		workflowInstanceId: string
		fileName: string
	} | null>(null)

	const isAdmin = user?.is_admin === true

	usePageTitle(
		structure
			? t('structures.structureValue1', {
					value1:
						getStructureTabForTypeId(structure.typeId, structure.typeName) === 'skyhooks'
							? t('structures.skyhookDetails')
							: structure.name,
				})
			: t('structures.structureDetails')
	)

	useEffect(() => {
		if (!structure) return
		setHidden(structure.hidden)
		setLowPowerAllowed(structure.lowPowerAllowed)
		setAssignedGroupId(structure.assignedGroupId ?? '')
	}, [structure])

	useEffect(() => {
		setAssetsDebug(null)
		setPendingAssetsDebug(null)
	}, [structureId])

	const groupOptions = useMemo<SelectOption[]>(() => {
		return [
			{ value: '', label: t('structures.noGroup') },
			...groups
				.slice()
				.sort((left, right) => left.name.localeCompare(right.name))
				.map((group) => ({ value: group.id, label: group.name })),
		]
	}, [groups, t])

	const updateMutation = useApiMutation({
		mutationFn: (data: {
			hidden: boolean
			lowPowerAllowed: boolean
			assignedGroupId: string | null
		}) => api.updateStructureConfig(structureId!, data),
		successMessage: t('structures.structureConfigurationSaved'),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['structures'] }),
				queryClient.invalidateQueries({ queryKey: ['structures', structureId] }),
			])
		},
	})

	const debugAssetsMutation = useApiMutation({
		mutationFn: () => api.requestStructureAssetsDebug(structureId!),
		showSuccessToast: false,
		onSuccess: (result) => {
			setPendingAssetsDebug({
				workflowInstanceId: result.workflowInstanceId,
				fileName: result.fileName,
			})
		},
	})

	const rebuildInventoryMutation = useApiMutation({
		mutationFn: () => api.requestStructureInventoryRebuild(structureId!),
		showSuccessToast: false,
		onSuccess: async (result) => {
			toast.success(t('structures.rebuiltInventory', { count: result.inventoryCount }))
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['structures'] }),
				queryClient.invalidateQueries({ queryKey: ['structures', structureId] }),
			])
		},
	})

	const assetsDebugStatusQuery = useQuery({
		queryKey: [
			'structures',
			structureId,
			'assets-debug',
			pendingAssetsDebug?.workflowInstanceId ?? null,
		],
		queryFn: () =>
			api.getStructureAssetsDebugStatus(structureId!, pendingAssetsDebug!.workflowInstanceId),
		enabled: Boolean(pendingAssetsDebug?.workflowInstanceId),
		refetchInterval: (query) => {
			const status = query.state.data?.status
			return status === 'queued' || status === 'running' || status === undefined ? 5000 : false
		},
		refetchOnWindowFocus: false,
	})
	const assetsDebugStatus = assetsDebugStatusQuery.data?.status
	const isAssetsDebugPolling =
		Boolean(pendingAssetsDebug) &&
		(assetsDebugStatus === undefined ||
			assetsDebugStatus === 'queued' ||
			assetsDebugStatus === 'running')
	const isAssetsDebugBusy = debugAssetsMutation.isPending || isAssetsDebugPolling
	const isInventoryRebuildBusy = rebuildInventoryMutation.isPending

	useEffect(() => {
		if (!pendingAssetsDebug) return
		if (!assetsDebugStatusQuery.data) return

		if (assetsDebugStatusQuery.data.status === 'completed') {
			void (async () => {
				try {
					const result = await api.downloadStructureAssetsDebug(
						structureId!,
						pendingAssetsDebug.workflowInstanceId
					)
					setAssetsDebug(result)
					toast.success(
						t('structures.fetchedValue1RawAssetsAndFoundValue2RowsForThis', {
							value1: result.fetchedAssetCount.toLocaleString(getActiveLocale()),
							value2: result.itemCount.toLocaleString(getActiveLocale()),
						})
					)
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: t('structures.failedToDownloadStructureAssetsDebugData')
					)
				} finally {
					setPendingAssetsDebug(null)
				}
			})()
			return
		}

		if (
			assetsDebugStatusQuery.data.status === 'failed' ||
			assetsDebugStatusQuery.data.status === 'unknown'
		) {
			toast.error(t('structures.failedToGenerateStructureAssetsDebugData'))
			setPendingAssetsDebug(null)
		}
	}, [assetsDebugStatusQuery.data, pendingAssetsDebug, structureId])
	const fittingItems = useMemo(() => {
		if (!structure) {
			return []
		}

		return structureFittingItemsToDisplayItems(structure)
	}, [structure, t])
	const fittingSlotCapacities: NonNullable<StructureDetailResult['fittingSlotCapacities']> =
		structure?.fittingSlotCapacities ?? { high: 0, mid: 0, low: 0, rig: 0 }
	const hasStructureFitting =
		fittingItems.length > 0 ||
		(structure?.fittingSlotCapacities != null &&
			Object.values(fittingSlotCapacities).some((capacity) => capacity > 0))
	const isReinforced = structure ? isReinforcedStructureState(structure.state) : false
	const structureFamily = structure
		? getStructureTabForTypeId(structure.typeId, structure.typeName)
		: null
	const corporationId = structure?.corporationId ?? ''
	const hasSovereigntySummary = structureFamily === 'sovereignty' && Boolean(structure?.sovereignty)
	const hasSkyhookSummary = structureFamily === 'skyhooks' && Boolean(structure?.skyhook)
	const isSkyhookStructure = structureFamily === 'skyhooks'
	const isMoonDrillStructure = structureFamily === 'moon-drills'
	const isPosStructure = structureFamily === 'poses'
	const hasMiningExtractionSummary =
		structureFamily === 'mining-citadels' &&
		(Boolean(structure?.miningExtraction) ||
			(structure?.miningExtractionHistory?.length ?? 0) > 0 ||
			Boolean(structure?.miningExtractionComposition))
	const moonDrill = structure?.moonDrill ?? null
	const miningExtraction = structure?.miningExtraction ?? null
	const miningExtractionComposition =
		structure?.miningExtractionComposition ?? miningExtraction?.composition ?? null
	const moonComposition = structure?.moonComposition ?? miningExtractionComposition
	const miningExtractionHistory = structure?.miningExtractionHistory ?? []
	const hasStructure = Boolean(structure)
	const [selectedExtractionId, setSelectedExtractionId] = useState<string | null>(null)
	const currentExtractionId = miningExtraction?.extractionId ?? null
	const firstExtractionId = miningExtractionHistory[0]?.id ?? null
	const selectedHistoricalExtraction = miningExtractionHistory.find(
		(extraction) => extraction.id === selectedExtractionId
	)
	const selectedExtraction =
		selectedHistoricalExtraction ??
		(selectedExtractionId === null || selectedExtractionId === currentExtractionId
			? miningExtraction
			: null)
	const extractionOptions = useMemo<SelectOption[]>(() => {
		return miningExtractionHistory.map((extraction) => ({
			value: extraction.id,
			label:
				extraction.id === currentExtractionId
					? t('structures.currentExtractionValue1', {
							value1: formatEveTimeLabel(extraction.extractionStartTime),
						})
					: `${formatEveTimeLabel(extraction.extractionStartTime)} - ${formatEveTimeLabel(extraction.naturalDecayTime)}`,
		}))
	}, [currentExtractionId, miningExtractionHistory, t])
	const sovereigntyHub = structure?.sovereignty?.hub ?? null
	const sovereigntyAllianceId = structure?.sovereignty?.allianceId ?? null
	const sovereigntyAllianceName = structure?.sovereignty?.allianceName ?? null
	const sovereigntyVulnerabilityState = getSovereigntyVulnerabilityState(structure?.sovereignty)

	useEffect(() => {
		if (!hasStructure) {
			setSelectedExtractionId(null)
			return
		}
		setSelectedExtractionId(currentExtractionId ?? firstExtractionId)
	}, [currentExtractionId, firstExtractionId, hasStructure, structureId])
	const { data: sovereigntyStructures = [] } = useQuery({
		queryKey: ['structures', 'sovereignty', corporationId],
		queryFn: async () => {
			const allItems: StructureSovereigntyListItem[] = []
			let page = 1
			let totalPages = 1

			while (page <= totalPages) {
				const response = await api.getSovereigntyStructures({
					corporationId,
					page,
					pageSize: 100,
				})
				allItems.push(...response.items)
				totalPages = response.pagination.totalPages
				page += 1
			}

			return allItems
		},
		enabled: hasSovereigntySummary,
	})
	const sovereigntyHubStructureIdBySystemId = useMemo(() => {
		return new Map(
			sovereigntyStructures.map((item) => [
				item.systemId,
				`/structures/${item.sovereigntyHubStructureId ?? item.structureId}`,
			])
		)
	}, [sovereigntyStructures, t])
	if (!authLoading && !permissionsLoading && !structureAccessLoading && !canViewStructures) {
		return <Navigate to="/dashboard" replace />
	}

	if (
		!authLoading &&
		!permissionsLoading &&
		!structureAccessLoading &&
		canViewStructures &&
		!canViewStructureDetails
	) {
		return <Navigate to="/structures" replace />
	}

	if (!structureId) {
		return <Navigate to="/structures" replace />
	}

	if (isLoading) {
		return <LoadingPage label={t('structures.loadingStructure')} />
	}

	if (error || !structure) {
		return (
			<Container className="py-6">
				<Card>
					<CardHeader>
						<CardTitle>{t('structures.structureNotFound')}</CardTitle>
						<CardDescription>
							{t('structures.theRequestedStructureCouldNotBeLoadedOrIsNot')}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button asChild variant="ghost">
							<Link to="/structures">{t('structures.backToStructures')}</Link>
						</Button>
					</CardContent>
				</Card>
			</Container>
		)
	}

	const syncDescription = structureSyncStatusDescription(
		structure.syncStatus,
		structure.syncFailureReason,
		structure.lastSyncedAt
	)
	const assetsSyncStatus = assetSyncStatus(
		structure.includeInStructureAssetSync,
		structure.assetsLastSync
	)
	const assetsSyncDescription = assetSyncStatusDescription(
		structure.includeInStructureAssetSync,
		structure.assetsLastSync
	)
	const reagentBaySyncStatus = snapshotSyncStatus(
		structure.sovereignty?.hub?.reagentBayLastUpdated ?? null
	)
	const reagentBaySyncDescription = t(
		'structures.value1ReagentQuantitiesAndRemainingTimesAreApproximationsCalculatedFrom',
		{
			value1: snapshotSyncStatusDescription(
				'reagent-bay',
				structure.sovereignty?.hub?.reagentBayLastUpdated ?? null
			),
		}
	)

	const handleSave = async () => {
		await updateMutation.mutateAsync({
			hidden,
			lowPowerAllowed,
			assignedGroupId: assignedGroupId || null,
		})
	}

	return (
		<Container className="space-y-6 py-6">
			<PageHeader
				title={
					hasSkyhookSummary
						? t('structures.skyhookDetails')
						: isMoonDrillStructure || hasMiningExtractionSummary
							? stripLeadingContextName(structure.name, structure.systemName)
							: structure.name
				}
				description={
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<div className="inline-flex items-center gap-2">
							<CorporationLogo
								corporationId={structure.corporationId}
								corporationName={structure.corporationName}
								size="sm"
							/>
							<span className="font-semibold text-white">{structure.corporationName}</span>
						</div>
						<span className="text-muted-foreground">·</span>
						<span>{structure.systemName ?? structure.systemId}</span>
					</div>
				}
				action={
					<Button asChild variant="ghost" size="sm">
						<Link to="/structures">
							<ArrowLeft className="h-4 w-4" />
							{t('structures.backToStructures')}
						</Link>
					</Button>
				}
			/>

			<div className="grid grid-flow-row grid-cols-1 gap-4 md:grid-cols-2">
				<div className="contents">
					<Card>
						<CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
							<div className="space-y-1.5">
								<CardTitle>{t('structures.summary')}</CardTitle>
								<CardDescription>
									{t('structures.currentSyncedStateAndOperationalMetadata')}
								</CardDescription>
							</div>
							{isAdmin && (
								<div className="flex items-center gap-3">
									{isAssetsDebugPolling ? (
										<span className="text-xs text-muted-foreground">
											{t('structures.generatingAssetDebugSnapshot')}
										</span>
									) : null}
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											if (isAssetsDebugBusy) return
											void debugAssetsMutation.mutateAsync()
										}}
										loading={isAssetsDebugBusy}
										loadingText={
											isAssetsDebugPolling ? t('structures.generating') : t('structures.queueing')
										}
									>
										<Search className="h-4 w-4" />
										{t('structures.debugAssets')}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											if (isInventoryRebuildBusy) return
											void rebuildInventoryMutation.mutateAsync()
										}}
										loading={isInventoryRebuildBusy}
										loadingText={t('structures.rebuilding')}
									>
										<Recycle className="h-4 w-4" />
										{t('structures.rebuildInventorySnapshot')}
									</Button>
								</div>
							)}
						</CardHeader>
						<CardContent className="space-y-4 text-sm">
							<div className="grid grid-cols-2 gap-4">
								<div>
									<div className="text-muted-foreground">{t('structures.region')}</div>
									<div className="font-medium">
										{structure.regionName ?? structure.regionId ?? '-'}
									</div>
								</div>
								<div>
									<div className="text-muted-foreground">{t('structures.system')}</div>
									<div className="font-medium">{structure.systemName ?? structure.systemId}</div>
								</div>
								<div>
									<div className="text-muted-foreground">
										{hasSovereigntySummary
											? t('structures.controllingAlliance')
											: t('structures.type')}
									</div>
									<div className="font-medium">
										{hasSovereigntySummary ? (
											sovereigntyAllianceId ? (
												<div className="flex items-center gap-2">
													<AllianceLogo
														allianceId={sovereigntyAllianceId}
														allianceName={sovereigntyAllianceName}
													/>
													<span>{sovereigntyAllianceName ?? sovereigntyAllianceId}</span>
												</div>
											) : (
												'-'
											)
										) : (
											(structure.typeName ?? structure.typeId)
										)}
									</div>
								</div>
								{!hasSovereigntySummary && !isSkyhookStructure && !isPosStructure && (
									<div>
										<div className="text-muted-foreground">{t('structures.lowPower')}</div>
										<div className="font-medium">
											{structure.lowPower ? t('structures.yes') : t('structures.no')}
										</div>
									</div>
								)}
								{!hasSovereigntySummary && !isSkyhookStructure && (
									<>
										<div>
											<div className="text-muted-foreground">{t('structures.fuel')}</div>
											<div className="font-medium">
												{structure.fuelAmount !== null ? (
													i18n.t('structures.fuelUnits', {
														value1: structure.fuelAmount.toLocaleString(getActiveLocale()),
													})
												) : structure.fuelExpires ? (
													<DurationDisplay endDate={structure.fuelExpires} format="compact" />
												) : (
													'-'
												)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">{t('structures.lastRefilled')}</div>
											<div className="font-medium">
												{structure.lastRefilledAt ? (
													<EveTimeDisplay dateStr={structure.lastRefilledAt} format="compact" />
												) : (
													'-'
												)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">{t('structures.burnHr')}</div>
											<div className="font-medium">
												{formatBurnRate(
													structure.fuelBurnRate === null
														? null
														: Number.parseFloat(structure.fuelBurnRate)
												)}
											</div>
										</div>
									</>
								)}
								{hasSovereigntySummary && (
									<div>
										<div className="text-muted-foreground">{t('structures.claimedSince')}</div>
										<div className="font-medium">
											{structure.sovereignty?.claimedSince ? (
												<EveTimeDisplay
													dateStr={structure.sovereignty.claimedSince}
													format="compact"
												/>
											) : (
												'-'
											)}
										</div>
									</div>
								)}
								{hasSovereigntySummary && (
									<div>
										<div className="text-muted-foreground">{t('structures.capitalSystem')}</div>
										<div className="font-medium">
											{structure.sovereignty?.isCapitalSystem
												? t('structures.yes')
												: t('structures.no')}
										</div>
									</div>
								)}
								{hasSovereigntySummary && (
									<div>
										<div className="text-muted-foreground">
											{t('structures.activityDefenseMultiplier')}
										</div>
										<div className="font-medium">
											{structure.sovereignty?.activityDefenseMultiplier ?? '-'}
										</div>
									</div>
								)}
								<div>
									<div className="text-muted-foreground">
										{hasSovereigntySummary
											? t('structures.vulnerabilityState')
											: t('structures.state')}
									</div>
									<div className="font-medium">
										{hasSovereigntySummary ? (
											<Badge variant={sovereigntyVulnerabilityState.variant}>
												{sovereigntyVulnerabilityState.label}
											</Badge>
										) : structure.skyhook ? (
											<SkyhookStateBadge state={structure.skyhook.state} />
										) : (
											<StructureStateBadge state={structure.state} />
										)}
									</div>
								</div>
								<div>
									<div className="text-muted-foreground">
										{hasSovereigntySummary ? (
											t('structures.vulnerabilityWindow')
										) : isReinforced ? (
											<Badge variant="destructive">{t('structures.reinforcedUntil')}</Badge>
										) : (
											t('structures.nextState')
										)}
									</div>
									<div className="font-medium">
										{hasSovereigntySummary ? (
											structure.sovereignty?.vulnerabilityWindowStart &&
											structure.sovereignty?.vulnerabilityWindowEnd ? (
												<span className="inline-flex flex-wrap items-center gap-1">
													<EveTimeDisplay
														dateStr={structure.sovereignty.vulnerabilityWindowStart}
														format="window"
														className="whitespace-nowrap"
													/>
													<span>-</span>
													<EveTimeDisplay
														dateStr={structure.sovereignty.vulnerabilityWindowEnd}
														format="window"
														className="whitespace-nowrap"
													/>
												</span>
											) : structure.sovereignty?.vulnerabilityWindowEnd ? (
												<EveTimeDisplay
													dateStr={structure.sovereignty.vulnerabilityWindowEnd}
													format="window"
													className="whitespace-nowrap"
												/>
											) : (
												'-'
											)
										) : structure.nextStateAt ? (
											<EveTimeDisplay dateStr={structure.nextStateAt} format="compact" />
										) : (
											'-'
										)}
									</div>
									{hasSovereigntySummary &&
									(structure.sovereignty?.vulnerabilityWindowStart ||
										structure.sovereignty?.vulnerabilityWindowEnd) ? (
										<div className="mt-1 text-xs text-muted-foreground">
											<LiveSovereigntyVulnerabilityWindow
												vulnerabilityWindowStart={structure.sovereignty?.vulnerabilityWindowStart}
												vulnerabilityWindowEnd={structure.sovereignty?.vulnerabilityWindowEnd}
											/>
										</div>
									) : null}
								</div>
							</div>
							<div className="flex flex-wrap gap-2 pt-2">
								{structure.hidden && <Badge variant="ghost">{t('structures.hidden')}</Badge>}
								{!hasSovereigntySummary &&
									!isSkyhookStructure &&
									!isPosStructure &&
									structure.lowPowerAllowed && (
										<Badge variant="success">{t('structures.lowPowerAlertsSuppressed')}</Badge>
									)}
								{structure.assignedGroupId && (
									<Badge variant="special">{t('structures.groupAssigned')}</Badge>
								)}
							</div>
							<div className="space-y-3">
								{!hasSovereigntySummary && !isSkyhookStructure && !isPosStructure && (
									<div className="space-y-2">
										<div className="text-xs uppercase tracking-wider text-muted-foreground">
											{t('structures.reinforcement')}
										</div>
										<div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
											<div className="grid gap-3">
												<div>
													<div className="text-xs text-muted-foreground">
														{t('structures.reinforcementHour')}
													</div>
													<div className="font-medium">
														{formatReinforcementHourUtc(structure.reinforceHour)}
													</div>
												</div>
												<div>
													<div className="text-xs text-muted-foreground">
														{t('structures.nextReinforcementHour')}
													</div>
													<div className="font-medium">
														{structure.nextReinforceHour !== null
															? formatReinforcementHourUtc(structure.nextReinforceHour)
															: '-'}
													</div>
												</div>
												<div>
													<div className="text-xs text-muted-foreground">
														{t('structures.nextReinforcementApplies')}
													</div>
													<div className="font-medium">
														{structure.nextReinforceApply ? (
															<EveTimeDisplay
																dateStr={structure.nextReinforceApply}
																format="compact"
															/>
														) : (
															'-'
														)}
													</div>
												</div>
											</div>
										</div>
									</div>
								)}
								{!hasSovereigntySummary && !isSkyhookStructure && structureFamily !== 'poses' && (
									<div className="space-y-2">
										<div className="text-xs uppercase tracking-wider text-muted-foreground">
											{t('structures.structureServices')}
										</div>
										{structure.services.length > 0 ? (
											<div className="space-y-1.5">
												{structure.services.map((service) => (
													<div
														key={`${service.name}-${service.state}`}
														className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
													>
														<div className="flex min-w-0 items-center gap-2">
															<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-muted-foreground">
																{renderServiceIcon(service.name)}
															</div>
															<div className="min-w-0">
																<div className="truncate text-sm font-medium">{service.name}</div>
															</div>
														</div>
														<Badge
															variant={serviceBadgeVariant(service.state)}
															className="shrink-0"
														>
															{formatServiceStateLabel(service.state)}
														</Badge>
													</div>
												))}
											</div>
										) : (
											<div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
												{t('structures.noStructureServicesWereReportedForThisStructure')}
											</div>
										)}
									</div>
								)}
								<div className="space-y-2">
									<div className="text-xs uppercase tracking-wider text-muted-foreground">
										{t('structures.syncStatus')}
									</div>
									<div className="rounded-lg border border-border/60 p-4">
										<div className="mb-3 flex flex-wrap items-center gap-2">
											<StructureSyncStatusBadge
												label={t('structures.structure')}
												status={structure.syncStatus}
												description={syncDescription}
											/>
											{!hasSovereigntySummary && (
												<>
													<span aria-hidden className="text-sm text-muted-foreground">
														-
													</span>
													<StructureSyncStatusBadge
														label={t('structures.assets')}
														status={assetsSyncStatus}
														description={assetsSyncDescription}
													/>
												</>
											)}
											{hasSovereigntySummary && structure.sovereignty?.hub && (
												<>
													<span aria-hidden className="text-sm text-muted-foreground">
														-
													</span>
													<StructureSyncStatusBadge
														label={t('structures.reagentBay')}
														status={reagentBaySyncStatus}
														description={reagentBaySyncDescription}
													/>
												</>
											)}
										</div>
										<div className="mt-2 text-sm text-muted-foreground">{syncDescription}</div>
									</div>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t('structures.configuration')}</CardTitle>
							<CardDescription>
								{t(
									'structures.managerLevelSettingsForVisibilityAlertSuppressionAndGroupAssignment'
								)}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-5">
							<div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
								<div>
									<div className="font-medium">{t('structures.hidden')}</div>
									<div className="text-sm text-muted-foreground">
										{t('structures.completelyOmitThisStructureFromNonSensitiveUsers')}
									</div>
								</div>
								<Switch checked={hidden} onCheckedChange={setHidden} />
							</div>
							{!hasSovereigntySummary && !isSkyhookStructure && !isPosStructure && (
								<div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
									<div>
										<div className="font-medium">{t('structures.lowPowerAllowed')}</div>
										<div className="text-sm text-muted-foreground">
											{t('structures.suppressLowPowerAlertsForStructuresWhereThatIsIntentional')}
										</div>
									</div>
									<Switch checked={lowPowerAllowed} onCheckedChange={setLowPowerAllowed} />
								</div>
							)}
							<FilterField label={t('structures.assignedGroup')}>
								<Select
									options={groupOptions}
									value={assignedGroupId}
									onValueChange={(value) => setAssignedGroupId(value)}
									placeholder={t('structures.noGroup')}
								/>
							</FilterField>
							<div className="flex items-center justify-end gap-3 pt-2">
								<Button
									variant="ghost"
									onClick={() => {
										setHidden(structure.hidden)
										if (!hasSovereigntySummary) {
											setLowPowerAllowed(structure.lowPowerAllowed)
										}
										setAssignedGroupId(structure.assignedGroupId ?? '')
									}}
								>
									{t('structures.reset')}
								</Button>
								<Button
									variant="confirm"
									onClick={() => void handleSave()}
									loading={updateMutation.isPending}
								>
									<Save className="h-4 w-4" />
									{t('structures.saveChanges')}
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>

				{hasSovereigntySummary && (
					<div className="contents">
						<Card>
							<CardHeader>
								<CardTitle>{t('structures.hubConfiguration')}</CardTitle>
								<CardDescription>
									{t('structures.workforceTransportRoutingAndTheHubSCurrentResourceAllocation')}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-6 text-sm">
								<div className="grid gap-4 md:grid-cols-2">
									<ResourceAllocationCard
										label={t('structures.powerAllocation')}
										allocated={sovereigntyHub?.resourcePowerAllocated}
										available={sovereigntyHub?.resourcePowerAvailable}
									/>
									<ResourceAllocationCard
										label={t('structures.workforceAllocation')}
										allocated={sovereigntyHub?.resourceWorkforceAllocated}
										available={sovereigntyHub?.resourceWorkforceAvailable}
									/>
								</div>

								<div className="grid gap-4 lg:grid-cols-2">
									<WorkforceTransportSection
										label={t('structures.workforceTransportConfiguration')}
										section={sovereigntyHub?.workforceTransport?.configuration}
										systemLinkById={sovereigntyHubStructureIdBySystemId}
									/>
									<WorkforceTransportSection
										label={t('structures.workforceTransportState')}
										section={sovereigntyHub?.workforceTransport?.state}
										systemLinkById={sovereigntyHubStructureIdBySystemId}
									/>
								</div>
							</CardContent>
						</Card>

						<div className="contents">
							<Card>
								<CardHeader>
									<CardTitle>{t('structures.upgrades')}</CardTitle>
									<CardDescription>
										{t('structures.installedSovereigntyHubUpgradesAndTheirCurrentPowerState')}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-2">
									{sovereigntyHub?.upgrades?.length ? (
										<div className="space-y-1.5">
											{sovereigntyHub.upgrades.map((upgrade) => (
												<div
													key={`${upgrade.typeId}-${upgrade.powerState}`}
													className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
												>
													<div className="flex min-w-0 items-center gap-2">
														<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-muted-foreground">
															<InventoryItemIcon typeId={upgrade.typeId} />
														</div>
														<div className="min-w-0">
															<div className="truncate text-sm font-medium">
																{upgrade.typeName ?? upgrade.typeId}
															</div>
														</div>
													</div>
													<Badge
														variant={
															upgrade.powerState.toLowerCase() === 'online' ? 'success' : 'ghost'
														}
														className="shrink-0"
													>
														{upgrade.powerState}
													</Badge>
												</div>
											))}
										</div>
									) : (
										<div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground">
											{t('structures.noUpgradesReported')}
										</div>
									)}
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle>{t('structures.reagentBay')}</CardTitle>
									<CardDescription>
										{t(
											'structures.currentSovereigntyHubReagentsBurnRatesAndEstimatedRemainingTime'
										)}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="grid gap-4 md:grid-cols-2 text-sm">
										<div>
											<div className="text-muted-foreground">{t('structures.lastUpdated')}</div>
											<div className="font-medium">
												{sovereigntyHub?.reagentBayLastUpdated ? (
													<EveTimeDisplay
														dateStr={sovereigntyHub.reagentBayLastUpdated}
														format="compact"
													/>
												) : (
													'-'
												)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">{t('structures.reagentTypes')}</div>
											<div className="font-medium">
												{sovereigntyHub?.reagentBay?.reagents.length ?? 0}
											</div>
										</div>
									</div>
									{sovereigntyHub?.reagentBay?.reagents.length ? (
										<div className="overflow-hidden rounded-lg border border-border/60 bg-background">
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>{t('structures.reagent')}</TableHead>
														<TableHead>{t('structures.estAmount')}</TableHead>
														<TableHead>{t('structures.burnHr')}</TableHead>
														<TableHead>{t('structures.estRemaining')}</TableHead>
														<TableHead>{t('structures.lastCycle')}</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{sovereigntyHub.reagentBay.reagents.map((reagent) => (
														<TableRow key={reagent.typeId}>
															<TableCell>
																<div className="flex min-w-0 items-center gap-2">
																	<InventoryItemIcon typeId={reagent.typeId} />
																	<span className="truncate font-medium">
																		{reagent.typeName ?? reagent.typeId}
																	</span>
																</div>
															</TableCell>
															<TableCell>
																{formatApproximateNumber(reagent.estimatedAmount ?? reagent.amount)}
															</TableCell>
															<TableCell>{formatNullableNumber(reagent.burningPerHour)}</TableCell>
															<TableCell>
																{reagent.estimatedDepletionAt ? (
																	<DurationDisplay
																		endDate={reagent.estimatedDepletionAt}
																		maxUnits={3}
																		durationStyle="compact"
																		format="compact"
																	/>
																) : (
																	formatEstimatedRemaining(
																		reagent.estimatedAmount ?? reagent.amount,
																		reagent.burningPerHour
																	)
																)}
															</TableCell>
															<TableCell>{formatNullableDateTime(reagent.lastCycle)}</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										</div>
									) : (
										<div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground">
											{t('structures.noReagentDataReported')}
										</div>
									)}
								</CardContent>
							</Card>
						</div>
					</div>
				)}

				{hasSkyhookSummary && (
					<Card>
						<CardHeader>
							<CardTitle>{t('structures.skyhookState')}</CardTitle>
							<CardDescription>
								{t('structures.vulnerabilityStateAndOwnershipContextForThisSkyhook')}
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 md:grid-cols-2 text-sm">
							<div>
								<div className="text-muted-foreground">{t('structures.planet')}</div>
								<div className="font-medium">
									{structure.skyhook?.planetName ?? structure.skyhook?.planetId ?? '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">{t('structures.system')}</div>
								<div className="font-medium">
									{structure.skyhook?.systemName ?? structure.systemName ?? '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">{t('structures.effectiveWorkforce')}</div>
								<div className="font-medium">
									{formatNullableNumber(structure.skyhook?.effectiveWorkforce)}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">{t('structures.state')}</div>
								<div className="font-medium">
									{structure.skyhook ? <SkyhookStateBadge state={structure.skyhook.state} /> : '-'}
								</div>
							</div>
							<div className="md:col-span-2">
								<div className="text-muted-foreground">{t('structures.fullness')}</div>
								<div className="mt-1">
									{structure.skyhook ? (
										<SkyhookFullnessBar
											volumeM3={
												(structure.skyhook.totalSecuredVolumeM3 ?? 0) +
												(structure.skyhook.totalUnsecuredVolumeM3 ?? 0)
											}
											capacityM3={
												(structure.skyhook.securedCapacityM3 ?? 0) +
												(structure.skyhook.unsecuredCapacityM3 ?? 0)
											}
											fillPercent={getSkyhookFullnessPercent(structure.skyhook)}
										/>
									) : (
										'-'
									)}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">{t('structures.theftVulnerability')}</div>
								<div className="font-medium">
									{structure.skyhook ? (
										structure.skyhook.theftVulnerabilityStart &&
										structure.skyhook.theftVulnerabilityEnd ? (
											<span className="inline-flex flex-wrap items-center gap-1">
												<EveTimeDisplay
													dateStr={structure.skyhook.theftVulnerabilityStart}
													format="window"
													className="whitespace-nowrap"
												/>
												<span>-</span>
												<EveTimeDisplay
													dateStr={structure.skyhook.theftVulnerabilityEnd}
													format="window"
													className="whitespace-nowrap"
												/>
											</span>
										) : structure.skyhook.theftVulnerabilityStart ? (
											<EveTimeDisplay
												dateStr={structure.skyhook.theftVulnerabilityStart}
												format="window"
												className="whitespace-nowrap"
											/>
										) : (
											'-'
										)
									) : (
										'-'
									)}
								</div>
							</div>
						</CardContent>
					</Card>
				)}

				{hasSkyhookSummary && (
					<Card>
						<CardHeader>
							<CardTitle>{t('structures.reagents')}</CardTitle>
							<CardDescription>
								{t('structures.skyhookReagentStockBayFullnessAndLastCycleTimestamps')}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid gap-4 md:grid-cols-2 text-sm">
								<div className="rounded-lg border border-border/60 bg-muted/20 p-3">
									<div className="text-muted-foreground">{t('structures.secureBay')}</div>
									<div className="mt-1">
										<SkyhookBayFillCell
											stock={structure.skyhook?.totalSecuredStock ?? 0}
											volumeM3={structure.skyhook?.totalSecuredVolumeM3 ?? 0}
											capacityM3={structure.skyhook?.securedCapacityM3 ?? 0}
											fillPercent={structure.skyhook?.securedFillPercent ?? 0}
										/>
									</div>
								</div>
								<div className="rounded-lg border border-border/60 bg-muted/20 p-3">
									<div className="text-muted-foreground">{t('structures.surplusBay')}</div>
									<div className="mt-1">
										<SkyhookBayFillCell
											stock={structure.skyhook?.totalUnsecuredStock ?? 0}
											volumeM3={structure.skyhook?.totalUnsecuredVolumeM3 ?? 0}
											capacityM3={structure.skyhook?.unsecuredCapacityM3 ?? 0}
											fillPercent={structure.skyhook?.unsecuredFillPercent ?? 0}
										/>
									</div>
								</div>
							</div>
							{!structure.skyhook || structure.skyhook.reagents.length === 0 ? (
								<div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
									{t('structures.noReagentSnapshotIsCurrentlyAvailableForThisSkyhook')}
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t('structures.type')}</TableHead>
											<TableHead>{t('structures.secureBay')}</TableHead>
											<TableHead>{t('structures.surplusBay')}</TableHead>
											<TableHead>{t('structures.lastCycle')}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{structure.skyhook.reagents.map((reagent) => (
											<TableRow key={`${reagent.typeId}-${reagent.lastCycle}`}>
												<TableCell className="font-medium">
													{reagent.typeName ?? reagent.typeId}
												</TableCell>
												<TableCell>
													<SkyhookBayFillCell
														stock={reagent.securedStock}
														volumeM3={reagent.securedVolumeM3}
														capacityM3={reagent.securedCapacityM3}
														fillPercent={reagent.securedFillPercent}
													/>
												</TableCell>
												<TableCell>
													<SkyhookBayFillCell
														stock={reagent.unsecuredStock}
														volumeM3={reagent.unsecuredVolumeM3}
														capacityM3={reagent.unsecuredCapacityM3}
														fillPercent={reagent.unsecuredFillPercent}
													/>
												</TableCell>
												<TableCell>
													<EveTimeDisplay dateStr={reagent.lastCycle} format="compact" />
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				)}

				{(isMoonDrillStructure || hasMiningExtractionSummary) && (
					<div className="contents">
						{isMoonDrillStructure ? (
							<MoonCompositionCard composition={moonComposition} moon={moonDrill} />
						) : null}

						{hasMiningExtractionSummary && (
							<Card>
								<CardHeader>
									<CardTitle>{t('structures.miningExtractions')}</CardTitle>
									<CardDescription>
										{t('structures.recordedExtractionPeriodsForThisStructure')}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4 text-sm">
									{extractionOptions.length > 0 ? (
										<div>
											<div className="mb-1 text-muted-foreground">
												{t('structures.extractionPeriod')}
											</div>
											<Select
												options={extractionOptions}
												value={selectedExtractionId ?? ''}
												onValueChange={(value) => setSelectedExtractionId(value)}
												placeholder={t('structures.selectAnExtractionPeriod')}
											/>
										</div>
									) : null}
									{!selectedExtraction ? (
										<div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-yellow-50">
											{t('structures.noMiningExtractionPeriodIsCurrentlySelectedForThisStructure')}
										</div>
									) : null}
									<div className="grid gap-4 md:grid-cols-2">
										<div>
											<div className="text-muted-foreground">{t('structures.extractionStart')}</div>
											<div className="font-medium">
												{selectedExtraction?.extractionStartTime ? (
													<DurationDisplay
														endDate={selectedExtraction.extractionStartTime}
														maxUnits={3}
														durationStyle="compact"
													/>
												) : (
													'-'
												)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">{t('structures.chunkArrival')}</div>
											<div className="font-medium">
												{selectedExtraction?.chunkArrivalTime ? (
													<DurationDisplay
														endDate={selectedExtraction.chunkArrivalTime}
														maxUnits={3}
														durationStyle="compact"
													/>
												) : (
													'-'
												)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">{t('structures.naturalDecay')}</div>
											<div className="font-medium">
												{selectedExtraction?.naturalDecayTime ? (
													<DurationDisplay
														endDate={selectedExtraction.naturalDecayTime}
														maxUnits={3}
														durationStyle="compact"
													/>
												) : (
													'-'
												)}
											</div>
										</div>
									</div>
								</CardContent>
							</Card>
						)}

						{hasMiningExtractionSummary ? (
							<MoonCompositionCard composition={moonComposition} moon={miningExtraction} />
						) : null}
					</div>
				)}

				<div className="contents">
					{hasStructureFitting ? (
						<Card>
							<CardHeader>
								<CardTitle>{t('structures.fitting')}</CardTitle>
								<CardDescription>
									{t('structures.structureFittingAndStaticSlotLayoutFromTheLatestKnown')}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-6">
								<div className="overflow-x-auto">
									<FittingPanel
										shipTypeId={structure.typeId}
										shipTypeName={structure.typeName ?? structure.name}
										items={fittingItems}
										slotCapacities={fittingSlotCapacities}
										getIconUrl={typeIconUrl}
										getRenderUrl={typeRenderUrl}
									/>
								</div>
								<div className="space-y-3 border-t border-border/60 pt-6">
									<FittingSlotTable
										items={fittingItems}
										getIconUrl={typeIconUrl}
										slotTypes={STRUCTURE_SLOT_TABLE_TYPES}
										slotCapacities={fittingSlotCapacities}
										emptyState={t('structures.noHighMidLowOrRigSlotItemsDetected')}
									/>
								</div>
							</CardContent>
						</Card>
					) : null}

					{structure.inventoryBays && structure.inventoryBays.length > 0 ? (
						<Card>
							<CardHeader>
								<CardTitle>{t('structures.inventory')}</CardTitle>
								<CardDescription>
									{t('structures.aggregatedBayContentsFromTheLatestCorpAssetProjectionFor')}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<InventoryBaysTable
									bays={structure.inventoryBays}
									renderItemIcon={(item) => <InventoryItemIcon typeId={item.typeId} />}
								/>
							</CardContent>
						</Card>
					) : null}
				</div>

				{isAdmin && assetsDebug ? (
					<Card>
						<CardHeader>
							<CardTitle>{t('structures.assetDebug')}</CardTitle>
							<CardDescription>
								{t('structures.rawCorporationAssetsFetchedForThisStructureSOwningCorporation')}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid gap-4 sm:grid-cols-3 text-sm">
								<div>
									<div className="text-muted-foreground">{t('structures.fetchedAt')}</div>
									<div className="font-medium">{formatDateTimeLong(assetsDebug.fetchedAt)}</div>
								</div>
								<div>
									<div className="text-muted-foreground">{t('structures.rawAssetsFetched')}</div>
									<div className="font-medium">
										{assetsDebug.fetchedAssetCount.toLocaleString(getActiveLocale())}
									</div>
								</div>
								<div>
									<div className="text-muted-foreground">{t('structures.matchingRows')}</div>
									<div className="font-medium">
										{assetsDebug.itemCount.toLocaleString(getActiveLocale())}
									</div>
								</div>
							</div>

							{assetsDebug.items.length > 0 ? (
								<div className="overflow-x-auto rounded-lg border border-border/60">
									<Table>
										<TableHeader>
											<TableRow className="bg-muted/40">
												<TableHead>{t('structures.item')}</TableHead>
												<TableHead className="text-right">{t('structures.qty')}</TableHead>
												<TableHead>{t('structures.flag')}</TableHead>
												<TableHead>{t('structures.location')}</TableHead>
												<TableHead className="text-right">{t('structures.singleton')}</TableHead>
												<TableHead>{t('structures.itemId')}</TableHead>
												<TableHead>{t('structures.updated')}</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{assetsDebug.items.map((item) => (
												<TableRow key={item.itemId}>
													<TableCell>
														<div className="flex items-start gap-2">
															<div className="mt-0.5 shrink-0">
																<InventoryItemIcon typeId={item.typeId} />
															</div>
															<div className="min-w-0">
																<div className="font-medium">{item.typeName ?? item.typeId}</div>
																<div className="text-xs text-muted-foreground">{item.typeId}</div>
															</div>
														</div>
													</TableCell>
													<TableCell className="text-right font-mono">
														{item.quantity.toLocaleString(getActiveLocale())}
													</TableCell>
													<TableCell>
														<div className="font-medium">{item.locationFlagLabel}</div>
														<div className="text-xs text-muted-foreground">{item.locationFlag}</div>
													</TableCell>
													<TableCell>{item.locationType}</TableCell>
													<TableCell className="text-right">
														{item.isSingleton ? t('structures.yes') : t('structures.no')}
													</TableCell>
													<TableCell className="font-mono text-xs">{item.itemId}</TableCell>
													<TableCell className="text-xs text-muted-foreground">
														{formatDateTimeLong(item.updatedAt)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									{t('structures.noRawAssetsMatchedThisStructureId')}
								</p>
							)}
						</CardContent>
					</Card>
				) : null}
			</div>
		</Container>
	)
}
