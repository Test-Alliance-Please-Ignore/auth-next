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
	SOVEREIGNTY_HUB_TYPE_ID,
	getSkyhookFullness,
	getSkyhookReagentEntries,
	getSkyhookReagentSummary,
	getSkyhookReagentUnitVolumeM3,
	getSovereigntyReagentBayReagents,
	getSovereigntyReagentBaySummary,
	getStructureTabForTypeId,
	STRUCTURE_SYNC_ERROR_STALE_MS,
	STRUCTURE_SYNC_WARNING_STALE_MS,
	type StructureMoonStructureListSortBy,
	type StructureCommonListSortBy,
	type StructureSkyhookListSortBy,
	type StructureSovereigntyListSortBy,
	type StructureCitadelListQuery,
	type StructureMoonDrillListQuery,
	type StructureMiningCitadelListQuery,
	type StructureMiningCitadelListItem as RepoStructureMiningCitadelListItem,
	type StructureMiningCitadelListResponse as RepoStructureMiningCitadelListResponse,
	type StructureNavigationListQuery,
	type StructureSovereigntyListFilterOptions as RepoStructureSovereigntyListFilterOptions,
	type StructureSovereigntyListItem as RepoStructureSovereigntyListItem,
	type StructureSovereigntyListResponse as RepoStructureSovereigntyListResponse,
	type StructureSovereigntyListSummary as RepoStructureSovereigntyListSummary,
	type StructureSovereigntyReagent,
	type StructureSovereigntyTransportState,
	type StructureMoonDrillListItem as RepoStructureMoonDrillListItem,
	type StructureMoonDrillListResponse as RepoStructureMoonDrillListResponse,
	type StructureMoonDrillSummary as RepoStructureMoonDrillSummary,
	type StructureMiningCitadelSummary as RepoStructureMiningCitadelSummary,
	type StructureSkyhookListItem as RepoStructureSkyhookListItem,
	type StructureSkyhookListResponse as RepoStructureSkyhookListResponse,
	type StructureSkyhookListQuery,
	type StructureSovereigntyListQuery,
	type StructureTab,
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

import type { DbClient } from '@repo/db-utils'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { InventoryDisplayBay } from '@repo/inventory-display'
import type { Env, SessionUser } from '../context'
import type { DbSchema } from '../db'
import type {
	StructureFuelHistorySample,
	StructureFuelUsageHistory,
} from './structure-fuel-history'

type StructureSovereigntyFilterableItem = RepoStructureSovereigntyListItem

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

export type StructureListSortField =
	| StructureCommonListSortBy
	| StructureMoonStructureListSortBy
	| StructureSkyhookListSortBy
	| StructureSovereigntyListSortBy
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

function toIso(value: unknown): string | null {
	const parsed =
		value instanceof Date
			? value
			: typeof value === 'string' || typeof value === 'number'
				? new Date(value)
				: null
	if (!parsed || Number.isNaN(parsed.getTime())) {
		return null
	}
	return parsed ? parsed.toISOString() : null
}

type StructureWhereCondition = NonNullable<Parameters<typeof and>[number]>

const NON_CITADEL_TYPE_IDS = [
	...SOVEREIGNTY_STRUCTURE_TYPE_IDS,
	...SKYHOOK_STRUCTURE_TYPE_IDS,
	...NAVIGATION_STRUCTURE_TYPE_IDS,
	...MOON_DRILL_STRUCTURE_TYPE_IDS,
]

const NON_CITADEL_TYPE_NAMES = [...MINING_CITADEL_TYPE_NAMES, METENOX_MOON_DRILL_TYPE_NAME]

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

function summarizeStructureSovereigntyHub(
	hub: typeof structureSovereigntyHubs.$inferSelect
): StructureSovereigntyHubSummary {
	const reagentBaySummary = getSovereigntyReagentBaySummary(hub.reagentBay)
	const reagents = getSovereigntyReagentBayReagents(hub.reagentBay)

	return {
		controllerAllianceId: hub.controllerAllianceId ?? null,
		controllerAllianceName: hub.controllerAllianceName ?? null,
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
		allianceName: system.allianceName ?? null,
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
		updatedAt: toIso(structure.updatedAt) ?? new Date().toISOString(),
		canViewDetails,
	}
}

function buildSyntheticSovereigntyStructureRow(
	hub: typeof structureSovereigntyHubs.$inferSelect,
	system: typeof structureSovereigntySystems.$inferSelect | null,
	geography: { solarSystemName: string; regionId: string; regionName: string } | null
): StructureSourceRecord {
	const lastSyncedAt = hub.lastSyncedAt ?? system?.lastSyncedAt ?? null
	return {
		id: hub.structureId,
		corporationId: hub.corporationId,
		structureId: hub.structureId,
		name: system?.systemName ?? hub.systemName ?? geography?.solarSystemName ?? hub.structureId,
		typeId: hub.typeId,
		typeName: 'Sovereignty Hub',
		systemId: hub.systemId,
		systemName: system?.systemName ?? hub.systemName ?? geography?.solarSystemName ?? null,
		regionId: system?.regionId ?? geography?.regionId ?? null,
		regionName: system?.regionName ?? geography?.regionName ?? null,
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
		const syntheticStructure = buildSyntheticSovereigntyStructureRow(
			sovereigntyHub,
			systemRow ?? null,
			null
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

async function buildMoonStructureFilterOptionsFromSql(
	db: DbClient<DbSchema>,
	moonStructures:
		| ReturnType<typeof buildMoonDrillStructuresCte>
		| ReturnType<typeof buildMiningCitadelStructuresCte>
): Promise<StructureListFilterOptions> {
	const [baseFilterOptions, planets] = await Promise.all([
		buildOperationalStructureFilterOptions(db, moonStructures as any),
		db
			.with(moonStructures)
			.selectDistinct({
				planetId: moonStructures.planetId,
				planetName: moonStructures.planetName,
			})
			.from(moonStructures)
			.where(isNotNull(moonStructures.planetId))
			.orderBy(asc(moonStructures.planetName)),
	])

	return {
		...baseFilterOptions,
		planets: planets
			.map((row) => ({
				value: row.planetId ?? '',
				label: row.planetName ?? row.planetId ?? '',
			}))
			.filter((option) => option.value.length > 0),
	}
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

type VisibleOperationalStructureRow = {
	structureId: string
	corporationId: string
	corporationName: string | null
	structureName: string | null
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

function buildOperationalStructureListItem(
	row: VisibleOperationalStructureRow,
	canViewDetails: boolean
): StructureListItem {
	const nextStateAt = row.stateTimerEnd ?? row.nextReinforceApply ?? row.unanchorsAt

	return {
		structureId: row.structureId,
		corporationId: row.corporationId,
		corporationName: row.corporationName ?? row.corporationId,
		name: row.structureName ?? row.structureId,
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
		updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
		canViewDetails,
	}
}

function invalidateVisibleStructureContextCache(): void {}

function buildStructureContextsWhere(
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

function buildOperationalStructuresSelectQuery(db: DbClient<DbSchema>, corpWhere: any) {
	return db
		.select({
			structureId: corporationStructures.structureId,
			corporationId: corporationStructures.corporationId,
			corporationName: sql<string>`coalesce(${managedCorporations.name}, '')`.as('corporationName'),
			structureName: sql<string | null>`${corporationStructures.name}`.as('structureName'),
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
}

function buildOperationalStructuresCte(db: DbClient<DbSchema>, corpWhere: any) {
	return db.$with('operational_structures').as(buildOperationalStructuresSelectQuery(db, corpWhere))
}

function buildSkyhookStructuresCte(db: DbClient<DbSchema>, corpWhere: any) {
	return db.$with('skyhook_structures').as(
		db
			.select({
				structureId: corporationStructures.structureId,
				corporationId: corporationStructures.corporationId,
				corporationName: sql<string>`coalesce(${managedCorporations.name}, '')`.as('corporationName'),
				structureName: sql<string | null>`${corporationStructures.name}`.as('structureName'),
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
				isRaidable: getSkyhookCurrentRaidableExpression(structureSkyhooks).as('isRaidable'),
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
	sortBy: StructureSkyhookListSortBy,
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
			return [sortExpression(sql`coalesce(${source.structureName}, '')`), sortExpression(source.structureId)]
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

function buildSkyhookVisibilityWhere(access: StructureAccessScope, query: StructureSkyhookListQuery): any {
	const conditions: StructureWhereCondition[] = []
	const baseWhere = buildStructureContextsWhere(access, query, 'skyhooks')
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
		updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
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
	skyhookStructures: ReturnType<typeof buildSkyhookStructuresCte>
): Promise<StructureListFilterOptions> {
	const rowsDb = db.with(skyhookStructures)
	const [corporations, assignedGroups, regions, systems, states, types, planets] = await Promise.all([
		rowsDb
			.selectDistinct({
				corporationId: skyhookStructures.corporationId,
				corporationName: skyhookStructures.corporationName,
			})
			.from(skyhookStructures)
			.orderBy(asc(skyhookStructures.corporationName)),
		rowsDb
			.selectDistinct({
				assignedGroupId: skyhookStructures.assignedGroupId,
			})
			.from(skyhookStructures)
			.where(isNotNull(skyhookStructures.assignedGroupId))
			.orderBy(asc(skyhookStructures.assignedGroupId)),
		rowsDb
			.selectDistinct({
				regionId: skyhookStructures.regionId,
				regionName: skyhookStructures.regionName,
			})
			.from(skyhookStructures)
			.orderBy(asc(skyhookStructures.regionName)),
		rowsDb
			.selectDistinct({
				systemId: skyhookStructures.systemId,
				systemName: skyhookStructures.systemName,
			})
			.from(skyhookStructures)
			.orderBy(asc(skyhookStructures.systemName)),
		rowsDb
			.selectDistinct({
				state: skyhookStructures.state,
			})
			.from(skyhookStructures)
			.orderBy(asc(skyhookStructures.state)),
		rowsDb
			.selectDistinct({
				typeId: skyhookStructures.typeId,
				typeName: skyhookStructures.typeName,
			})
			.from(skyhookStructures)
			.orderBy(asc(skyhookStructures.typeName)),
		rowsDb
			.selectDistinct({
				planetId: skyhookStructures.planetId,
				planetName: skyhookStructures.planetName,
			})
			.from(skyhookStructures)
			.where(isNotNull(skyhookStructures.planetId))
			.orderBy(asc(skyhookStructures.planetName)),
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
	skyhookStructures: ReturnType<typeof buildSkyhookStructuresCte>
): Promise<StructureListSummary> {
	const rowsDb = db.with(skyhookStructures)
	const currentRaidableExpression = getSkyhookCurrentRaidableExpression(skyhookStructures)
	const highestFillExpression = sql<number | null>`
		greatest(
			coalesce(((${skyhookStructures.reagents} -> 'summary' ->> 'securedFillPercent')::numeric), 0),
			coalesce(((${skyhookStructures.reagents} -> 'summary' ->> 'unsecuredFillPercent')::numeric), 0)
		)
	`
	const candidateStartExpression = sql<Date | null>`
		${skyhookStructures.theftVulnerabilityStart}
	`
	const [totalResult, highestFillResult, workforceResult, raidableCountResult, nextRaidableResult] =
		await Promise.all([
			rowsDb
				.select({
					total: sql<number>`count(*)::int`,
				})
				.from(skyhookStructures),
			rowsDb
				.select({
					skyhookHighestFillPercent: sql<number | null>`max(${highestFillExpression})`,
				})
				.from(skyhookStructures),
			rowsDb
				.select({
					skyhookTotalWorkforce: sql<number>`coalesce(sum(${skyhookStructures.effectiveWorkforce}), 0)::int`,
				})
				.from(skyhookStructures),
			rowsDb
				.select({
					skyhookCurrentRaidableCount: sql<number>`coalesce(sum(case when ${currentRaidableExpression} then 1 else 0 end), 0)::int`,
				})
				.from(skyhookStructures),
			rowsDb
				.select({
					structureId: skyhookStructures.structureId,
					planetName: skyhookStructures.planetName,
					candidateStart: sql<string | null>`${candidateStartExpression}`,
					currentRaidable: currentRaidableExpression,
				})
				.from(skyhookStructures)
				.where(
					sql`(${candidateStartExpression}) is not null and (${skyhookStructures.theftVulnerabilityEnd} is null or now() <= ${skyhookStructures.theftVulnerabilityEnd})`
				)
				.orderBy(asc(candidateStartExpression), asc(skyhookStructures.structureId))
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

function buildSovereigntyReagentMetricSql(
	source: any,
	summaryField: 'magmaticGasQuantity' | 'magmaticGasBurningPerHour' | 'superionicIceQuantity' | 'superionicIceBurningPerHour',
	reagentField: 'amount' | 'burningPerHour',
	typeId: string
) {
	const summaryValue = sql<string | null>`nullif(${source.reagentBay} -> 'summary' ->> ${summaryField}, '')`
	const arrayValue = sql<number>`
		(
			select coalesce(sum((reagent ->> ${reagentField})::numeric), 0)
			from jsonb_array_elements(
				case
					when jsonb_typeof(${source.reagentBay}) = 'object'
						and jsonb_typeof(${source.reagentBay} -> 'reagents') = 'array'
						then ${source.reagentBay} -> 'reagents'
					when jsonb_typeof(${source.reagentBay}) = 'array' then ${source.reagentBay}
					else '[]'::jsonb
				end
			) as reagent
			where reagent ->> 'typeId' = ${typeId}
		)
	`

	return sql<number>`
		coalesce(nullif(((${summaryValue})::numeric), 'NaN'::numeric), ${arrayValue})
	`
}

function buildSovereigntySummaryDateSql(source: any, field: string) {
	const [quantityExpression, burningPerHourExpression] =
		field === 'magmaticGasEstimatedDepletionAt'
			? [
					buildSovereigntyReagentMetricSql(
						source,
						'magmaticGasQuantity',
						'amount',
						SKYHOOK_MAGMATIC_GAS_TYPE_ID
					),
					buildSovereigntyReagentMetricSql(
						source,
						'magmaticGasBurningPerHour',
						'burningPerHour',
						SKYHOOK_MAGMATIC_GAS_TYPE_ID
					),
				]
			: [
					buildSovereigntyReagentMetricSql(
						source,
						'superionicIceQuantity',
						'amount',
						SKYHOOK_SUPERIONIC_ICE_TYPE_ID
					),
					buildSovereigntyReagentMetricSql(
						source,
						'superionicIceBurningPerHour',
						'burningPerHour',
						SKYHOOK_SUPERIONIC_ICE_TYPE_ID
					),
				]

	return sql<string | null>`
		case
			when ${quantityExpression} > 0 and ${burningPerHourExpression} > 0
				then (now() + ((${quantityExpression}::numeric / ${burningPerHourExpression}::numeric) * interval '1 hour'))::text
			else null
		end
	`
}

function buildSovereigntySortOrder(
	sortBy: StructureSovereigntyListSortBy,
	sortDirection: StructureListSortDirection,
	source: any
) {
	const descending = sortDirection === 'desc'
	const sortExpression = (expression: any) => (descending ? desc(expression) : asc(expression))
	const depletionSort = (field: 'magmaticGasEstimatedDepletionAt' | 'superionicIceEstimatedDepletionAt') =>
		sortExpression(buildSovereigntySummaryDateSql(source, field))

	switch (sortBy) {
		case 'fuel':
		case 'nextStateAt':
		case 'group':
		case 'state':
			return [sortExpression(source.structureId)]
		case 'updatedAt':
			return [sortExpression(source.updatedAt), sortExpression(source.structureId)]
		case 'name':
			return [sortExpression(sql`coalesce(${source.structureName}, '')`), sortExpression(source.structureId)]
		case 'corporation':
			return [sortExpression(sql`coalesce(${source.corporationName}, '')`), sortExpression(source.structureId)]
		case 'region':
			return [sortExpression(sql`coalesce(${source.regionName}, '')`), sortExpression(source.structureId)]
		case 'system':
			return [sortExpression(sql`coalesce(${source.systemName}, '')`), sortExpression(source.structureId)]
		case 'type':
			return [sortExpression(sql`coalesce(${source.typeName}, '')`), sortExpression(source.structureId)]
		case 'syncStatus':
			return [
				sortExpression(
					sql`case ${source.syncStatus} when 'error' then 0 when 'warning' then 1 when 'ok' then 2 else null end`
				),
				sortExpression(source.structureId),
			]
		case 'activityDefenseMultiplier':
			return [sortExpression(source.activityDefenseMultiplier), sortExpression(source.structureId)]
		case 'magmaticGasEstimatedDepletionAt':
			return [depletionSort('magmaticGasEstimatedDepletionAt'), sortExpression(source.structureId)]
		case 'superionicIceEstimatedDepletionAt':
			return [depletionSort('superionicIceEstimatedDepletionAt'), sortExpression(source.structureId)]
		default:
			return [sortExpression(source.structureId)]
	}
}

function buildSovereigntyStructuresCte(db: DbClient<DbSchema>, corpWhere: any) {
	return db.$with('sovereignty_structures').as(
		db
			.select({
				structureId: sql<string>`
					coalesce(${structureSovereigntyHubs.structureId}, ${structureSovereigntySystems.sovereigntyHubStructureId}, ${structureSovereigntySystems.systemId})
				`.as('structureId'),
				corporationId: structureSovereigntySystems.corporationId,
				corporationName: managedCorporations.name,
				includeInStructureAssetSync: managedCorporations.includeInStructureAssetSync,
				typeId: sql<string>`
					coalesce(${structureSovereigntyHubs.typeId}, ${SOVEREIGNTY_HUB_TYPE_ID})
				`.as('typeId'),
				typeName: sql<string>`'Sovereignty Hub'`.as('typeName'),
				systemId: structureSovereigntySystems.systemId,
				systemName: structureSovereigntySystems.systemName,
				regionId: structureSovereigntySystems.regionId,
				regionName: structureSovereigntySystems.regionName,
				claimType: structureSovereigntySystems.claimType,
				allianceId: structureSovereigntySystems.allianceId,
				allianceName: structureSovereigntySystems.allianceName,
				corporationClaimantId: structureSovereigntySystems.corporationClaimantId,
				factionId: structureSovereigntySystems.factionId,
				claimedSince: structureSovereigntySystems.claimedSince,
				sovereigntyHubStructureId: structureSovereigntySystems.sovereigntyHubStructureId,
				isCapitalSystem: structureSovereigntySystems.isCapitalSystem,
				vulnerabilityWindowStart: structureSovereigntySystems.vulnerabilityWindowStart,
				vulnerabilityWindowEnd: structureSovereigntySystems.vulnerabilityWindowEnd,
				activityDefenseMultiplier: structureSovereigntySystems.activityDefenseMultiplier,
				militaryLevel: structureSovereigntySystems.militaryLevel,
				industrialLevel: structureSovereigntySystems.industrialLevel,
				strategicLevel: structureSovereigntySystems.strategicLevel,
				controllerAllianceId: structureSovereigntyHubs.controllerAllianceId,
				controllerAllianceName: structureSovereigntyHubs.controllerAllianceName,
				reagentBayLastUpdated: structureSovereigntyHubs.reagentBayLastUpdated,
				reagentBay: structureSovereigntyHubs.reagentBay,
				resources: structureSovereigntyHubs.resources,
				upgrades: structureSovereigntyHubs.upgrades,
				workforceTransport: structureSovereigntyHubs.workforceTransport,
				syncStatus: sql<string>`
					coalesce(${structureSovereigntyHubs.syncStatus}, 'warning')
				`.as('syncStatus'),
				syncFailureReason: structureSovereigntyHubs.syncFailureReason,
				sourceSyncAt: structureSovereigntyHubs.sourceSyncAt,
				lastSyncedAt: sql<Date | null>`
					coalesce(${structureSovereigntyHubs.lastSyncedAt}, ${structureSovereigntySystems.lastSyncedAt})
				`.as('lastSyncedAt'),
				updatedAt: sql<Date>`
					coalesce(${structureSovereigntySystems.updatedAt}, ${structureSovereigntyHubs.updatedAt})
				`.as('updatedAt'),
			})
			.from(structureSovereigntySystems)
			.leftJoin(
				structureSovereigntyHubs,
				or(
					eq(
						structureSovereigntyHubs.structureId,
						structureSovereigntySystems.sovereigntyHubStructureId
					),
					eq(structureSovereigntyHubs.systemId, structureSovereigntySystems.systemId)
				)
			)
			.leftJoin(
				managedCorporations,
				eq(managedCorporations.corporationId, structureSovereigntySystems.corporationId)
			)
			.where(corpWhere ?? sql`true`)
	)
}

function buildSovereigntyWhere(
	access: StructureAccessScope,
	query: StructureSovereigntyListQuery
): any {
	const conditions: StructureWhereCondition[] = []
	if (query.corporationId) {
		conditions.push(eq(structureSovereigntySystems.corporationId, query.corporationId))
	}
	if (query.systemId) {
		conditions.push(eq(structureSovereigntySystems.systemId, query.systemId))
	}
	if (query.regionId) {
		conditions.push(eq(structureSovereigntySystems.regionId, query.regionId))
	}
	if (query.controllerAllianceId) {
		conditions.push(eq(structureSovereigntyHubs.controllerAllianceId, query.controllerAllianceId))
	}
	if (query.vulnerabilityState) {
		switch (query.vulnerabilityState) {
			case 'vulnerable':
				{
					const condition = combineWhereConditions([
						isNotNull(structureSovereigntySystems.vulnerabilityWindowStart),
						isNotNull(structureSovereigntySystems.vulnerabilityWindowEnd),
						sql`now() >= ${structureSovereigntySystems.vulnerabilityWindowStart}`,
						sql`now() <= ${structureSovereigntySystems.vulnerabilityWindowEnd}`,
					])
					if (condition) {
						conditions.push(condition)
					}
				}
				break
			case 'invulnerable':
				{
					const condition = combineWhereConditions([
						isNotNull(structureSovereigntySystems.vulnerabilityWindowStart),
						isNotNull(structureSovereigntySystems.vulnerabilityWindowEnd),
						or(
							sql`now() < ${structureSovereigntySystems.vulnerabilityWindowStart}`,
							sql`now() > ${structureSovereigntySystems.vulnerabilityWindowEnd}`
						),
					])
					if (condition) {
						conditions.push(condition)
					}
				}
				break
			case 'reinforced':
				conditions.push(sql`false`)
				break
		}
	}
	return combineWhereConditions(conditions) ?? sql`true`
}

async function buildSovereigntyStructureFilterOptionsFromSql(
	db: DbClient<DbSchema>,
	sovereigntyStructures: ReturnType<typeof buildSovereigntyStructuresCte>
): Promise<RepoStructureSovereigntyListFilterOptions> {
	const rowsDb = db.with(sovereigntyStructures)
	const vulnerableExpression = sql<boolean>`
		${sovereigntyStructures.vulnerabilityWindowStart} is not null
		and ${sovereigntyStructures.vulnerabilityWindowEnd} is not null
		and now() >= ${sovereigntyStructures.vulnerabilityWindowStart}
		and now() <= ${sovereigntyStructures.vulnerabilityWindowEnd}
	`
	const invulnerableExpression = sql<boolean>`
		${sovereigntyStructures.vulnerabilityWindowStart} is not null
		and ${sovereigntyStructures.vulnerabilityWindowEnd} is not null
		and (now() < ${sovereigntyStructures.vulnerabilityWindowStart}
			or now() > ${sovereigntyStructures.vulnerabilityWindowEnd})
	`
	const unknownExpression = sql<boolean>`
		${sovereigntyStructures.vulnerabilityWindowStart} is null
		or ${sovereigntyStructures.vulnerabilityWindowEnd} is null
	`
	const [corporations, regions, systems, controllerAlliances, vulnerabilityCounts] = await Promise.all([
			rowsDb
				.selectDistinct({
					corporationId: sovereigntyStructures.corporationId,
					corporationName: sovereigntyStructures.corporationName,
				})
				.from(sovereigntyStructures)
				.orderBy(asc(sovereigntyStructures.corporationName)),
			rowsDb
				.selectDistinct({
					regionId: sovereigntyStructures.regionId,
					regionName: sovereigntyStructures.regionName,
				})
				.from(sovereigntyStructures)
				.where(isNotNull(sovereigntyStructures.regionId))
				.orderBy(asc(sovereigntyStructures.regionName)),
			rowsDb
				.selectDistinct({
					systemId: sovereigntyStructures.systemId,
					systemName: sovereigntyStructures.systemName,
				})
				.from(sovereigntyStructures)
				.orderBy(asc(sovereigntyStructures.systemName)),
			rowsDb
				.selectDistinct({
					controllerAllianceId: sovereigntyStructures.controllerAllianceId,
				})
				.from(sovereigntyStructures)
				.where(isNotNull(sovereigntyStructures.controllerAllianceId))
				.orderBy(asc(sovereigntyStructures.controllerAllianceId)),
			rowsDb
				.select({
					vulnerable: sql<number>`coalesce(sum(case when ${vulnerableExpression} then 1 else 0 end), 0)::int`,
					invulnerable: sql<number>`coalesce(sum(case when ${invulnerableExpression} then 1 else 0 end), 0)::int`,
					unknown: sql<number>`coalesce(sum(case when ${unknownExpression} then 1 else 0 end), 0)::int`,
				})
				.from(sovereigntyStructures),
	])

	return {
		corporations: corporations
			.map((row) => ({
				value: row.corporationId,
				label: row.corporationName ?? row.corporationId,
			}))
			.filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index),
		assignedGroups: [],
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
		controllerAlliances: controllerAlliances
			.map((row) => ({
				value: row.controllerAllianceId ?? '',
				label: row.controllerAllianceId ?? '',
			}))
			.filter((option) => option.value.length > 0),
		vulnerabilityStates: [
			vulnerabilityCounts[0]?.vulnerable ? { value: 'vulnerable', label: 'Vulnerable' } : null,
			vulnerabilityCounts[0]?.invulnerable ? { value: 'invulnerable', label: 'Invulnerable' } : null,
			vulnerabilityCounts[0]?.unknown ? { value: 'unknown', label: 'Unknown' } : null,
		].filter((entry): entry is NonNullable<typeof entry> => entry !== null),
	}
}

async function buildSovereigntyStructureSummaryFromSql(
	db: DbClient<DbSchema>,
	sovereigntyStructures: ReturnType<typeof buildSovereigntyStructuresCte>,
	moduleConfig: Pick<
		StructureModuleConfigResult,
		| 'lowFuelTimeThresholdHours'
		| 'criticalFuelTimeThresholdHours'
		| 'lowFuelAmountThreshold'
		| 'criticalFuelAmountThreshold'
	>
): Promise<RepoStructureSovereigntyListSummary> {
	const rowsDb = db.with(sovereigntyStructures)
	const lowFuelThresholdAt = new Date(
		Date.now() + moduleConfig.lowFuelTimeThresholdHours * HOURS_TO_MS
	)
	const magmaticGasQuantityExpression = buildSovereigntyReagentMetricSql(
		sovereigntyStructures,
		'magmaticGasQuantity',
		'amount',
		SKYHOOK_MAGMATIC_GAS_TYPE_ID
	)
	const magmaticGasBurningPerHourExpression = buildSovereigntyReagentMetricSql(
		sovereigntyStructures,
		'magmaticGasBurningPerHour',
		'burningPerHour',
		SKYHOOK_MAGMATIC_GAS_TYPE_ID
	)
	const magmaticGasDepletionExpression = buildSovereigntySummaryDateSql(
		sovereigntyStructures,
		'magmaticGasEstimatedDepletionAt'
	)
	const superionicIceQuantityExpression = buildSovereigntyReagentMetricSql(
		sovereigntyStructures,
		'superionicIceQuantity',
		'amount',
		SKYHOOK_SUPERIONIC_ICE_TYPE_ID
	)
	const superionicIceBurningPerHourExpression = buildSovereigntyReagentMetricSql(
		sovereigntyStructures,
		'superionicIceBurningPerHour',
		'burningPerHour',
		SKYHOOK_SUPERIONIC_ICE_TYPE_ID
	)
	const superionicIceDepletionExpression = buildSovereigntySummaryDateSql(
		sovereigntyStructures,
		'superionicIceEstimatedDepletionAt'
	)
	const vulnerableExpression = sql<boolean>`
		${sovereigntyStructures.vulnerabilityWindowStart} is not null
		and ${sovereigntyStructures.vulnerabilityWindowEnd} is not null
		and now() >= ${sovereigntyStructures.vulnerabilityWindowStart}
		and now() <= ${sovereigntyStructures.vulnerabilityWindowEnd}
	`
	const invulnerableExpression = sql<boolean>`
		${sovereigntyStructures.vulnerabilityWindowStart} is not null
		and ${sovereigntyStructures.vulnerabilityWindowEnd} is not null
		and (now() < ${sovereigntyStructures.vulnerabilityWindowStart}
			or now() > ${sovereigntyStructures.vulnerabilityWindowEnd})
	`
	const lowFuelExpression = sql<boolean>`
		(
			${magmaticGasQuantityExpression} > 0
			and ${magmaticGasDepletionExpression} is not null
			and ${magmaticGasDepletionExpression}::timestamptz <= ${lowFuelThresholdAt}
		)
		or (
			${superionicIceQuantityExpression} > 0
			and ${superionicIceDepletionExpression} is not null
			and ${superionicIceDepletionExpression}::timestamptz <= ${lowFuelThresholdAt}
		)
	`
	const [totalResult, lowFuelResult, vulnerableResult, invulnerableResult, unknownResult, hubBurnRateResult] =
		await Promise.all([
			rowsDb
				.select({
					total: sql<number>`count(*)::int`,
				})
				.from(sovereigntyStructures),
			rowsDb
				.select({
					count: sql<number>`coalesce(sum(case when ${lowFuelExpression} then 1 else 0 end), 0)::int`,
				})
				.from(sovereigntyStructures),
			rowsDb
				.select({
					count: sql<number>`coalesce(sum(case when ${vulnerableExpression} then 1 else 0 end), 0)::int`,
				})
				.from(sovereigntyStructures),
			rowsDb
				.select({
					count: sql<number>`coalesce(sum(case when ${invulnerableExpression} then 1 else 0 end), 0)::int`,
				})
				.from(sovereigntyStructures),
			rowsDb
				.select({
					count: sql<number>`coalesce(sum(case when ${vulnerableExpression} or ${invulnerableExpression} then 0 else 1 end), 0)::int`,
				})
				.from(sovereigntyStructures),
			rowsDb
				.select({
					magmaticGasBurningPerHour: sql<string | null>`sum(case when ${magmaticGasQuantityExpression} > 0 and ${magmaticGasBurningPerHourExpression} > 0 then ${magmaticGasBurningPerHourExpression} else 0 end)::text`,
					magmaticGasBurningSampleCount: sql<number>`coalesce(sum(case when ${magmaticGasQuantityExpression} > 0 and ${magmaticGasBurningPerHourExpression} > 0 then 1 else 0 end), 0)::int`,
					superionicIceBurningPerHour: sql<string | null>`sum(case when ${superionicIceQuantityExpression} > 0 and ${superionicIceBurningPerHourExpression} > 0 then ${superionicIceBurningPerHourExpression} else 0 end)::text`,
					superionicIceBurningSampleCount: sql<number>`coalesce(sum(case when ${superionicIceQuantityExpression} > 0 and ${superionicIceBurningPerHourExpression} > 0 then 1 else 0 end), 0)::int`,
				})
				.from(sovereigntyStructures),
		])

	return {
		total: totalResult[0]?.total ?? 0,
		lowFuel: lowFuelResult[0]?.count ?? 0,
		lowPower: 0,
		reinforced: 0,
		estimatedFuelBurnRatePerHour: null,
		fuelBurnRateSampleCount: 0,
		vulnerable: vulnerableResult[0]?.count ?? 0,
		invulnerable: invulnerableResult[0]?.count ?? 0,
		unknown: unknownResult[0]?.count ?? 0,
		magmaticGasBurningPerHour: hubBurnRateResult[0]?.magmaticGasBurningPerHour ?? null,
		superionicIceBurningPerHour: hubBurnRateResult[0]?.superionicIceBurningPerHour ?? null,
		magmaticGasBurningSampleCount: hubBurnRateResult[0]?.magmaticGasBurningSampleCount ?? 0,
		superionicIceBurningSampleCount: hubBurnRateResult[0]?.superionicIceBurningSampleCount ?? 0,
	}
}

async function loadSovereigntyPageItems(
	db: DbClient<DbSchema>,
	user: SessionUser,
	access: StructureAccessScope,
	query: StructureSovereigntyListQuery,
	sovereigntyStructures: ReturnType<typeof buildSovereigntyStructuresCte>,
	pageOverride?: number
): Promise<RepoStructureSovereigntyListItem[]> {
	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortOrder = buildSovereigntySortOrder(sortBy, sortDirection, sovereigntyStructures)
	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const page = Math.max(pageOverride ?? query.page ?? 1, 1)
	const offset = (page - 1) * pageSize
	const rows = await db
		.with(sovereigntyStructures)
		.select({
			structureId: sovereigntyStructures.structureId,
			corporationId: sovereigntyStructures.corporationId,
			corporationName: sovereigntyStructures.corporationName,
			includeInStructureAssetSync: sovereigntyStructures.includeInStructureAssetSync,
			typeId: sovereigntyStructures.typeId,
			typeName: sovereigntyStructures.typeName,
			systemId: sovereigntyStructures.systemId,
			systemName: sovereigntyStructures.systemName,
			regionId: sovereigntyStructures.regionId,
			regionName: sovereigntyStructures.regionName,
			claimType: sovereigntyStructures.claimType,
			allianceId: sovereigntyStructures.allianceId,
			allianceName: sovereigntyStructures.allianceName,
			corporationClaimantId: sovereigntyStructures.corporationClaimantId,
			factionId: sovereigntyStructures.factionId,
			claimedSince: sovereigntyStructures.claimedSince,
			sovereigntyHubStructureId: sovereigntyStructures.sovereigntyHubStructureId,
			isCapitalSystem: sovereigntyStructures.isCapitalSystem,
			vulnerabilityWindowStart: sovereigntyStructures.vulnerabilityWindowStart,
			vulnerabilityWindowEnd: sovereigntyStructures.vulnerabilityWindowEnd,
			activityDefenseMultiplier: sovereigntyStructures.activityDefenseMultiplier,
			militaryLevel: sovereigntyStructures.militaryLevel,
			industrialLevel: sovereigntyStructures.industrialLevel,
			strategicLevel: sovereigntyStructures.strategicLevel,
			controllerAllianceId: sovereigntyStructures.controllerAllianceId,
			controllerAllianceName: sovereigntyStructures.controllerAllianceName,
			reagentBayLastUpdated: sovereigntyStructures.reagentBayLastUpdated,
			reagentBay: sovereigntyStructures.reagentBay,
			resources: sovereigntyStructures.resources,
			upgrades: sovereigntyStructures.upgrades,
			workforceTransport: sovereigntyStructures.workforceTransport,
			syncStatus: sovereigntyStructures.syncStatus,
			syncFailureReason: sovereigntyStructures.syncFailureReason,
			sourceSyncAt: sovereigntyStructures.sourceSyncAt,
			lastSyncedAt: sovereigntyStructures.lastSyncedAt,
			updatedAt: sovereigntyStructures.updatedAt,
		})
		.from(sovereigntyStructures)
		.orderBy(...sortOrder)
		.limit(pageSize)
		.offset(offset)

	return rows.map((row) => {
		const hubRow = {
			structureId: row.structureId,
			corporationId: row.corporationId,
			systemId: row.systemId,
			systemName: row.systemName,
			typeId: row.typeId,
			fuelAccessListId: null,
			controllerAllianceId: row.controllerAllianceId,
			controllerAllianceName: row.controllerAllianceName,
			reagentBayLastUpdated: row.reagentBayLastUpdated,
			reagentBay:
				row.reagentBay ?? {
					lastUpdated: '',
					reagents: [],
				},
			resources:
				row.resources ?? {
					power: {
						allocated: 0,
						available: 0,
					},
					workforce: {
						allocated: 0,
						available: 0,
					},
				},
			upgrades: row.upgrades ?? [],
			vulnerabilityWindowStart: row.vulnerabilityWindowStart,
			vulnerabilityWindowEnd: row.vulnerabilityWindowEnd,
			workforceTransport:
				row.workforceTransport ?? {
					configuration: { mode: 'unknown', systems: [] },
					state: { mode: 'unknown', systems: [] },
				},
			syncStatus: (row.syncStatus ?? 'warning') as typeof structureSovereigntyHubs.$inferSelect['syncStatus'],
			syncFailureReason: row.syncFailureReason,
			sourceSyncAt: row.sourceSyncAt,
			lastSyncedAt: row.lastSyncedAt,
			updatedAt: row.updatedAt,
		} satisfies typeof structureSovereigntyHubs.$inferSelect
		const systemRow = {
			systemId: row.systemId,
			systemName: row.systemName,
			corporationId: row.corporationId,
			claimType: row.claimType ?? 'unclaimed',
			allianceId: row.allianceId,
			allianceName: row.allianceName,
			corporationClaimantId: row.corporationClaimantId,
			factionId: row.factionId,
			regionId: row.regionId,
			regionName: row.regionName,
			claimedSince: row.claimedSince,
			sovereigntyHubStructureId: row.sovereigntyHubStructureId,
			isCapitalSystem: row.isCapitalSystem,
			vulnerabilityWindowStart: row.vulnerabilityWindowStart,
			vulnerabilityWindowEnd: row.vulnerabilityWindowEnd,
			activityDefenseMultiplier: row.activityDefenseMultiplier,
			militaryLevel: row.militaryLevel,
			industrialLevel: row.industrialLevel,
			strategicLevel: row.strategicLevel,
			updatedAt: row.updatedAt,
			lastSyncedAt: row.lastSyncedAt,
			sourceSyncAt: row.sourceSyncAt,
		} satisfies typeof structureSovereigntySystems.$inferSelect
		const structure = buildSyntheticSovereigntyStructureRow(hubRow, systemRow, null)
		const structureTab = getStructureTab(structure)
		const canViewDetails =
			user.is_admin || canViewDetailsStructure(access, row.corporationId, structureTab)
		const canViewSensitive =
			user.is_admin || canViewSensitiveStructure(access, row.corporationId, structureTab)
		const canEdit = user.is_admin || canEditStructure(access, row.corporationId, structureTab)
		const context: VisibleStructureContext = {
			structure,
			corporationName: row.corporationName ?? row.corporationId,
			includeInStructureAssetSync: row.includeInStructureAssetSync ?? false,
			config: null,
			canViewDetails,
			canViewSensitive,
			canEdit,
			tabData: null,
			fittingItems: null,
			lastRefilledAt: null,
			fuelUsage: null,
		}
		return buildSovereigntyListItem({
			context,
			systemRow,
			hubRow,
		})
	})
}

async function loadSkyhookPageItems(
	db: DbClient<DbSchema>,
	user: SessionUser,
	access: StructureAccessScope,
	query: StructureSkyhookListQuery,
	skyhookStructures: ReturnType<typeof buildSkyhookStructuresCte>,
	pageOverride?: number
): Promise<RepoStructureSkyhookListItem[]> {
	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortOrder = buildSkyhookSortOrder(sortBy, sortDirection, skyhookStructures)
	if (!sortOrder) {
		return []
	}

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const page = Math.max(pageOverride ?? query.page ?? 1, 1)
	const offset = (page - 1) * pageSize
	const rows = await db
		.with(skyhookStructures)
		.select({
			structureId: skyhookStructures.structureId,
			corporationId: skyhookStructures.corporationId,
			corporationName: skyhookStructures.corporationName,
			structureName: skyhookStructures.structureName,
			typeId: skyhookStructures.typeId,
			typeName: skyhookStructures.typeName,
			systemId: skyhookStructures.systemId,
			systemName: skyhookStructures.systemName,
			regionId: skyhookStructures.regionId,
			regionName: skyhookStructures.regionName,
			state: skyhookStructures.state,
			stateTimerEnd: skyhookStructures.stateTimerEnd,
			nextReinforceApply: skyhookStructures.nextReinforceApply,
			unanchorsAt: skyhookStructures.unanchorsAt,
			fuelExpires: skyhookStructures.fuelExpires,
			fuelAmount: skyhookStructures.fuelAmount,
			fuelBurnRate: skyhookStructures.fuelBurnRate,
			lowPower: skyhookStructures.lowPower,
			hidden: skyhookStructures.hidden,
			lowPowerAllowed: skyhookStructures.lowPowerAllowed,
			assignedGroupId: skyhookStructures.assignedGroupId,
			syncStatus: skyhookStructures.syncStatus,
			syncFailureReason: skyhookStructures.syncFailureReason,
			lastSyncedAt: skyhookStructures.lastSyncedAt,
			updatedAt: skyhookStructures.updatedAt,
			planetId: skyhookStructures.planetId,
			planetName: skyhookStructures.planetName,
			isActive: skyhookStructures.isActive,
			effectiveWorkforce: skyhookStructures.effectiveWorkforce,
			reagents: skyhookStructures.reagents,
			reinforcementTimerEnd: skyhookStructures.reinforcementTimerEnd,
			theftVulnerabilityStart: skyhookStructures.theftVulnerabilityStart,
			theftVulnerabilityEnd: skyhookStructures.theftVulnerabilityEnd,
			isRaidable: skyhookStructures.isRaidable,
		})
		.from(skyhookStructures)
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

async function loadMoonDrillPageItems(
	db: DbClient<DbSchema>,
	user: SessionUser,
	access: StructureAccessScope,
	query: StructureMoonDrillListQuery,
	moonDrillStructures: ReturnType<typeof buildMoonDrillStructuresCte>,
	pageOverride?: number
): Promise<RepoStructureMoonDrillListItem[]> {
	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortOrder = buildMoonStructureSortOrder(sortBy, sortDirection, moonDrillStructures)
	if (!sortOrder) {
		return []
	}

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const page = Math.max(pageOverride ?? query.page ?? 1, 1)
	const offset = (page - 1) * pageSize
	const rows = await db
		.with(moonDrillStructures)
		.select({
			structureId: moonDrillStructures.structureId,
			corporationId: moonDrillStructures.corporationId,
			corporationName: moonDrillStructures.corporationName,
			structureName: moonDrillStructures.structureName,
			typeId: moonDrillStructures.typeId,
			typeName: moonDrillStructures.typeName,
			systemId: moonDrillStructures.systemId,
			systemName: moonDrillStructures.systemName,
			regionId: moonDrillStructures.regionId,
			regionName: moonDrillStructures.regionName,
			state: moonDrillStructures.state,
			stateTimerEnd: moonDrillStructures.stateTimerEnd,
			nextReinforceApply: moonDrillStructures.nextReinforceApply,
			unanchorsAt: moonDrillStructures.unanchorsAt,
			fuelExpires: moonDrillStructures.fuelExpires,
			fuelAmount: moonDrillStructures.fuelAmount,
			fuelBurnRate: moonDrillStructures.fuelBurnRate,
			lowPower: moonDrillStructures.lowPower,
			hidden: moonDrillStructures.hidden,
			lowPowerAllowed: moonDrillStructures.lowPowerAllowed,
			assignedGroupId: moonDrillStructures.assignedGroupId,
			syncStatus: moonDrillStructures.syncStatus,
			syncFailureReason: moonDrillStructures.syncFailureReason,
			lastSyncedAt: moonDrillStructures.lastSyncedAt,
			updatedAt: moonDrillStructures.updatedAt,
			moonDrillStructureId: moonDrillStructures.moonDrillStructureId,
			moonId: moonDrillStructures.moonId,
			moonName: moonDrillStructures.moonName,
			planetId: moonDrillStructures.planetId,
			planetName: moonDrillStructures.planetName,
			moonDrillLastSyncedAt: moonDrillStructures.moonDrillLastSyncedAt,
			moonDrillUpdatedAt: moonDrillStructures.moonDrillUpdatedAt,
		})
		.from(moonDrillStructures)
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
		const hasMoonDrillSnapshot = row.moonDrillStructureId !== null && row.moonId !== null

		return {
			...buildOperationalStructureListItem(row, canViewDetails),
			name: row.structureName ?? row.structureId,
			planetId: row.planetId ?? null,
			planetName: row.planetName ?? null,
			moonId: row.moonId ?? '',
			moonName: row.moonName ?? null,
			syncStatus: hasMoonDrillSnapshot ? getSnapshotSyncStatus(row.moonDrillLastSyncedAt) : 'warning',
			syncFailureReason: hasMoonDrillSnapshot
				? null
				: 'Moon drill snapshot has not been ingested yet for this structure.',
			lastSyncedAt: toIso(row.moonDrillLastSyncedAt ?? row.lastSyncedAt),
			updatedAt: toIso(row.moonDrillUpdatedAt ?? row.updatedAt) ?? new Date().toISOString(),
		}
	})
}

async function loadMiningCitadelPageItems(
	db: DbClient<DbSchema>,
	user: SessionUser,
	access: StructureAccessScope,
	query: StructureMiningCitadelListQuery,
	miningStructures: ReturnType<typeof buildMiningCitadelStructuresCte>,
	pageOverride?: number
): Promise<RepoStructureMiningCitadelListItem[]> {
	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortOrder = buildMoonStructureSortOrder(sortBy, sortDirection, miningStructures)
	if (!sortOrder) {
		return []
	}

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const page = Math.max(pageOverride ?? query.page ?? 1, 1)
	const offset = (page - 1) * pageSize
	const rows = await db
		.with(miningStructures)
		.select({
			structureId: miningStructures.structureId,
			corporationId: miningStructures.corporationId,
			corporationName: miningStructures.corporationName,
			structureName: miningStructures.structureName,
			typeId: miningStructures.typeId,
			typeName: miningStructures.typeName,
			systemId: miningStructures.systemId,
			systemName: miningStructures.systemName,
			regionId: miningStructures.regionId,
			regionName: miningStructures.regionName,
			state: miningStructures.state,
			stateTimerEnd: miningStructures.stateTimerEnd,
			nextReinforceApply: miningStructures.nextReinforceApply,
			unanchorsAt: miningStructures.unanchorsAt,
			fuelExpires: miningStructures.fuelExpires,
			fuelAmount: miningStructures.fuelAmount,
			fuelBurnRate: miningStructures.fuelBurnRate,
			lowPower: miningStructures.lowPower,
			hidden: miningStructures.hidden,
			lowPowerAllowed: miningStructures.lowPowerAllowed,
			assignedGroupId: miningStructures.assignedGroupId,
			syncStatus: miningStructures.syncStatus,
			syncFailureReason: miningStructures.syncFailureReason,
			lastSyncedAt: miningStructures.lastSyncedAt,
			updatedAt: miningStructures.updatedAt,
			miningExtractionStructureId: miningStructures.miningExtractionStructureId,
			moonId: miningStructures.moonId,
			moonName: miningStructures.moonName,
			planetId: miningStructures.planetId,
			planetName: miningStructures.planetName,
			miningExtractionLastSyncedAt: miningStructures.miningExtractionLastSyncedAt,
			miningExtractionUpdatedAt: miningStructures.miningExtractionUpdatedAt,
			extractionStartTime: miningStructures.extractionStartTime,
			chunkArrivalTime: miningStructures.chunkArrivalTime,
			naturalDecayTime: miningStructures.naturalDecayTime,
		})
		.from(miningStructures)
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
		const hasMiningSnapshot = row.miningExtractionStructureId !== null && row.moonId !== null
		const baseItem = buildOperationalStructureListItem(row, canViewDetails)
		if (!hasMiningSnapshot) {
			return {
				...baseItem,
				name: row.structureName ?? row.structureId,
				planetId: row.planetId ?? null,
				planetName: row.planetName ?? null,
				moonId: row.moonId ?? '',
				moonName: row.moonName ?? null,
				extractionStartTime: null,
				chunkArrivalTime: null,
				naturalDecayTime: null,
				syncFailureReason: 'Mining extraction snapshot has not been ingested yet for this structure.',
				lastSyncedAt: toIso(row.lastSyncedAt),
				updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
			}
		}

		return {
			...baseItem,
			name: row.structureName ?? row.structureId,
			planetId: row.planetId ?? null,
			planetName: row.planetName ?? null,
			moonId: row.moonId ?? '',
			moonName: row.moonName ?? null,
			extractionStartTime: toIso(row.extractionStartTime ?? null),
			chunkArrivalTime: toIso(row.chunkArrivalTime ?? null),
			naturalDecayTime: toIso(row.naturalDecayTime ?? null),
			syncStatus: getSnapshotSyncStatus(row.miningExtractionLastSyncedAt),
			syncFailureReason: null,
			lastSyncedAt: toIso(row.miningExtractionLastSyncedAt ?? row.lastSyncedAt),
			updatedAt: toIso(row.miningExtractionUpdatedAt ?? row.updatedAt) ?? new Date().toISOString(),
		}
	})
}

async function buildOperationalStructureFilterOptions(
	db: DbClient<DbSchema>,
	operationalStructures: any
): Promise<StructureListFilterOptions> {
	const rowsDb = db.with(operationalStructures)
	const [corporations, assignedGroups, regions, systems, states, types] = await Promise.all([
		rowsDb
			.selectDistinct({
				corporationId: operationalStructures.corporationId,
				corporationName: operationalStructures.corporationName,
			})
			.from(operationalStructures)
			.orderBy(asc(operationalStructures.corporationName)),
		rowsDb
			.selectDistinct({
				assignedGroupId: operationalStructures.assignedGroupId,
			})
			.from(operationalStructures)
			.where(isNotNull(operationalStructures.assignedGroupId))
			.orderBy(asc(operationalStructures.assignedGroupId)),
		rowsDb
			.selectDistinct({
				regionId: operationalStructures.regionId,
				regionName: operationalStructures.regionName,
			})
			.from(operationalStructures)
			.orderBy(asc(operationalStructures.regionName)),
		rowsDb
			.selectDistinct({
				systemId: operationalStructures.systemId,
				systemName: operationalStructures.systemName,
			})
			.from(operationalStructures)
			.orderBy(asc(operationalStructures.systemName)),
		rowsDb
			.selectDistinct({
				state: operationalStructures.state,
			})
			.from(operationalStructures)
			.orderBy(asc(operationalStructures.state)),
		rowsDb
			.selectDistinct({
				typeId: operationalStructures.typeId,
				typeName: operationalStructures.typeName,
			})
			.from(operationalStructures)
			.orderBy(asc(operationalStructures.typeName)),
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
	operationalStructures: any,
	moduleConfig: StructureModuleConfigResult
): Promise<StructureListSummary> {
	const rowsDb = db.with(operationalStructures)
	const lowFuelWhere = buildOperationalLowFuelWhere(moduleConfig, operationalStructures)
	const reinforcedStates = [...STRUCTURE_REINFORCED_STATES]
	const [totalResult, lowFuelResult, lowPowerResult, reinforcedResult, fuelBurnRateResult] =
		await Promise.all([
		rowsDb
			.select({
				total: sql<number>`count(*)::int`,
			})
			.from(operationalStructures),
		rowsDb
			.select({
				count: sql<number>`count(*)::int`,
			})
			.from(operationalStructures)
			.where(lowFuelWhere),
		rowsDb
			.select({
				count: sql<number>`count(*)::int`,
			})
			.from(operationalStructures)
			.where(
				and(
					eq(operationalStructures.lowPower, true),
					or(
						eq(operationalStructures.lowPowerAllowed, false),
						isNull(operationalStructures.lowPowerAllowed)
					)
				)
			),
		rowsDb
			.select({
				count: sql<number>`count(*)::int`,
			})
			.from(operationalStructures)
			.where(inArray(operationalStructures.state, reinforcedStates)),
		rowsDb
			.select({
				estimatedFuelBurnRatePerHour: sql<string | null>`sum(${operationalStructures.fuelBurnRate})::text`,
				fuelBurnRateSampleCount: sql<number>`count(${operationalStructures.fuelBurnRate})::int`,
			})
			.from(operationalStructures),
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

function buildMoonStructureSortOrder(
	sortBy: StructureMoonStructureListSortBy,
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
			return [sortExpression(sql`coalesce(${source.structureName}, '')`), sortExpression(source.structureId)]
		case 'corporation':
			return [sortExpression(sql`coalesce(${source.corporationName}, '')`), sortExpression(source.structureId)]
		case 'region':
			return [sortExpression(sql`coalesce(${source.regionName}, '')`), sortExpression(source.structureId)]
		case 'planet':
			return [sortExpression(sql`coalesce(${source.planetName}, '')`), sortExpression(source.structureId)]
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

function buildMoonDrillStructuresCte(
	db: DbClient<DbSchema>,
	corpWhere: any,
	planetId?: string
) {
	const operationalStructures = buildOperationalStructuresSelectQuery(db, corpWhere).as('operational_structures')
	const conditions = [sql`true`]
	if (planetId) {
		conditions.push(eq(structureMoonGeographies.planetId, planetId))
	}
	return db.$with('moon_drill_structures').as(
		db.with(operationalStructures)
			.select({
				structureId: sql<string>`${operationalStructures.structureId}`.as('structureId'),
				corporationId: sql<string>`${operationalStructures.corporationId}`.as('corporationId'),
				corporationName: sql<string>`${operationalStructures.corporationName}`.as('corporationName'),
				structureName: sql<string | null>`${operationalStructures.structureName}`.as('structureName'),
				typeId: sql<string>`${operationalStructures.typeId}`.as('typeId'),
				typeName: sql<string | null>`${operationalStructures.typeName}`.as('typeName'),
				systemId: sql<string>`${operationalStructures.systemId}`.as('systemId'),
				systemName: sql<string | null>`${operationalStructures.systemName}`.as('systemName'),
				regionId: sql<string | null>`${operationalStructures.regionId}`.as('regionId'),
				regionName: sql<string | null>`${operationalStructures.regionName}`.as('regionName'),
				state: sql<string>`${operationalStructures.state}`.as('state'),
				stateTimerEnd: sql<Date | null>`${operationalStructures.stateTimerEnd}`.as('stateTimerEnd'),
				nextReinforceApply: sql<Date | null>`${operationalStructures.nextReinforceApply}`.as('nextReinforceApply'),
				unanchorsAt: sql<Date | null>`${operationalStructures.unanchorsAt}`.as('unanchorsAt'),
				fuelExpires: sql<Date | null>`${operationalStructures.fuelExpires}`.as('fuelExpires'),
				fuelAmount: sql<number | null>`${operationalStructures.fuelAmount}`.as('fuelAmount'),
				fuelBurnRate: sql<string | null>`${operationalStructures.fuelBurnRate}`.as('fuelBurnRate'),
				lowPower: sql<boolean>`${operationalStructures.lowPower}`.as('lowPower'),
				hidden: sql<boolean | null>`${operationalStructures.hidden}`.as('hidden'),
				lowPowerAllowed: sql<boolean | null>`${operationalStructures.lowPowerAllowed}`.as('lowPowerAllowed'),
				assignedGroupId: sql<string | null>`${operationalStructures.assignedGroupId}`.as('assignedGroupId'),
				syncStatus: sql<string>`${operationalStructures.syncStatus}`.as('syncStatus'),
				syncFailureReason: sql<string | null>`${operationalStructures.syncFailureReason}`.as('syncFailureReason'),
				lastSyncedAt: sql<Date | null>`${operationalStructures.lastSyncedAt}`.as('lastSyncedAt'),
				updatedAt: sql<Date>`${operationalStructures.updatedAt}`.as('updatedAt'),
				moonDrillStructureId: sql<string | null>`${structureMoonDrills.structureId}`.as('moonDrillStructureId'),
				moonId: sql<string | null>`${structureMoonGeographies.moonId}`.as('moonId'),
				moonName: sql<string | null>`${structureMoonGeographies.moonName}`.as('moonName'),
				planetId: sql<string | null>`${structureMoonGeographies.planetId}`.as('planetId'),
				planetName: sql<string | null>`${structureMoonGeographies.planetName}`.as('planetName'),
				moonDrillLastSyncedAt: sql<Date | null>`${structureMoonDrills.lastSyncedAt}`.as('moonDrillLastSyncedAt'),
				moonDrillUpdatedAt: sql<Date | null>`${structureMoonDrills.updatedAt}`.as('moonDrillUpdatedAt'),
			})
			.from(operationalStructures)
			.leftJoin(
				structureMoonDrills,
				eq(structureMoonDrills.structureId, operationalStructures.structureId)
			)
			.leftJoin(
				structureMoonGeographies,
				eq(structureMoonGeographies.structureId, operationalStructures.structureId)
			)
			.where(combineWhereConditions(conditions) ?? sql`true`)
	)
}

function buildMiningCitadelStructuresCte(
	db: DbClient<DbSchema>,
	corpWhere: any,
	planetId?: string
) {
	const operationalStructures = buildOperationalStructuresSelectQuery(db, corpWhere).as('operational_structures')
	const conditions = [sql`true`]
	if (planetId) {
		conditions.push(eq(structureMoonGeographies.planetId, planetId))
	}
	return db.$with('mining_citadel_structures').as(
		db.with(operationalStructures)
			.select({
				structureId: sql<string>`${operationalStructures.structureId}`.as('structureId'),
				corporationId: sql<string>`${operationalStructures.corporationId}`.as('corporationId'),
				corporationName: sql<string>`${operationalStructures.corporationName}`.as('corporationName'),
				structureName: sql<string | null>`${operationalStructures.structureName}`.as('structureName'),
				typeId: sql<string>`${operationalStructures.typeId}`.as('typeId'),
				typeName: sql<string | null>`${operationalStructures.typeName}`.as('typeName'),
				systemId: sql<string>`${operationalStructures.systemId}`.as('systemId'),
				systemName: sql<string | null>`${operationalStructures.systemName}`.as('systemName'),
				regionId: sql<string | null>`${operationalStructures.regionId}`.as('regionId'),
				regionName: sql<string | null>`${operationalStructures.regionName}`.as('regionName'),
				state: sql<string>`${operationalStructures.state}`.as('state'),
				stateTimerEnd: sql<Date | null>`${operationalStructures.stateTimerEnd}`.as('stateTimerEnd'),
				nextReinforceApply: sql<Date | null>`${operationalStructures.nextReinforceApply}`.as('nextReinforceApply'),
				unanchorsAt: sql<Date | null>`${operationalStructures.unanchorsAt}`.as('unanchorsAt'),
				fuelExpires: sql<Date | null>`${operationalStructures.fuelExpires}`.as('fuelExpires'),
				fuelAmount: sql<number | null>`${operationalStructures.fuelAmount}`.as('fuelAmount'),
				fuelBurnRate: sql<string | null>`${operationalStructures.fuelBurnRate}`.as('fuelBurnRate'),
				lowPower: sql<boolean>`${operationalStructures.lowPower}`.as('lowPower'),
				hidden: sql<boolean | null>`${operationalStructures.hidden}`.as('hidden'),
				lowPowerAllowed: sql<boolean | null>`${operationalStructures.lowPowerAllowed}`.as('lowPowerAllowed'),
				assignedGroupId: sql<string | null>`${operationalStructures.assignedGroupId}`.as('assignedGroupId'),
				syncStatus: sql<string>`${operationalStructures.syncStatus}`.as('syncStatus'),
				syncFailureReason: sql<string | null>`${operationalStructures.syncFailureReason}`.as('syncFailureReason'),
				lastSyncedAt: sql<Date | null>`${operationalStructures.lastSyncedAt}`.as('lastSyncedAt'),
				updatedAt: sql<Date>`${operationalStructures.updatedAt}`.as('updatedAt'),
				miningExtractionStructureId: sql<string | null>`${structureMiningExtractions.structureId}`.as('miningExtractionStructureId'),
				moonId: sql<string | null>`${structureMoonGeographies.moonId}`.as('moonId'),
				moonName: sql<string | null>`${structureMoonGeographies.moonName}`.as('moonName'),
				planetId: sql<string | null>`${structureMoonGeographies.planetId}`.as('planetId'),
				planetName: sql<string | null>`${structureMoonGeographies.planetName}`.as('planetName'),
				miningExtractionLastSyncedAt: sql<Date | null>`${structureMiningExtractions.lastSyncedAt}`.as('miningExtractionLastSyncedAt'),
				miningExtractionUpdatedAt: sql<Date | null>`${structureMiningExtractions.updatedAt}`.as('miningExtractionUpdatedAt'),
				extractionStartTime: sql<Date | null>`${structureMiningExtractions.extractionStartTime}`.as('extractionStartTime'),
				chunkArrivalTime: sql<Date | null>`${structureMiningExtractions.chunkArrivalTime}`.as('chunkArrivalTime'),
				naturalDecayTime: sql<Date | null>`${structureMiningExtractions.naturalDecayTime}`.as('naturalDecayTime'),
			})
			.from(operationalStructures)
			.leftJoin(
				structureMiningExtractions,
				eq(structureMiningExtractions.structureId, operationalStructures.structureId)
			)
			.leftJoin(
				structureMoonGeographies,
				eq(structureMoonGeographies.structureId, operationalStructures.structureId)
			)
			.where(combineWhereConditions(conditions) ?? sql`true`)
	)
}

function buildOperationalSortOrder(
	sortBy: StructureCommonListSortBy,
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
			return [sortExpression(sql`coalesce(${source.structureName}, '')`), sortExpression(source.structureId)]
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

async function loadOperationalStructurePageItems(
	db: DbClient<DbSchema>,
	user: SessionUser,
	access: StructureAccessScope,
	query: StructureListQuery,
	operationalStructures: ReturnType<typeof buildOperationalStructuresCte>,
	pageOverride?: number
): Promise<StructureListItem[]> {
	const sortBy = query.sortBy ?? 'fuel'
	const sortDirection = query.sortDirection ?? 'asc'
	const sortOrder = buildOperationalSortOrder(sortBy, sortDirection, operationalStructures)
	if (!sortOrder) {
		return []
	}

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const page = Math.max(pageOverride ?? query.page ?? 1, 1)
	const offset = (page - 1) * pageSize

	const rows = await db
		.with(operationalStructures)
		.select({
			structureId: operationalStructures.structureId,
			corporationId: operationalStructures.corporationId,
			corporationName: operationalStructures.corporationName,
			structureName: operationalStructures.structureName,
			typeId: operationalStructures.typeId,
			typeName: operationalStructures.typeName,
			systemId: operationalStructures.systemId,
			systemName: operationalStructures.systemName,
			regionId: operationalStructures.regionId,
			regionName: operationalStructures.regionName,
			state: operationalStructures.state,
			stateTimerEnd: operationalStructures.stateTimerEnd,
			nextReinforceApply: operationalStructures.nextReinforceApply,
			unanchorsAt: operationalStructures.unanchorsAt,
			fuelExpires: operationalStructures.fuelExpires,
			fuelAmount: operationalStructures.fuelAmount,
			fuelBurnRate: operationalStructures.fuelBurnRate,
			lowPower: operationalStructures.lowPower,
			hidden: operationalStructures.hidden,
			lowPowerAllowed: operationalStructures.lowPowerAllowed,
			assignedGroupId: operationalStructures.assignedGroupId,
			syncStatus: operationalStructures.syncStatus,
			syncFailureReason: operationalStructures.syncFailureReason,
			lastSyncedAt: operationalStructures.lastSyncedAt,
			updatedAt: operationalStructures.updatedAt,
		})
		.from(operationalStructures)
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

async function listOperationalStructures(
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

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const requestedPage = Math.max(query.page ?? 1, 1)

	if (activeTab === 'citadels' || activeTab === 'navigation') {
		const moduleConfig = await getStructureModuleConfig(db)
		const corpWhere = buildStructureContextsWhere(access, query, activeTab)
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
		const operationalStructures = buildOperationalStructuresCte(db, corpWhere)

		const [filterOptions, summary, pageItems] = await Promise.all([
			buildOperationalStructureFilterOptions(db, operationalStructures),
			buildOperationalStructureSummary(db, operationalStructures, moduleConfig),
			loadOperationalStructurePageItems(
				db,
				user,
				access,
				query,
				operationalStructures
			),
		])
		const totalCount = summary.total
		const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
		const page = Math.min(requestedPage, totalPages)
		const items =
			page === requestedPage
			? pageItems
			: await loadOperationalStructurePageItems(
					db,
					user,
					access,
					query,
					operationalStructures,
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

	if (activeTab === 'skyhooks') {
		const skyhookQuery = query as StructureSkyhookListQuery
		const corpWhere = buildSkyhookVisibilityWhere(access, skyhookQuery)
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

		const skyhookStructures = buildSkyhookStructuresCte(db, corpWhere)
		const [filterOptions, summary, pageItems] = await Promise.all([
			buildSkyhookStructureFilterOptionsFromSql(db, skyhookStructures),
			buildSkyhookStructureSummaryFromSql(db, skyhookStructures),
			loadSkyhookPageItems(
				db,
				user,
				access,
				skyhookQuery,
				skyhookStructures
			),
		])
		const totalCount = summary.total
		const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
		const page = Math.min(requestedPage, totalPages)
		const items =
			page === requestedPage
				? pageItems
				: await loadSkyhookPageItems(
						db,
						user,
						access,
						skyhookQuery,
						skyhookStructures,
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

	throw new Error(`Unsupported structure tab: ${activeTab}`)
}

export async function listStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureListQuery = {}
): Promise<StructureListResponse> {
	return listOperationalStructures(db, user, query, 'citadels')
}

export async function listCitadelStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureCitadelListQuery = {}
): Promise<StructureListResponse> {
	return listOperationalStructures(db, user, query, 'citadels')
}

export async function listNavigationStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureNavigationListQuery = {}
): Promise<StructureListResponse> {
	return listOperationalStructures(db, user, query as StructureListQuery, 'navigation')
}

export async function listMoonDrillStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureMoonDrillListQuery = {}
): Promise<RepoStructureMoonDrillListResponse> {
	const access = computeStructureAccess(user.roles, user.is_admin)
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

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const moduleConfig = await getStructureModuleConfig(db)
	const corpWhere = buildStructureContextsWhere(access, query, 'moon-drills')
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

	const moonDrillStructures = buildMoonDrillStructuresCte(db, corpWhere, query.planetId)
	const [filterOptions, summary, pageItems] = await Promise.all([
		buildMoonStructureFilterOptionsFromSql(db, moonDrillStructures),
		buildOperationalStructureSummary(db, moonDrillStructures, moduleConfig),
		loadMoonDrillPageItems(db, user, access, query, moonDrillStructures),
	])
	const totalCount = summary.total
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(Math.max(query.page ?? 1, 1), totalPages)
	const items =
		page === Math.max(query.page ?? 1, 1)
			? pageItems
			: await loadMoonDrillPageItems(db, user, access, query, moonDrillStructures, page)

	return {
		items,
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

function getSnapshotSyncStatus(lastSyncedAt: unknown): 'ok' | 'warning' | 'error' {
	const parsed = lastSyncedAt instanceof Date
		? lastSyncedAt
		: typeof lastSyncedAt === 'string' || typeof lastSyncedAt === 'number'
			? new Date(lastSyncedAt)
			: null
	if (!parsed || Number.isNaN(parsed.getTime())) {
		return 'warning'
	}

	const ageMs = Math.max(0, Date.now() - parsed.getTime())
	if (ageMs >= STRUCTURE_SYNC_ERROR_STALE_MS) return 'error'
	if (ageMs >= STRUCTURE_SYNC_WARNING_STALE_MS) return 'warning'
	return 'ok'
}

function getStructureSyncStatus(
	syncStatus: 'ok' | 'warning' | 'error',
	lastSyncedAt: unknown
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
	const { structure: structureRow, corporationName } = context
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
		structureRow?.typeName ?? hubRow?.systemName ?? 'Sovereignty Hub',
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
		allianceName: systemRow?.allianceName ?? null,
		controllerAllianceName: hubSummary?.controllerAllianceName ?? null,
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
		updatedAt: toIso(sourceUpdatedAt) ?? new Date().toISOString(),
	}
}

export async function listSovereigntyStructures(
	_env: Env,
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureSovereigntyListQuery = {}
): Promise<RepoStructureSovereigntyListResponse> {
	const access = computeStructureAccess(user.roles, user.is_admin)
	const accessibleCorporations = getAccessibleCorporationIds(access)
	if (!accessibleCorporations.hasGlobalAccess && accessibleCorporations.corporationIds.size === 0) {
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

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const requestedPage = Math.max(query.page ?? 1, 1)
	const corpWhere = buildSovereigntyWhere(access, query)
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
			filterOptions: emptySovereigntyFilterOptions(),
			summary: emptySovereigntySummary(),
		}
	}

	const sovereigntyStructures = buildSovereigntyStructuresCte(db, corpWhere)
	const moduleConfig = await getStructureModuleConfig(db)
	const [filterOptions, summary, pageItems] = await Promise.all([
		buildSovereigntyStructureFilterOptionsFromSql(db, sovereigntyStructures),
		buildSovereigntyStructureSummaryFromSql(db, sovereigntyStructures, moduleConfig),
		loadSovereigntyPageItems(db, user, access, query, sovereigntyStructures),
	])
	const totalCount = summary.total
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(requestedPage, totalPages)
	const items =
		page === requestedPage
			? pageItems
			: await loadSovereigntyPageItems(db, user, access, query, sovereigntyStructures, page)

	return {
		items,
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

export async function listSkyhookStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureSkyhookListQuery = {}
): Promise<RepoStructureSkyhookListResponse> {
	return (await listOperationalStructures(
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
	const access = computeStructureAccess(user.roles, user.is_admin)
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

	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const moduleConfig = await getStructureModuleConfig(db)
	const corpWhere = buildStructureContextsWhere(access, query, 'mining-citadels')
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

	const miningStructures = buildMiningCitadelStructuresCte(db, corpWhere, query.planetId)
	const [filterOptions, summary, pageItems] = await Promise.all([
		buildMoonStructureFilterOptionsFromSql(db, miningStructures),
		buildOperationalStructureSummary(db, miningStructures, moduleConfig),
		loadMiningCitadelPageItems(db, user, access, query, miningStructures),
	])
	const totalCount = summary.total
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(Math.max(query.page ?? 1, 1), totalPages)
	const items =
		page === Math.max(query.page ?? 1, 1)
			? pageItems
			: await loadMiningCitadelPageItems(db, user, access, query, miningStructures, page)

	return {
		items,
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
