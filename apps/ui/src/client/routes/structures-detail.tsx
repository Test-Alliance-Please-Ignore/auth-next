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
import { Link, Navigate, useParams } from 'react-router-dom'

import { FittingPanel } from '@repo/eve-fitting/fitting-panel'
import { FittingSlotTable } from '@repo/eve-fitting/fitting-slot-table'
import { hasAnyStructurePermission, hasStructureDetailsPermission } from '@repo/groups'
import {
	getStructureTabForTypeId,
	isReinforcedStructureState,
	type StructureSovereigntyTransportSection,
	STRUCTURE_SYNC_ERROR_STALE_MS,
	STRUCTURE_SYNC_WARNING_STALE_MS,
} from '@repo/structures'

import { CorporationLogo } from '@/components/corporation-logo'
import { StructureFuelUsageChart } from '@/components/structure-fuel-usage-chart'
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
import { InventoryBaysTable } from '@/components/inventory-bays-table'
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
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { api } from '@/lib/api'
import { formatDateTimeLong } from '@/lib/date-utils'
import { formatDurationMs } from '@/lib/duration-utils'
import { allianceLogoUrl, typeIconUrl, typeImageUrl, typeRenderUrl } from '@/lib/eve-images'
import { stripLeadingContextName } from '@/lib/structure-name-utils'
import toast from '@/lib/toast'

import type { FittingDisplayItem, FittingShipSlotType } from '@repo/eve-fitting/flags'
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
			return 'This snapshot is more than 24 hours old and should be treated as stale.'
		}
		if (ageMs >= STRUCTURE_SYNC_WARNING_STALE_MS) {
			return 'This snapshot is more than 12 hours old and may be stale.'
		}
		return null
	}

	if (syncFailureReason) {
		return lastSyncedAt
			? `Last sync at ${formatDateTimeLong(lastSyncedAt)}. ${syncFailureReason}`
			: syncFailureReason
	}

	if (syncStatus === 'ok') {
		return lastSyncedAt
			? `Last successful sync at ${formatDateTimeLong(lastSyncedAt)}.`
			: 'The latest corporation-data sync completed successfully.'
	}

	if (syncStatus === 'warning') {
		const stalenessNote = getStalenessNote()
		return lastSyncedAt
			? `Last sync at ${formatDateTimeLong(lastSyncedAt)}. ${stalenessNote ?? 'The latest corporation-data sync completed with warnings, so some fields may be incomplete or stale.'}`
			: 'The latest corporation-data sync completed with warnings, so some fields may be incomplete or stale.'
	}

	if (syncStatus === 'error') {
		const stalenessNote = getStalenessNote()
		return lastSyncedAt
			? `Last sync at ${formatDateTimeLong(lastSyncedAt)}. ${stalenessNote ?? 'The latest corporation-data sync failed, so this snapshot may be stale until the next successful refresh.'}`
			: 'The latest corporation-data sync failed, so this snapshot may be stale until the next successful refresh.'
	}

	return lastSyncedAt
		? `Last sync at ${formatDateTimeLong(lastSyncedAt)}. The latest corporation-data sync completed successfully and the stored snapshot is current.`
		: 'The latest corporation-data sync completed successfully and the stored snapshot is current.'
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
	return `~${hour.toString().padStart(2, '0')}:00 EVE Time`
}

function formatNullableDateTime(value: string | null | undefined): string {
	return value ? formatDateTimeLong(value) : '-'
}

function formatNullableNumber(value: number | null | undefined): string {
	if (value === null || value === undefined) return '-'
	return value.toLocaleString()
}

function formatEstimatedRemaining(amount: number | null | undefined, burningPerHour: number | null | undefined): string {
	const amountValue = toFiniteNumber(amount)
	const burnRate = toFiniteNumber(burningPerHour)

	if (amount === null || amount === undefined || burningPerHour === null || burningPerHour === undefined) {
		return '-'
	}

	if (burnRate <= 0) {
		return amountValue > 0 ? 'Not burning' : '0s'
	}

	const remainingMs = (amountValue / burnRate) * 60 * 60 * 1000
	return formatDurationMs(remainingMs, { style: 'compact', maxUnits: 2 })
}

function getSovereigntyVulnerabilityState(
	sovereignty: StructureDetailResult['sovereignty'] | null | undefined
): { label: string; variant: BadgeVariant } {
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

function toFiniteNumber(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

function formatBurnRate(value: number | null | undefined): string {
	if (value === null || value === undefined) return '-'
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}/hr`
}

function formatVolumeM3(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return '-'
	}
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} m3`
}

function formatPercent(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return '-'
	}
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
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
	return (
		<div className="space-y-1.5">
			<div className="font-medium tabular-nums">
				{formatVolumeM3(volumeM3)} / {formatVolumeM3(capacityM3)}
			</div>
			<Progress value={Math.min(100, Math.max(0, fillPercent))} className="h-2 bg-muted/30" />
			<div className="text-xs text-muted-foreground">{formatPercent(fillPercent)} full</div>
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
	return (
		<div className="space-y-1.5">
			<div className="font-medium tabular-nums">{stock.toLocaleString()}</div>
			<div className="text-xs text-muted-foreground">
				{formatVolumeM3(volumeM3)} / {formatVolumeM3(capacityM3)}
			</div>
			<Progress value={Math.min(100, Math.max(0, fillPercent))} className="h-2 bg-muted/30" />
			<div className="text-xs text-muted-foreground">{formatPercent(fillPercent)} full</div>
		</div>
	)
}

function AllianceLogo({ allianceId, allianceName }: { allianceId: string; allianceName?: string | null }) {
	const [failed, setFailed] = useState(false)

	if (failed) {
		return <Shield className="h-4 w-4 text-muted-foreground" />
	}

	return (
		<img
			src={allianceLogoUrl(allianceId, 32)}
			alt={allianceName ? `${allianceName} logo` : 'Alliance logo'}
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

function parseWorkforceTransportSystems(value: unknown, defaultAmount: number | null = null): WorkforceTransportEntry[] {
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
			return 'Import'
		case 'export':
			return 'Export'
		case 'transit':
			return 'Transit'
		default:
			return 'Unrecognized'
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
					systemDetails?.name ?? systemId
				)}
			</div>
			<div className="text-xs text-muted-foreground">System ID {systemId}</div>
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
								<TableHead>System</TableHead>
								<TableHead>Amount</TableHead>
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
						? 'Transit mode does not list systems.'
						: 'No systems recorded.'}
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
	const { structureId } = useParams<{ structureId: string }>()
	const queryClient = useQueryClient()
	const { user, isLoading: authLoading } = useAuth()
	const { permissions, isLoading: permissionsLoading } = useUserPermissions()
	const canViewStructures = user?.is_admin === true || hasAnyStructurePermission(permissions)
	const canViewStructureDetails = user?.is_admin === true || hasStructureDetailsPermission(permissions)
	const canAccess = canViewStructureDetails && Boolean(structureId)
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
			? `Structure - ${
					getStructureTabForTypeId(structure.typeId, structure.typeName) === 'skyhooks'
						? 'Skyhook Details'
						: structure.name
				}`
			: 'Structure Details'
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
			{ value: '', label: 'No Group' },
			...groups
				.slice()
				.sort((left, right) => left.name.localeCompare(right.name))
				.map((group) => ({ value: group.id, label: group.name })),
		]
	}, [groups])

	const updateMutation = useApiMutation({
		mutationFn: (data: {
			hidden: boolean
			lowPowerAllowed: boolean
			assignedGroupId: string | null
		}) => api.updateStructureConfig(structureId!, data),
		successMessage: 'Structure configuration saved.',
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
			toast.success(
				`Rebuilt the structure inventory snapshot with ${result.inventoryCount.toLocaleString()} row${result.inventoryCount === 1 ? '' : 's'}.`
			)
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['structures'] }),
				queryClient.invalidateQueries({ queryKey: ['structures', structureId] }),
			])
		},
	})

	const assetsDebugStatusQuery = useQuery({
		queryKey: ['structures', structureId, 'assets-debug', pendingAssetsDebug?.workflowInstanceId ?? null],
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
						`Fetched ${result.fetchedAssetCount.toLocaleString()} raw assets and found ${result.itemCount.toLocaleString()} rows for this structure.`
					)
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: 'Failed to download structure assets debug data'
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
			toast.error('Failed to generate structure assets debug data.')
			setPendingAssetsDebug(null)
		}
	}, [assetsDebugStatusQuery.data, pendingAssetsDebug, structureId])
	const fittingItems = useMemo(() => {
		if (!structure) {
			return []
		}

		return structureFittingItemsToDisplayItems(structure)
	}, [structure])
	const hasStructureFitting = fittingItems.length > 0
	const isReinforced = structure ? isReinforcedStructureState(structure.state) : false
	const structureFamily = structure ? getStructureTabForTypeId(structure.typeId, structure.typeName) : null
	const corporationId = structure?.corporationId ?? ''
	const hasSovereigntySummary = structureFamily === 'sovereignty' && Boolean(structure?.sovereignty)
	const hasSkyhookSummary = structureFamily === 'skyhooks' && Boolean(structure?.skyhook)
	const isSkyhookStructure = structureFamily === 'skyhooks'
	const hasMoonDrillSummary = structureFamily === 'moon-drills' && Boolean(structure?.moonDrill)
	const hasMiningExtractionSummary =
		structureFamily === 'mining-citadels' && Boolean(structure?.miningExtraction)
	const moonDrill = structure?.moonDrill ?? null
	const miningExtraction = structure?.miningExtraction ?? null
	const sovereigntyHub = structure?.sovereignty?.hub ?? null
	const sovereigntyAllianceId = structure?.sovereignty?.allianceId ?? null
	const sovereigntyAllianceName = structure?.sovereignty?.allianceName ?? null
	const sovereigntyVulnerabilityState = getSovereigntyVulnerabilityState(structure?.sovereignty)
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
	}, [sovereigntyStructures])
	if (!authLoading && !permissionsLoading && !canViewStructures) {
		return <Navigate to="/dashboard" replace />
	}

	if (!authLoading && !permissionsLoading && canViewStructures && !canViewStructureDetails) {
		return <Navigate to="/structures" replace />
	}

	if (!structureId) {
		return <Navigate to="/structures" replace />
	}

	if (isLoading) {
		return <LoadingPage label="Loading structure..." />
	}

	if (error || !structure) {
		return (
			<Container className="py-6">
				<Card>
					<CardHeader>
						<CardTitle>Structure not found</CardTitle>
						<CardDescription>
							The requested structure could not be loaded or is not visible to your permissions.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button asChild variant="ghost">
							<Link to="/structures">Back to Structures</Link>
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
						? 'Skyhook Details'
						: hasMoonDrillSummary || hasMiningExtractionSummary
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
							Back to Structures
						</Link>
					</Button>
				}
			/>

			<div className="grid gap-4 md:grid-cols-2">
				<Card>
					<CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-1.5">
							<CardTitle>Summary</CardTitle>
							<CardDescription>Current synced state and operational metadata.</CardDescription>
						</div>
						{isAdmin && (
							<div className="flex items-center gap-3">
								{isAssetsDebugPolling ? (
									<span className="text-xs text-muted-foreground">
										Generating asset debug snapshot...
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
										loadingText={isAssetsDebugPolling ? 'Generating...' : 'Queueing...'}
									>
										<Search className="h-4 w-4" />
										Debug Assets
									</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										if (isInventoryRebuildBusy) return
										void rebuildInventoryMutation.mutateAsync()
									}}
									loading={isInventoryRebuildBusy}
									loadingText="Rebuilding..."
								>
									<Recycle className="h-4 w-4" />
									Rebuild Inventory Snapshot
								</Button>
							</div>
						)}
					</CardHeader>
						<CardContent className="space-y-4 text-sm">
							<div className="grid grid-cols-2 gap-4">
								<div>
									<div className="text-muted-foreground">Region</div>
									<div className="font-medium">
										{structure.regionName ?? structure.regionId ?? '-'}
									</div>
								</div>
								<div>
									<div className="text-muted-foreground">System</div>
									<div className="font-medium">{structure.systemName ?? structure.systemId}</div>
								</div>
								<div>
									<div className="text-muted-foreground">
										{hasSovereigntySummary ? 'Controlling Alliance' : 'Type'}
									</div>
									<div className="font-medium">
										{hasSovereigntySummary
											? sovereigntyAllianceId ? (
													<div className="flex items-center gap-2">
														<AllianceLogo
															allianceId={sovereigntyAllianceId}
															allianceName={sovereigntyAllianceName}
														/>
														<span>
															{sovereigntyAllianceName ?? sovereigntyAllianceId}
														</span>
													</div>
												) : (
													'-'
												)
											: structure.typeName ?? structure.typeId}
									</div>
								</div>
								{!hasSovereigntySummary && !isSkyhookStructure && (
									<div>
										<div className="text-muted-foreground">Low Power</div>
										<div className="font-medium">{structure.lowPower ? 'Yes' : 'No'}</div>
									</div>
								)}
								{!hasSovereigntySummary && !isSkyhookStructure && (
									<>
										<div>
											<div className="text-muted-foreground">Fuel</div>
											<div className="font-medium">
												{structure.fuelAmount !== null ? (
													`${structure.fuelAmount.toLocaleString()} units`
												) : structure.fuelExpires ? (
													<DurationDisplay endDate={structure.fuelExpires} format="compact" />
												) : (
													'-'
												)}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">Last Refilled</div>
											<div className="font-medium">
												{structure.lastRefilledAt ? (
													<EveTimeDisplay dateStr={structure.lastRefilledAt} format="compact" />
												) : (
													'-'
												)}
											</div>
										</div>
									</>
								)}
								{hasSovereigntySummary && (
									<div>
										<div className="text-muted-foreground">Claimed Since</div>
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
										<div className="text-muted-foreground">Capital System</div>
										<div className="font-medium">
											{structure.sovereignty?.isCapitalSystem ? 'Yes' : 'No'}
										</div>
									</div>
								)}
								{hasSovereigntySummary && (
									<div>
										<div className="text-muted-foreground">Activity Defense Multiplier</div>
										<div className="font-medium">
											{structure.sovereignty?.activityDefenseMultiplier ?? '-'}
										</div>
									</div>
								)}
								<div>
									<div className="text-muted-foreground">
										{hasSovereigntySummary ? 'Vulnerability State' : 'State'}
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
											'Theft Window'
										) : isReinforced ? (
											<Badge variant="destructive">Reinforced until</Badge>
										) : (
											'Next State'
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
								</div>
							</div>
							<div className="flex flex-wrap gap-2 pt-2">
								{structure.hidden && <Badge variant="ghost">Hidden</Badge>}
								{!hasSovereigntySummary && !isSkyhookStructure && structure.lowPowerAllowed && (
									<Badge variant="success">Low Power Alerts Suppressed</Badge>
								)}
								{structure.assignedGroupId && <Badge variant="special">Group Assigned</Badge>}
							</div>
								<div className="space-y-3">
								{!hasSovereigntySummary && !isSkyhookStructure && (
									<div className="space-y-2">
										<div className="text-xs uppercase tracking-wider text-muted-foreground">
											Reinforcement
											</div>
											<div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
												<div className="grid gap-3">
													<div>
														<div className="text-xs text-muted-foreground">Reinforcement Hour</div>
														<div className="font-medium">
															{formatReinforcementHourUtc(structure.reinforceHour)}
														</div>
													</div>
													<div>
														<div className="text-xs text-muted-foreground">Next Reinforcement Hour</div>
														<div className="font-medium">
															{structure.nextReinforceHour !== null
																? formatReinforcementHourUtc(structure.nextReinforceHour)
																: '-'}
														</div>
													</div>
													<div>
														<div className="text-xs text-muted-foreground">
															Next Reinforcement Applies
														</div>
														<div className="font-medium">
															{structure.nextReinforceApply ? (
																<EveTimeDisplay dateStr={structure.nextReinforceApply} format="compact" />
															) : (
																'-'
															)}
														</div>
													</div>
												</div>
										</div>
									</div>
								)}
								{!hasSovereigntySummary && !isSkyhookStructure && (
									<div className="space-y-2">
										<div className="text-xs uppercase tracking-wider text-muted-foreground">
											Structure Services
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
														<Badge variant={serviceBadgeVariant(service.state)} className="shrink-0">
															{formatServiceStateLabel(service.state)}
														</Badge>
													</div>
												))}
											</div>
										) : (
											<div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
												No structure services were reported for this structure.
											</div>
										)}
									</div>
								)}
								<div className="space-y-2">
									<div className="text-xs uppercase tracking-wider text-muted-foreground">
										Sync Status
									</div>
									<div className="rounded-lg border border-border/60 p-4">
										<div className="mb-3 flex flex-wrap items-center gap-2">
											{!hasSovereigntySummary && structure.includeInStructureAssetSync && (
												<Badge variant="success">Asset Sync Enabled</Badge>
											)}
											<div className="mt-0.5">
												<StructureSyncStatusBadge
													status={structure.syncStatus}
													description={syncDescription}
												/>
											</div>
										</div>
										<div className="mt-2 text-sm text-muted-foreground">{syncDescription}</div>
									</div>
								</div>
							</div>
						</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Configuration</CardTitle>
						<CardDescription>
							Manager-level settings for visibility, alert suppression, and group assignment.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
							<div>
								<div className="font-medium">Hidden</div>
								<div className="text-sm text-muted-foreground">
									Completely omit this structure from non-sensitive users.
								</div>
							</div>
							<Switch checked={hidden} onCheckedChange={setHidden} />
						</div>
						{!hasSovereigntySummary && !isSkyhookStructure && (
							<div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
								<div>
									<div className="font-medium">Low Power Allowed</div>
									<div className="text-sm text-muted-foreground">
										Suppress low-power alerts for structures where that is intentional.
									</div>
								</div>
								<Switch checked={lowPowerAllowed} onCheckedChange={setLowPowerAllowed} />
							</div>
						)}
						<FilterField label="Assigned Group">
							<Select
								options={groupOptions}
								value={assignedGroupId}
								onValueChange={(value) => setAssignedGroupId(value)}
								placeholder="No Group"
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
								Reset
							</Button>
							<Button
								variant="confirm"
								onClick={() => void handleSave()}
								loading={updateMutation.isPending}
							>
								<Save className="h-4 w-4" />
								Save Changes
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>

			{hasSovereigntySummary && (
				<div className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Hub Configuration</CardTitle>
							<CardDescription>
								Workforce transport routing and the hub's current resource allocation.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6 text-sm">
							<div className="grid gap-4 md:grid-cols-2">
								<ResourceAllocationCard
									label="Power Allocation"
									allocated={sovereigntyHub?.resourcePowerAllocated}
									available={sovereigntyHub?.resourcePowerAvailable}
								/>
								<ResourceAllocationCard
									label="Workforce Allocation"
									allocated={sovereigntyHub?.resourceWorkforceAllocated}
									available={sovereigntyHub?.resourceWorkforceAvailable}
								/>
							</div>

							<div className="grid gap-4 lg:grid-cols-2">
								<WorkforceTransportSection
									label="Workforce Transport Configuration"
									section={sovereigntyHub?.workforceTransport?.configuration}
									systemLinkById={sovereigntyHubStructureIdBySystemId}
								/>
								<WorkforceTransportSection
									label="Workforce Transport State"
									section={sovereigntyHub?.workforceTransport?.state}
									systemLinkById={sovereigntyHubStructureIdBySystemId}
								/>
							</div>
						</CardContent>
					</Card>

					<div className="grid gap-4 lg:grid-cols-2">
						<Card>
							<CardHeader>
								<CardTitle>Upgrades</CardTitle>
								<CardDescription>
									Installed sovereignty hub upgrades and their current power state.
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
													variant={upgrade.powerState.toLowerCase() === 'online' ? 'success' : 'ghost'}
													className="shrink-0"
												>
													{upgrade.powerState}
												</Badge>
											</div>
										))}
									</div>
								) : (
									<div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground">
										No upgrades reported.
									</div>
								)}
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>Reagent Bay</CardTitle>
								<CardDescription>
									Current sovereignty hub reagents, burn rates, and estimated remaining time.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="grid gap-4 md:grid-cols-2 text-sm">
						<div>
							<div className="text-muted-foreground">Last Updated</div>
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
										<div className="text-muted-foreground">Reagent Types</div>
										<div className="font-medium">{sovereigntyHub?.reagentBay?.reagents.length ?? 0}</div>
									</div>
								</div>
								{sovereigntyHub?.reagentBay?.reagents.length ? (
									<div className="overflow-hidden rounded-lg border border-border/60 bg-background">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Reagent</TableHead>
													<TableHead>Amount</TableHead>
													<TableHead>Burn / Hr</TableHead>
													<TableHead>Est. Remaining</TableHead>
													<TableHead>Last Cycle</TableHead>
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
														<TableCell>{formatNullableNumber(reagent.amount)}</TableCell>
														<TableCell>{formatNullableNumber(reagent.burningPerHour)}</TableCell>
														<TableCell>{formatEstimatedRemaining(reagent.amount, reagent.burningPerHour)}</TableCell>
														<TableCell>{formatNullableDateTime(reagent.lastCycle)}</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
								) : (
									<div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground">
										No reagent data reported.
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
						<CardTitle>Skyhook State</CardTitle>
						<CardDescription>Vulnerability state and ownership context for this skyhook.</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4 md:grid-cols-2 text-sm">
						<div>
							<div className="text-muted-foreground">Planet</div>
							<div className="font-medium">
								{structure.skyhook?.planetName ?? structure.skyhook?.planetId ?? '-'}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">System</div>
							<div className="font-medium">
								{structure.skyhook?.systemName ?? structure.systemName ?? '-'}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">Effective Workforce</div>
							<div className="font-medium">
								{formatNullableNumber(structure.skyhook?.effectiveWorkforce)}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">State</div>
							<div className="font-medium">
								{structure.skyhook ? (
									<SkyhookStateBadge state={structure.skyhook.state} />
								) : (
									'-'
								)}
							</div>
						</div>
						<div className="md:col-span-2">
							<div className="text-muted-foreground">Fullness</div>
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
							<div className="text-muted-foreground">Theft Vulnerability</div>
							<div className="font-medium">
								{structure.skyhook
									? structure.skyhook.theftVulnerabilityStart &&
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
										) : structure.skyhook.vulnerableAt ? (
											<EveTimeDisplay
												dateStr={structure.skyhook.vulnerableAt}
												format="window"
												className="whitespace-nowrap"
											/>
										) : (
											'-'
										)
									: '-'}
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{hasSkyhookSummary && (
				<Card>
					<CardHeader>
						<CardTitle>Reagents</CardTitle>
						<CardDescription>Skyhook reagent stock, bay fullness, and last cycle timestamps.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-4 md:grid-cols-2 text-sm">
							<div className="rounded-lg border border-border/60 bg-muted/20 p-3">
								<div className="text-muted-foreground">Secure Bay</div>
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
								<div className="text-muted-foreground">Surplus Bay</div>
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
								No reagent snapshot is currently available for this skyhook.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Type</TableHead>
										<TableHead>Secure Bay</TableHead>
										<TableHead>Surplus Bay</TableHead>
										<TableHead>Last Cycle</TableHead>
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

			{hasMoonDrillSummary && (
				<Card>
					<CardHeader>
						<CardTitle>Moon Drill</CardTitle>
						<CardDescription>Moon association resolved from the latest snapshot.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 text-sm">
						{!moonDrill ? (
							<div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-yellow-50">
								Moon drill snapshot has not been ingested yet for this structure.
							</div>
						) : null}
						<div className="grid gap-4 md:grid-cols-2">
							<div>
								<div className="text-muted-foreground">Moon</div>
								<div className="font-medium">
									{stripLeadingContextName(
										moonDrill?.moonName ?? moonDrill?.moonId,
										moonDrill?.planetName
									)}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Planet</div>
								<div className="font-medium">
									{moonDrill?.planetName ?? moonDrill?.planetId ?? '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">System</div>
								<div className="font-medium">
									{moonDrill?.systemName ?? moonDrill?.systemId ?? '-'}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{hasMiningExtractionSummary && (
				<Card>
					<CardHeader>
						<CardTitle>Mining Citadel</CardTitle>
						<CardDescription>Last known moon extraction snapshot for this structure.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 text-sm">
						{!miningExtraction ? (
							<div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-yellow-50">
								Mining extraction snapshot has not been ingested yet for this structure.
							</div>
						) : null}
						<div className="grid gap-4 md:grid-cols-2">
							<div>
								<div className="text-muted-foreground">Moon</div>
								<div className="font-medium">
									{stripLeadingContextName(
										miningExtraction?.moonName ?? miningExtraction?.moonId,
										miningExtraction?.planetName
									)}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Planet</div>
								<div className="font-medium">
									{miningExtraction?.planetName ?? miningExtraction?.planetId ?? '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">System</div>
								<div className="font-medium">
									{miningExtraction?.systemName ?? miningExtraction?.systemId ?? '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Extraction Start</div>
								<div className="font-medium">
									{formatNullableDateTime(miningExtraction?.extractionStartTime)}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Chunk Arrival</div>
								<div className="font-medium">
									{formatNullableDateTime(miningExtraction?.chunkArrivalTime)}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Natural Decay</div>
								<div className="font-medium">
									{formatNullableDateTime(miningExtraction?.naturalDecayTime)}
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			<div className="grid gap-4 md:grid-cols-2">
				{hasStructureFitting ? (
					<Card>
						<CardHeader>
							<CardTitle>Fitting</CardTitle>
							<CardDescription>Structure fitting from the latest known snapshot.</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<div className="overflow-x-auto">
								<FittingPanel
									shipTypeId={structure.typeId}
									shipTypeName={structure.typeName ?? structure.name}
									items={fittingItems}
									getIconUrl={typeIconUrl}
									getRenderUrl={typeRenderUrl}
								/>
							</div>
							<div className="space-y-3 border-t border-border/60 pt-6">
								<div>
									<div className="text-sm font-medium">Slot Layout</div>
									<div className="text-sm text-muted-foreground">
										High, mid, low, and rig slot fittings from the latest structure asset snapshot,
										with loaded charges and scripts shown beneath their parent modules.
									</div>
								</div>
								<FittingSlotTable
									items={fittingItems}
									getIconUrl={typeIconUrl}
									slotTypes={STRUCTURE_SLOT_TABLE_TYPES}
									emptyState="No high, mid, low, or rig slot items detected."
								/>
							</div>
						</CardContent>
					</Card>
				) : null}

				{structure.inventoryBays && structure.inventoryBays.length > 0 ? (
					<Card>
						<CardHeader>
							<CardTitle>Inventory</CardTitle>
							<CardDescription>
								Aggregated bay contents from the latest corp asset projection for this structure.
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

				{!hasSovereigntySummary && !isSkyhookStructure && (
					<Card>
						<CardHeader>
							<CardTitle>Fuel Usage</CardTitle>
							<CardDescription>
								Hourly fuel block count and burn rate over the last 7 days.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-5">
							<div className="grid gap-4 md:grid-cols-3 text-sm">
								<div>
									<div className="text-muted-foreground">Current Burn Rate</div>
									<div className="font-medium">
										{formatBurnRate(structure.fuelUsage?.fuelBurnRatePerHour)}
									</div>
								</div>
								<div>
									<div className="text-muted-foreground">Hourly Samples</div>
									<div className="font-medium">{structure.fuelUsage?.sampleCount ?? 0}</div>
								</div>
								<div>
									<div className="text-muted-foreground">Last Refilled</div>
									<div className="font-medium">
										{formatNullableDateTime(structure.fuelUsage?.lastRefilledAt)}
									</div>
								</div>
							</div>
							<StructureFuelUsageChart points={structure.fuelUsage?.points ?? []} />
						</CardContent>
					</Card>
				)}

			{isAdmin && assetsDebug ? (
				<Card>
					<CardHeader>
						<CardTitle>Asset Debug</CardTitle>
						<CardDescription>
							Raw corporation assets fetched for this structure&apos;s owning corporation and
							filtered to this structure ID. This is a direct asset snapshot, not the grouped
							inventory view.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-4 sm:grid-cols-3 text-sm">
							<div>
								<div className="text-muted-foreground">Fetched At</div>
								<div className="font-medium">{formatDateTimeLong(assetsDebug.fetchedAt)}</div>
							</div>
							<div>
								<div className="text-muted-foreground">Raw Assets Fetched</div>
								<div className="font-medium">{assetsDebug.fetchedAssetCount.toLocaleString()}</div>
							</div>
							<div>
								<div className="text-muted-foreground">Matching Rows</div>
								<div className="font-medium">{assetsDebug.itemCount.toLocaleString()}</div>
							</div>
						</div>

						{assetsDebug.items.length > 0 ? (
							<div className="overflow-x-auto rounded-lg border border-border/60">
								<Table>
									<TableHeader>
										<TableRow className="bg-muted/40">
											<TableHead>Item</TableHead>
											<TableHead className="text-right">Qty</TableHead>
											<TableHead>Flag</TableHead>
											<TableHead>Location</TableHead>
											<TableHead className="text-right">Singleton</TableHead>
											<TableHead>Item ID</TableHead>
											<TableHead>Updated</TableHead>
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
													{item.quantity.toLocaleString()}
												</TableCell>
												<TableCell>
													<div className="font-medium">{item.locationFlagLabel}</div>
													<div className="text-xs text-muted-foreground">{item.locationFlag}</div>
												</TableCell>
												<TableCell>{item.locationType}</TableCell>
												<TableCell className="text-right">
													{item.isSingleton ? 'Yes' : 'No'}
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
								No raw assets matched this structure ID.
							</p>
						)}
					</CardContent>
				</Card>
			) : null}
		</Container>
	)
}
