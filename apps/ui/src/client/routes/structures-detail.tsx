import { ArrowLeft, CircleHelp, Factory, Package, Recycle, Save, Search, Store, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import type { BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { FilterField } from '@/components/ui/filter-field'
import { StructureSyncStatusBadge } from '@/components/structure-sync-status-badge'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Select, type SelectOption } from '@/components/ui/select'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { DurationDisplay } from '@/components/ui/duration-display'
import { Switch } from '@/components/ui/switch'
import { StructureStateBadge } from '@/components/structure-state-badge'
import { useApiMutation } from '@/hooks/useApiMutation'
import { useAuth } from '@/hooks/useAuth'
import { useGroups } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useSystemDetails } from '@/hooks/useLocationSearch'
import { InventoryBaysTable } from '@/components/inventory-bays-table'
import { CorporationLogo } from '@/components/corporation-logo'
import { StructureFuelUsageChart } from '@/components/structure-fuel-usage-chart'
import { Skeleton } from '@/components/ui/skeleton'
import { FittingPanel } from '@repo/eve-fitting/fitting-panel'
import { FittingSlotTable } from '@repo/eve-fitting/fitting-slot-table'
import type { FittingDisplayItem, FittingShipSlotType } from '@repo/eve-fitting/flags'
import {
	api,
	type StructureAssetsDebugResult,
	type StructureDetailResult,
	type StructureInventoryBay,
} from '@/lib/api'
import { typeIconUrl, typeImageUrl, typeRenderUrl } from '@/lib/eve-images'
import { formatDateTimeLong } from '@/lib/date-utils'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { hasAnyStructurePermission } from '@repo/groups'
import { isReinforcedStructureState } from '@repo/structures'
import { getStructureTabForTypeId } from '@repo/structures'

function structureSyncStatusDescription(
	syncStatus: StructureDetailResult['syncStatus'],
	syncFailureReason: string | null,
	lastSyncedAt: string | null
) {
	const lastSyncText = lastSyncedAt ? `Last sync at ${formatDateTimeLong(lastSyncedAt)}.` : ''
	const appendWithLastSync = (text: string) => (lastSyncText ? `${lastSyncText} ${text}` : text)

	if (syncFailureReason) {
		return appendWithLastSync(syncFailureReason)
	}

	if (syncStatus === 'ok') {
		return lastSyncedAt
			? `Last successful sync at ${formatDateTimeLong(lastSyncedAt)}.`
			: 'The latest corporation-data sync completed successfully.'
	}

	if (syncStatus === 'warning') {
		return appendWithLastSync(
			'The latest corporation-data sync completed with warnings, so some fields may be incomplete or stale.'
		)
	}

	if (syncStatus === 'error') {
		return appendWithLastSync(
			'The latest corporation-data sync failed, so this snapshot may be stale until the next successful refresh.'
		)
	}

	return lastSyncText || 'The latest corporation-data sync completed successfully and the stored snapshot is current.'
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

function formatBurnRate(value: number | null | undefined): string {
	if (value === null || value === undefined) return '-'
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}/hr`
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type WorkforceTransportSource = {
	solarSystemId: string
	amount: number | null
}

type ParsedWorkforceTransportSection =
	| {
			mode: 'import' | 'export'
			sources: WorkforceTransportSource[]
	  }
	| {
			mode: 'transit'
			sources: []
	  }
	| {
			mode: 'unknown'
			sources: []
	  }

function parseWorkforceTransportSources(value: unknown): WorkforceTransportSource[] {
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
				: typeof entry.amount === 'string' && entry.amount.trim() !== '' && Number.isFinite(Number(entry.amount))
					? Number(entry.amount)
					: null
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
		return { mode: 'unknown', sources: [] }
	}

	if ('import' in section && isRecord(section.import)) {
		return {
			mode: 'import',
			sources: parseWorkforceTransportSources(section.import.sources),
		}
	}

	if ('export' in section && isRecord(section.export)) {
		return {
			mode: 'export',
			sources: parseWorkforceTransportSources(section.export.sources),
		}
	}

	if (section.transit === true) {
		return { mode: 'transit', sources: [] }
	}

	return { mode: 'unknown', sources: [] }
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

function workforceTransportBadgeVariant(mode: ParsedWorkforceTransportSection['mode']): BadgeVariant {
	return mode === 'unknown' ? 'ghost' : 'success'
}

function WorkforceTransportSystemName({ systemId }: { systemId: string }) {
	const { data: systemDetails, isLoading } = useSystemDetails(systemId)

	if (isLoading) {
		return <Skeleton className="h-8 w-32" />
	}

	return (
		<div className="space-y-0.5">
			<div className="font-medium">{systemDetails?.name ?? systemId}</div>
			<div className="text-xs text-muted-foreground">System ID {systemId}</div>
		</div>
	)
}

function WorkforceTransportSection({
	label,
	section,
}: {
	label: string
	section: Record<string, unknown> | null | undefined
}) {
	const parsed = parseWorkforceTransportSection(section)

	return (
		<div className="rounded-lg border border-border/60 bg-muted/20 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="font-medium">{label}</div>
					<div className="text-xs text-muted-foreground">
						{parsed.mode === 'transit'
							? 'This hub is configured for transit routing.'
							: parsed.mode === 'unknown'
								? 'No recognizable workforce transport configuration was recorded.'
								: `This hub is configured for ${formatWorkforceTransportMode(parsed.mode).toLowerCase()} routing.`}
					</div>
				</div>
				<Badge variant={workforceTransportBadgeVariant(parsed.mode)}>
					{formatWorkforceTransportMode(parsed.mode)}
				</Badge>
			</div>

			{parsed.mode !== 'unknown' && parsed.sources.length > 0 ? (
				<div className="mt-4 overflow-hidden rounded-md border border-border/60 bg-background">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Source System</TableHead>
								<TableHead>Amount</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{parsed.sources.map((source) => (
								<TableRow key={`${label}-${source.solarSystemId}`}>
									<TableCell>
										<WorkforceTransportSystemName systemId={source.solarSystemId} />
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
						? 'Transit mode does not list source systems.'
						: 'No source systems recorded.'}
				</div>
			)}
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

function structureFittingItemsToDisplayItems(structure: StructureDetailResult): FittingDisplayItem[] {
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
	const canAccess = canViewStructures && Boolean(structureId)
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

	const isAdmin = user?.is_admin === true

	usePageTitle(structure ? `Structure - ${structure.name}` : 'Structure Details')

	useEffect(() => {
		if (!structure) return
		setHidden(structure.hidden)
		setLowPowerAllowed(structure.lowPowerAllowed)
		setAssignedGroupId(structure.assignedGroupId ?? '')
	}, [structure])

	useEffect(() => {
		setAssetsDebug(null)
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
		mutationFn: (data: { hidden: boolean; lowPowerAllowed: boolean; assignedGroupId: string | null }) =>
			api.updateStructureConfig(structureId!, data),
		successMessage: 'Structure configuration saved.',
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['structures'] }),
				queryClient.invalidateQueries({ queryKey: ['structures', structureId] }),
			])
		},
	})

	const debugAssetsMutation = useApiMutation({
		mutationFn: () => api.fetchStructureAssetsDebug(structureId!),
		successMessage: (result) =>
			`Fetched ${result.fetchedAssetCount.toLocaleString()} raw assets and found ${result.itemCount.toLocaleString()} rows for this structure.`,
		onSuccess: (result) => {
			setAssetsDebug(result)
		},
	})
	const fittingItems = useMemo(() => {
		if (!structure) {
			return []
		}

		return structureFittingItemsToDisplayItems(structure)
	}, [structure])
	const hasStructureFitting = fittingItems.length > 0
	const isReinforced = structure ? isReinforcedStructureState(structure.state) : false

	if (!authLoading && !permissionsLoading && !canViewStructures) {
		return <Navigate to="/dashboard" replace />
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
	const structureFamily = getStructureTabForTypeId(structure.typeId, structure.typeName)
	const hasSovereigntySummary = structureFamily === 'sovereignty' && structure.sovereignty
	const hasSkyhookSummary = structureFamily === 'skyhooks' && structure.skyhook
	const hasMiningSummary = structureFamily === 'mining-citadels'
	type SovereigntyReagent = NonNullable<NonNullable<StructureDetailResult['sovereignty']>['hub']>['reagentBay']['reagents'][number]
	const sovereigntyReagentBays = useMemo<StructureInventoryBay[]>(() => {
		const hub = structure.sovereignty?.hub
		if (!hub) {
			return []
		}

		const totalQuantity = hub.reagentBay.reagents.reduce(
			(accumulator, reagent) => accumulator + reagent.securedStock + reagent.unsecuredStock,
			0
		)

		return [
			{
				locationFlag: 'SovereigntyReagentBay',
				label: 'Reagent Bay',
				totalQuantity,
				totalStacks: hub.reagentBay.reagents.length,
				items: hub.reagentBay.reagents.map((reagent) => ({
					typeId: reagent.typeId,
					typeName: null,
					quantity: reagent.securedStock + reagent.unsecuredStock,
					stackCount: 1,
				})),
			},
		]
	}, [structure.sovereignty?.hub])
	const sovereigntyReagentDetailsByTypeId = useMemo(() => {
		const hub = structure.sovereignty?.hub
		if (!hub) {
			return new Map<string, SovereigntyReagent>()
		}

		return new Map(hub.reagentBay.reagents.map((reagent) => [reagent.typeId, reagent] as const))
	}, [structure.sovereignty?.hub])

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
				title={structure.name}
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
							<Button
								variant="ghost"
								size="sm"
								onClick={() => void debugAssetsMutation.mutateAsync()}
								loading={debugAssetsMutation.isPending}
								loadingText="Fetching..."
							>
								<Search className="h-4 w-4" />
								Debug Assets
							</Button>
						)}
					</CardHeader>
					<CardContent className="space-y-4 text-sm">
						<div className="grid grid-cols-2 gap-4">
							<div>
								<div className="text-muted-foreground">Region</div>
								<div className="font-medium">{structure.regionName ?? structure.regionId ?? '-'}</div>
							</div>
							<div>
								<div className="text-muted-foreground">System</div>
								<div className="font-medium">{structure.systemName ?? structure.systemId}</div>
							</div>
							<div>
								<div className="text-muted-foreground">Type</div>
								<div className="font-medium">{structure.typeName ?? structure.typeId}</div>
							</div>
							<div>
								<div className="text-muted-foreground">Low Power</div>
								<div className="font-medium">{structure.lowPower ? 'Yes' : 'No'}</div>
							</div>
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
							<div>
								<div className="text-muted-foreground">State</div>
								<div className="font-medium">
									<StructureStateBadge state={structure.state} />
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">
									{isReinforced ? 'Reinforced until' : 'Next State'}
								</div>
								<div className="font-medium">
									{structure.nextStateAt ? (
										<EveTimeDisplay dateStr={structure.nextStateAt} format="compact" />
									) : (
										'-'
									)}
								</div>
							</div>
						</div>
						<div className="flex flex-wrap gap-2 pt-2">
							{structure.hidden && <Badge variant="ghost">Hidden</Badge>}
							{structure.lowPowerAllowed && <Badge variant="success">Low Power Alerts Suppressed</Badge>}
							{structure.assignedGroupId && <Badge variant="special">Group Assigned</Badge>}
						</div>
						<div className="space-y-3">
							<div className="space-y-2">
								<div className="text-xs uppercase tracking-wider text-muted-foreground">Reinforcement</div>
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
											<div className="text-xs text-muted-foreground">Next Reinforcement Applies</div>
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
							<div className="space-y-2">
								<div className="text-xs uppercase tracking-wider text-muted-foreground">Sync Status</div>
								<div className="rounded-lg border border-border/60 p-4">
									<div className="mb-3 flex flex-wrap items-center gap-2">
										{structure.includeInStructureAssetSync && (
											<Badge variant="success">Asset Sync Enabled</Badge>
										)}
									<div className="mt-0.5">
										<StructureSyncStatusBadge status={structure.syncStatus} description={syncDescription} />
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
						<div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4">
							<div>
								<div className="font-medium">Low Power Allowed</div>
								<div className="text-sm text-muted-foreground">
									Suppress low-power alerts for structures where that is intentional.
								</div>
							</div>
							<Switch checked={lowPowerAllowed} onCheckedChange={setLowPowerAllowed} />
						</div>
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
									setLowPowerAllowed(structure.lowPowerAllowed)
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
							<CardTitle>Sovereignty State</CardTitle>
							<CardDescription>
								System ownership and the currently linked sovereignty hub snapshot.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 md:grid-cols-2 text-sm">
							<div>
								<div className="text-muted-foreground">Activity Defense Multiplier</div>
								<div className="font-medium">
									{structure.sovereignty?.activityDefenseMultiplier ?? '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Claimed Since</div>
								<div className="font-medium">{formatNullableDateTime(structure.sovereignty?.claimedSince)}</div>
							</div>
							<div>
								<div className="text-muted-foreground">Capital System</div>
								<div className="font-medium">{structure.sovereignty?.isCapitalSystem ? 'Yes' : 'No'}</div>
							</div>
							<div>
								<div className="text-muted-foreground">Sovereignty Hub</div>
								<div className="font-medium">
									{structure.sovereignty?.sovereigntyHubStructureId ?? '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Controller Alliance</div>
								<div className="font-medium">
									{structure.sovereignty?.hub?.controllerAllianceId ?? '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Vulnerability Window</div>
								<div className="font-medium">
									{structure.sovereignty?.vulnerabilityWindowStart &&
									structure.sovereignty?.vulnerabilityWindowEnd
										? `${formatDateTimeLong(structure.sovereignty.vulnerabilityWindowStart)} - ${formatDateTimeLong(structure.sovereignty.vulnerabilityWindowEnd)}`
										: formatNullableDateTime(structure.sovereignty?.vulnerabilityWindowEnd)}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">System Resources</div>
								<div className="font-medium">
									{structure.sovereignty?.hub
										? `${formatNullableNumber(structure.sovereignty.hub.resourcePowerAllocated)} / ${formatNullableNumber(structure.sovereignty.hub.resourcePowerAvailable)} power, ${formatNullableNumber(structure.sovereignty.hub.resourceWorkforceAllocated)} / ${formatNullableNumber(structure.sovereignty.hub.resourceWorkforceAvailable)} workforce`
										: '-'}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground">Fuel Access List</div>
								<div className="font-medium">
									{structure.sovereignty?.hub?.fuelAccessListId ?? '-'}
								</div>
							</div>
						</CardContent>
					</Card>

						<Card>
							<CardHeader>
								<CardTitle>Hub Configuration</CardTitle>
								<CardDescription>
									Workforce transport routing and the hub's current resource allocation.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-6 text-sm">
								<div className="grid gap-4 lg:grid-cols-2">
									<WorkforceTransportSection
										label="Workforce Transport Configuration"
										section={structure.sovereignty?.hub?.workforceTransport?.configuration}
									/>
									<WorkforceTransportSection
										label="Workforce Transport State"
										section={structure.sovereignty?.hub?.workforceTransport?.state}
									/>
								</div>

								<div className="grid gap-4 md:grid-cols-2">
									<div className="rounded-lg border border-border/60 bg-muted/20 p-4">
										<div className="text-xs uppercase tracking-wide text-muted-foreground">Power Allocation</div>
										<div className="mt-2 grid grid-cols-2 gap-4">
											<div>
												<div className="text-muted-foreground">Allocated</div>
												<div className="font-medium">
													{formatNullableNumber(structure.sovereignty?.hub?.resourcePowerAllocated)}
												</div>
											</div>
											<div>
												<div className="text-muted-foreground">Available</div>
												<div className="font-medium">
													{formatNullableNumber(structure.sovereignty?.hub?.resourcePowerAvailable)}
												</div>
											</div>
										</div>
									</div>

									<div className="rounded-lg border border-border/60 bg-muted/20 p-4">
										<div className="text-xs uppercase tracking-wide text-muted-foreground">Workforce Allocation</div>
										<div className="mt-2 grid grid-cols-2 gap-4">
											<div>
												<div className="text-muted-foreground">Allocated</div>
												<div className="font-medium">
													{formatNullableNumber(structure.sovereignty?.hub?.resourceWorkforceAllocated)}
												</div>
											</div>
											<div>
												<div className="text-muted-foreground">Available</div>
												<div className="font-medium">
													{formatNullableNumber(structure.sovereignty?.hub?.resourceWorkforceAvailable)}
												</div>
											</div>
										</div>
									</div>
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<CardTitle>Reagent Bay</CardTitle>
								<CardDescription>
									Current reagent bay contents and resource totals for the sovereignty hub.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="grid gap-4 md:grid-cols-3 text-sm">
									<div>
										<div className="text-muted-foreground">Last Updated</div>
									<div className="font-medium">
										{formatNullableDateTime(structure.sovereignty?.hub?.reagentBayLastUpdated)}
									</div>
								</div>
								<div>
									<div className="text-muted-foreground">Reagent Count</div>
									<div className="font-medium">{structure.sovereignty?.hub?.reagentCount ?? 0}</div>
								</div>
								<div>
									<div className="text-muted-foreground">Stock Totals</div>
										<div className="font-medium">
											{structure.sovereignty?.hub
												? `${formatNullableNumber(structure.sovereignty.hub.totalSecuredStock)} secured, ${formatNullableNumber(structure.sovereignty.hub.totalUnsecuredStock)} unsecured`
												: '-'}
										</div>
									</div>
								</div>
								<InventoryBaysTable
									bays={sovereigntyReagentBays}
									emptyLabel="No reagents reported."
									searchPlaceholder="Search reagent bay..."
									renderItemIcon={(item) => <InventoryItemIcon typeId={item.typeId} />}
									renderItemDetails={(item) => {
										const reagent = sovereigntyReagentDetailsByTypeId.get(item.typeId)
										if (!reagent) {
											return null
										}

										return (
											<span>
												Secured {formatNullableNumber(reagent.securedStock)} · Unsecured{' '}
												{formatNullableNumber(reagent.unsecuredStock)} · Last cycle{' '}
												{formatNullableDateTime(reagent.lastCycle)}
											</span>
										)
									}}
								/>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
							<CardTitle>Upgrades</CardTitle>
							<CardDescription>
								Installed sovereignty hub upgrades and their current power state.
							</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
									{structure.sovereignty?.hub?.upgrades.length ? (
										structure.sovereignty.hub.upgrades.map((upgrade) => (
											<Card key={`${upgrade.typeId}-${upgrade.powerState}`} className="border-border/60 bg-muted/20">
												<CardContent className="space-y-3 p-4">
													<div className="flex items-start justify-between gap-3">
														<div className="space-y-1">
															<div className="text-xs uppercase tracking-wide text-muted-foreground">
																Installed Upgrade
															</div>
															<div className="font-medium">{upgrade.typeId}</div>
														</div>
														<Badge
															variant={upgrade.powerState.toLowerCase() === 'online' ? 'success' : 'ghost'}
														>
															{upgrade.powerState}
														</Badge>
													</div>
													<div className="text-sm text-muted-foreground">
														Sovereignty hub upgrade slot currently reporting this state.
													</div>
												</CardContent>
											</Card>
										))
									) : (
										<div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground">
											No upgrades reported.
										</div>
									)}
								</div>
							</CardContent>
						</Card>
				</div>
			)}

			{hasSkyhookSummary && (
				<Card>
					<CardHeader>
						<CardTitle>Skyhook State</CardTitle>
						<CardDescription>Raidability and inventory state for this skyhook.</CardDescription>
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
							<div className="font-medium">{formatNullableNumber(structure.skyhook?.effectiveWorkforce)}</div>
						</div>
						<div>
							<div className="text-muted-foreground">Raidable</div>
							<div className="font-medium">{structure.skyhook?.isRaidable ? 'Yes' : 'No'}</div>
						</div>
						<div>
							<div className="text-muted-foreground">Active</div>
							<div className="font-medium">{structure.skyhook?.isActive ? 'Yes' : 'No'}</div>
						</div>
						<div>
							<div className="text-muted-foreground">Theft Vulnerability</div>
							<div className="font-medium">
								{structure.skyhook?.theftVulnerabilityStart && structure.skyhook?.theftVulnerabilityEnd
									? `${formatDateTimeLong(structure.skyhook.theftVulnerabilityStart)} - ${formatDateTimeLong(structure.skyhook.theftVulnerabilityEnd)}`
									: formatNullableDateTime(structure.skyhook?.vulnerableAt)}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">Reinforcement Timer</div>
							<div className="font-medium">
								{formatNullableDateTime(structure.skyhook?.reinforcementTimerEnd)}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">Reagents</div>
							<div className="font-medium">
								{structure.skyhook
									? `${structure.skyhook.totalReagents} reagents, ${formatNullableNumber(structure.skyhook.totalSecuredStock)} secured, ${formatNullableNumber(structure.skyhook.totalUnsecuredStock)} unsecured`
									: '-'}
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{hasMiningSummary && (
				<Card>
					<CardHeader>
						<CardTitle>Mining Extraction</CardTitle>
						<CardDescription>Last known moon extraction snapshot for this structure.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 text-sm">
						{!structure.mining ? (
							<div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-yellow-50">
								Mining extraction snapshot has not been ingested yet for this structure.
							</div>
						) : null}
						<div className="grid gap-4 md:grid-cols-2">
						<div>
							<div className="text-muted-foreground">Moon</div>
							<div className="font-medium">
								{structure.mining?.moonName ?? structure.mining?.moonId ?? '-'}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">Planet</div>
							<div className="font-medium">
								{structure.mining?.planetName ?? structure.mining?.planetId ?? '-'}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">System</div>
							<div className="font-medium">
								{structure.mining?.systemName ?? structure.mining?.systemId ?? '-'}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">Extraction Start</div>
							<div className="font-medium">
								{formatNullableDateTime(structure.mining?.extractionStartTime)}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">Chunk Arrival</div>
							<div className="font-medium">
								{formatNullableDateTime(structure.mining?.chunkArrivalTime)}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground">Natural Decay</div>
							<div className="font-medium">
								{formatNullableDateTime(structure.mining?.naturalDecayTime)}
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
							<CardDescription>
								Structure fitting from the latest known snapshot.
							</CardDescription>
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
										High, mid, low, and rig slot fittings from the latest structure asset snapshot, with
										loaded charges and scripts shown beneath their parent modules.
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
							<div className="font-medium">{formatBurnRate(structure.fuelUsage?.fuelBurnRatePerHour)}</div>
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

			{isAdmin && assetsDebug && assetsDebug.items.length > 0 ? (
				<Card>
					<CardHeader>
						<CardTitle>Asset Debug</CardTitle>
						<CardDescription>
							Raw corporation assets fetched for this structure&apos;s owning corporation and filtered to
							this structure ID. This is a direct asset snapshot, not the grouped inventory view.
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
												<TableCell className="text-right font-mono">{item.quantity.toLocaleString()}</TableCell>
												<TableCell>
													<div className="font-medium">{item.locationFlagLabel}</div>
													<div className="text-xs text-muted-foreground">{item.locationFlag}</div>
												</TableCell>
												<TableCell>{item.locationType}</TableCell>
												<TableCell className="text-right">{item.isSingleton ? 'Yes' : 'No'}</TableCell>
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
