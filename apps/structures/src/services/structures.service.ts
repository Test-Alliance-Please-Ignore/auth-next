import { managedCorporations } from '@repo/core-db-schema'
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import {
	corporationStructureInventory,
	corporationStructures,
	structureFuelLog,
} from '@repo/eve-corporation-data-db-schema'
import { parseFittingSlotFlag } from '@repo/eve-fitting/flags'
import {
	parseStructurePermissionUrn,
	STRUCTURE_PERMISSION_ROLES,
	STRUCTURE_PERMISSION_SCOPE_ALL,
} from '@repo/groups'
import { logger } from '@repo/hono-helpers'
import { summarizeInventoryRows } from '@repo/inventory-display'
import {
	METENOX_MOON_DRILL_TYPE_NAME,
	MINING_CITADEL_TYPE_NAMES,
	MOON_DRILL_STRUCTURE_TYPE_IDS,
	NAVIGATION_STRUCTURE_TYPE_IDS,
	SKYHOOK_STRUCTURE_TYPE_IDS,
	SOVEREIGNTY_STRUCTURE_TYPE_IDS,
	STRUCTURE_REINFORCED_STATES,
	SKYHOOK_SECURED_BAY_CAPACITY_M3,
	SKYHOOK_SURPLUS_BAY_CAPACITY_M3,
	SKYHOOK_MAGMATIC_GAS_TYPE_ID,
	SKYHOOK_MAGMATIC_GAS_TYPE_NAME,
	SKYHOOK_SUPERIONIC_ICE_TYPE_ID,
	SKYHOOK_SUPERIONIC_ICE_TYPE_NAME,
	getSkyhookFullness,
	getSkyhookReagentEntries,
	getSkyhookReagentSummary,
	getSkyhookReagentUnitVolumeM3,
	getSovereigntyReagentBayReagents,
	getSovereigntyReagentBaySummary,
	getStructureTabForTypeId,
	isReinforcedStructureState,
	STRUCTURE_SYNC_ERROR_STALE_MS,
	STRUCTURE_SYNC_WARNING_STALE_MS,
} from '@repo/structures'
import {
	structureMoonDrills,
	structureMoonGeographies,
	structureMiningExtractions,
	structureSkyhooks,
	structureSovereigntyHubs,
	structureSovereigntySystems,
} from '@repo/structures-db-schema'

import {
	structureConfigs,
	structureCorporationGroupDefaults,
	structureGroupAlertConfigs,
	structureGroupSettings,
	structureModuleConfig,
	structureStateEvents,
} from '../db/schema'
import { buildStructureFuelUsageHistory } from './structure-fuel-history'
import {
	buildSkyhookStructureSummary,
} from './skyhook-summary'

import type { DbClient } from '@repo/db-utils'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { InventoryDisplayBay } from '@repo/inventory-display'
import type {
	StructureIdentity,
	StructureConfig,
	StructureSyncState,
	StructureCitadelListQuery,
	StructureMoonDrillListQuery,
	StructureMiningCitadelListQuery,
	StructureMiningCitadelListItem as RepoStructureMiningCitadelListItem,
	StructureMiningCitadelListResponse as RepoStructureMiningCitadelListResponse,
	StructureNavigationListQuery,
	StructureOverviewMetrics,
	StructureSovereigntyListFilterOptions as RepoStructureSovereigntyListFilterOptions,
	StructureSovereigntyListItem as RepoStructureSovereigntyListItem,
	StructureSovereigntyListResponse as RepoStructureSovereigntyListResponse,
	StructureSovereigntyListSummary as RepoStructureSovereigntyListSummary,
	StructureSovereigntyReagent,
	StructureSovereigntyTransportState,
	StructureMoonDrillListItem as RepoStructureMoonDrillListItem,
	StructureMoonDrillListResponse as RepoStructureMoonDrillListResponse,
	StructureMoonDrillSummary as RepoStructureMoonDrillSummary,
	StructureMiningCitadelSummary as RepoStructureMiningCitadelSummary,
	StructureSkyhookListItem as RepoStructureSkyhookListItem,
	StructureSkyhookListResponse as RepoStructureSkyhookListResponse,
	StructureSkyhookListQuery,
	StructureSovereigntyListQuery,
	StructureTab,
} from '@repo/structures'
import type { Env, SessionUser } from '../context'
import type { DbSchema } from '../db'
import type {
	StructureFuelHistorySample,
	StructureFuelUsageHistory,
} from './structure-fuel-history'

type StructureFilterableItemBase = StructureIdentity &
	StructureSyncState &
	StructureConfig & {
		state: string
		typeId: string
		typeName: string | null
		planetId?: string | null
		planetName?: string | null
		nextStateAt: string | null
		fuelExpires?: string | null
		fuelAmount?: number | null
		lowPower: boolean
	}

type StructureSovereigntyFilterableItem = RepoStructureSovereigntyListItem
type StructureSkyhookFilterableItem = RepoStructureSkyhookListItem
type StructureMoonDrillFilterableItem = RepoStructureMoonDrillListItem
type StructureMiningCitadelFilterableItem = RepoStructureMiningCitadelListItem

const HOURS_TO_MS = 60 * 60 * 1000
const STRUCTURE_LIST_PAGE_SIZE_MAX = 100

type SkyhookStateLabel = 'invulnerable' | 'vulnerable' | 'reinforced'

function getSkyhookState(
	state: string,
	isRaidable: boolean,
	reinforcementTimerEnd: string | null
): SkyhookStateLabel {
	const normalized = state.trim().toLowerCase()
	if (reinforcementTimerEnd !== null || normalized.includes('reinforce')) {
		return 'reinforced'
	}
	if (isRaidable || normalized.includes('vulnerable')) {
		return 'vulnerable'
	}
	return 'invulnerable'
}

function isSkyhookCurrentlyRaidable(
	structure:
		| Pick<typeof structureSkyhooks.$inferSelect, 'theftVulnerabilityStart' | 'theftVulnerabilityEnd'>
		| null
		| undefined
): boolean {
	if (!structure) {
		return false
	}

	const raidableStart = structure.theftVulnerabilityStart ?? null
	if (!raidableStart) {
		return false
	}

	const now = Date.now()
	const raidableEnd = structure.theftVulnerabilityEnd?.getTime() ?? null
	if (raidableEnd !== null && now > raidableEnd) {
		return false
	}

	return raidableEnd === null
		? now > raidableStart.getTime()
		: now > raidableStart.getTime() && now < raidableEnd
}

function getSkyhookVulnerabilityWindowStart(
	structure: Pick<StructureSkyhookFilterableItem, 'theftVulnerabilityStart'>
): string | null {
	return structure.theftVulnerabilityStart ?? null
}

export type StructureListSortField =
	| 'updatedAt'
	| 'nextStateAt'
	| 'fuel'
	| 'activityDefenseMultiplier'
	| 'magmaticGasEstimatedDepletionAt'
	| 'superionicIceEstimatedDepletionAt'
	| 'theftVulnerabilityStart'
	| 'skyhookSecureFullness'
	| 'skyhookSurplusFullness'
	| 'raidable'
	| 'workforce'
	| 'group'
	| 'syncStatus'
	| 'name'
	| 'corporation'
	| 'region'
	| 'planet'
	| 'system'
	| 'type'
	| 'state'
export type StructureListSortDirection = 'asc' | 'desc'

export interface StructureListFilterOptionsEntry {
	value: string
	label: string
}

export interface StructureListFilterOptions {
	corporations: StructureListFilterOptionsEntry[]
	regions: StructureListFilterOptionsEntry[]
	systems: StructureListFilterOptionsEntry[]
	states: StructureListFilterOptionsEntry[]
	vulnerabilityStates?: StructureListFilterOptionsEntry[]
	types: StructureListFilterOptionsEntry[]
	assignedGroups: StructureListFilterOptionsEntry[]
	alliances: StructureListFilterOptionsEntry[]
	planets: StructureListFilterOptionsEntry[]
	raidableStates: StructureListFilterOptionsEntry[]
}

export interface StructureListSummary {
	total: number
	lowFuel: number
	lowPower: number
	reinforced: number
	estimatedFuelBurnRatePerHour: string | null
	fuelBurnRateSampleCount: number
	skyhookHighestFillPercent?: number | null
	skyhookNextRaidableAt?: string | null
	skyhookNextRaidablePlanetName?: string | null
	skyhookCurrentRaidableCount?: number | null
	skyhookTotalWorkforce?: number | null
}

export type StructureListQuery = StructureCitadelListQuery

export interface StructureListResponse<TItem = StructureListItem> {
	items: TItem[]
	pagination: {
		page: number
		pageSize: number
		totalCount: number
		totalPages: number
		hasNextPage: boolean
		hasPreviousPage: boolean
	}
	filterOptions: StructureListFilterOptions
	summary: StructureListSummary
}

interface StructurePermissionAccessTarget {
	viewAll: boolean
	detailsAll: boolean
	sensitiveAll: boolean
	managerAll: boolean
	viewCorporationIds: Set<string>
	detailsCorporationIds: Set<string>
	sensitiveCorporationIds: Set<string>
	managerCorporationIds: Set<string>
}

interface StructureAccessScope {
	all: StructurePermissionAccessTarget
	tabs: Record<StructureTab, StructurePermissionAccessTarget>
}

type SovereigntyVulnerabilityState = 'vulnerable' | 'invulnerable' | 'reinforced' | 'unknown'

export interface StructureListItem {
	structureId: string
	corporationId: string
	corporationName: string
	name: string
	typeId: string
	typeName: string | null
	systemId: string
	systemName: string | null
	regionId: string | null
	regionName: string | null
	state: string
	nextStateAt: string | null
	fuelExpires: string | null
	fuelAmount: number | null
	lowPower: boolean
	hidden: boolean
	lowPowerAllowed: boolean
	assignedGroupId: string | null
	syncStatus: 'ok' | 'warning' | 'error'
	syncFailureReason: string | null
	lastSyncedAt: string | null
	estimatedFuelBurnRatePerHour?: string | null
	updatedAt: string
	canViewDetails: boolean
}

export interface StructureNavigationListItem extends StructureListItem {
	navigationType: StructureTab
}

export interface StructureSovereigntyHubSummary {
	controllerAllianceId: string | null
	controllerAllianceName?: string | null
	reagentBayLastUpdated: string | null
	reagentCount: number
	magmaticGasQuantity: number
	magmaticGasBurningPerHour: number
	magmaticGasEstimatedDepletionAt: string | null
	superionicIceQuantity: number
	superionicIceBurningPerHour: number
	superionicIceEstimatedDepletionAt: string | null
	reagentBay: {
		lastUpdated: string
		reagents: StructureSovereigntyReagent[]
	}
	resources: {
		power: {
			allocated: number
			available: number
		}
		workforce: {
			allocated: number
			available: number
		}
	}
	upgrades: Array<{
		typeId: string
		typeName?: string | null
		powerState: string
	}>
	workforceTransport: StructureSovereigntyTransportState
	resourcePowerAllocated: number
	resourcePowerAvailable: number
	resourceWorkforceAllocated: number
	resourceWorkforceAvailable: number
	upgradeCount: number
	vulnerabilityWindowStart: string | null
	vulnerabilityWindowEnd: string | null
}

export interface StructureSovereigntySummary {
	claimType: 'alliance' | 'faction' | 'unclaimed'
	allianceId: string | null
	allianceName?: string | null
	corporationClaimantId: string | null
	factionId: string | null
	claimedSince: string | null
	sovereigntyHubStructureId: string | null
	isCapitalSystem: boolean | null
	vulnerabilityWindowStart: string | null
	vulnerabilityWindowEnd: string | null
	activityDefenseMultiplier: string | null
	militaryLevel: number | null
	industrialLevel: number | null
	strategicLevel: number | null
	hub: StructureSovereigntyHubSummary | null
}

export interface StructureSkyhookSummary {
	planetId: string | null
	planetName: string | null
	systemId: string | null
	systemName: string | null
	state: string
	isActive: boolean
	effectiveWorkforce: number | null
	totalReagents: number
	totalSecuredStock: number
	totalUnsecuredStock: number
	totalSecuredVolumeM3: number
	totalUnsecuredVolumeM3: number
	securedCapacityM3: number
	unsecuredCapacityM3: number
	securedFillPercent: number
	unsecuredFillPercent: number
	reagents: Array<{
		typeId: string
		typeName: string | null
		unitVolumeM3: number
		securedStock: number
		unsecuredStock: number
		securedVolumeM3: number
		unsecuredVolumeM3: number
		securedCapacityM3: number
		unsecuredCapacityM3: number
		securedFillPercent: number
		unsecuredFillPercent: number
		lastCycle: string
	}>
	reinforcementTimerEnd: string | null
	theftVulnerabilityStart: string | null
	theftVulnerabilityEnd: string | null
	isRaidable: boolean
}

export interface StructureMoonDrillSummary {
	moonId: string
	moonName: string | null
	planetId: string | null
	planetName: string | null
	systemId: string
	systemName: string | null
}

export interface StructureMiningCitadelSummary {
	moonId: string
	moonName: string | null
	planetId: string | null
	planetName: string | null
	systemId: string
	systemName: string | null
	extractionStartTime: string | null
	chunkArrivalTime: string | null
	naturalDecayTime: string | null
}

export type StructureInventoryItemSummary = InventoryDisplayBay['items'][number]
export type StructureInventoryBaySummary = InventoryDisplayBay

export interface StructureFittingItemSummary {
	locationFlag: string
	slotIndex: number
	flagName: 'High Slot' | 'Mid Slot' | 'Low Slot' | 'Rig Slot' | 'Subsystem Slot'
	typeId: string
	typeName: string | null
	quantity: number
}

interface StructureTabData {
	sovereignty?: StructureSovereigntySummary | null
	skyhook?: StructureSkyhookSummary | null
	moonDrill?: StructureMoonDrillSummary | null
	miningExtraction?: StructureMiningCitadelSummary | null
	inventoryBays?: StructureInventoryBaySummary[]
}

export interface StructureDetailResult extends Omit<StructureListItem, 'canViewDetails'> {
	includeInStructureAssetSync: boolean
	canViewSensitive: boolean
	canEdit: boolean
	services: Array<{
		name: string
		state: string
	}>
	stateTimerStart: string | null
	stateTimerEnd: string | null
	unanchorsAt: string | null
	nextReinforceApply: string | null
	nextReinforceHour: number | null
	reinforceHour: number | null
	lastRefilledAt: string | null
	fuelBurnRate: string | null
	fuelUsage: {
		points: Array<{
			observedAt: string
			fuelBlockUnits: number | null
			fuelBurnRatePerHour: number | null
		}>
		lastRefilledAt: string | null
		sampleCount: number
	} | null
	sovereignty?: StructureSovereigntySummary | null
	skyhook?: StructureSkyhookSummary | null
	moonDrill?: StructureMoonDrillSummary | null
	miningExtraction?: StructureMiningCitadelSummary | null
	inventoryBays?: StructureInventoryBaySummary[]
	fittingItems?: StructureFittingItemSummary[]
}

export interface UpdateStructureConfigInput {
	hidden?: boolean
	lowPowerAllowed?: boolean
	assignedGroupId?: string | null
	updatedBy?: string | null
}

export interface StructureModuleConfigResult {
	id: string
	lowFuelTimeThresholdHours: number
	criticalFuelTimeThresholdHours: number
	lowFuelAmountThreshold: number
	criticalFuelAmountThreshold: number
	updatedBy: string | null
	createdAt: Date
	updatedAt: Date
}

export interface UpdateStructureModuleConfigInput {
	lowFuelTimeThresholdHours?: number
	criticalFuelTimeThresholdHours?: number
	lowFuelAmountThreshold?: number
	criticalFuelAmountThreshold?: number
	updatedBy?: string | null
}

export interface UpsertStructureGroupSettingInput {
	groupId: string
	updatedBy?: string | null
}

export interface DeleteStructureGroupSettingInput {
	groupId: string
}

export interface UpsertStructureCorporationDefaultInput {
	corporationId: string
	groupId: string | null
	updatedBy?: string | null
}

export interface UpsertStructureGroupAlertConfigInput {
	id?: string
	groupId: string
	alertType: string
	destinationIds: string[]
	config: Record<string, unknown>
	isEnabled: boolean
}

const STRUCTURE_ACCESS_TABS: StructureTab[] = [
	'citadels',
	'navigation',
	'sovereignty',
	'skyhooks',
	'moon-drills',
	'mining-citadels',
]

function createStructurePermissionAccessTarget(): StructurePermissionAccessTarget {
	return {
		viewAll: false,
		detailsAll: false,
		sensitiveAll: false,
		managerAll: false,
		viewCorporationIds: new Set<string>(),
		detailsCorporationIds: new Set<string>(),
		sensitiveCorporationIds: new Set<string>(),
		managerCorporationIds: new Set<string>(),
	}
}

function addParsedStructurePermissionToTarget(
	target: StructurePermissionAccessTarget,
	parsed: NonNullable<ReturnType<typeof parseStructurePermissionUrn>>
): void {
	if (parsed.scope === STRUCTURE_PERMISSION_SCOPE_ALL) {
		target.viewAll = true
		if (parsed.role === 'details' || parsed.role === 'sensitive' || parsed.role === 'manager') {
			target.detailsAll = true
		}
		if (parsed.role === 'sensitive' || parsed.role === 'manager') {
			target.sensitiveAll = true
		}
		if (parsed.role === 'manager') {
			target.managerAll = true
		}
		return
	}

	if (!parsed.corporationId) {
		return
	}

	target.viewCorporationIds.add(parsed.corporationId)
	if (parsed.role === 'details' || parsed.role === 'sensitive' || parsed.role === 'manager') {
		target.detailsCorporationIds.add(parsed.corporationId)
	}
	if (parsed.role === 'sensitive' || parsed.role === 'manager') {
		target.sensitiveCorporationIds.add(parsed.corporationId)
	}
	if (parsed.role === 'manager') {
		target.managerCorporationIds.add(parsed.corporationId)
	}
}

function buildStructureAccessTargetSummary(
	access: StructurePermissionAccessTarget,
	corporationId: string
): {
	canView: boolean
	canViewDetails: boolean
	canViewSensitive: boolean
	canEdit: boolean
} {
	const canView =
		access.viewAll ||
		access.detailsAll ||
		access.sensitiveAll ||
		access.managerAll ||
		access.viewCorporationIds.has(corporationId) ||
		access.detailsCorporationIds.has(corporationId) ||
		access.sensitiveCorporationIds.has(corporationId) ||
		access.managerCorporationIds.has(corporationId)
	const canViewDetails =
		access.detailsAll ||
		access.sensitiveAll ||
		access.managerAll ||
		access.detailsCorporationIds.has(corporationId) ||
		access.sensitiveCorporationIds.has(corporationId) ||
		access.managerCorporationIds.has(corporationId)
	const canViewSensitive =
		access.sensitiveAll ||
		access.managerAll ||
		access.sensitiveCorporationIds.has(corporationId) ||
		access.managerCorporationIds.has(corporationId)
	const canEdit = access.managerAll || access.managerCorporationIds.has(corporationId)

	return {
		canView,
		canViewDetails,
		canViewSensitive,
		canEdit,
	}
}

function getStructureAccessTarget(
	access: StructureAccessScope,
	tab: StructureTab
): StructurePermissionAccessTarget {
	return {
		viewAll: access.all.viewAll || access.tabs[tab].viewAll,
		detailsAll: access.all.detailsAll || access.tabs[tab].detailsAll,
		sensitiveAll: access.all.sensitiveAll || access.tabs[tab].sensitiveAll,
		managerAll: access.all.managerAll || access.tabs[tab].managerAll,
		viewCorporationIds: new Set([
			...access.all.viewCorporationIds,
			...access.tabs[tab].viewCorporationIds,
		]),
		detailsCorporationIds: new Set([
			...access.all.detailsCorporationIds,
			...access.tabs[tab].detailsCorporationIds,
		]),
		sensitiveCorporationIds: new Set([
			...access.all.sensitiveCorporationIds,
			...access.tabs[tab].sensitiveCorporationIds,
		]),
		managerCorporationIds: new Set([
			...access.all.managerCorporationIds,
			...access.tabs[tab].managerCorporationIds,
		]),
	}
}

function hasAnyStructureAccess(target: StructurePermissionAccessTarget): boolean {
	return (
		target.viewAll ||
		target.detailsAll ||
		target.sensitiveAll ||
		target.managerAll ||
		target.viewCorporationIds.size > 0 ||
		target.detailsCorporationIds.size > 0 ||
		target.sensitiveCorporationIds.size > 0 ||
		target.managerCorporationIds.size > 0
	)
}

function hasStructureAccessForTab(
	access: StructureAccessScope,
	corporationId: string,
	tab: StructureTab
): boolean {
	const target = getStructureAccessTarget(access, tab)
	return buildStructureAccessTargetSummary(target, corporationId).canView
}

function canViewDetailsStructure(
	access: StructureAccessScope,
	corporationId: string,
	tab: StructureTab
): boolean {
	const target = getStructureAccessTarget(access, tab)
	return buildStructureAccessTargetSummary(target, corporationId).canViewDetails
}

function canViewSensitiveStructure(
	access: StructureAccessScope,
	corporationId: string,
	tab: StructureTab
): boolean {
	const target = getStructureAccessTarget(access, tab)
	return buildStructureAccessTargetSummary(target, corporationId).canViewSensitive
}

function canEditStructure(
	access: StructureAccessScope,
	corporationId: string,
	tab: StructureTab
): boolean {
	const target = getStructureAccessTarget(access, tab)
	return buildStructureAccessTargetSummary(target, corporationId).canEdit
}

function getAccessibleCorporationIds(
	access: StructureAccessScope,
	tab?: StructureTab
): { hasGlobalAccess: boolean; corporationIds: Set<string> } {
	const targets = tab
		? [access.all, access.tabs[tab]]
		: [access.all, ...STRUCTURE_ACCESS_TABS.map((entry) => access.tabs[entry])]
	const corporationIds = new Set<string>()
	let hasGlobalAccess = false

	for (const target of targets) {
		if (target.viewAll) {
			hasGlobalAccess = true
		}
		for (const corporationId of target.viewCorporationIds) {
			corporationIds.add(corporationId)
		}
		for (const corporationId of target.detailsCorporationIds) {
			corporationIds.add(corporationId)
		}
		for (const corporationId of target.sensitiveCorporationIds) {
			corporationIds.add(corporationId)
		}
		for (const corporationId of target.managerCorporationIds) {
			corporationIds.add(corporationId)
		}
	}

	return { hasGlobalAccess, corporationIds }
}

function computeStructureAccess(roles: string[], isAdmin: boolean): StructureAccessScope {
	if (isAdmin) {
		return {
			all: {
				viewAll: true,
				detailsAll: true,
				sensitiveAll: true,
				managerAll: true,
				viewCorporationIds: new Set<string>(),
				detailsCorporationIds: new Set<string>(),
				sensitiveCorporationIds: new Set<string>(),
				managerCorporationIds: new Set<string>(),
			},
			tabs: Object.fromEntries(
				STRUCTURE_ACCESS_TABS.map((tab) => [
					tab,
					{
						viewAll: true,
						detailsAll: true,
						sensitiveAll: true,
						managerAll: true,
						viewCorporationIds: new Set<string>(),
						detailsCorporationIds: new Set<string>(),
						sensitiveCorporationIds: new Set<string>(),
						managerCorporationIds: new Set<string>(),
					},
				])
			) as Record<StructureTab, StructurePermissionAccessTarget>,
		}
	}

	const all = createStructurePermissionAccessTarget()
	const tabs = Object.fromEntries(
		STRUCTURE_ACCESS_TABS.map((tab) => [tab, createStructurePermissionAccessTarget()])
	) as Record<StructureTab, StructurePermissionAccessTarget>

	for (const roleUrn of roles) {
		const parsed = parseStructurePermissionUrn(roleUrn)
		if (!parsed) continue
		if (parsed.tab === 'all') {
			addParsedStructurePermissionToTarget(all, parsed)
		} else {
			addParsedStructurePermissionToTarget(tabs[parsed.tab], parsed)
		}
	}

	return {
		all,
		tabs,
	}
}

export function canManageStructureModule(user: SessionUser): boolean {
	const access = computeStructureAccess(user.roles, user.is_admin)
	return user.is_admin || access.all.managerAll
}

function toIso(value: Date | null | undefined): string | null {
	return value ? value.toISOString() : null
}

function compareNullableStrings(
	left: string | null | undefined,
	right: string | null | undefined
): number {
	const normalizedLeft = left ?? ''
	const normalizedRight = right ?? ''
	return normalizedLeft.localeCompare(normalizedRight)
}

function compareNullableDates(
	left: string | number | null | undefined,
	right: string | number | null | undefined
): number {
	if (!left && !right) return 0
	if (!left) return 1
	if (!right) return -1
	const leftTime = typeof left === 'number' ? left : new Date(left).getTime()
	const rightTime = typeof right === 'number' ? right : new Date(right).getTime()
	return leftTime - rightTime
}

function compareNullableNumbers(
	left: number | null | undefined,
	right: number | null | undefined
): number {
	if (left === null || left === undefined) {
		if (right === null || right === undefined) return 0
		return 1
	}
	if (right === null || right === undefined) {
		return -1
	}
	return left - right
}

function parseNullableNumber(value: string | number | null | undefined): number | null {
	if (value === null || value === undefined || value === '') return null
	const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
	return Number.isFinite(parsed) ? parsed : null
}

type StructureWhereCondition = NonNullable<Parameters<typeof and>[number]>

const NON_CITADEL_TYPE_IDS = [
	...SOVEREIGNTY_STRUCTURE_TYPE_IDS,
	...SKYHOOK_STRUCTURE_TYPE_IDS,
	...NAVIGATION_STRUCTURE_TYPE_IDS,
	...MOON_DRILL_STRUCTURE_TYPE_IDS,
]

const NON_CITADEL_TYPE_NAMES = [...MINING_CITADEL_TYPE_NAMES, METENOX_MOON_DRILL_TYPE_NAME]

type SovereigntyHubUniverseStub = {
	resolveSolarSystemsByIds(
		systemIds: string[]
	): Promise<Record<string, { solarSystemName: string; regionId: string } | null>>
	resolveRegionsByIds(regionIds: string[]): Promise<Record<string, { regionName: string } | null>>
}

function combineWhereConditions(conditions: Array<StructureWhereCondition | undefined>): any {
	const defined = conditions.filter(
		(condition): condition is StructureWhereCondition => condition !== undefined
	)
	if (defined.length === 0) return undefined
	if (defined.length === 1) return defined[0]
	return and(...defined)
}

function buildStructureFamilyWhere(tab: StructureTab): StructureWhereCondition | undefined {
	switch (tab) {
		case 'citadels':
			return and(
				notInArray(corporationStructures.typeId, NON_CITADEL_TYPE_IDS),
				or(
					isNull(corporationStructures.typeName),
					notInArray(corporationStructures.typeName, NON_CITADEL_TYPE_NAMES)
				)
			)
		case 'sovereignty':
			return inArray(corporationStructures.typeId, [...SOVEREIGNTY_STRUCTURE_TYPE_IDS])
		case 'skyhooks':
			return inArray(corporationStructures.typeId, [...SKYHOOK_STRUCTURE_TYPE_IDS])
		case 'navigation':
			return inArray(corporationStructures.typeId, [...NAVIGATION_STRUCTURE_TYPE_IDS])
		case 'mining-citadels':
			return inArray(corporationStructures.typeName, [...MINING_CITADEL_TYPE_NAMES])
		case 'moon-drills':
			return or(
				inArray(corporationStructures.typeId, [...MOON_DRILL_STRUCTURE_TYPE_IDS]),
				eq(corporationStructures.typeName, METENOX_MOON_DRILL_TYPE_NAME)
			)
	}
}

function buildHiddenVisibilityWhere(
	access: StructureAccessScope,
	tabFilter?: StructureTab
): StructureWhereCondition | undefined {
	const tabs = tabFilter ? [tabFilter] : STRUCTURE_ACCESS_TABS
	const branches = tabs.flatMap((tab) => {
		const target = getStructureAccessTarget(access, tab)
		const familyWhere = buildStructureFamilyWhere(tab)

		if (!familyWhere) {
			return []
		}

		if (target.sensitiveAll || target.managerAll) {
			return [familyWhere]
		}

		const hiddenCorporationIds = [
			...target.sensitiveCorporationIds,
			...target.managerCorporationIds,
		]
		if (hiddenCorporationIds.length === 0) {
			return []
		}

		return [and(familyWhere, inArray(corporationStructures.corporationId, hiddenCorporationIds))]
	})

	if (branches.length === 0) {
		return undefined
	}

	return or(...branches)
}

function isFuelBelowThreshold(
	structure: Pick<StructureFilterableItemBase, 'fuelAmount' | 'fuelExpires'>,
	moduleConfig: Pick<
		StructureModuleConfigResult,
		| 'lowFuelTimeThresholdHours'
		| 'criticalFuelTimeThresholdHours'
		| 'lowFuelAmountThreshold'
		| 'criticalFuelAmountThreshold'
	>
): boolean {
	if (structure.fuelAmount != null) {
		return structure.fuelAmount <= moduleConfig.lowFuelAmountThreshold
	}

	if (!structure.fuelExpires) {
		return false
	}

	const hoursRemaining = (new Date(structure.fuelExpires).getTime() - Date.now()) / (60 * 60 * 1000)
	return hoursRemaining <= moduleConfig.lowFuelTimeThresholdHours
}

function summarizeStructureSovereigntyHub(
	hub: typeof structureSovereigntyHubs.$inferSelect
): StructureSovereigntyHubSummary {
	const reagentBaySummary = getSovereigntyReagentBaySummary(hub.reagentBay)
	const reagents = getSovereigntyReagentBayReagents(hub.reagentBay)

	return {
		controllerAllianceId: hub.controllerAllianceId ?? null,
		reagentBayLastUpdated: hub.reagentBayLastUpdated
			? hub.reagentBayLastUpdated.toISOString()
			: null,
		reagentCount: reagentBaySummary?.reagentCount ?? reagents.length,
		magmaticGasQuantity: reagentBaySummary?.magmaticGasQuantity ?? 0,
		magmaticGasBurningPerHour: reagentBaySummary?.magmaticGasBurningPerHour ?? 0,
		magmaticGasEstimatedDepletionAt: reagentBaySummary?.magmaticGasEstimatedDepletionAt ?? null,
		superionicIceQuantity: reagentBaySummary?.superionicIceQuantity ?? 0,
		superionicIceBurningPerHour: reagentBaySummary?.superionicIceBurningPerHour ?? 0,
		superionicIceEstimatedDepletionAt: reagentBaySummary?.superionicIceEstimatedDepletionAt ?? null,
		reagentBay: hub.reagentBay,
		resources: hub.resources,
		upgrades: hub.upgrades,
		workforceTransport:
			hub.workforceTransport as StructureSovereigntyHubSummary['workforceTransport'],
		resourcePowerAllocated: hub.resources.power.allocated,
		resourcePowerAvailable: hub.resources.power.available,
		resourceWorkforceAllocated: hub.resources.workforce.allocated,
		resourceWorkforceAvailable: hub.resources.workforce.available,
		upgradeCount: hub.upgrades.length,
		vulnerabilityWindowStart: hub.vulnerabilityWindowStart
			? hub.vulnerabilityWindowStart.toISOString()
			: null,
		vulnerabilityWindowEnd: hub.vulnerabilityWindowEnd
			? hub.vulnerabilityWindowEnd.toISOString()
			: null,
	}
}

function summarizeStructureSovereignty(
	system: typeof structureSovereigntySystems.$inferSelect | null,
	hub: typeof structureSovereigntyHubs.$inferSelect | null
): StructureSovereigntySummary | null {
	if (!system) {
		return null
	}

	return {
		claimType: system.claimType,
		allianceId: system.allianceId ?? null,
		corporationClaimantId: system.corporationClaimantId ?? null,
		factionId: system.factionId ?? null,
		claimedSince: system.claimedSince ? system.claimedSince.toISOString() : null,
		sovereigntyHubStructureId: system.sovereigntyHubStructureId ?? null,
		isCapitalSystem: system.isCapitalSystem ?? null,
		vulnerabilityWindowStart: system.vulnerabilityWindowStart
			? system.vulnerabilityWindowStart.toISOString()
			: null,
		vulnerabilityWindowEnd: system.vulnerabilityWindowEnd
			? system.vulnerabilityWindowEnd.toISOString()
			: null,
		activityDefenseMultiplier:
			system.activityDefenseMultiplier !== null && system.activityDefenseMultiplier !== undefined
				? String(system.activityDefenseMultiplier)
				: null,
		militaryLevel: system.militaryLevel ?? null,
		industrialLevel: system.industrialLevel ?? null,
		strategicLevel: system.strategicLevel ?? null,
		hub: hub ? summarizeStructureSovereigntyHub(hub) : null,
	}
}

function summarizeStructureSkyhook(
	skyhook: typeof structureSkyhooks.$inferSelect | null
): StructureSkyhookSummary | null {
	if (!skyhook) {
		return null
	}

	const reagentTotals = getSkyhookReagentSummary(skyhook.reagents)
	const reagents = getSkyhookReagentEntries(skyhook.reagents)
	const isRaidable = isSkyhookCurrentlyRaidable(skyhook)
	const normalizedState = getSkyhookState(
		skyhook.state,
		isRaidable,
		skyhook.reinforcementTimerEnd ? skyhook.reinforcementTimerEnd.toISOString() : null
	)

	return {
		planetId: skyhook.planetId ?? null,
		planetName: skyhook.planetName ?? null,
		systemId: skyhook.systemId ?? null,
		systemName: skyhook.systemName ?? null,
		state: normalizedState,
		isActive: skyhook.isActive,
		effectiveWorkforce: skyhook.effectiveWorkforce ?? null,
		totalReagents: reagentTotals?.totalReagents ?? reagents.length,
		totalSecuredStock: reagentTotals?.totalSecuredStock ?? 0,
		totalUnsecuredStock: reagentTotals?.totalUnsecuredStock ?? 0,
		totalSecuredVolumeM3: reagentTotals?.totalSecuredVolumeM3 ?? 0,
		totalUnsecuredVolumeM3: reagentTotals?.totalUnsecuredVolumeM3 ?? 0,
		securedCapacityM3: SKYHOOK_SECURED_BAY_CAPACITY_M3,
		unsecuredCapacityM3: SKYHOOK_SURPLUS_BAY_CAPACITY_M3,
		securedFillPercent: reagentTotals?.securedFillPercent ?? 0,
		unsecuredFillPercent: reagentTotals?.unsecuredFillPercent ?? 0,
		reagents: reagents.map((reagent) => ({
			typeId: reagent.typeId,
			typeName:
				reagent.typeId === SKYHOOK_MAGMATIC_GAS_TYPE_ID
					? SKYHOOK_MAGMATIC_GAS_TYPE_NAME
					: reagent.typeId === SKYHOOK_SUPERIONIC_ICE_TYPE_ID
						? SKYHOOK_SUPERIONIC_ICE_TYPE_NAME
						: null,
			unitVolumeM3: getSkyhookReagentUnitVolumeM3(reagent.typeId),
			securedStock: reagent.securedStock,
			unsecuredStock: reagent.unsecuredStock,
			securedVolumeM3: reagent.securedStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
			unsecuredVolumeM3: reagent.unsecuredStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
			securedCapacityM3: SKYHOOK_SECURED_BAY_CAPACITY_M3,
			unsecuredCapacityM3: SKYHOOK_SURPLUS_BAY_CAPACITY_M3,
			securedFillPercent: getSkyhookFullness(
				reagent.securedStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
				SKYHOOK_SECURED_BAY_CAPACITY_M3
			),
			unsecuredFillPercent: getSkyhookFullness(
				reagent.unsecuredStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
				SKYHOOK_SURPLUS_BAY_CAPACITY_M3
			),
			lastCycle: reagent.lastCycle,
		})),
		reinforcementTimerEnd: skyhook.reinforcementTimerEnd
			? skyhook.reinforcementTimerEnd.toISOString()
			: null,
			theftVulnerabilityStart: skyhook.theftVulnerabilityStart
				? skyhook.theftVulnerabilityStart.toISOString()
				: null,
			theftVulnerabilityEnd: skyhook.theftVulnerabilityEnd
				? skyhook.theftVulnerabilityEnd.toISOString()
				: null,
			isRaidable,
		}
	}

function summarizeStructureMoonDrill(
	moonDrill: typeof structureMoonDrills.$inferSelect | null,
	moonGeography: typeof structureMoonGeographies.$inferSelect | null
): RepoStructureMoonDrillSummary | null {
	if (!moonDrill || !moonGeography) {
		return null
	}

	return {
		moonId: moonGeography.moonId,
		moonName: moonGeography.moonName ?? null,
		planetId: moonGeography.planetId ?? null,
		planetName: moonGeography.planetName ?? null,
		systemId: moonGeography.systemId ?? null,
		systemName: moonGeography.systemName ?? null,
	}
}

function summarizeStructureMiningCitadel(
	miningExtraction: typeof structureMiningExtractions.$inferSelect | null,
	moonGeography: typeof structureMoonGeographies.$inferSelect | null
): RepoStructureMiningCitadelSummary | null {
	if (!miningExtraction || !moonGeography) {
		return null
	}

	return {
		moonId: moonGeography.moonId,
		moonName: moonGeography.moonName ?? null,
		planetId: moonGeography.planetId ?? null,
		planetName: moonGeography.planetName ?? null,
		systemId: moonGeography.systemId ?? null,
		systemName: moonGeography.systemName ?? null,
		extractionStartTime: miningExtraction.extractionStartTime
			? miningExtraction.extractionStartTime.toISOString()
			: null,
		chunkArrivalTime: miningExtraction.chunkArrivalTime
			? miningExtraction.chunkArrivalTime.toISOString()
			: null,
		naturalDecayTime: miningExtraction.naturalDecayTime
			? miningExtraction.naturalDecayTime.toISOString()
			: null,
	}
}

function buildStructureListItem(context: VisibleStructureContext): StructureListItem {
	const { structure, corporationName, config, canViewDetails } = context
	const nextStateAt =
		structure.stateTimerEnd ?? structure.nextReinforceApply ?? structure.unanchorsAt

	return {
		structureId: structure.structureId,
		corporationId: structure.corporationId,
		corporationName,
		name: structure.name ?? structure.structureId,
		typeId: structure.typeId,
		typeName: structure.typeName,
		systemId: structure.systemId,
		systemName: structure.systemName,
		regionId: structure.regionId,
		regionName: structure.regionName,
		state: structure.state,
		nextStateAt: toIso(nextStateAt),
		fuelExpires: toIso(structure.fuelExpires),
		fuelAmount: structure.fuelAmount,
		estimatedFuelBurnRatePerHour: structure.fuelBurnRate ?? null,
		lowPower: structure.lowPower,
		hidden: config?.hidden ?? false,
		lowPowerAllowed: config?.lowPowerAllowed ?? false,
		assignedGroupId: config?.assignedGroupId ?? null,
		syncStatus: getStructureSyncStatus(structure.syncStatus, structure.lastSyncedAt),
		syncFailureReason: structure.syncFailureReason,
		lastSyncedAt: toIso(structure.lastSyncedAt),
		updatedAt: structure.updatedAt.toISOString(),
		canViewDetails,
	}
}

interface SovereigntyHubGeography {
	solarSystemName: string
	regionId: string
	regionName: string
}

async function resolveSovereigntyHubGeographies(
	env: Env,
	systemIds: string[]
): Promise<Record<string, SovereigntyHubGeography | null>> {
	if (systemIds.length === 0) {
		return {}
	}

	const universe = getStub<SovereigntyHubUniverseStub>(env.UNIVERSE, 'default')
	const systemsById = await universe.resolveSolarSystemsByIds(systemIds)
	const regionIds = [
		...new Set(Object.values(systemsById).flatMap((system) => (system ? [system.regionId] : []))),
	]
	const regionsById = regionIds.length > 0 ? await universe.resolveRegionsByIds(regionIds) : {}

	return Object.fromEntries(
		Object.entries(systemsById).map(([systemId, system]) => {
			if (!system) {
				return [systemId, null]
			}

			const region = regionsById[system.regionId] ?? null
			return [
				systemId,
				{
					solarSystemName: system.solarSystemName,
					regionId: system.regionId,
					regionName: region?.regionName ?? system.regionId,
				},
			]
		})
	)
}

function buildSyntheticSovereigntyStructureRow(
	hub: typeof structureSovereigntyHubs.$inferSelect,
	system: typeof structureSovereigntySystems.$inferSelect | null,
	geography: SovereigntyHubGeography | null
): StructureSourceRecord {
	const lastSyncedAt = hub.lastSyncedAt ?? system?.lastSyncedAt ?? null
	return {
		id: hub.structureId,
		corporationId: hub.corporationId,
		structureId: hub.structureId,
		name:
			hub.name ??
			geography?.solarSystemName ??
			hub.systemName ??
			system?.systemName ??
			hub.structureId,
		typeId: hub.typeId,
		typeName: 'Sovereignty Hub',
		systemId: hub.systemId,
		systemName: geography?.solarSystemName ?? hub.systemName ?? system?.systemName ?? null,
		regionId: geography?.regionId ?? null,
		regionName: geography?.regionName ?? null,
		fuelExpires: null,
		fuelAmount: null,
		fuelBurnRate: null,
		lastRefilledAt: null,
		nextReinforceApply: null,
		nextReinforceHour: null,
		reinforceHour: null,
		state: 'online',
		stateTimerEnd: null,
		stateTimerStart: null,
		unanchorsAt: null,
		lowPower: false,
		syncStatus: 'ok',
		syncFailureReason: null,
		lastSyncedAt,
		services: [],
		updatedAt: hub.updatedAt,
	} satisfies StructureSourceRecord
}

async function loadStructureTabDetailData(
	db: DbClient<DbSchema>,
	structure: StructureSourceRecord
): Promise<StructureTabData | null> {
	const tab = getStructureTab(structure)

	if (tab === 'citadels') {
		return null
	}

	if (tab === 'sovereignty') {
		const [systemRow, hubRow] = await Promise.all([
			db.query.structureSovereigntySystems.findFirst({
				where: eq(structureSovereigntySystems.systemId, structure.systemId),
			}),
			db.query.structureSovereigntyHubs.findFirst({
				where: eq(structureSovereigntyHubs.structureId, structure.structureId),
			}),
		])
		return {
			sovereignty: summarizeStructureSovereignty(systemRow ?? null, hubRow ?? null),
		}
	}

	if (tab === 'skyhooks') {
		const skyhookRow = await db.query.structureSkyhooks.findFirst({
			where: eq(structureSkyhooks.structureId, structure.structureId),
		})
		return {
			skyhook: skyhookRow ? summarizeStructureSkyhook(skyhookRow) : null,
		}
	}

	if (tab === 'moon-drills') {
		const [moonDrillRow, moonGeographyRow] = await Promise.all([
			db.query.structureMoonDrills.findFirst({
				where: eq(structureMoonDrills.structureId, structure.structureId),
			}),
			db.query.structureMoonGeographies.findFirst({
				where: eq(structureMoonGeographies.structureId, structure.structureId),
			}),
		])
		return {
			moonDrill:
				moonDrillRow && moonGeographyRow
					? summarizeStructureMoonDrill(moonDrillRow, moonGeographyRow)
					: null,
		}
	}

	if (tab === 'mining-citadels') {
		const [miningExtractionRow, moonGeographyRow] = await Promise.all([
			db.query.structureMiningExtractions.findFirst({
				where: eq(structureMiningExtractions.structureId, structure.structureId),
			}),
			db.query.structureMoonGeographies.findFirst({
				where: eq(structureMoonGeographies.structureId, structure.structureId),
			}),
		])
		return {
			miningExtraction:
				miningExtractionRow && moonGeographyRow
					? summarizeStructureMiningCitadel(miningExtractionRow, moonGeographyRow)
					: null,
		}
	}

	return null
}

async function loadStructureInventoryDetailData(
	db: DbClient<DbSchema>,
	structure: StructureSourceRecord
): Promise<StructureInventoryBaySummary[]> {
	const rows = await db.query.corporationStructureInventory.findMany({
		where: and(
			eq(corporationStructureInventory.corporationId, structure.corporationId),
			eq(corporationStructureInventory.structureId, structure.structureId)
		),
	})
	return summarizeInventoryRows(rows)
}

const STRUCTURE_FITTING_SLOT_ORDER: Array<StructureFittingItemSummary['flagName']> = [
	'High Slot',
	'Mid Slot',
	'Low Slot',
	'Rig Slot',
	'Subsystem Slot',
]

function compareStructureFittingItems(
	left: StructureFittingItemSummary,
	right: StructureFittingItemSummary
): number {
	const leftOrder = STRUCTURE_FITTING_SLOT_ORDER.indexOf(left.flagName)
	const rightOrder = STRUCTURE_FITTING_SLOT_ORDER.indexOf(right.flagName)
	if (leftOrder !== rightOrder) {
		return leftOrder - rightOrder
	}

	if (left.slotIndex !== right.slotIndex) {
		return left.slotIndex - right.slotIndex
	}

	return left.typeId.localeCompare(right.typeId)
}

async function loadStructureFittingDetailData(
	env: Env,
	structure: StructureSourceRecord
): Promise<StructureFittingItemSummary[]> {
	const structureTab = getStructureTab(structure)
	if (structureTab !== 'citadels') {
		return []
	}

	try {
		const corpData = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, structure.corporationId)
		const rawAssets = await corpData.searchAssets(structure.corporationId, {
			locationId: structure.structureId,
			locationType: 'item',
		})

		return rawAssets
			.flatMap((asset) => {
				const slot = parseFittingSlotFlag(asset.locationFlag)
				if (!slot) {
					return []
				}

				return [
					{
						locationFlag: asset.locationFlag,
						slotIndex: slot.slotIndex,
						flagName: slot.flagName,
						typeId: asset.typeId,
						typeName: null,
						quantity: asset.quantity,
					},
				]
			})
			.sort(compareStructureFittingItems)
	} catch (error) {
		logger.error('[loadStructureFittingDetailData] Failed to load structure fitting items', {
			corporationId: structure.corporationId,
			structureId: structure.structureId,
			error: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		})
		return []
	}
}

export async function assertStructureGroupConfigured(
	db: DbClient<DbSchema>,
	groupId: string
): Promise<void> {
	const groupSetting = await db.query.structureGroupSettings.findFirst({
		where: eq(structureGroupSettings.groupId, groupId),
		columns: {
			groupId: true,
		},
	})

	if (!groupSetting) {
		throw new Error(`Structure group ${groupId} is not configured`)
	}
}

export async function listStructureGroupSettings(db: DbClient<DbSchema>) {
	return db.query.structureGroupSettings.findMany({
		orderBy: desc(structureGroupSettings.updatedAt),
	})
}

export async function upsertStructureGroupSetting(
	db: DbClient<DbSchema>,
	input: UpsertStructureGroupSettingInput
) {
	const existing = await db.query.structureGroupSettings.findFirst({
		where: eq(structureGroupSettings.groupId, input.groupId),
	})
	const now = new Date()
	const values = {
		groupId: input.groupId,
		createdBy: input.updatedBy ?? null,
		updatedBy: input.updatedBy ?? existing?.updatedBy ?? null,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	}

	if (existing) {
		const [updated] = await db
			.update(structureGroupSettings)
			.set({
				updatedBy: input.updatedBy ?? existing.updatedBy ?? null,
				updatedAt: now,
			})
			.where(eq(structureGroupSettings.groupId, input.groupId))
			.returning()
		invalidateVisibleStructureContextCache()
		return updated
	}

	const [created] = await db.insert(structureGroupSettings).values(values).returning()
	invalidateVisibleStructureContextCache()
	return created
}

export async function deleteStructureGroupSetting(
	db: DbClient<DbSchema>,
	input: DeleteStructureGroupSettingInput
) {
	const [deleted] = await db
		.delete(structureGroupSettings)
		.where(eq(structureGroupSettings.groupId, input.groupId))
		.returning()
	invalidateVisibleStructureContextCache()
	return deleted ?? null
}

export async function listStructureCorporationGroupDefaults(db: DbClient<DbSchema>) {
	const rows = await db.query.structureCorporationGroupDefaults.findMany({
		where: isNotNull(structureCorporationGroupDefaults.groupId),
		orderBy: desc(structureCorporationGroupDefaults.updatedAt),
	})

	const corporationIds = [...new Set(rows.map((row) => row.corporationId))]
	const corporationRows = corporationIds.length
		? await db.query.managedCorporations.findMany({
				where: inArray(managedCorporations.corporationId, corporationIds),
				columns: {
					corporationId: true,
					name: true,
					includeInStructureAssetSync: true,
				},
			})
		: []
	const corporationById = new Map(corporationRows.map((row) => [row.corporationId, row] as const))

	return rows.map((row) => ({
		...row,
		corporationName: corporationById.get(row.corporationId)?.name ?? row.corporationId,
	}))
}

const STRUCTURE_MODULE_CONFIG_ID = 'default'

async function getOrCreateStructureModuleConfig(
	db: DbClient<DbSchema>
): Promise<typeof structureModuleConfig.$inferSelect> {
	const existing = await db.query.structureModuleConfig.findFirst({
		where: eq(structureModuleConfig.id, STRUCTURE_MODULE_CONFIG_ID),
	})
	if (existing) {
		return existing
	}

	const now = new Date()
	const [created] = await db
		.insert(structureModuleConfig)
		.values({
			id: STRUCTURE_MODULE_CONFIG_ID,
			lowFuelTimeThresholdHours: 12,
			criticalFuelTimeThresholdHours: 4,
			lowFuelAmountThreshold: 0,
			criticalFuelAmountThreshold: 0,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.returning()
	if (created) {
		return created
	}

	const retried = await db.query.structureModuleConfig.findFirst({
		where: eq(structureModuleConfig.id, STRUCTURE_MODULE_CONFIG_ID),
	})
	if (!retried) {
		throw new Error('Failed to initialize structure module config')
	}
	return retried
}

export async function getStructureModuleConfig(
	db: DbClient<DbSchema>
): Promise<StructureModuleConfigResult> {
	const row = await getOrCreateStructureModuleConfig(db)
	return row
}

export async function updateStructureModuleConfig(
	db: DbClient<DbSchema>,
	input: UpdateStructureModuleConfigInput
): Promise<StructureModuleConfigResult> {
	const existing = await getOrCreateStructureModuleConfig(db)
	const now = new Date()
	const [updated] = await db
		.insert(structureModuleConfig)
		.values({
			id: existing.id,
			lowFuelTimeThresholdHours:
				input.lowFuelTimeThresholdHours ?? existing.lowFuelTimeThresholdHours,
			criticalFuelTimeThresholdHours:
				input.criticalFuelTimeThresholdHours ?? existing.criticalFuelTimeThresholdHours,
			lowFuelAmountThreshold: input.lowFuelAmountThreshold ?? existing.lowFuelAmountThreshold,
			criticalFuelAmountThreshold:
				input.criticalFuelAmountThreshold ?? existing.criticalFuelAmountThreshold,
			updatedBy: input.updatedBy ?? existing.updatedBy ?? null,
			createdAt: existing.createdAt,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: structureModuleConfig.id,
			set: {
				lowFuelTimeThresholdHours:
					input.lowFuelTimeThresholdHours ?? existing.lowFuelTimeThresholdHours,
				criticalFuelTimeThresholdHours:
					input.criticalFuelTimeThresholdHours ?? existing.criticalFuelTimeThresholdHours,
				lowFuelAmountThreshold: input.lowFuelAmountThreshold ?? existing.lowFuelAmountThreshold,
				criticalFuelAmountThreshold:
					input.criticalFuelAmountThreshold ?? existing.criticalFuelAmountThreshold,
				updatedBy: input.updatedBy ?? existing.updatedBy ?? null,
				updatedAt: now,
			},
		})
		.returning()
	invalidateVisibleStructureContextCache()
	return updated
}

export async function upsertStructureCorporationGroupDefault(
	db: DbClient<DbSchema>,
	input: UpsertStructureCorporationDefaultInput
) {
	if (input.groupId !== null) {
		await assertStructureGroupConfigured(db, input.groupId)
	}

	const existing = await db.query.structureCorporationGroupDefaults.findFirst({
		where: eq(structureCorporationGroupDefaults.corporationId, input.corporationId),
	})
	const now = new Date()

	if (existing) {
		const [updated] = await db
			.update(structureCorporationGroupDefaults)
			.set({
				groupId: input.groupId,
				updatedBy: input.updatedBy ?? existing.updatedBy ?? null,
				updatedAt: now,
			})
			.where(eq(structureCorporationGroupDefaults.corporationId, input.corporationId))
			.returning()
		invalidateVisibleStructureContextCache()
		return updated
	}

	const [created] = await db
		.insert(structureCorporationGroupDefaults)
		.values({
			corporationId: input.corporationId,
			groupId: input.groupId,
			updatedBy: input.updatedBy ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
	invalidateVisibleStructureContextCache()
	return created
}

export async function listStructureGroupAlertConfigs(db: DbClient<DbSchema>, groupId?: string) {
	return db.query.structureGroupAlertConfigs.findMany({
		where: groupId ? eq(structureGroupAlertConfigs.groupId, groupId) : undefined,
		orderBy: desc(structureGroupAlertConfigs.updatedAt),
	})
}

export async function upsertStructureGroupAlertConfig(
	db: DbClient<DbSchema>,
	input: UpsertStructureGroupAlertConfigInput
) {
	await assertStructureGroupConfigured(db, input.groupId)

	const existing = input.id
		? await db.query.structureGroupAlertConfigs.findFirst({
				where: eq(structureGroupAlertConfigs.id, input.id),
			})
		: await db.query.structureGroupAlertConfigs.findFirst({
				where: and(
					eq(structureGroupAlertConfigs.groupId, input.groupId),
					eq(structureGroupAlertConfigs.alertType, input.alertType)
				),
			})
	const now = new Date()

	if (existing) {
		const [updated] = await db
			.update(structureGroupAlertConfigs)
			.set({
				groupId: input.groupId,
				alertType: input.alertType,
				destinationIds: input.destinationIds,
				config: input.config,
				isEnabled: input.isEnabled,
				updatedAt: now,
			})
			.where(eq(structureGroupAlertConfigs.id, existing.id))
			.returning()
		invalidateVisibleStructureContextCache()
		return updated
	}

	const [created] = await db
		.insert(structureGroupAlertConfigs)
		.values({
			groupId: input.groupId,
			alertType: input.alertType,
			destinationIds: input.destinationIds,
			config: input.config,
			isEnabled: input.isEnabled,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
	invalidateVisibleStructureContextCache()
	return created
}

export async function deleteStructureGroupAlertConfig(
	db: DbClient<DbSchema>,
	groupId: string,
	id: string
): Promise<void> {
	await db
		.delete(structureGroupAlertConfigs)
		.where(
			and(eq(structureGroupAlertConfigs.groupId, groupId), eq(structureGroupAlertConfigs.id, id))
		)
	invalidateVisibleStructureContextCache()
}

type DirectCorporationStructureRecord = typeof corporationStructures.$inferSelect
type StructureSourceRecord = Pick<
	DirectCorporationStructureRecord,
	| 'id'
	| 'corporationId'
	| 'structureId'
	| 'name'
	| 'typeId'
	| 'typeName'
	| 'systemId'
	| 'systemName'
	| 'regionId'
	| 'regionName'
	| 'fuelExpires'
	| 'fuelAmount'
	| 'fuelBurnRate'
	| 'lastRefilledAt'
	| 'nextReinforceApply'
	| 'nextReinforceHour'
	| 'reinforceHour'
	| 'state'
	| 'stateTimerEnd'
	| 'stateTimerStart'
	| 'unanchorsAt'
	| 'lowPower'
	| 'syncStatus'
	| 'syncFailureReason'
	| 'lastSyncedAt'
	| 'services'
	| 'updatedAt'
>

const CORPORATION_STRUCTURE_SELECT_COLUMNS = {
	id: true,
	corporationId: true,
	structureId: true,
	name: true,
	typeId: true,
	typeName: true,
	systemId: true,
	systemName: true,
	regionId: true,
	regionName: true,
	fuelExpires: true,
	fuelAmount: true,
	fuelBurnRate: true,
	lastRefilledAt: true,
	nextReinforceApply: true,
	nextReinforceHour: true,
	reinforceHour: true,
	state: true,
	stateTimerEnd: true,
	stateTimerStart: true,
	unanchorsAt: true,
	lowPower: true,
	syncStatus: true,
	syncFailureReason: true,
	lastSyncedAt: true,
	services: true,
	updatedAt: true,
} as const

interface VisibleStructureContext {
	structure: StructureSourceRecord
	corporationName: string
	includeInStructureAssetSync: boolean
	config: typeof structureConfigs.$inferSelect | null
	canViewDetails: boolean
	canViewSensitive: boolean
	canEdit: boolean
	tabData: StructureTabData | null
	fittingItems: StructureFittingItemSummary[] | null
	lastRefilledAt: Date | null
	fuelUsage: StructureFuelUsageHistory | null
}

const EMPTY_STRUCTURE_FUEL_USAGE_HISTORY: StructureFuelUsageHistory = {
	points: [],
	fuelBurnRatePerHour: null,
	lastRefilledAt: null,
	sampleCount: 0,
}

export function getStructureTab(
	structure: Pick<StructureListItem, 'typeId' | 'typeName'>
): StructureTab {
	return getStructureTabForTypeId(structure.typeId, structure.typeName)
}

function matchesStructureTab(
	structure: Pick<StructureListItem, 'typeId' | 'typeName'>,
	tab: StructureTab
): boolean {
	return getStructureTab(structure) === tab
}

function buildStructureDetailResult(context: VisibleStructureContext): StructureDetailResult {
	const { canViewDetails: _canViewDetails, ...structure } = buildStructureListItem(context)
	return {
		...structure,
		includeInStructureAssetSync: context.includeInStructureAssetSync,
		canViewSensitive: context.canViewSensitive,
		canEdit: context.canEdit,
		fuelBurnRate: context.structure.fuelBurnRate ?? null,
		services: context.structure.services ?? [],
		stateTimerStart: toIso(context.structure.stateTimerStart),
		stateTimerEnd: toIso(context.structure.stateTimerEnd),
		unanchorsAt: toIso(context.structure.unanchorsAt),
		nextReinforceApply: toIso(context.structure.nextReinforceApply),
		nextReinforceHour: context.structure.nextReinforceHour,
		reinforceHour: context.structure.reinforceHour,
		lastRefilledAt: toIso(context.lastRefilledAt),
		fuelUsage: context.fuelUsage
			? {
					points: context.fuelUsage.points.map((point) => ({
						observedAt: point.observedAt.toISOString(),
						fuelBlockUnits: point.fuelBlockUnits,
						fuelBurnRatePerHour: point.fuelBurnRatePerHour,
					})),
					lastRefilledAt: context.fuelUsage.lastRefilledAt
						? context.fuelUsage.lastRefilledAt.toISOString()
						: null,
					sampleCount: context.fuelUsage.sampleCount,
				}
			: null,
		...(context.tabData ?? {}),
		moonDrill: context.tabData?.moonDrill ?? null,
		miningExtraction: context.tabData?.miningExtraction ?? null,
		fittingItems: context.fittingItems ?? [],
	}
}

async function getVisibleStructureContext(
	env: Env,
	db: DbClient<DbSchema>,
	user: SessionUser,
	structureId: string,
	options: {
		requireDetailsPermission?: boolean
	} = {}
): Promise<VisibleStructureContext | null> {
	const requireDetailsPermission = options.requireDetailsPermission ?? false
	const access = computeStructureAccess(user.roles, user.is_admin)
	const accessibleCorporations = getAccessibleCorporationIds(access)
	const structure = await db.query.corporationStructures.findFirst({
		columns: CORPORATION_STRUCTURE_SELECT_COLUMNS,
		where: (() => {
			const conditions = [eq(corporationStructures.structureId, structureId)]
			if (!accessibleCorporations.hasGlobalAccess) {
				if (accessibleCorporations.corporationIds.size === 0) {
					return and(...conditions, eq(corporationStructures.corporationId, '__no_access__'))
				}
				conditions.push(
					inArray(corporationStructures.corporationId, [...accessibleCorporations.corporationIds])
				)
			}
			return and(...conditions)
		})(),
	})

	if (!structure) {
		const sovereigntyHub = await db.query.structureSovereigntyHubs.findFirst({
			where: (() => {
				const conditions = [eq(structureSovereigntyHubs.structureId, structureId)]
				if (!accessibleCorporations.hasGlobalAccess) {
					if (accessibleCorporations.corporationIds.size === 0) {
						return and(...conditions, eq(structureSovereigntyHubs.corporationId, '__no_access__'))
					}
					conditions.push(
						inArray(structureSovereigntyHubs.corporationId, [
							...accessibleCorporations.corporationIds,
						])
					)
				}
				return and(...conditions)
			})(),
		})

		if (!sovereigntyHub) {
			return null
		}

		const corporation = await db.query.managedCorporations.findFirst({
			where: eq(managedCorporations.corporationId, sovereigntyHub.corporationId),
			columns: {
				corporationId: true,
				name: true,
				includeInStructureAssetSync: true,
			},
		})
		const systemRow = await db.query.structureSovereigntySystems.findFirst({
			where: eq(structureSovereigntySystems.sovereigntyHubStructureId, structureId),
		})
		const geographyBySystemId = await resolveSovereigntyHubGeographies(env, [
			sovereigntyHub.systemId,
		])
		const syntheticStructure = buildSyntheticSovereigntyStructureRow(
			sovereigntyHub,
			systemRow ?? null,
			geographyBySystemId[sovereigntyHub.systemId] ?? null
		)
		const structureTab = getStructureTab(syntheticStructure)
		if (!hasStructureAccessForTab(access, sovereigntyHub.corporationId, structureTab)) {
			return null
		}

		const canViewDetails =
			user.is_admin || canViewDetailsStructure(access, sovereigntyHub.corporationId, structureTab)
		if (requireDetailsPermission && !canViewDetails) {
			return null
		}
		const canViewSensitive =
			user.is_admin || canViewSensitiveStructure(access, sovereigntyHub.corporationId, structureTab)
		const canEdit =
			user.is_admin || canEditStructure(access, sovereigntyHub.corporationId, structureTab)

		const [tabData, inventoryBays, fittingItems] = await Promise.all([
			loadStructureTabDetailData(db, syntheticStructure),
			loadStructureInventoryDetailData(db, syntheticStructure),
			loadStructureFittingDetailData(env, syntheticStructure),
		])

		return {
			structure: syntheticStructure,
			corporationName: corporation?.name ?? sovereigntyHub.corporationId,
			includeInStructureAssetSync: corporation?.includeInStructureAssetSync ?? false,
			config: null,
			canViewDetails,
			canViewSensitive,
			canEdit,
			tabData: {
				...(tabData ?? {}),
				inventoryBays,
			},
			fittingItems,
			lastRefilledAt: null,
			fuelUsage: null,
		}
	}

	const config = await db.query.structureConfigs.findFirst({
		where: eq(structureConfigs.structureId, structureId),
	})
	const corporation = await db.query.managedCorporations.findFirst({
		where: eq(managedCorporations.corporationId, structure.corporationId),
		columns: {
			corporationId: true,
			name: true,
			includeInStructureAssetSync: true,
		},
	})
	const structureTab = getStructureTab(structure)
	if (!hasStructureAccessForTab(access, structure.corporationId, structureTab)) {
		return null
	}

	const canViewDetails = user.is_admin || canViewDetailsStructure(access, structure.corporationId, structureTab)
	if (requireDetailsPermission && !canViewDetails) {
		return null
	}
	const canViewSensitive =
		user.is_admin || canViewSensitiveStructure(access, structure.corporationId, structureTab)
	const canEdit = user.is_admin || canEditStructure(access, structure.corporationId, structureTab)
	if (config?.hidden && !canViewSensitive) {
		return null
	}

	const [tabData, inventoryBays, fittingItems] = await Promise.all([
		loadStructureTabDetailData(db, structure),
		loadStructureInventoryDetailData(db, structure),
		loadStructureFittingDetailData(env, structure),
	])

	return {
		structure,
		corporationName: corporation?.name ?? structure.corporationId,
		includeInStructureAssetSync: corporation?.includeInStructureAssetSync ?? false,
		config: config ?? null,
		canViewDetails,
		canViewSensitive,
		canEdit,
		tabData: {
			...(tabData ?? {}),
			inventoryBays,
		},
		fittingItems,
		lastRefilledAt: structure.lastRefilledAt ?? null,
		fuelUsage: null,
	}
}

function getStructureSortValue(
	structure: StructureFilterableItemBase,
	field: StructureListSortField
): string | number | null {
	const sovereigntyStructure = structure as Partial<StructureSovereigntyFilterableItem>
	const skyhookStructure = structure as Partial<StructureSkyhookFilterableItem>
	switch (field) {
		case 'updatedAt':
			return new Date(structure.updatedAt).getTime()
		case 'nextStateAt':
			return structure.nextStateAt
				? new Date(structure.nextStateAt).getTime()
				: Number.POSITIVE_INFINITY
		case 'fuel':
			return structure.fuelExpires
				? new Date(structure.fuelExpires).getTime()
				: (structure.fuelAmount ?? Number.POSITIVE_INFINITY)
		case 'activityDefenseMultiplier':
			return parseNullableNumber(sovereigntyStructure.activityDefenseMultiplier ?? null)
		case 'magmaticGasEstimatedDepletionAt':
			return sovereigntyStructure.magmaticGasEstimatedDepletionAt ?? null
		case 'superionicIceEstimatedDepletionAt':
			return sovereigntyStructure.superionicIceEstimatedDepletionAt ?? null
			case 'theftVulnerabilityStart':
				return getSkyhookVulnerabilityWindowStart(
					structure as Partial<StructureSkyhookFilterableItem> as Pick<
						StructureSkyhookFilterableItem,
						'theftVulnerabilityStart'
					>
				)
		case 'skyhookSecureFullness':
			return (structure as Partial<StructureSkyhookFilterableItem>).securedFillPercent ?? null
		case 'skyhookSurplusFullness':
			return (structure as Partial<StructureSkyhookFilterableItem>).unsecuredFillPercent ?? null
		case 'raidable':
			return skyhookStructure.isRaidable ? 1 : 0
		case 'workforce':
			return skyhookStructure.effectiveWorkforce ?? null
		case 'group':
			return structure.assignedGroupId ?? null
		case 'syncStatus':
			return skyhookStructure.syncStatus === 'error'
				? 0
				: skyhookStructure.syncStatus === 'warning'
					? 1
					: skyhookStructure.syncStatus === 'ok'
						? 2
						: null
		case 'name':
			return structure.structureId
		case 'corporation':
			return structure.corporationName
		case 'region':
			return structure.regionName ?? ''
		case 'planet':
			return structure.planetName ?? structure.planetId ?? ''
		case 'system':
			return structure.systemName ?? structure.systemId
		case 'type':
			return structure.typeName ?? structure.typeId
		case 'state':
			return structure.state
	}

	return null
}

function compareFuelStructures(
	left: Pick<StructureFilterableItemBase, 'fuelExpires' | 'fuelAmount'>,
	right: Pick<StructureFilterableItemBase, 'fuelExpires' | 'fuelAmount'>
): number {
	const leftHasExpiry = left.fuelExpires != null
	const rightHasExpiry = right.fuelExpires != null
	if (leftHasExpiry !== rightHasExpiry) {
		return leftHasExpiry ? -1 : 1
	}

	if (leftHasExpiry && rightHasExpiry) {
		return compareNullableDates(left.fuelExpires, right.fuelExpires)
	}

	return compareNullableNumbers(left.fuelAmount, right.fuelAmount)
}

function sortStructures<TItem extends StructureFilterableItemBase>(
	items: TItem[],
	sortBy: StructureListSortField,
	sortDirection: StructureListSortDirection
): TItem[] {
	const direction = sortDirection === 'asc' ? 1 : -1
	return [...items].sort((left, right) => {
		let comparison = 0
		switch (sortBy) {
			case 'updatedAt':
			case 'nextStateAt':
				comparison = compareNullableDates(
					getStructureSortValue(left, sortBy) as string | null | undefined,
					getStructureSortValue(right, sortBy) as string | null | undefined
				)
				break
			case 'activityDefenseMultiplier':
				comparison = compareNullableNumbers(
					getStructureSortValue(left, sortBy) as number | null | undefined,
					getStructureSortValue(right, sortBy) as number | null | undefined
				)
				break
			case 'magmaticGasEstimatedDepletionAt':
			case 'superionicIceEstimatedDepletionAt':
			case 'theftVulnerabilityStart':
				comparison = compareNullableDates(
					getStructureSortValue(left, sortBy) as string | null | undefined,
					getStructureSortValue(right, sortBy) as string | null | undefined
				)
				break
			case 'fuel':
				comparison = compareFuelStructures(left, right)
				break
			case 'skyhookSecureFullness':
			case 'skyhookSurplusFullness':
				comparison = compareNullableNumbers(
					getStructureSortValue(left, sortBy) as number | null | undefined,
					getStructureSortValue(right, sortBy) as number | null | undefined
				)
				break
			case 'raidable':
			case 'workforce':
			case 'syncStatus':
				comparison = compareNullableNumbers(
					getStructureSortValue(left, sortBy) as number | null | undefined,
					getStructureSortValue(right, sortBy) as number | null | undefined
				)
				break
			case 'group':
				comparison = compareNullableStrings(
					getStructureSortValue(left, sortBy) as string | null | undefined,
					getStructureSortValue(right, sortBy) as string | null | undefined
				)
				break
			case 'name':
				comparison = left.structureId.localeCompare(right.structureId)
				break
			case 'corporation':
				comparison = compareNullableStrings(left.corporationName, right.corporationName)
				break
			case 'region':
				comparison = compareNullableStrings(left.regionName, right.regionName)
				break
			case 'planet':
				comparison = compareNullableStrings(left.planetName, right.planetName)
				break
			case 'system':
				comparison = compareNullableStrings(left.systemName, right.systemName)
				break
			case 'type':
				comparison = compareNullableStrings(left.typeName, right.typeName)
				break
			case 'state':
				comparison = left.state.localeCompare(right.state)
				break
		}

		if (comparison !== 0) return comparison * direction
		return left.structureId.localeCompare(right.structureId)
	})
}

function buildCommonStructureFilterOptions<TItem extends StructureFilterableItemBase>(
	items: TItem[]
): StructureListFilterOptions {
	const corporations = new Map<string, string>()
	const assignedGroups = new Map<string, string>()
	const regions = new Map<string, string>()
	const systems = new Map<string, string>()
	const states = new Set<string>()
	const types = new Map<string, string>()

	for (const structure of items) {
		corporations.set(structure.corporationId, structure.corporationName)
		if (structure.assignedGroupId) {
			assignedGroups.set(structure.assignedGroupId, structure.assignedGroupId)
		}
		if (structure.regionId) {
			regions.set(structure.regionId, structure.regionName ?? structure.regionId)
		}
		systems.set(structure.systemId, structure.systemName ?? structure.systemId)
		states.add(structure.state)
		types.set(structure.typeId, structure.typeName ?? structure.typeId)
	}

	return {
		corporations: Array.from(corporations.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		assignedGroups: Array.from(assignedGroups.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		regions: Array.from(regions.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		systems: Array.from(systems.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		states: Array.from(states.values())
			.sort((left, right) => left.localeCompare(right))
			.map((value) => ({ value, label: value })),
		types: Array.from(types.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		alliances: [],
		planets: [],
		raidableStates: [],
	}
}

function buildStructureFilterOptions<TItem extends StructureFilterableItemBase>(
	items: TItem[]
): StructureListFilterOptions {
	return buildCommonStructureFilterOptions(items)
}

function buildSkyhookFilterOptions(
	items: StructureSkyhookFilterableItem[]
): StructureListFilterOptions {
	const filterOptions = buildCommonStructureFilterOptions(items)
	const planets = new Map<string, string>()
	const raidableStates = new Set<string>()

	for (const structure of items) {
		if (structure.planetId) {
			planets.set(structure.planetId, structure.planetName ?? structure.planetId)
		}
		raidableStates.add(structure.isRaidable ? 'true' : 'false')
	}

	return {
		...filterOptions,
		planets: Array.from(planets.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		raidableStates: Array.from(raidableStates.values())
			.sort((left, right) => left.localeCompare(right))
			.map((value) => ({ value, label: value === 'true' ? 'Raidable' : 'Not raidable' })),
	}
}

function buildMoonGeographyFilterOptions(
	items: Array<
		StructureFilterableItemBase & {
			planetId: string | null
			planetName: string | null
		}
	>
): StructureListFilterOptions {
	const filterOptions = buildCommonStructureFilterOptions(items)
	const planets = new Map<string, string>()

	for (const structure of items) {
		if (structure.planetId) {
			planets.set(structure.planetId, structure.planetName ?? structure.planetId)
		}
	}

	return {
		...filterOptions,
		planets: Array.from(planets.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
	}
}

function getSovereigntyVulnerabilityState(
	structure:
		| Pick<
				RepoStructureSovereigntyListItem,
				'vulnerabilityWindowStart' | 'vulnerabilityWindowEnd' | 'state'
		  >
		| null
		| undefined
): SovereigntyVulnerabilityState {
	if (!structure?.vulnerabilityWindowStart || !structure?.vulnerabilityWindowEnd) {
		return 'unknown'
	}

	if (isReinforcedStructureState(structure.state)) {
		return 'reinforced'
	}

	const start = new Date(structure.vulnerabilityWindowStart).getTime()
	const end = new Date(structure.vulnerabilityWindowEnd).getTime()
	const now = Date.now()
	if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) {
		return 'vulnerable'
	}

	return 'invulnerable'
}

function buildSovereigntyFilterOptions(
	items: RepoStructureSovereigntyListItem[]
): RepoStructureSovereigntyListFilterOptions {
	const corporations = new Map<string, string>()
	const assignedGroups = new Map<string, string>()
	const regions = new Map<string, string>()
	const systems = new Map<string, string>()
	const controllerAlliances = new Map<string, string>()
	const vulnerabilityStates = new Set<SovereigntyVulnerabilityState>()

	for (const item of items) {
		corporations.set(item.corporationId, item.corporationName)
		if (item.assignedGroupId) {
			assignedGroups.set(item.assignedGroupId, item.assignedGroupId)
		}
		if (item.regionId) {
			regions.set(item.regionId, item.regionName ?? item.regionId)
		}
		systems.set(item.systemId, item.systemName ?? item.systemId)
		if (item.controllerAllianceId) {
			controllerAlliances.set(
				item.controllerAllianceId,
				item.controllerAllianceName ?? item.controllerAllianceId
			)
		}
		vulnerabilityStates.add(getSovereigntyVulnerabilityState(item))
	}

	return {
		corporations: Array.from(corporations.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		assignedGroups: Array.from(assignedGroups.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		regions: Array.from(regions.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		systems: Array.from(systems.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		controllerAlliances: Array.from(controllerAlliances.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		vulnerabilityStates: Array.from(vulnerabilityStates.values())
			.sort((left, right) => left.localeCompare(right))
			.map((value) => {
				switch (value) {
					case 'vulnerable':
						return { value, label: 'Vulnerable' }
					case 'invulnerable':
						return { value, label: 'Invulnerable' }
					case 'reinforced':
						return { value, label: 'Reinforced' }
					case 'unknown':
						return { value, label: 'Unknown' }
				}
			}),
	}
}

async function buildSovereigntySummary(
	db: DbClient<DbSchema>,
	items: RepoStructureSovereigntyListItem[],
	moduleConfig: Pick<
		StructureModuleConfigResult,
		| 'lowFuelTimeThresholdHours'
		| 'criticalFuelTimeThresholdHours'
		| 'lowFuelAmountThreshold'
		| 'criticalFuelAmountThreshold'
	>
): Promise<RepoStructureSovereigntyListSummary> {
	const baseSummary = buildStructureSummaryCounts(items, moduleConfig)
	const hubBurnRates = summarizeSovereigntyHubBurnRates(items)
	const summary: RepoStructureSovereigntyListSummary = {
		...baseSummary,
		vulnerable: 0,
		invulnerable: 0,
		reinforced: 0,
		unknown: 0,
		...hubBurnRates,
	}

	for (const item of items) {
		if (isSovereigntyHubLowFuel(item, moduleConfig)) {
			summary.lowFuel += 1
		}
		switch (getSovereigntyVulnerabilityState(item)) {
			case 'vulnerable':
				summary.vulnerable += 1
				break
			case 'invulnerable':
				summary.invulnerable += 1
				break
			case 'reinforced':
				summary.reinforced += 1
				break
			case 'unknown':
				summary.unknown += 1
				break
			}
	}
	return summary
}

function summarizeSovereigntyHubBurnRates(items: RepoStructureSovereigntyListItem[]): Pick<
	RepoStructureSovereigntyListSummary,
		| 'magmaticGasBurningPerHour'
		| 'superionicIceBurningPerHour'
		| 'magmaticGasBurningSampleCount'
		| 'superionicIceBurningSampleCount'
> {
	let magmaticGasBurningPerHour = 0
	let superionicIceBurningPerHour = 0
	let magmaticGasBurningSampleCount = 0
	let superionicIceBurningSampleCount = 0

	for (const item of items) {
		if (
			item.magmaticGasQuantity > 0 &&
			Number.isFinite(item.magmaticGasBurningPerHour) &&
			item.magmaticGasBurningPerHour > 0
		) {
			magmaticGasBurningPerHour += item.magmaticGasBurningPerHour
			magmaticGasBurningSampleCount += 1
		}
		if (
			item.superionicIceQuantity > 0 &&
			Number.isFinite(item.superionicIceBurningPerHour) &&
			item.superionicIceBurningPerHour > 0
		) {
			superionicIceBurningPerHour += item.superionicIceBurningPerHour
			superionicIceBurningSampleCount += 1
		}
	}

	return {
		magmaticGasBurningPerHour:
			magmaticGasBurningSampleCount > 0 ? magmaticGasBurningPerHour.toFixed(4) : null,
		superionicIceBurningPerHour:
			superionicIceBurningSampleCount > 0 ? superionicIceBurningPerHour.toFixed(4) : null,
		magmaticGasBurningSampleCount,
		superionicIceBurningSampleCount,
	}
}

function isSovereigntyHubLowFuel(
	item: RepoStructureSovereigntyListItem,
	moduleConfig: Pick<
		StructureModuleConfigResult,
		| 'lowFuelTimeThresholdHours'
		| 'criticalFuelTimeThresholdHours'
		| 'lowFuelAmountThreshold'
		| 'criticalFuelAmountThreshold'
	>
): boolean {
	const thresholdMs = moduleConfig.lowFuelTimeThresholdHours * 60 * 60 * 1000
	const now = Date.now()
	const magmaticGasLow =
		item.magmaticGasQuantity > 0 &&
		item.magmaticGasEstimatedDepletionAt !== null &&
		new Date(item.magmaticGasEstimatedDepletionAt).getTime() - now <= thresholdMs
	const superionicIceLow =
		item.superionicIceQuantity > 0 &&
		item.superionicIceEstimatedDepletionAt !== null &&
		new Date(item.superionicIceEstimatedDepletionAt).getTime() - now <= thresholdMs

	return magmaticGasLow || superionicIceLow
}

function emptySovereigntyFilterOptions(): RepoStructureSovereigntyListFilterOptions {
	return {
		corporations: [],
		assignedGroups: [],
		regions: [],
		systems: [],
		controllerAlliances: [],
		vulnerabilityStates: [],
	}
}

function emptySovereigntySummary(): RepoStructureSovereigntyListSummary {
	return {
		total: 0,
		lowFuel: 0,
		lowPower: 0,
		reinforced: 0,
		estimatedFuelBurnRatePerHour: null,
		fuelBurnRateSampleCount: 0,
		vulnerable: 0,
		invulnerable: 0,
		unknown: 0,
		magmaticGasBurningPerHour: null,
		superionicIceBurningPerHour: null,
		magmaticGasBurningSampleCount: 0,
		superionicIceBurningSampleCount: 0,
	}
}

function emptyStructureListSummary(): StructureListSummary {
	return {
		total: 0,
		lowFuel: 0,
		lowPower: 0,
		reinforced: 0,
		estimatedFuelBurnRatePerHour: null,
		fuelBurnRateSampleCount: 0,
	}
}

function buildStructureSummaryCounts(
	items: Array<
		Pick<
			StructureFilterableItemBase,
			'state' | 'lowPower' | 'lowPowerAllowed' | 'fuelAmount' | 'fuelExpires'
		> & { estimatedFuelBurnRatePerHour?: string | null }
	>,
	moduleConfig: Pick<
		StructureModuleConfigResult,
		| 'lowFuelTimeThresholdHours'
		| 'criticalFuelTimeThresholdHours'
		| 'lowFuelAmountThreshold'
		| 'criticalFuelAmountThreshold'
	>,
	totalCountOverride?: number
): StructureListSummary {
	let totalEstimatedFuelBurnRatePerHour = 0
	let fuelBurnRateSampleCount = 0
	for (const structure of items) {
		if (structure.estimatedFuelBurnRatePerHour === null || structure.estimatedFuelBurnRatePerHour === undefined) {
			continue
		}

		const burnRate = Number.parseFloat(structure.estimatedFuelBurnRatePerHour)
		if (!Number.isFinite(burnRate)) {
			continue
		}

		totalEstimatedFuelBurnRatePerHour += burnRate
		fuelBurnRateSampleCount += 1
	}

	return {
		total: totalCountOverride ?? items.length,
		lowFuel: items.filter((structure) => isFuelBelowThreshold(structure, moduleConfig)).length,
		lowPower: items.filter((structure) => structure.lowPower && !structure.lowPowerAllowed).length,
		reinforced: items.filter((structure) => isReinforcedStructureState(structure.state)).length,
		estimatedFuelBurnRatePerHour:
			fuelBurnRateSampleCount > 0 ? totalEstimatedFuelBurnRatePerHour.toFixed(4) : null,
		fuelBurnRateSampleCount,
	}
}

async function buildStructureSummary(
	items: Array<
		Pick<
			StructureFilterableItemBase,
			'structureId' | 'state' | 'lowPower' | 'lowPowerAllowed' | 'fuelAmount' | 'fuelExpires'
		> & { estimatedFuelBurnRatePerHour?: string | null }
	>,
	moduleConfig: Pick<
		StructureModuleConfigResult,
		| 'lowFuelTimeThresholdHours'
		| 'criticalFuelTimeThresholdHours'
		| 'lowFuelAmountThreshold'
		| 'criticalFuelAmountThreshold'
	>,
	totalCountOverride?: number
): Promise<StructureListSummary> {
	return buildStructureSummaryCounts(items, moduleConfig, totalCountOverride)
}

async function loadFuelUsageForStructure(
	db: DbClient<DbSchema>,
	corporationId: string,
	structureId: string
): Promise<StructureFuelUsageHistory | null> {
	const rows = await db.query.structureFuelLog.findMany({
		where: and(
			eq(structureFuelLog.corporationId, corporationId),
			eq(structureFuelLog.structureId, structureId)
		),
		orderBy: desc(structureFuelLog.observedAt),
	})

	if (rows.length === 0) {
		return null
	}

	const samples: StructureFuelHistorySample[] = rows.map((row) => ({
		structureId: row.structureId,
		fuelBlockUnits: row.fuelBlockUnits,
		observedAt: row.observedAt,
		updatedAt: row.updatedAt,
	}))

	return buildStructureFuelUsageHistory(samples)
}

function emptyStructureFilterOptions(): StructureListFilterOptions {
	return {
		corporations: [],
		regions: [],
		systems: [],
		states: [],
		types: [],
		assignedGroups: [],
		alliances: [],
		planets: [],
		raidableStates: [],
	}
}

function emptyStructureOverviewMetrics(): StructureOverviewMetrics {
	return emptyStructureListSummary()
}

interface StructureBaseFilterQuery {
	corporationId?: string
	assignedGroupId?: string
	lowPower?: 'true' | 'false'
	lowPowerAllowed?: 'true' | 'false'
	regionId?: string
	systemId?: string
	state?: string
	typeId?: string
}

type VisibleStructureContextsResult = {
	moduleConfig: StructureModuleConfigResult
	access: StructureAccessScope
	contexts: VisibleStructureContext[]
	totalCount: number
}

type VisibleOperationalStructureRow = {
	structureId: string
	corporationId: string
	corporationName: string | null
	name: string | null
	typeId: string
	typeName: string | null
	systemId: string
	systemName: string | null
	regionId: string | null
	regionName: string | null
	state: string
	stateTimerEnd: Date | null
	nextReinforceApply: Date | null
	unanchorsAt: Date | null
	fuelExpires: Date | null
	fuelAmount: number | null
	fuelBurnRate: string | null
	lowPower: boolean
	hidden: boolean | null
	lowPowerAllowed: boolean | null
	assignedGroupId: string | null
	syncStatus: string
	syncFailureReason: string | null
	lastSyncedAt: Date | null
	updatedAt: Date
}

type VisibleSkyhookStructureRow = VisibleOperationalStructureRow & {
	planetId: string | null
	planetName: string | null
	isActive: boolean | null
	effectiveWorkforce: number | null
	reagents: typeof structureSkyhooks.$inferSelect['reagents'] | null
	reinforcementTimerEnd: Date | null
	theftVulnerabilityStart: Date | null
	theftVulnerabilityEnd: Date | null
	isRaidable: boolean | null
}

type VisibleStructureContextCacheEntry = {
	value: Promise<VisibleStructureContextsResult>
}

// Dedupes concurrent loads only; settled entries are cleared immediately.
const visibleStructureContextCache = new Map<string, VisibleStructureContextCacheEntry>()

function buildVisibleStructureContextCacheKey(
	user: SessionUser,
	query: StructureBaseFilterQuery,
	tabFilter?: StructureTab
): string {
	return JSON.stringify({
		userId: user.id,
		isAdmin: user.is_admin,
		roles: [...user.roles].sort(),
		tabFilter: tabFilter ?? null,
		corporationId: query.corporationId ?? null,
		assignedGroupId: query.assignedGroupId ?? null,
		lowPower: query.lowPower ?? null,
		lowPowerAllowed: query.lowPowerAllowed ?? null,
		regionId: query.regionId ?? null,
		systemId: query.systemId ?? null,
		state: query.state ?? null,
		typeId: query.typeId ?? null,
	})
}

function invalidateVisibleStructureContextCache(): void {
	visibleStructureContextCache.clear()
}

function buildOperationalStructureListItem(
	row: VisibleOperationalStructureRow,
	canViewDetails: boolean
): StructureListItem {
	const nextStateAt = row.stateTimerEnd ?? row.nextReinforceApply ?? row.unanchorsAt

	return {
		structureId: row.structureId,
		corporationId: row.corporationId,
		corporationName: row.corporationName ?? row.corporationId,
		name: row.name ?? row.structureId,
		typeId: row.typeId,
		typeName: row.typeName,
		systemId: row.systemId,
		systemName: row.systemName,
		regionId: row.regionId,
		regionName: row.regionName,
		state: row.state,
		nextStateAt: toIso(nextStateAt),
		fuelExpires: toIso(row.fuelExpires),
		fuelAmount: row.fuelAmount,
		estimatedFuelBurnRatePerHour: row.fuelBurnRate ?? null,
		lowPower: row.lowPower,
		hidden: row.hidden ?? false,
		lowPowerAllowed: row.lowPowerAllowed ?? false,
		assignedGroupId: row.assignedGroupId,
		syncStatus: getStructureSyncStatus(row.syncStatus as StructureListItem['syncStatus'], row.lastSyncedAt),
		syncFailureReason: row.syncFailureReason,
		lastSyncedAt: toIso(row.lastSyncedAt),
		updatedAt: row.updatedAt.toISOString(),
		canViewDetails,
	}
}

async function loadVisibleStructureContextsUncached(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureBaseFilterQuery,
	tabFilter?: StructureTab
): Promise<VisibleStructureContextsResult> {
	const moduleConfig = await getStructureModuleConfig(db)
	const access = computeStructureAccess(user.roles, user.is_admin)
	const corpWhere = buildVisibleStructureContextsWhere(access, query, tabFilter)
	if (!corpWhere) {
		return {
			moduleConfig,
			access,
			contexts: [],
			totalCount: 0,
		}
	}

	const corpRows = await db
		.select({
			structure: corporationStructures,
			config: structureConfigs,
		})
		.from(corporationStructures)
		.leftJoin(structureConfigs, eq(structureConfigs.structureId, corporationStructures.structureId))
		.where(corpWhere ?? sql`true`)
	const [{ totalCount }] = await db
		.select({
			totalCount: sql<number>`count(*)::int`,
		})
		.from(corporationStructures)
		.leftJoin(structureConfigs, eq(structureConfigs.structureId, corporationStructures.structureId))
		.where(corpWhere ?? sql`true`)

	const corpStructures = corpRows.map((row) => row.structure)
	const configsByStructureId = new Map(
		corpRows
			.filter(
				(row): row is (typeof corpRows)[number] & { config: typeof structureConfigs.$inferSelect } =>
					row.config !== null
			)
			.map((row) => [row.structure.structureId, row.config] as const)
	)
	const corporationIds = [...new Set(corpStructures.map((structure) => structure.corporationId))]
	const corporationRows = corporationIds.length
		? await db.query.managedCorporations.findMany({
				where: inArray(managedCorporations.corporationId, corporationIds),
				columns: {
					corporationId: true,
					name: true,
					includeInStructureAssetSync: true,
				},
			})
		: []
	const corporationById = new Map(corporationRows.map((row) => [row.corporationId, row] as const))

	return {
		moduleConfig,
		access,
		totalCount,
		contexts: corpStructures
			.map<VisibleStructureContext | null>((structure) => {
				const config = configsByStructureId.get(structure.structureId) ?? null
				const structureTab = getStructureTab(structure)
				const canViewDetails =
					user.is_admin || canViewDetailsStructure(access, structure.corporationId, structureTab)
				const canViewSensitive =
					user.is_admin || canViewSensitiveStructure(access, structure.corporationId, structureTab)
				const canEdit =
					user.is_admin || canEditStructure(access, structure.corporationId, structureTab)
				if (config?.hidden && !canViewSensitive) {
					return null
				}

				const corporation = corporationById.get(structure.corporationId)

				return {
					structure,
					corporationName: corporation?.name ?? structure.corporationId,
					includeInStructureAssetSync: corporation?.includeInStructureAssetSync ?? false,
					config,
					canViewDetails,
					canViewSensitive,
					canEdit,
					tabData: null,
					fittingItems: null,
					lastRefilledAt: null,
					fuelUsage: null,
				}
			})
			.filter((item): item is VisibleStructureContext => item !== null)
	}
}

function buildVisibleStructureContextsWhere(
	access: StructureAccessScope,
	query: StructureBaseFilterQuery,
	tabFilter?: StructureTab
): any {
	const accessibleCorporations = getAccessibleCorporationIds(access, tabFilter)

	if (!accessibleCorporations.hasGlobalAccess && accessibleCorporations.corporationIds.size === 0) {
		return eq(corporationStructures.corporationId, '__no_access__')
	}

	const conditions: StructureWhereCondition[] = []
	if (query.corporationId) {
		conditions.push(eq(corporationStructures.corporationId, query.corporationId))
	}
	if (!accessibleCorporations.hasGlobalAccess) {
		conditions.push(inArray(corporationStructures.corporationId, [...accessibleCorporations.corporationIds]))
	}
	if (query.lowPower === 'true') {
		conditions.push(eq(corporationStructures.lowPower, true))
	} else if (query.lowPower === 'false') {
		conditions.push(eq(corporationStructures.lowPower, false))
	}
	if (query.regionId) {
		conditions.push(eq(corporationStructures.regionId, query.regionId))
	}
	if (query.systemId) {
		conditions.push(eq(corporationStructures.systemId, query.systemId))
	}
	if (query.state) {
		conditions.push(eq(corporationStructures.state, query.state))
	}
	if (query.typeId) {
		conditions.push(eq(corporationStructures.typeId, query.typeId))
	}
	if (tabFilter) {
		const tabWhere = buildStructureFamilyWhere(tabFilter)
		if (tabWhere) {
			conditions.push(tabWhere)
		}
	}
	if (query.assignedGroupId === '__unassigned__') {
		conditions.push(isNotNull(structureConfigs.structureId))
		conditions.push(isNull(structureConfigs.assignedGroupId))
	} else if (query.assignedGroupId) {
		conditions.push(eq(structureConfigs.assignedGroupId, query.assignedGroupId))
	}
	if (query.lowPowerAllowed === 'true') {
		conditions.push(eq(structureConfigs.lowPowerAllowed, true))
	} else if (query.lowPowerAllowed === 'false') {
		conditions.push(or(eq(structureConfigs.lowPowerAllowed, false), isNull(structureConfigs.structureId)) ?? sql`false`)
	}
	const hiddenVisibilityWhere = buildHiddenVisibilityWhere(access, tabFilter)
	const hiddenVisibilityConditions: StructureWhereCondition[] = [
		eq(structureConfigs.hidden, false),
		isNull(structureConfigs.structureId),
	]
	if (hiddenVisibilityWhere !== undefined) {
		hiddenVisibilityConditions.push(hiddenVisibilityWhere)
	}
	conditions.push(or(...hiddenVisibilityConditions) ?? sql`false`)
	return combineWhereConditions(conditions)
}

function buildCommonStructureFilterOptionsFromRows(
	rows: Array<{
		corporationId: string
		corporationName: string | null
		assignedGroupId: string | null
		regionId: string | null
		regionName: string | null
		systemId: string
		systemName: string | null
		state: string
		typeId: string
		typeName: string | null
	}>
): StructureListFilterOptions {
	const corporations = new Map<string, string>()
	const assignedGroups = new Map<string, string>()
	const regions = new Map<string, string>()
	const systems = new Map<string, string>()
	const states = new Set<string>()
	const types = new Map<string, string>()

	for (const row of rows) {
		corporations.set(row.corporationId, row.corporationName ?? row.corporationId)
		if (row.assignedGroupId) {
			assignedGroups.set(row.assignedGroupId, row.assignedGroupId)
		}
		if (row.regionId) {
			regions.set(row.regionId, row.regionName ?? row.regionId)
		}
		systems.set(row.systemId, row.systemName ?? row.systemId)
		states.add(row.state)
		types.set(row.typeId, row.typeName ?? row.typeId)
	}

	return {
		corporations: [...corporations.entries()]
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		assignedGroups: [...assignedGroups.entries()]
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		regions: [...regions.entries()]
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		systems: [...systems.entries()]
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		states: [...states.values()]
			.sort((left, right) => left.localeCompare(right))
			.map((value) => ({ value, label: value })),
		types: [...types.entries()]
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		alliances: [],
		planets: [],
		raidableStates: [],
	}
}

function buildVisibleOperationalStructuresCte(db: DbClient<DbSchema>, corpWhere: any) {
	return db.$with('visible_operational_structures').as(
		db
			.select({
				structureId: corporationStructures.structureId,
				corporationId: corporationStructures.corporationId,
				corporationName: managedCorporations.name,
				name: corporationStructures.name,
				typeId: corporationStructures.typeId,
				typeName: corporationStructures.typeName,
				systemId: corporationStructures.systemId,
				systemName: corporationStructures.systemName,
				regionId: corporationStructures.regionId,
				regionName: corporationStructures.regionName,
				state: corporationStructures.state,
				stateTimerEnd: corporationStructures.stateTimerEnd,
				nextReinforceApply: corporationStructures.nextReinforceApply,
				unanchorsAt: corporationStructures.unanchorsAt,
				fuelExpires: corporationStructures.fuelExpires,
				fuelAmount: corporationStructures.fuelAmount,
				fuelBurnRate: corporationStructures.fuelBurnRate,
				lowPower: corporationStructures.lowPower,
				hidden: structureConfigs.hidden,
				lowPowerAllowed: structureConfigs.lowPowerAllowed,
				assignedGroupId: structureConfigs.assignedGroupId,
				syncStatus: corporationStructures.syncStatus,
				syncFailureReason: corporationStructures.syncFailureReason,
				lastSyncedAt: corporationStructures.lastSyncedAt,
				updatedAt: corporationStructures.updatedAt,
			})
			.from(corporationStructures)
			.leftJoin(structureConfigs, eq(structureConfigs.structureId, corporationStructures.structureId))
			.leftJoin(managedCorporations, eq(managedCorporations.corporationId, corporationStructures.corporationId))
			.where(corpWhere ?? sql`true`)
	)
}

function buildVisibleSkyhookStructuresCte(db: DbClient<DbSchema>, corpWhere: any) {
	return db.$with('visible_skyhook_structures').as(
		db
			.select({
				structureId: corporationStructures.structureId,
				corporationId: corporationStructures.corporationId,
				corporationName: managedCorporations.name,
				name: corporationStructures.name,
				typeId: corporationStructures.typeId,
				typeName: corporationStructures.typeName,
				systemId: corporationStructures.systemId,
				systemName: corporationStructures.systemName,
				regionId: corporationStructures.regionId,
				regionName: corporationStructures.regionName,
				state: corporationStructures.state,
				stateTimerEnd: corporationStructures.stateTimerEnd,
				nextReinforceApply: corporationStructures.nextReinforceApply,
				unanchorsAt: corporationStructures.unanchorsAt,
				fuelExpires: corporationStructures.fuelExpires,
				fuelAmount: corporationStructures.fuelAmount,
				fuelBurnRate: corporationStructures.fuelBurnRate,
				lowPower: corporationStructures.lowPower,
				hidden: structureConfigs.hidden,
				lowPowerAllowed: structureConfigs.lowPowerAllowed,
				assignedGroupId: structureConfigs.assignedGroupId,
				syncStatus: corporationStructures.syncStatus,
				syncFailureReason: corporationStructures.syncFailureReason,
				lastSyncedAt: corporationStructures.lastSyncedAt,
				updatedAt: corporationStructures.updatedAt,
				planetId: structureSkyhooks.planetId,
				planetName: structureSkyhooks.planetName,
				isActive: structureSkyhooks.isActive,
				effectiveWorkforce: structureSkyhooks.effectiveWorkforce,
				reagents: structureSkyhooks.reagents,
				reinforcementTimerEnd: structureSkyhooks.reinforcementTimerEnd,
				theftVulnerabilityStart: structureSkyhooks.theftVulnerabilityStart,
				theftVulnerabilityEnd: structureSkyhooks.theftVulnerabilityEnd,
				isRaidable: getSkyhookCurrentRaidableExpression(structureSkyhooks),
			})
			.from(corporationStructures)
			.leftJoin(structureConfigs, eq(structureConfigs.structureId, corporationStructures.structureId))
			.leftJoin(structureSkyhooks, eq(structureSkyhooks.structureId, corporationStructures.structureId))
			.leftJoin(
				managedCorporations,
				eq(managedCorporations.corporationId, corporationStructures.corporationId)
			)
			.where(corpWhere ?? sql`true`)
	)
}

function extractSkyhookSummaryFillPercentSql(source: any, field: 'securedFillPercent' | 'unsecuredFillPercent') {
	const key = field === 'securedFillPercent' ? 'securedFillPercent' : 'unsecuredFillPercent'
	return sql<number | null>`nullif(((${source.reagents} -> 'summary' ->> ${key})::numeric), 'NaN'::numeric)`
}

function buildSkyhookSortOrder(
	sortBy: StructureListSortField,
	sortDirection: StructureListSortDirection,
	source: any
) {
	const descending = sortDirection === 'desc'
	const sortExpression = (expression: any) => (descending ? desc(expression) : asc(expression))

	switch (sortBy) {
		case 'fuel':
			return descending
				? [
						asc(sql`case when ${source.fuelExpires} is null then 0 else 1 end`),
						desc(source.fuelExpires),
						desc(source.fuelAmount),
						desc(source.structureId),
					]
				: [
						asc(sql`case when ${source.fuelExpires} is null then 1 else 0 end`),
						asc(source.fuelExpires),
						asc(source.fuelAmount),
						asc(source.structureId),
					]
		case 'updatedAt':
			return [sortExpression(source.updatedAt), sortExpression(source.structureId)]
		case 'nextStateAt':
			return [
				sortExpression(
					sql`coalesce(${source.stateTimerEnd}, ${source.nextReinforceApply}, ${source.unanchorsAt})`
				),
				sortExpression(source.structureId),
			]
		case 'theftVulnerabilityStart':
			return [sortExpression(source.theftVulnerabilityStart), sortExpression(source.structureId)]
		case 'skyhookSecureFullness':
			return [
				sortExpression(extractSkyhookSummaryFillPercentSql(source, 'securedFillPercent')),
				sortExpression(source.structureId),
			]
		case 'skyhookSurplusFullness':
			return [
				sortExpression(extractSkyhookSummaryFillPercentSql(source, 'unsecuredFillPercent')),
				sortExpression(source.structureId),
			]
		case 'raidable':
			return [sortExpression(source.isRaidable), sortExpression(source.structureId)]
		case 'workforce':
			return [sortExpression(source.effectiveWorkforce), sortExpression(source.structureId)]
		case 'name':
			return [sortExpression(source.structureId), sortExpression(source.structureId)]
		case 'corporation':
			return [sortExpression(sql`coalesce(${source.corporationName}, '')`), sortExpression(source.structureId)]
		case 'region':
			return [sortExpression(sql`coalesce(${source.regionName}, '')`), sortExpression(source.structureId)]
		case 'system':
			return [sortExpression(sql`coalesce(${source.systemName}, '')`), sortExpression(source.structureId)]
		case 'type':
			return [sortExpression(sql`coalesce(${source.typeName}, '')`), sortExpression(source.structureId)]
		case 'state':
			return [sortExpression(source.state), sortExpression(source.structureId)]
		case 'group':
			return [sortExpression(sql`coalesce(${source.assignedGroupId}, '')`), sortExpression(source.structureId)]
		case 'syncStatus':
			return [
				sortExpression(
					sql`case ${source.syncStatus} when 'error' then 0 when 'warning' then 1 when 'ok' then 2 else null end`
				),
				sortExpression(source.structureId),
			]
		default:
			return null
	}
}

function isSqlPagedSkyhookSort(sortBy: StructureListSortField): boolean {
	switch (sortBy) {
		case 'fuel':
		case 'updatedAt':
		case 'nextStateAt':
		case 'theftVulnerabilityStart':
		case 'skyhookSecureFullness':
		case 'skyhookSurplusFullness':
		case 'raidable':
		case 'workforce':
		case 'name':
		case 'corporation':
		case 'region':
		case 'system':
		case 'type':
		case 'state':
		case 'group':
		case 'syncStatus':
			return true
		default:
			return false
	}
}

function buildSkyhookVisibilityWhere(access: StructureAccessScope, query: StructureSkyhookListQuery): any {
	const conditions: StructureWhereCondition[] = []
	const baseWhere = buildVisibleStructureContextsWhere(access, query, 'skyhooks')
	if (baseWhere) {
		conditions.push(baseWhere)
	}
	if (query.planetId) {
		conditions.push(eq(structureSkyhooks.planetId, query.planetId))
	}
	if (query.isRaidable === 'true') {
		conditions.push(eq(getSkyhookCurrentRaidableExpression(structureSkyhooks), true))
	} else if (query.isRaidable === 'false') {
		conditions.push(eq(getSkyhookCurrentRaidableExpression(structureSkyhooks), false))
	}
	return combineWhereConditions(conditions)
}

function buildSkyhookListItemFromRow(
	row: VisibleSkyhookStructureRow,
	canViewDetails: boolean
): RepoStructureSkyhookListItem {
	const reagentSnapshot = row.reagents ?? []
	const reagentSummary = getSkyhookReagentSummary(reagentSnapshot)
	const reagentEntries = getSkyhookReagentEntries(reagentSnapshot)
	const normalizedState = getSkyhookState(
		row.state,
		row.isRaidable ?? false,
		row.reinforcementTimerEnd ? row.reinforcementTimerEnd.toISOString() : null
	)

	return {
		structureId: row.structureId,
		corporationId: row.corporationId,
		corporationName: row.corporationName ?? row.corporationId,
		typeId: row.typeId,
		typeName: row.typeName,
		systemId: row.systemId,
		systemName: row.systemName ?? null,
		regionId: row.regionId,
		regionName: row.regionName,
		state: normalizedState,
		nextStateAt: toIso(row.stateTimerEnd ?? row.nextReinforceApply ?? row.unanchorsAt),
		lowPower: row.lowPower,
		hidden: row.hidden ?? false,
		lowPowerAllowed: row.lowPowerAllowed ?? false,
		assignedGroupId: row.assignedGroupId,
		syncStatus: getStructureSyncStatus(
			row.syncStatus as RepoStructureSkyhookListItem['syncStatus'],
			row.lastSyncedAt
		),
		syncFailureReason: row.syncFailureReason,
		lastSyncedAt: toIso(row.lastSyncedAt),
		updatedAt: row.updatedAt.toISOString(),
		canViewDetails,
		planetId: row.planetId ?? '',
		planetName: row.planetName ?? null,
		isActive: row.isActive ?? false,
		effectiveWorkforce: row.effectiveWorkforce ?? null,
		totalReagents: reagentSummary?.totalReagents ?? reagentEntries.length,
		totalSecuredStock: reagentSummary?.totalSecuredStock ?? 0,
		totalUnsecuredStock: reagentSummary?.totalUnsecuredStock ?? 0,
		totalSecuredVolumeM3: reagentSummary?.totalSecuredVolumeM3 ?? 0,
		totalUnsecuredVolumeM3: reagentSummary?.totalUnsecuredVolumeM3 ?? 0,
		securedCapacityM3: SKYHOOK_SECURED_BAY_CAPACITY_M3,
		unsecuredCapacityM3: SKYHOOK_SURPLUS_BAY_CAPACITY_M3,
		securedFillPercent: reagentSummary?.securedFillPercent ?? 0,
		unsecuredFillPercent: reagentSummary?.unsecuredFillPercent ?? 0,
		reagents: reagentEntries.map((reagent) => ({
			typeId: reagent.typeId,
			typeName:
				reagent.typeId === SKYHOOK_MAGMATIC_GAS_TYPE_ID
					? SKYHOOK_MAGMATIC_GAS_TYPE_NAME
					: reagent.typeId === SKYHOOK_SUPERIONIC_ICE_TYPE_ID
						? SKYHOOK_SUPERIONIC_ICE_TYPE_NAME
						: null,
			unitVolumeM3: getSkyhookReagentUnitVolumeM3(reagent.typeId),
			securedStock: reagent.securedStock,
			unsecuredStock: reagent.unsecuredStock,
			securedVolumeM3: reagent.securedStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
			unsecuredVolumeM3: reagent.unsecuredStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
			securedCapacityM3: SKYHOOK_SECURED_BAY_CAPACITY_M3,
			unsecuredCapacityM3: SKYHOOK_SURPLUS_BAY_CAPACITY_M3,
			securedFillPercent: getSkyhookFullness(
				reagent.securedStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
				SKYHOOK_SECURED_BAY_CAPACITY_M3
			),
			unsecuredFillPercent: getSkyhookFullness(
				reagent.unsecuredStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
				SKYHOOK_SURPLUS_BAY_CAPACITY_M3
			),
			lastCycle: reagent.lastCycle,
		})),
			reinforcementTimerEnd: toIso(row.reinforcementTimerEnd),
			theftVulnerabilityStart: toIso(row.theftVulnerabilityStart),
			theftVulnerabilityEnd: toIso(row.theftVulnerabilityEnd),
			isRaidable: row.isRaidable ?? false,
		}
	}

async function buildSkyhookStructureFilterOptionsFromSql(
	db: DbClient<DbSchema>,
	visibleSkyhookStructures: ReturnType<typeof buildVisibleSkyhookStructuresCte>
): Promise<StructureListFilterOptions> {
	const visibleRowsDb = db.with(visibleSkyhookStructures)
	const [corporations, assignedGroups, regions, systems, states, types, planets] = await Promise.all([
		visibleRowsDb
			.selectDistinct({
				corporationId: visibleSkyhookStructures.corporationId,
				corporationName: visibleSkyhookStructures.corporationName,
			})
			.from(visibleSkyhookStructures)
			.orderBy(asc(visibleSkyhookStructures.corporationName)),
		visibleRowsDb
			.selectDistinct({
				assignedGroupId: visibleSkyhookStructures.assignedGroupId,
			})
			.from(visibleSkyhookStructures)
			.where(isNotNull(visibleSkyhookStructures.assignedGroupId))
			.orderBy(asc(visibleSkyhookStructures.assignedGroupId)),
		visibleRowsDb
			.selectDistinct({
				regionId: visibleSkyhookStructures.regionId,
				regionName: visibleSkyhookStructures.regionName,
			})
			.from(visibleSkyhookStructures)
			.orderBy(asc(visibleSkyhookStructures.regionName)),
		visibleRowsDb
			.selectDistinct({
				systemId: visibleSkyhookStructures.systemId,
				systemName: visibleSkyhookStructures.systemName,
			})
			.from(visibleSkyhookStructures)
			.orderBy(asc(visibleSkyhookStructures.systemName)),
		visibleRowsDb
			.selectDistinct({
				state: visibleSkyhookStructures.state,
			})
			.from(visibleSkyhookStructures)
			.orderBy(asc(visibleSkyhookStructures.state)),
		visibleRowsDb
			.selectDistinct({
				typeId: visibleSkyhookStructures.typeId,
				typeName: visibleSkyhookStructures.typeName,
			})
			.from(visibleSkyhookStructures)
			.orderBy(asc(visibleSkyhookStructures.typeName)),
		visibleRowsDb
			.selectDistinct({
				planetId: visibleSkyhookStructures.planetId,
				planetName: visibleSkyhookStructures.planetName,
			})
			.from(visibleSkyhookStructures)
			.where(isNotNull(visibleSkyhookStructures.planetId))
			.orderBy(asc(visibleSkyhookStructures.planetName)),
	])

	return {
		corporations: corporations
			.map((row) => ({
				value: row.corporationId,
				label: row.corporationName ?? row.corporationId,
			}))
			.filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index),
		assignedGroups: assignedGroups
			.map((row) => ({
				value: row.assignedGroupId ?? '',
				label: row.assignedGroupId ?? '',
			}))
			.filter((option) => option.value.length > 0),
		regions: regions
			.map((row) => ({
				value: row.regionId ?? '',
				label: row.regionName ?? row.regionId ?? '',
			}))
			.filter((option) => option.value.length > 0),
		systems: systems
			.map((row) => ({
				value: row.systemId,
				label: row.systemName ?? row.systemId,
			}))
			.filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index),
		states: states
			.map((row) => ({
				value: row.state,
				label: row.state,
			}))
			.filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index),
		types: types
			.map((row) => ({
				value: row.typeId,
				label: row.typeName ?? row.typeId,
			}))
			.filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index),
		alliances: [],
		planets: planets
			.map((row) => ({
				value: row.planetId ?? '',
				label: row.planetName ?? row.planetId ?? '',
			}))
			.filter((option) => option.value.length > 0),
		raidableStates: [
			{ value: 'false', label: 'Not raidable' },
			{ value: 'true', label: 'Raidable' },
		],
	}
}

function getSkyhookCurrentRaidableExpression(source: any) {
	return sql<boolean>`
		case
			when ${source.theftVulnerabilityStart} is null then false
			when ${source.theftVulnerabilityEnd} is not null and now() > ${source.theftVulnerabilityEnd} then false
			when ${source.theftVulnerabilityEnd} is null and now() > ${source.theftVulnerabilityStart} then true
			when ${source.theftVulnerabilityEnd} is not null and now() > ${source.theftVulnerabilityStart}
				and now() < ${source.theftVulnerabilityEnd} then true
			else false
		end
	`
}

async function buildSkyhookStructureSummaryFromSql(
	db: DbClient<DbSchema>,
	visibleSkyhookStructures: ReturnType<typeof buildVisibleSkyhookStructuresCte>
): Promise<StructureListSummary> {
	const visibleRowsDb = db.with(visibleSkyhookStructures)
	const currentRaidableExpression = getSkyhookCurrentRaidableExpression(visibleSkyhookStructures)
	const highestFillExpression = sql<number | null>`
		greatest(
			coalesce(((${visibleSkyhookStructures.reagents} -> 'summary' ->> 'securedFillPercent')::numeric), 0),
			coalesce(((${visibleSkyhookStructures.reagents} -> 'summary' ->> 'unsecuredFillPercent')::numeric), 0)
		)
	`
	const candidateStartExpression = sql<Date | null>`
		${visibleSkyhookStructures.theftVulnerabilityStart}
	`
	const [totalResult, highestFillResult, workforceResult, raidableCountResult, nextRaidableResult] =
		await Promise.all([
			visibleRowsDb
				.select({
					total: sql<number>`count(*)::int`,
				})
				.from(visibleSkyhookStructures),
			visibleRowsDb
				.select({
					skyhookHighestFillPercent: sql<number | null>`max(${highestFillExpression})`,
				})
				.from(visibleSkyhookStructures),
			visibleRowsDb
				.select({
					skyhookTotalWorkforce: sql<number>`coalesce(sum(${visibleSkyhookStructures.effectiveWorkforce}), 0)::int`,
				})
				.from(visibleSkyhookStructures),
			visibleRowsDb
				.select({
					skyhookCurrentRaidableCount: sql<number>`coalesce(sum(case when ${currentRaidableExpression} then 1 else 0 end), 0)::int`,
				})
				.from(visibleSkyhookStructures),
			visibleRowsDb
				.select({
					structureId: visibleSkyhookStructures.structureId,
					planetName: visibleSkyhookStructures.planetName,
					candidateStart: sql<string | null>`${candidateStartExpression}`,
					currentRaidable: currentRaidableExpression,
				})
				.from(visibleSkyhookStructures)
				.where(
					sql`(${candidateStartExpression}) is not null and (${visibleSkyhookStructures.theftVulnerabilityEnd} is null or now() <= ${visibleSkyhookStructures.theftVulnerabilityEnd})`
				)
				.orderBy(asc(candidateStartExpression), asc(visibleSkyhookStructures.structureId))
				.limit(1),
		])

	const nextRaidableRow = nextRaidableResult[0] ?? null
	const nextRaidableAt = nextRaidableRow
		? nextRaidableRow.currentRaidable
			? new Date().toISOString()
			: nextRaidableRow.candidateStart
				? new Date(nextRaidableRow.candidateStart).toISOString()
				: null
		: null

	return {
		total: totalResult[0]?.total ?? 0,
		lowFuel: 0,
		lowPower: 0,
		reinforced: 0,
		estimatedFuelBurnRatePerHour: null,
		fuelBurnRateSampleCount: 0,
		skyhookHighestFillPercent: highestFillResult[0]?.skyhookHighestFillPercent ?? null,
		skyhookNextRaidableAt: nextRaidableAt,
		skyhookNextRaidablePlanetName: nextRaidableRow?.planetName ?? null,
		skyhookCurrentRaidableCount: raidableCountResult[0]?.skyhookCurrentRaidableCount ?? 0,
		skyhookTotalWorkforce: workforceResult[0]?.skyhookTotalWorkforce ?? 0,
	}
}

async function loadVisibleSkyhookPageItems(
	db: DbClient<DbSchema>,
	user: SessionUser,
	access: StructureAccessScope,
	query: StructureSkyhookListQuery,
	visibleSkyhookStructures: ReturnType<typeof buildVisibleSkyhookStructuresCte>,
	pageOverride?: number
): Promise<RepoStructureSkyhookListItem[]> {
	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortOrder = buildSkyhookSortOrder(sortBy, sortDirection, visibleSkyhookStructures)
	if (!sortOrder) {
		return []
	}

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const page = Math.max(pageOverride ?? query.page ?? 1, 1)
	const offset = (page - 1) * pageSize
	const rows = await db
		.with(visibleSkyhookStructures)
		.select({
			structureId: visibleSkyhookStructures.structureId,
			corporationId: visibleSkyhookStructures.corporationId,
			corporationName: visibleSkyhookStructures.corporationName,
			name: visibleSkyhookStructures.name,
			typeId: visibleSkyhookStructures.typeId,
			typeName: visibleSkyhookStructures.typeName,
			systemId: visibleSkyhookStructures.systemId,
			systemName: visibleSkyhookStructures.systemName,
			regionId: visibleSkyhookStructures.regionId,
			regionName: visibleSkyhookStructures.regionName,
			state: visibleSkyhookStructures.state,
			stateTimerEnd: visibleSkyhookStructures.stateTimerEnd,
			nextReinforceApply: visibleSkyhookStructures.nextReinforceApply,
			unanchorsAt: visibleSkyhookStructures.unanchorsAt,
			fuelExpires: visibleSkyhookStructures.fuelExpires,
			fuelAmount: visibleSkyhookStructures.fuelAmount,
			fuelBurnRate: visibleSkyhookStructures.fuelBurnRate,
			lowPower: visibleSkyhookStructures.lowPower,
			hidden: visibleSkyhookStructures.hidden,
			lowPowerAllowed: visibleSkyhookStructures.lowPowerAllowed,
			assignedGroupId: visibleSkyhookStructures.assignedGroupId,
			syncStatus: visibleSkyhookStructures.syncStatus,
			syncFailureReason: visibleSkyhookStructures.syncFailureReason,
			lastSyncedAt: visibleSkyhookStructures.lastSyncedAt,
			updatedAt: visibleSkyhookStructures.updatedAt,
			planetId: visibleSkyhookStructures.planetId,
			planetName: visibleSkyhookStructures.planetName,
			isActive: visibleSkyhookStructures.isActive,
			effectiveWorkforce: visibleSkyhookStructures.effectiveWorkforce,
			reagents: visibleSkyhookStructures.reagents,
			reinforcementTimerEnd: visibleSkyhookStructures.reinforcementTimerEnd,
			theftVulnerabilityStart: visibleSkyhookStructures.theftVulnerabilityStart,
			theftVulnerabilityEnd: visibleSkyhookStructures.theftVulnerabilityEnd,
			isRaidable: visibleSkyhookStructures.isRaidable,
		})
		.from(visibleSkyhookStructures)
		.orderBy(...sortOrder)
		.limit(pageSize)
		.offset(offset)

	return rows.map((row) => {
		const structureTab = getStructureTab({
			typeId: row.typeId,
			typeName: row.typeName,
		})
		const canViewDetails =
			user.is_admin || canViewDetailsStructure(access, row.corporationId, structureTab)
		return buildSkyhookListItemFromRow(row, canViewDetails)
	})
}

async function buildOperationalStructureFilterOptions(
	db: DbClient<DbSchema>,
	visibleOperationalStructures: any
): Promise<StructureListFilterOptions> {
	const visibleRowsDb = db.with(visibleOperationalStructures)
	const [corporations, assignedGroups, regions, systems, states, types] = await Promise.all([
		visibleRowsDb
			.selectDistinct({
				corporationId: visibleOperationalStructures.corporationId,
				corporationName: visibleOperationalStructures.corporationName,
			})
			.from(visibleOperationalStructures)
			.orderBy(asc(visibleOperationalStructures.corporationName)),
		visibleRowsDb
			.selectDistinct({
				assignedGroupId: visibleOperationalStructures.assignedGroupId,
			})
			.from(visibleOperationalStructures)
			.where(isNotNull(visibleOperationalStructures.assignedGroupId))
			.orderBy(asc(visibleOperationalStructures.assignedGroupId)),
		visibleRowsDb
			.selectDistinct({
				regionId: visibleOperationalStructures.regionId,
				regionName: visibleOperationalStructures.regionName,
			})
			.from(visibleOperationalStructures)
			.orderBy(asc(visibleOperationalStructures.regionName)),
		visibleRowsDb
			.selectDistinct({
				systemId: visibleOperationalStructures.systemId,
				systemName: visibleOperationalStructures.systemName,
			})
			.from(visibleOperationalStructures)
			.orderBy(asc(visibleOperationalStructures.systemName)),
		visibleRowsDb
			.selectDistinct({
				state: visibleOperationalStructures.state,
			})
			.from(visibleOperationalStructures)
			.orderBy(asc(visibleOperationalStructures.state)),
		visibleRowsDb
			.selectDistinct({
				typeId: visibleOperationalStructures.typeId,
				typeName: visibleOperationalStructures.typeName,
			})
			.from(visibleOperationalStructures)
			.orderBy(asc(visibleOperationalStructures.typeName)),
	])

	return {
		corporations: corporations
			.map((row) => ({
				value: row.corporationId,
				label: row.corporationName ?? row.corporationId,
			}))
			.filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index),
		assignedGroups: assignedGroups
			.map((row) => ({
				value: row.assignedGroupId ?? '',
				label: row.assignedGroupId ?? '',
			}))
			.filter((option) => option.value.length > 0),
		regions: regions
			.map((row) => ({
				value: row.regionId ?? '',
				label: row.regionName ?? row.regionId ?? '',
			}))
			.filter((option) => option.value.length > 0),
		systems: systems
			.map((row) => ({
				value: row.systemId,
				label: row.systemName ?? row.systemId,
			}))
			.filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index),
		states: states
			.map((row) => ({
				value: row.state,
				label: row.state,
			}))
			.filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index),
		types: types
			.map((row) => ({
				value: row.typeId,
				label: row.typeName ?? row.typeId,
			}))
			.filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index),
		alliances: [],
		planets: [],
		raidableStates: [],
	}
}

function buildOperationalLowFuelWhere(
	moduleConfig: Pick<
		StructureModuleConfigResult,
		| 'lowFuelTimeThresholdHours'
		| 'criticalFuelTimeThresholdHours'
		| 'lowFuelAmountThreshold'
		| 'criticalFuelAmountThreshold'
	>,
	structureSource: { fuelAmount: any; fuelExpires: any } = corporationStructures
) {
	const lowFuelExpiresAt = new Date(Date.now() + moduleConfig.lowFuelTimeThresholdHours * HOURS_TO_MS)
	return or(
		and(isNotNull(structureSource.fuelAmount), lte(structureSource.fuelAmount, moduleConfig.lowFuelAmountThreshold)),
		and(
			isNull(structureSource.fuelAmount),
			isNotNull(structureSource.fuelExpires),
			lte(structureSource.fuelExpires, lowFuelExpiresAt)
		)
	)
}

async function buildOperationalStructureSummary(
	db: DbClient<DbSchema>,
	visibleOperationalStructures: any,
	moduleConfig: StructureModuleConfigResult
): Promise<StructureListSummary> {
	const visibleRowsDb = db.with(visibleOperationalStructures)
	const lowFuelWhere = buildOperationalLowFuelWhere(moduleConfig, visibleOperationalStructures)
	const reinforcedStates = [...STRUCTURE_REINFORCED_STATES]
	const [totalResult, lowFuelResult, lowPowerResult, reinforcedResult, fuelBurnRateResult] =
		await Promise.all([
		visibleRowsDb
			.select({
				total: sql<number>`count(*)::int`,
			})
			.from(visibleOperationalStructures),
		visibleRowsDb
			.select({
				count: sql<number>`count(*)::int`,
			})
			.from(visibleOperationalStructures)
			.where(lowFuelWhere),
		visibleRowsDb
			.select({
				count: sql<number>`count(*)::int`,
			})
			.from(visibleOperationalStructures)
			.where(
				and(
					eq(visibleOperationalStructures.lowPower, true),
					or(
						eq(visibleOperationalStructures.lowPowerAllowed, false),
						isNull(visibleOperationalStructures.lowPowerAllowed)
					)
				)
			),
		visibleRowsDb
			.select({
				count: sql<number>`count(*)::int`,
			})
			.from(visibleOperationalStructures)
			.where(inArray(visibleOperationalStructures.state, reinforcedStates)),
		visibleRowsDb
			.select({
				estimatedFuelBurnRatePerHour: sql<string | null>`sum(${visibleOperationalStructures.fuelBurnRate})::text`,
				fuelBurnRateSampleCount: sql<number>`count(${visibleOperationalStructures.fuelBurnRate})::int`,
			})
			.from(visibleOperationalStructures),
	])

	return {
		total: totalResult[0]?.total ?? 0,
		lowFuel: lowFuelResult[0]?.count ?? 0,
		lowPower: lowPowerResult[0]?.count ?? 0,
		reinforced: reinforcedResult[0]?.count ?? 0,
		estimatedFuelBurnRatePerHour: fuelBurnRateResult[0]?.estimatedFuelBurnRatePerHour ?? null,
		fuelBurnRateSampleCount: fuelBurnRateResult[0]?.fuelBurnRateSampleCount ?? 0,
	}
}

async function loadVisibleStructureContexts(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureBaseFilterQuery,
	tabFilter?: StructureTab
): Promise<VisibleStructureContextsResult> {
	const cacheKey = buildVisibleStructureContextCacheKey(user, query, tabFilter)
	const cached = visibleStructureContextCache.get(cacheKey)
	if (cached) {
		return cached.value
	}

	const value = loadVisibleStructureContextsUncached(db, user, query, tabFilter)
	visibleStructureContextCache.set(cacheKey, { value })
	value.then(
		() => {
			const current = visibleStructureContextCache.get(cacheKey)
			if (current?.value === value) {
				visibleStructureContextCache.delete(cacheKey)
			}
		},
		() => {
			const current = visibleStructureContextCache.get(cacheKey)
			if (current?.value === value) {
				visibleStructureContextCache.delete(cacheKey)
			}
		}
	)
	return value
}

function buildOperationalSortOrder(
	sortBy: StructureListSortField,
	sortDirection: StructureListSortDirection,
	source: any
) {
	const descending = sortDirection === 'desc'
	const sortExpression = (expression: any) => (descending ? desc(expression) : asc(expression))

	switch (sortBy) {
		case 'fuel':
			return descending
				? [
						asc(sql`case when ${source.fuelExpires} is null then 0 else 1 end`),
						desc(source.fuelExpires),
						desc(source.fuelAmount),
						desc(source.structureId),
					]
				: [
						asc(sql`case when ${source.fuelExpires} is null then 1 else 0 end`),
						asc(source.fuelExpires),
						asc(source.fuelAmount),
						asc(source.structureId),
					]
		case 'updatedAt':
			return [sortExpression(source.updatedAt), sortExpression(source.structureId)]
		case 'nextStateAt':
			return [
				sortExpression(
					sql`coalesce(${source.stateTimerEnd}, ${source.nextReinforceApply}, ${source.unanchorsAt})`
				),
				sortExpression(source.structureId),
			]
		case 'name':
			return [sortExpression(source.structureId), sortExpression(source.structureId)]
		case 'corporation':
			return [sortExpression(sql`coalesce(${source.corporationName}, '')`), sortExpression(source.structureId)]
		case 'region':
			return [sortExpression(sql`coalesce(${source.regionName}, '')`), sortExpression(source.structureId)]
		case 'system':
			return [sortExpression(sql`coalesce(${source.systemName}, '')`), sortExpression(source.structureId)]
		case 'type':
			return [sortExpression(sql`coalesce(${source.typeName}, '')`), sortExpression(source.structureId)]
		case 'state':
			return [sortExpression(source.state), sortExpression(source.structureId)]
		case 'group':
			return [sortExpression(sql`coalesce(${source.assignedGroupId}, '')`), sortExpression(source.structureId)]
		case 'syncStatus':
			return [
				sortExpression(
					sql`case ${source.syncStatus} when 'error' then 0 when 'warning' then 1 when 'ok' then 2 else null end`
				),
				sortExpression(source.structureId),
			]
		default:
			return null
	}
}

function isSqlPagedOperationalSort(sortBy: StructureListSortField): boolean {
	switch (sortBy) {
		case 'fuel':
		case 'updatedAt':
		case 'nextStateAt':
		case 'name':
		case 'corporation':
		case 'region':
		case 'system':
		case 'type':
		case 'state':
		case 'group':
		case 'syncStatus':
			return true
		default:
			return false
	}
}

async function loadVisibleOperationalStructurePageItems(
	db: DbClient<DbSchema>,
	user: SessionUser,
	access: StructureAccessScope,
	query: StructureListQuery,
	visibleOperationalStructures: ReturnType<typeof buildVisibleOperationalStructuresCte>,
	pageOverride?: number
): Promise<StructureListItem[]> {
	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortOrder = buildOperationalSortOrder(sortBy, sortDirection, visibleOperationalStructures)
	if (!sortOrder) {
		return []
	}

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const page = Math.max(pageOverride ?? query.page ?? 1, 1)
	const offset = (page - 1) * pageSize

	const rows = await db
		.with(visibleOperationalStructures)
		.select({
			structureId: visibleOperationalStructures.structureId,
			corporationId: visibleOperationalStructures.corporationId,
			corporationName: visibleOperationalStructures.corporationName,
			name: visibleOperationalStructures.name,
			typeId: visibleOperationalStructures.typeId,
			typeName: visibleOperationalStructures.typeName,
			systemId: visibleOperationalStructures.systemId,
			systemName: visibleOperationalStructures.systemName,
			regionId: visibleOperationalStructures.regionId,
			regionName: visibleOperationalStructures.regionName,
			state: visibleOperationalStructures.state,
			stateTimerEnd: visibleOperationalStructures.stateTimerEnd,
			nextReinforceApply: visibleOperationalStructures.nextReinforceApply,
			unanchorsAt: visibleOperationalStructures.unanchorsAt,
			fuelExpires: visibleOperationalStructures.fuelExpires,
			fuelAmount: visibleOperationalStructures.fuelAmount,
			fuelBurnRate: visibleOperationalStructures.fuelBurnRate,
			lowPower: visibleOperationalStructures.lowPower,
			hidden: visibleOperationalStructures.hidden,
			lowPowerAllowed: visibleOperationalStructures.lowPowerAllowed,
			assignedGroupId: visibleOperationalStructures.assignedGroupId,
			syncStatus: visibleOperationalStructures.syncStatus,
			syncFailureReason: visibleOperationalStructures.syncFailureReason,
			lastSyncedAt: visibleOperationalStructures.lastSyncedAt,
			updatedAt: visibleOperationalStructures.updatedAt,
		})
		.from(visibleOperationalStructures)
		.orderBy(...sortOrder)
		.limit(pageSize)
		.offset(offset)

	return rows.map((row) => {
		const structureTab = getStructureTab({
			typeId: row.typeId,
			typeName: row.typeName,
		})
		const canViewDetails =
			user.is_admin || canViewDetailsStructure(access, row.corporationId, structureTab)
		return buildOperationalStructureListItem(row, canViewDetails)
	})
}

async function loadVisibleSovereigntyHubContexts(
	env: Env,
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureSovereigntyListQuery
): Promise<{
	moduleConfig: StructureModuleConfigResult
	access: StructureAccessScope
	contexts: VisibleStructureContext[]
	hubRows: Array<typeof structureSovereigntyHubs.$inferSelect>
	systemRows: Array<typeof structureSovereigntySystems.$inferSelect>
}> {
	const moduleConfig = await getStructureModuleConfig(db)
	const access = computeStructureAccess(user.roles, user.is_admin)
	const accessForTab = getStructureAccessTarget(access, 'sovereignty')
	if (!hasAnyStructureAccess(accessForTab)) {
		return {
			moduleConfig,
			access,
			contexts: [],
			hubRows: [],
			systemRows: [],
		}
	}

	const accessibleCorporations = getAccessibleCorporationIds(access, 'sovereignty')
	if (!accessibleCorporations.hasGlobalAccess && accessibleCorporations.corporationIds.size === 0) {
		return {
			moduleConfig,
			access,
			contexts: [],
			hubRows: [],
			systemRows: [],
		}
	}

	const corpWhere = (() => {
		const conditions: StructureWhereCondition[] = []
		if (query.corporationId) {
			conditions.push(eq(structureSovereigntyHubs.corporationId, query.corporationId))
		}
		if (!accessibleCorporations.hasGlobalAccess) {
			conditions.push(
				inArray(structureSovereigntyHubs.corporationId, [...accessibleCorporations.corporationIds])
			)
		}
		if (query.systemId) {
			conditions.push(eq(structureSovereigntyHubs.systemId, query.systemId))
		}
		if (query.controllerAllianceId) {
			conditions.push(eq(structureSovereigntyHubs.controllerAllianceId, query.controllerAllianceId))
		}
		return combineWhereConditions(conditions)
	})()

	const joinedRows = await db
		.select({
			hub: structureSovereigntyHubs,
			system: structureSovereigntySystems,
			corporation: {
				corporationId: managedCorporations.corporationId,
				name: managedCorporations.name,
				includeInStructureAssetSync: managedCorporations.includeInStructureAssetSync,
			},
		})
		.from(structureSovereigntyHubs)
		.leftJoin(
			structureSovereigntySystems,
			eq(structureSovereigntySystems.systemId, structureSovereigntyHubs.systemId)
		)
		.leftJoin(managedCorporations, eq(managedCorporations.corporationId, structureSovereigntyHubs.corporationId))
		.where(corpWhere ?? sql`true`)
		.orderBy(desc(structureSovereigntyHubs.updatedAt))
	if (joinedRows.length === 0) {
		return {
			moduleConfig,
			access,
			contexts: [],
			hubRows: [],
			systemRows: [],
		}
	}

	const geographyBySystemId = await resolveSovereigntyHubGeographies(env, [
		...new Set(joinedRows.map((row) => row.hub.systemId)),
	])
	const systemRows = joinedRows
		.map((row) => row.system)
		.filter((row): row is typeof structureSovereigntySystems.$inferSelect => row !== null)

	return {
		moduleConfig,
		access,
		contexts: joinedRows
			.map<VisibleStructureContext | null>((row) => {
				const geography = geographyBySystemId[row.hub.systemId] ?? null
				const structure = buildSyntheticSovereigntyStructureRow(row.hub, row.system ?? null, geography)
				const structureTab = getStructureTab(structure)
				const canViewDetails =
					user.is_admin || canViewDetailsStructure(access, row.hub.corporationId, structureTab)
				const canViewSensitive =
					user.is_admin || canViewSensitiveStructure(access, row.hub.corporationId, structureTab)
				const canEdit = user.is_admin || canEditStructure(access, row.hub.corporationId, structureTab)
				const corporation = row.corporation

				return {
					structure,
					corporationName: corporation?.name ?? row.hub.corporationId,
					includeInStructureAssetSync: corporation?.includeInStructureAssetSync ?? false,
					config: null,
					canViewDetails,
					canViewSensitive,
					canEdit,
					tabData: null,
					fittingItems: null,
					lastRefilledAt: null,
					fuelUsage: null,
				}
			})
			.filter((item): item is VisibleStructureContext => item !== null)
			.filter((context) => {
				if (query.regionId && context.structure.regionId !== query.regionId) return false
				if (query.systemId && context.structure.systemId !== query.systemId) return false
				return true
			}),
		hubRows: joinedRows.map((row) => row.hub),
		systemRows,
	}
}

async function listVisibleOperationalStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureListQuery = {},
	activeTab: StructureTab
): Promise<StructureListResponse> {
	const access = computeStructureAccess(user.roles, user.is_admin)
	const tabAccess = getStructureAccessTarget(access, activeTab)
	if (!hasAnyStructureAccess(tabAccess)) {
		return {
			items: [],
			pagination: {
				page: 1,
				pageSize: query.pageSize ?? 25,
				totalCount: 0,
				totalPages: 1,
				hasNextPage: false,
				hasPreviousPage: false,
			},
			filterOptions: emptyStructureFilterOptions(),
			summary: emptyStructureListSummary(),
		}
	}

	const sortBy = query.sortBy ?? 'skyhookSecureFullness'
	const sortDirection = query.sortDirection ?? 'asc'
	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const requestedPage = Math.max(query.page ?? 1, 1)

	if (isSqlPagedOperationalSort(sortBy) && (activeTab === 'citadels' || activeTab === 'navigation')) {
		const moduleConfig = await getStructureModuleConfig(db)
		const corpWhere = buildVisibleStructureContextsWhere(access, query, activeTab)
		if (!corpWhere) {
				return {
					items: [],
				pagination: {
					page: 1,
					pageSize,
					totalCount: 0,
					totalPages: 1,
					hasNextPage: false,
					hasPreviousPage: false,
				},
				filterOptions: emptyStructureFilterOptions(),
				summary: emptyStructureListSummary(),
			}
		}
		const visibleOperationalStructures = buildVisibleOperationalStructuresCte(db, corpWhere)

		const [filterOptions, summary, pageItems] = await Promise.all([
			buildOperationalStructureFilterOptions(db, visibleOperationalStructures),
			buildOperationalStructureSummary(db, visibleOperationalStructures, moduleConfig),
			loadVisibleOperationalStructurePageItems(
				db,
				user,
				access,
				query,
				visibleOperationalStructures
			),
		])
		const totalCount = summary.total
		const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
		const page = Math.min(requestedPage, totalPages)
		const items =
			page === requestedPage
			? pageItems
			: await loadVisibleOperationalStructurePageItems(
					db,
					user,
					access,
					query,
					visibleOperationalStructures,
					page
				)

		return {
			items: items as unknown as StructureListItem[],
			pagination: {
				page,
				pageSize,
				totalCount,
				totalPages,
				hasNextPage: page < totalPages,
				hasPreviousPage: page > 1,
			},
			filterOptions,
			summary,
		}
	}

	if (activeTab === 'skyhooks' && isSqlPagedSkyhookSort(sortBy)) {
		const corpWhere = buildSkyhookVisibilityWhere(access, query as StructureSkyhookListQuery)
		if (!corpWhere) {
			return {
				items: [],
				pagination: {
					page: 1,
					pageSize,
					totalCount: 0,
					totalPages: 1,
					hasNextPage: false,
					hasPreviousPage: false,
				},
				filterOptions: emptyStructureFilterOptions(),
				summary: emptyStructureListSummary(),
			}
		}

		const visibleSkyhookStructures = buildVisibleSkyhookStructuresCte(db, corpWhere)
		const [filterOptions, summary, pageItems] = await Promise.all([
			buildSkyhookStructureFilterOptionsFromSql(db, visibleSkyhookStructures),
			buildSkyhookStructureSummaryFromSql(db, visibleSkyhookStructures),
			loadVisibleSkyhookPageItems(
				db,
				user,
				access,
				query as StructureSkyhookListQuery,
				visibleSkyhookStructures
			),
		])
		const totalCount = summary.total
		const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
		const page = Math.min(requestedPage, totalPages)
		const items =
			page === requestedPage
				? pageItems
				: await loadVisibleSkyhookPageItems(
						db,
						user,
						access,
						query as StructureSkyhookListQuery,
						visibleSkyhookStructures,
						page
					)

		return {
			items: items as unknown as StructureListItem[],
			pagination: {
				page,
				pageSize,
				totalCount,
				totalPages,
				hasNextPage: page < totalPages,
				hasPreviousPage: page > 1,
			},
			filterOptions,
			summary,
		}
	}

	const { moduleConfig, contexts, totalCount: totalCountFromDb } = await loadVisibleStructureContexts(
		db,
		user,
		query,
		activeTab
	)
	const baseItems = contexts
		.map((context) => buildStructureListItem(context))
		.filter((item) => matchesStructureTab(item, activeTab))
		.filter((item) => hasStructureAccessForTab(access, item.corporationId, activeTab))
	const filterOptions = buildStructureFilterOptions(baseItems)
	const filteredItems = baseItems
	const sortedItems = sortStructures(filteredItems, sortBy, sortDirection)
		const summary = await buildStructureSummary(filteredItems, moduleConfig, totalCountFromDb)
	const totalCount = totalCountFromDb
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(requestedPage, totalPages)
	const start = (page - 1) * pageSize
	const end = start + pageSize
	const pageItems = sortedItems.slice(start, end)

	return {
		items: pageItems,
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages,
			hasNextPage: page < totalPages,
			hasPreviousPage: page > 1,
		},
		filterOptions,
		summary,
	}
}

export async function getStructureOverviewMetrics(
	db: DbClient<DbSchema>,
	user: SessionUser
): Promise<StructureOverviewMetrics> {
	const { moduleConfig, access, contexts } = await loadVisibleStructureContexts(db, user, {})
	const visibleContexts = contexts.filter((context) =>
		hasStructureAccessForTab(
			access,
			context.structure.corporationId,
			getStructureTab(context.structure)
		)
	)
	if (visibleContexts.length === 0) {
		return emptyStructureOverviewMetrics()
	}

	const items = visibleContexts.map((context) => buildStructureListItem(context))
	return buildStructureSummary(items, moduleConfig)
}

export async function listVisibleStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureListQuery = {}
): Promise<StructureListResponse> {
	return listVisibleOperationalStructures(db, user, query, 'citadels')
}

export async function listCitadelStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureCitadelListQuery = {}
): Promise<StructureListResponse> {
	return listVisibleOperationalStructures(db, user, query, 'citadels')
}

export async function listNavigationStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureNavigationListQuery = {}
): Promise<StructureListResponse> {
	return listVisibleOperationalStructures(db, user, query as StructureListQuery, 'navigation')
}

export async function listMoonDrillStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureMoonDrillListQuery = {}
): Promise<RepoStructureMoonDrillListResponse> {
	const { moduleConfig, contexts, access } = await loadVisibleStructureContexts(
		db,
		user,
		{
			corporationId: query.corporationId,
			assignedGroupId: query.assignedGroupId,
			lowPower: query.lowPower,
			lowPowerAllowed: query.lowPowerAllowed,
			regionId: query.regionId,
			systemId: query.systemId,
			state: query.state,
			typeId: query.typeId,
		},
		'moon-drills'
	)

	const accessForTab = getStructureAccessTarget(access, 'moon-drills')
	if (!hasAnyStructureAccess(accessForTab)) {
		return {
			items: [],
			pagination: {
				page: 1,
				pageSize: query.pageSize ?? 25,
				totalCount: 0,
				totalPages: 1,
				hasNextPage: false,
				hasPreviousPage: false,
			},
			filterOptions: emptyStructureFilterOptions(),
			summary: emptyStructureListSummary(),
		}
	}

	const moonDrillContexts = contexts.filter((context) => matchesStructureTab(context.structure, 'moon-drills'))
	const structureIds = moonDrillContexts.map((context) => context.structure.structureId)

	if (structureIds.length === 0) {
		return {
			items: [],
			pagination: {
				page: 1,
				pageSize: query.pageSize ?? 25,
				totalCount: 0,
				totalPages: 1,
				hasNextPage: false,
				hasPreviousPage: false,
			},
			filterOptions: emptyStructureFilterOptions(),
			summary: emptyStructureListSummary(),
		}
	}

	const moonDrillWhere = (() => {
		const conditions: StructureWhereCondition[] = []
		if (query.planetId) {
			conditions.push(eq(structureMoonGeographies.planetId, query.planetId))
		}
		return combineWhereConditions(conditions)
	})()

		const moonDrillRows = await db
			.select({
				moonDrill: structureMoonDrills,
				moonGeography: structureMoonGeographies,
			})
			.from(structureMoonDrills)
			.leftJoin(
				structureMoonGeographies,
				eq(structureMoonGeographies.structureId, structureMoonDrills.structureId)
			)
			.where(
				combineWhereConditions([
					inArray(structureMoonDrills.structureId, structureIds),
					moonDrillWhere,
				]) ?? sql`true`
			)
			.orderBy(desc(structureMoonDrills.updatedAt))
		const moonDrillByStructureId = new Map(
			moonDrillRows.map((row) => [row.moonDrill.structureId, row] as const)
		)
		const items = moonDrillContexts.map((context) =>
			buildMoonDrillListItem({
				context,
				moonDrillRow: moonDrillByStructureId.get(context.structure.structureId)?.moonDrill ?? null,
				moonGeographyRow: moonDrillByStructureId.get(context.structure.structureId)?.moonGeography ?? null,
			})
		)

	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortedItems = sortStructures(items, sortBy, sortDirection)
	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const totalCount = sortedItems.length
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(Math.max(query.page ?? 1, 1), totalPages)
	const start = (page - 1) * pageSize
	const end = start + pageSize

	return {
		items: sortedItems
			.slice(start, end)
			.map((item) => items.find((row) => row.structureId === item.structureId)!) as RepoStructureMoonDrillListItem[],
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages,
			hasNextPage: page < totalPages,
			hasPreviousPage: page > 1,
		},
		filterOptions: buildMoonGeographyFilterOptions(items),
		summary: buildStructureSummaryCounts(items, moduleConfig),
	}
}

function getSnapshotSyncStatus(lastSyncedAt: Date | null | undefined): 'ok' | 'warning' | 'error' {
	if (!lastSyncedAt) {
		return 'warning'
	}

	const ageMs = Math.max(0, Date.now() - lastSyncedAt.getTime())
	if (ageMs >= STRUCTURE_SYNC_ERROR_STALE_MS) return 'error'
	if (ageMs >= STRUCTURE_SYNC_WARNING_STALE_MS) return 'warning'
	return 'ok'
}

function getStructureSyncStatus(
	syncStatus: 'ok' | 'warning' | 'error',
	lastSyncedAt: Date | null | undefined
): 'ok' | 'warning' | 'error' {
	const stalenessStatus = getSnapshotSyncStatus(lastSyncedAt)
	if (syncStatus === 'error' || stalenessStatus === 'error') {
		return 'error'
	}
	if (syncStatus === 'warning' || stalenessStatus === 'warning') {
		return 'warning'
	}
	return 'ok'
}

function buildStructureRowIdentity(
	corporationId: string,
	corporationName: string,
	typeId: string,
	typeName: string | null,
	systemId: string,
	systemName: string | null,
	regionId: string | null,
	regionName: string | null
) {
	return {
		corporationId,
		corporationName,
		typeId,
		typeName,
		systemId,
		systemName,
		regionId,
		regionName,
	}
}

function buildSovereigntyListItem(input: {
	context: VisibleStructureContext
	systemRow: typeof structureSovereigntySystems.$inferSelect | null
	hubRow: typeof structureSovereigntyHubs.$inferSelect | null
}): StructureSovereigntyFilterableItem {
	const { context, systemRow, hubRow } = input
	const { structure: structureRow, corporationName, canViewSensitive, canEdit } = context
	const hasHubSnapshot = hubRow !== null
	const lastSyncedAt =
		hubRow?.lastSyncedAt ?? systemRow?.lastSyncedAt ?? structureRow.lastSyncedAt ?? null
	const sourceUpdatedAt = systemRow?.updatedAt ?? hubRow?.updatedAt ?? structureRow.updatedAt
	const {
		name: _structureName,
		fuelExpires: _fuelExpires,
		fuelAmount: _fuelAmount,
		...structureBase
	} = buildStructureListItem(context)

	const hubSummary = hubRow ? summarizeStructureSovereigntyHub(hubRow) : null
	const explicitSyncFailure = hubRow?.syncStatus === 'error'
		? (hubRow.syncFailureReason ?? 'Sovereignty hub sync failed.')
		: null
	const syncStatus = explicitSyncFailure
		? 'error'
		: hasHubSnapshot
			? getSnapshotSyncStatus(lastSyncedAt)
			: 'warning'
	const structureIdentity = buildStructureRowIdentity(
		structureRow.corporationId,
		corporationName,
		structureRow.typeId ??
			hubRow?.typeId ??
			systemRow?.sovereigntyHubStructureId ??
			'sovereignty hub',
		structureRow?.typeName ?? hubRow?.name ?? 'Sovereignty Hub',
		structureRow.systemId,
		structureRow.systemName ?? null,
		structureRow.regionId ?? null,
		structureRow.regionName ?? null
	)

	return {
		...structureBase,
		...structureIdentity,
		claimType: systemRow?.claimType ?? 'unclaimed',
		allianceId: systemRow?.allianceId ?? null,
		allianceName: null,
		controllerAllianceName: hubSummary?.controllerAllianceId
			? (hubSummary.controllerAllianceName ?? null)
			: null,
		corporationClaimantId: systemRow?.corporationClaimantId ?? null,
		factionId: systemRow?.factionId ?? null,
		claimedSince: toIso(systemRow?.claimedSince ?? null),
		sovereigntyHubStructureId: systemRow?.sovereigntyHubStructureId ?? hubRow?.structureId ?? null,
		vulnerabilityWindowStart: toIso(systemRow?.vulnerabilityWindowStart ?? null),
		vulnerabilityWindowEnd: toIso(systemRow?.vulnerabilityWindowEnd ?? null),
	activityDefenseMultiplier:
			systemRow?.activityDefenseMultiplier !== null &&
			systemRow?.activityDefenseMultiplier !== undefined
				? String(systemRow.activityDefenseMultiplier)
				: null,
		militaryLevel: systemRow?.militaryLevel ?? null,
		industrialLevel: systemRow?.industrialLevel ?? null,
		strategicLevel: systemRow?.strategicLevel ?? null,
		controllerAllianceId: hubSummary?.controllerAllianceId ?? null,
		reagentBayLastUpdated: hubSummary?.reagentBayLastUpdated ?? null,
		reagentCount: hubSummary?.reagentCount ?? 0,
		magmaticGasQuantity: hubSummary?.magmaticGasQuantity ?? 0,
		magmaticGasBurningPerHour: hubSummary?.magmaticGasBurningPerHour ?? 0,
		magmaticGasEstimatedDepletionAt: hubSummary?.magmaticGasEstimatedDepletionAt ?? null,
		superionicIceQuantity: hubSummary?.superionicIceQuantity ?? 0,
		superionicIceBurningPerHour: hubSummary?.superionicIceBurningPerHour ?? 0,
		superionicIceEstimatedDepletionAt: hubSummary?.superionicIceEstimatedDepletionAt ?? null,
		resourcePowerAllocated: hubSummary?.resourcePowerAllocated ?? 0,
		resourcePowerAvailable: hubSummary?.resourcePowerAvailable ?? 0,
		resourceWorkforceAllocated: hubSummary?.resourceWorkforceAllocated ?? 0,
		resourceWorkforceAvailable: hubSummary?.resourceWorkforceAvailable ?? 0,
		upgradeCount: hubSummary?.upgradeCount ?? 0,
		syncStatus,
		syncFailureReason: explicitSyncFailure
			? explicitSyncFailure
			: hasHubSnapshot
				? null
				: 'Sovereignty hub snapshot has not been ingested yet for this structure.',
		lastSyncedAt: toIso(lastSyncedAt),
		updatedAt: sourceUpdatedAt.toISOString(),
	}
}

function buildSkyhookListItem(input: {
	context: VisibleStructureContext
	skyhookRow: typeof structureSkyhooks.$inferSelect | null
}): StructureSkyhookFilterableItem {
	const { context, skyhookRow } = input
	const { structure: structureRow } = context
	const hasSkyhookSnapshot = skyhookRow !== null
	const {
		name: _structureName,
		fuelExpires: _fuelExpires,
		fuelAmount: _fuelAmount,
		...structureBase
	} = buildStructureListItem(context)
	const reagentSummary = getSkyhookReagentSummary(skyhookRow?.reagents ?? [])
	const reagentEntries = getSkyhookReagentEntries(skyhookRow?.reagents ?? [])
	const isRaidable = isSkyhookCurrentlyRaidable(skyhookRow)
	const normalizedState = skyhookRow
		? getSkyhookState(
				skyhookRow.state,
				isRaidable,
				skyhookRow.reinforcementTimerEnd ? skyhookRow.reinforcementTimerEnd.toISOString() : null
			)
		: 'invulnerable'
	const explicitSyncFailure = skyhookRow?.syncStatus === 'error'
		? (skyhookRow.syncFailureReason ?? 'Skyhook sync failed.')
		: null
	const syncStatus = explicitSyncFailure
		? 'error'
		: hasSkyhookSnapshot
			? getSnapshotSyncStatus(skyhookRow.lastSyncedAt)
			: 'warning'

	return {
		...structureBase,
		systemName: skyhookRow?.systemName ?? structureRow.systemName ?? null,
		planetId: skyhookRow?.planetId ?? '',
		planetName: skyhookRow?.planetName ?? null,
		typeId: skyhookRow?.typeId ?? structureRow.typeId,
		typeName: structureRow.typeName,
		isActive: skyhookRow?.isActive ?? false,
		effectiveWorkforce: skyhookRow?.effectiveWorkforce ?? null,
		totalReagents: reagentSummary?.totalReagents ?? reagentEntries.length,
		totalSecuredStock: reagentSummary?.totalSecuredStock ?? 0,
		totalUnsecuredStock: reagentSummary?.totalUnsecuredStock ?? 0,
		totalSecuredVolumeM3: reagentSummary?.totalSecuredVolumeM3 ?? 0,
		totalUnsecuredVolumeM3: reagentSummary?.totalUnsecuredVolumeM3 ?? 0,
		securedCapacityM3: SKYHOOK_SECURED_BAY_CAPACITY_M3,
		unsecuredCapacityM3: SKYHOOK_SURPLUS_BAY_CAPACITY_M3,
		securedFillPercent: reagentSummary?.securedFillPercent ?? 0,
		unsecuredFillPercent: reagentSummary?.unsecuredFillPercent ?? 0,
		reagents: reagentEntries.map((reagent) => ({
			typeId: reagent.typeId,
			typeName:
				reagent.typeId === SKYHOOK_MAGMATIC_GAS_TYPE_ID
					? SKYHOOK_MAGMATIC_GAS_TYPE_NAME
					: reagent.typeId === SKYHOOK_SUPERIONIC_ICE_TYPE_ID
						? SKYHOOK_SUPERIONIC_ICE_TYPE_NAME
						: null,
			unitVolumeM3: getSkyhookReagentUnitVolumeM3(reagent.typeId),
			securedStock: reagent.securedStock,
			unsecuredStock: reagent.unsecuredStock,
			securedVolumeM3: reagent.securedStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
			unsecuredVolumeM3: reagent.unsecuredStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
			securedCapacityM3: SKYHOOK_SECURED_BAY_CAPACITY_M3,
			unsecuredCapacityM3: SKYHOOK_SURPLUS_BAY_CAPACITY_M3,
			securedFillPercent: getSkyhookFullness(
				reagent.securedStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
				SKYHOOK_SECURED_BAY_CAPACITY_M3
			),
			unsecuredFillPercent: getSkyhookFullness(
				reagent.unsecuredStock * getSkyhookReagentUnitVolumeM3(reagent.typeId),
				SKYHOOK_SURPLUS_BAY_CAPACITY_M3
			),
			lastCycle: reagent.lastCycle,
		})),
			reinforcementTimerEnd: toIso(skyhookRow?.reinforcementTimerEnd ?? null),
			theftVulnerabilityStart: toIso(skyhookRow?.theftVulnerabilityStart ?? null),
			theftVulnerabilityEnd: toIso(skyhookRow?.theftVulnerabilityEnd ?? null),
			isRaidable,
			state: normalizedState,
		syncStatus,
		syncFailureReason: explicitSyncFailure
			? explicitSyncFailure
			: hasSkyhookSnapshot
				? null
				: 'Skyhook snapshot has not been ingested yet for this structure.',
		lastSyncedAt: toIso(skyhookRow?.lastSyncedAt ?? structureRow.lastSyncedAt),
		updatedAt: (skyhookRow?.updatedAt ?? structureRow.updatedAt).toISOString(),
	}
}

function buildMoonDrillListItem(input: {
	context: VisibleStructureContext
	moonDrillRow: typeof structureMoonDrills.$inferSelect | null
	moonGeographyRow: typeof structureMoonGeographies.$inferSelect | null
}): StructureMoonDrillFilterableItem {
	const { context, moonDrillRow, moonGeographyRow } = input
	const { structure: structureRow } = context
	const hasMoonDrillSnapshot = moonDrillRow !== null && moonGeographyRow !== null
	const structureBase = buildStructureListItem(context)

	return {
		...structureBase,
		systemId: moonGeographyRow?.systemId ?? structureRow.systemId,
		systemName: moonGeographyRow?.systemName ?? structureRow.systemName ?? null,
		moonId: moonGeographyRow?.moonId ?? '',
		moonName: moonGeographyRow?.moonName ?? null,
		planetId: moonGeographyRow?.planetId ?? null,
		planetName: moonGeographyRow?.planetName ?? null,
		syncStatus: hasMoonDrillSnapshot ? getSnapshotSyncStatus(moonDrillRow.lastSyncedAt) : 'warning',
		syncFailureReason: hasMoonDrillSnapshot
			? null
			: 'Moon drill snapshot has not been ingested yet for this structure.',
		lastSyncedAt: toIso(moonDrillRow?.lastSyncedAt ?? structureRow.lastSyncedAt),
		updatedAt: (moonDrillRow?.updatedAt ?? structureRow.updatedAt).toISOString(),
	}
}

function buildMiningCitadelListItem(input: {
	context: VisibleStructureContext
	miningExtractionRow: typeof structureMiningExtractions.$inferSelect | null
	moonGeographyRow: typeof structureMoonGeographies.$inferSelect | null
}): StructureMiningCitadelFilterableItem {
	const { context, miningExtractionRow, moonGeographyRow } = input
	const { structure: structureRow } = context
	const hasMiningSnapshot = miningExtractionRow !== null && moonGeographyRow !== null
	const structureBase = buildStructureListItem(context)

	return {
		...structureBase,
		systemId: moonGeographyRow?.systemId ?? structureRow.systemId,
		systemName: moonGeographyRow?.systemName ?? structureRow.systemName ?? null,
		moonId: moonGeographyRow?.moonId ?? '',
		moonName: moonGeographyRow?.moonName ?? null,
		planetId: moonGeographyRow?.planetId ?? null,
		planetName: moonGeographyRow?.planetName ?? null,
		extractionStartTime: toIso(miningExtractionRow?.extractionStartTime ?? null),
		chunkArrivalTime: toIso(miningExtractionRow?.chunkArrivalTime ?? null),
		naturalDecayTime: toIso(miningExtractionRow?.naturalDecayTime ?? null),
		syncStatus: hasMiningSnapshot
			? getSnapshotSyncStatus(miningExtractionRow.lastSyncedAt)
			: 'warning',
		syncFailureReason: hasMiningSnapshot
			? null
			: 'Mining extraction snapshot has not been ingested yet for this structure.',
		lastSyncedAt: toIso(miningExtractionRow?.lastSyncedAt ?? structureRow.lastSyncedAt),
		updatedAt: (miningExtractionRow?.updatedAt ?? structureRow.updatedAt).toISOString(),
	}
}

export async function listSovereigntyStructures(
	env: Env,
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureSovereigntyListQuery = {}
): Promise<RepoStructureSovereigntyListResponse> {
	const { moduleConfig, contexts, access, hubRows, systemRows } =
		await loadVisibleSovereigntyHubContexts(env, db, user, query)
	if (!hasAnyStructureAccess(getStructureAccessTarget(access, 'sovereignty'))) {
		return {
			items: [],
			pagination: {
				page: 1,
				pageSize: query.pageSize ?? 25,
				totalCount: 0,
				totalPages: 1,
				hasNextPage: false,
				hasPreviousPage: false,
			},
			filterOptions: emptySovereigntyFilterOptions(),
			summary: emptySovereigntySummary(),
		}
	}

	const hubById = new Map(hubRows.map((row) => [row.structureId, row] as const))
	const systemBySystemId = new Map(systemRows.map((row) => [row.systemId, row] as const))
	const items = contexts.map((context) =>
		buildSovereigntyListItem({
			context,
			systemRow: systemBySystemId.get(context.structure.systemId) ?? null,
			hubRow: hubById.get(context.structure.structureId) ?? null,
		})
	)
	const filteredItems = query.vulnerabilityState
		? items.filter((item) => {
				const vulnerabilityState = getSovereigntyVulnerabilityState(item)
				return vulnerabilityState === query.vulnerabilityState
			})
		: items

	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortedItems = sortStructures(filteredItems, sortBy, sortDirection)
	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const totalCount = sortedItems.length
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(Math.max(query.page ?? 1, 1), totalPages)
	const start = (page - 1) * pageSize
	const end = start + pageSize

	return {
		items: sortedItems.slice(start, end) as RepoStructureSovereigntyListItem[],
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages,
			hasNextPage: page < totalPages,
			hasPreviousPage: page > 1,
		},
		filterOptions: buildSovereigntyFilterOptions(filteredItems),
		summary: await buildSovereigntySummary(db, filteredItems, moduleConfig),
	}
}

export async function listSkyhookStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureSkyhookListQuery = {}
): Promise<RepoStructureSkyhookListResponse> {
	return (await listVisibleOperationalStructures(
		db,
		user,
		query as StructureListQuery,
		'skyhooks'
	)) as unknown as RepoStructureSkyhookListResponse
}

export async function listMiningCitadelStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureMiningCitadelListQuery = {}
): Promise<RepoStructureMiningCitadelListResponse> {
	const { moduleConfig, contexts, access } = await loadVisibleStructureContexts(
		db,
		user,
		{
			corporationId: query.corporationId,
			assignedGroupId: query.assignedGroupId,
			lowPower: query.lowPower,
			lowPowerAllowed: query.lowPowerAllowed,
			regionId: query.regionId,
			systemId: query.systemId,
			state: query.state,
			typeId: query.typeId,
		},
		'mining-citadels'
	)

	const accessForTab = getStructureAccessTarget(access, 'mining-citadels')
	if (!hasAnyStructureAccess(accessForTab)) {
		return {
			items: [],
			pagination: {
				page: 1,
				pageSize: query.pageSize ?? 25,
				totalCount: 0,
				totalPages: 1,
				hasNextPage: false,
				hasPreviousPage: false,
			},
			filterOptions: emptyStructureFilterOptions(),
			summary: emptyStructureListSummary(),
		}
	}

	const matchingContexts = contexts.filter((context) =>
		matchesStructureTab(context.structure, 'mining-citadels')
	)
	const structureIds = matchingContexts.map((context) => context.structure.structureId)

	if (structureIds.length === 0) {
		return {
			items: [],
			pagination: {
				page: 1,
				pageSize: query.pageSize ?? 25,
				totalCount: 0,
				totalPages: 1,
				hasNextPage: false,
				hasPreviousPage: false,
			},
			filterOptions: emptyStructureFilterOptions(),
			summary: emptyStructureListSummary(),
		}
	}

	const miningExtractionWhere = (() => {
		const conditions: StructureWhereCondition[] = []
		if (query.planetId) {
			conditions.push(eq(structureMoonGeographies.planetId, query.planetId))
		}
		return combineWhereConditions(conditions)
	})()

		const miningExtractionRows = await db
			.select({
				miningExtraction: structureMiningExtractions,
				moonGeography: structureMoonGeographies,
			})
			.from(structureMiningExtractions)
			.leftJoin(
				structureMoonGeographies,
				eq(structureMoonGeographies.structureId, structureMiningExtractions.structureId)
			)
			.where(
				combineWhereConditions([
					inArray(structureMiningExtractions.structureId, structureIds),
					miningExtractionWhere,
				]) ?? sql`true`
			)
			.orderBy(desc(structureMiningExtractions.updatedAt))
		const miningExtractionByStructureId = new Map(
			miningExtractionRows.map((row) => [row.miningExtraction.structureId, row] as const)
		)
		const items = matchingContexts.map((context) =>
			buildMiningCitadelListItem({
				context,
				miningExtractionRow:
					miningExtractionByStructureId.get(context.structure.structureId)?.miningExtraction ?? null,
				moonGeographyRow:
					miningExtractionByStructureId.get(context.structure.structureId)?.moonGeography ?? null,
			})
		)

	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortedItems = sortStructures(items, sortBy, sortDirection)
	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const totalCount = sortedItems.length
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(Math.max(query.page ?? 1, 1), totalPages)
	const start = (page - 1) * pageSize
	const end = start + pageSize

	return {
		items: sortedItems
			.slice(start, end)
			.map(
				(item) => items.find((row) => row.structureId === item.structureId)!
			) as RepoStructureMiningCitadelListItem[],
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages,
			hasNextPage: page < totalPages,
			hasPreviousPage: page > 1,
		},
		filterOptions: buildMoonGeographyFilterOptions(items),
		summary: buildStructureSummaryCounts(items, moduleConfig),
	}
}

export async function getVisibleStructureDetail(
	env: Env,
	db: DbClient<DbSchema>,
	user: SessionUser,
	structureId: string
): Promise<StructureDetailResult | null> {
	const context = await getVisibleStructureContext(env, db, user, structureId, {
		requireDetailsPermission: true,
	})
	if (!context) {
		return null
	}
	context.fuelUsage =
		(await loadFuelUsageForStructure(
			db,
			context.structure.corporationId,
			context.structure.structureId
		)) ?? EMPTY_STRUCTURE_FUEL_USAGE_HISTORY
	return buildStructureDetailResult(context)
}

export async function updateStructureConfig(
	env: Env,
	db: DbClient<DbSchema>,
	user: SessionUser,
	structureId: string,
	input: UpdateStructureConfigInput
): Promise<StructureDetailResult | null> {
	const context = await getVisibleStructureContext(env, db, user, structureId)
	if (!context) {
		return null
	}

	const access = computeStructureAccess(user.roles, user.is_admin)
	const structureTab = getStructureTab(context.structure)
	const canEdit =
		user.is_admin || canEditStructure(access, context.structure.corporationId, structureTab)
	if (!canEdit) {
		return null
	}

	if (input.assignedGroupId) {
		await assertStructureGroupConfigured(db, input.assignedGroupId)
	}

	const existingConfig = context.config
	const now = new Date()
	await db
		.insert(structureConfigs)
		.values({
			structureId,
			hidden: input.hidden ?? existingConfig?.hidden ?? false,
			lowPowerAllowed: input.lowPowerAllowed ?? existingConfig?.lowPowerAllowed ?? false,
			assignedGroupId: input.assignedGroupId ?? existingConfig?.assignedGroupId ?? null,
			updatedBy: input.updatedBy ?? existingConfig?.updatedBy ?? null,
			createdAt: existingConfig?.createdAt ?? now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: structureConfigs.structureId,
			set: {
				hidden: input.hidden ?? existingConfig?.hidden ?? false,
				lowPowerAllowed: input.lowPowerAllowed ?? existingConfig?.lowPowerAllowed ?? false,
				assignedGroupId: input.assignedGroupId ?? existingConfig?.assignedGroupId ?? null,
				updatedBy: input.updatedBy ?? existingConfig?.updatedBy ?? null,
				updatedAt: now,
			},
		})

	invalidateVisibleStructureContextCache()
	return buildStructureDetailResult({
		...context,
		config: {
			structureId,
			hidden: input.hidden ?? existingConfig?.hidden ?? false,
			lowPowerAllowed: input.lowPowerAllowed ?? existingConfig?.lowPowerAllowed ?? false,
			assignedGroupId: input.assignedGroupId ?? existingConfig?.assignedGroupId ?? null,
			updatedBy: input.updatedBy ?? existingConfig?.updatedBy ?? null,
			createdAt: existingConfig?.createdAt ?? now,
			updatedAt: now,
		} as typeof structureConfigs.$inferSelect,
	})
}

export async function syncCorporationStructures(
	env: Env,
	db: DbClient<DbSchema>,
	corporationId: string,
	forceRefresh = false
): Promise<{
	structureCount: number
	stateChangeCount: number
}> {
	const corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corporationId)
	const previousStructures = await corpStub.getStructures(corporationId)
	const previousById = new Map(previousStructures.map((row) => [row.structureId, row]))
	await corpStub.fetchStructures(corporationId, forceRefresh)
	const corpStructures = await corpStub.getStructures(corporationId)

	if (corpStructures.length === 0) {
		return { structureCount: 0, stateChangeCount: 0 }
	}

	const now = new Date()
	let stateChangeCount = 0

	for (const structure of corpStructures) {
		const previous = previousById.get(structure.structureId)
		if (!previous || previous.state === structure.state) {
			continue
		}

		stateChangeCount += 1
		await db.insert(structureStateEvents).values({
			structureId: structure.structureId,
			corporationId,
			previousState: previous.state,
			newState: structure.state,
			detectedAt: now,
			sourceSyncAt: structure.lastSyncedAt ?? now,
		})
	}

	logger.info('[Structures] Synced corporation structures', {
		corporationId,
		structureCount: corpStructures.length,
		stateChangeCount,
	})

	invalidateVisibleStructureContextCache()
	return {
		structureCount: corpStructures.length,
		stateChangeCount,
	}
}
