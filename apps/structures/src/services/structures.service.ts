import { and, desc, eq, inArray, isNotNull } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	corporationStructureInventory,
	corporationStructures,
	structureFuelLog,
} from '@repo/eve-corporation-data-db-schema'
import { managedCorporations } from '@repo/core-db-schema'
import {
	structureMiningStates,
	structureSkyhookStates,
	structureSovereigntyHubs,
	structureSovereigntySystems,
} from '@repo/structures-db-schema'
import {
	summarizeInventoryRows,
	type InventoryDisplayBay,
} from '@repo/inventory-display'
import type {
	StructureCitadelListQuery,
	StructureMiningListQuery,
	StructureNavigationListQuery,
	StructureSkyhookListQuery,
	StructureSovereigntyListQuery,
	StructureOverviewMetrics,
	StructureTab,
} from '@repo/structures'
import { getStructureTabForTypeId } from '@repo/structures'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import {
	STRUCTURE_PERMISSION_ROLES,
	STRUCTURE_PERMISSION_SCOPE_ALL,
	parseStructurePermissionUrn,
} from '@repo/groups'

import {
	structureConfigs,
	structureCorporationGroupDefaults,
	structureGroupAlertConfigs,
	structureGroupSettings,
	structureModuleConfig,
	structureStateEvents,
} from '../db/schema'
import type { DbSchema } from '../db'

import type { DbClient } from '@repo/db-utils'
import type { Env, SessionUser } from '../context'
import {
	aggregateFuelBurnRatePerHour,
	type StructureFuelHistorySample,
} from './structure-fuel-history'

const STRUCTURE_REINFORCED_STATES = new Set(['shield', 'armor', 'hull', 'anchoring', 'unanchoring'])
const STRUCTURE_LIST_PAGE_SIZE_MAX = 100

export type StructureListSortField =
	| 'updatedAt'
	| 'nextStateAt'
	| 'fuel'
	| 'name'
	| 'corporation'
	| 'region'
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

interface StructureAccessScope {
	viewAll: boolean
	managerAll: boolean
	viewCorporationIds: Set<string>
	managerCorporationIds: Set<string>
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
	profileId: string
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
	updatedAt: string
	canViewSensitive: boolean
	canEdit: boolean
}

export interface StructureNavigationListItem extends StructureListItem {
	navigationType: StructureTab
}

export interface StructureSovereigntyListItem {
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
	claimType: 'alliance' | 'faction' | 'unclaimed'
	allianceId: string | null
	corporationClaimantId: string | null
	factionId: string | null
	claimedSince: string | null
	sovereigntyHubStructureId: string | null
	vulnerabilityWindowStart: string | null
	vulnerabilityWindowEnd: string | null
	activityDefenseMultiplier: string | null
	militaryLevel: number | null
	industrialLevel: number | null
	strategicLevel: number | null
	fuelAccessListId: string | null
	controllerAllianceId: string | null
	reagentBayLastUpdated: string | null
	reagentCount: number
	totalSecuredStock: number
	totalUnsecuredStock: number
	resourcePowerAllocated: number
	resourcePowerAvailable: number
	resourceWorkforceAllocated: number
	resourceWorkforceAvailable: number
	upgradeCount: number
	syncStatus: 'ok' | 'warning' | 'error'
	syncFailureReason: string | null
	lastSyncedAt: string | null
	updatedAt: string
	canViewSensitive: boolean
	canEdit: boolean
}

export interface StructureSkyhookListItem {
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
	planetId: string
	state: string
	isActive: boolean
	effectiveWorkforce: number | null
	totalReagents: number
	totalSecuredStock: number
	totalUnsecuredStock: number
	reinforcementTimerEnd: string | null
	theftVulnerabilityStart: string | null
	theftVulnerabilityEnd: string | null
	isRaidable: boolean
	becomesRaidableAt: string | null
	vulnerableAt: string | null
	syncStatus: 'ok' | 'warning' | 'error'
	syncFailureReason: string | null
	lastSyncedAt: string | null
	updatedAt: string
	canViewSensitive: boolean
	canEdit: boolean
}

export interface StructureMiningListItem {
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
	planetId: string
	currentStockVolume: number | null
	capacityVolume: number | null
	fillRatePerHour: string | null
	lastEmptiedAt: string | null
	estimatedFullAt: string | null
	lastObservedVolume: number | null
	lastObservedAt: string | null
	syncStatus: 'ok' | 'warning' | 'error'
	syncFailureReason: string | null
	lastSyncedAt: string | null
	updatedAt: string
	canViewSensitive: boolean
	canEdit: boolean
}

export interface StructureSovereigntyHubSummary {
	fuelAccessListId: string | null
	controllerAllianceId: string | null
	reagentBayLastUpdated: string | null
	reagentCount: number
	totalSecuredStock: number
	totalUnsecuredStock: number
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
	planetId: string
	state: string
	isActive: boolean
	effectiveWorkforce: number | null
	totalReagents: number
	totalSecuredStock: number
	totalUnsecuredStock: number
	reinforcementTimerEnd: string | null
	theftVulnerabilityStart: string | null
	theftVulnerabilityEnd: string | null
	isRaidable: boolean
	becomesRaidableAt: string | null
	vulnerableAt: string | null
}

export interface StructureMiningSummary {
	planetId: string
	currentStockVolume: number | null
	capacityVolume: number | null
	fillRatePerHour: string | null
	lastEmptiedAt: string | null
	estimatedFullAt: string | null
	lastObservedVolume: number | null
	lastObservedAt: string | null
}

export type StructureInventoryItemSummary = InventoryDisplayBay['items'][number]
export type StructureInventoryBaySummary = InventoryDisplayBay

interface StructureTabData {
	sovereignty?: StructureSovereigntySummary | null
	skyhook?: StructureSkyhookSummary | null
	mining?: StructureMiningSummary | null
	inventoryBays?: StructureInventoryBaySummary[]
}

export interface StructureDetailResult extends StructureListItem {
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
	sovereignty?: StructureSovereigntySummary | null
	skyhook?: StructureSkyhookSummary | null
	mining?: StructureMiningSummary | null
	inventoryBays?: StructureInventoryBaySummary[]
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

function computeStructureAccess(roles: string[], isAdmin: boolean): StructureAccessScope {
	if (isAdmin) {
		return {
			viewAll: true,
			managerAll: true,
			viewCorporationIds: new Set<string>(),
			managerCorporationIds: new Set<string>(),
		}
	}

	const viewCorporationIds = new Set<string>()
	const managerCorporationIds = new Set<string>()
	let viewAll = false
	let managerAll = false

	for (const roleUrn of roles) {
		const parsed = parseStructurePermissionUrn(roleUrn)
		if (!parsed) continue
		if (parsed.scope === STRUCTURE_PERMISSION_SCOPE_ALL) {
			viewAll = true
			if (parsed.role === 'manager' || parsed.role === 'sensitive') {
				managerAll = true
			}
			continue
		}

		if (parsed.corporationId) {
			if (STRUCTURE_PERMISSION_ROLES.includes(parsed.role)) {
				viewCorporationIds.add(parsed.corporationId)
			}
			if (parsed.role === 'manager' || parsed.role === 'sensitive') {
				managerCorporationIds.add(parsed.corporationId)
			}
		}
	}

	return {
		viewAll,
		managerAll,
		viewCorporationIds,
		managerCorporationIds,
	}
}

export function canManageStructureModule(user: SessionUser): boolean {
	const access = computeStructureAccess(user.roles, user.is_admin)
	return user.is_admin || access.managerAll
}

function toIso(value: Date | null | undefined): string | null {
	return value ? value.toISOString() : null
}

function compareNullableStrings(left: string | null | undefined, right: string | null | undefined): number {
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

type StructureWhereCondition = NonNullable<Parameters<typeof and>[number]>

function combineWhereConditions(
	conditions: Array<StructureWhereCondition | undefined>
): any {
	const defined = conditions.filter((condition): condition is StructureWhereCondition => condition !== undefined)
	if (defined.length === 0) return undefined
	if (defined.length === 1) return defined[0]
	return and(...defined)
}

function isFuelBelowThreshold(
	structure: Pick<StructureListItem, 'fuelAmount' | 'fuelExpires'>,
	moduleConfig: Pick<
		StructureModuleConfigResult,
		'lowFuelTimeThresholdHours' | 'criticalFuelTimeThresholdHours' | 'lowFuelAmountThreshold' | 'criticalFuelAmountThreshold'
	>
): boolean {
	if (structure.fuelAmount !== null) {
		return structure.fuelAmount <= moduleConfig.lowFuelAmountThreshold
	}

	if (!structure.fuelExpires) {
		return false
	}

	const hoursRemaining = (new Date(structure.fuelExpires).getTime() - Date.now()) / (60 * 60 * 1000)
	return hoursRemaining <= moduleConfig.lowFuelTimeThresholdHours
}

function isReinforcedStructureState(state: string): boolean {
	return STRUCTURE_REINFORCED_STATES.has(state.toLowerCase())
}

function summarizeStructureSovereigntyHub(
	hub: typeof structureSovereigntyHubs.$inferSelect
): StructureSovereigntyHubSummary {
	const reagentTotals = hub.reagentBay.reagents.reduce(
		(accumulator: { secured: number; unsecured: number }, reagent: { securedStock: number; unsecuredStock: number }) => {
			accumulator.secured += reagent.securedStock
			accumulator.unsecured += reagent.unsecuredStock
			return accumulator
		},
		{ secured: 0, unsecured: 0 }
	)

	return {
		fuelAccessListId: hub.fuelAccessListId ?? null,
		controllerAllianceId: hub.controllerAllianceId ?? null,
		reagentBayLastUpdated: hub.reagentBayLastUpdated ? hub.reagentBayLastUpdated.toISOString() : null,
		reagentCount: hub.reagentBay.reagents.length,
		totalSecuredStock: reagentTotals.secured,
		totalUnsecuredStock: reagentTotals.unsecured,
		resourcePowerAllocated: hub.resources.power.allocated,
		resourcePowerAvailable: hub.resources.power.available,
		resourceWorkforceAllocated: hub.resources.workforce.allocated,
		resourceWorkforceAvailable: hub.resources.workforce.available,
		upgradeCount: hub.upgrades.length,
		vulnerabilityWindowStart: hub.vulnerabilityWindowStart ? hub.vulnerabilityWindowStart.toISOString() : null,
		vulnerabilityWindowEnd: hub.vulnerabilityWindowEnd ? hub.vulnerabilityWindowEnd.toISOString() : null,
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
	skyhook: typeof structureSkyhookStates.$inferSelect | null
): StructureSkyhookSummary | null {
	if (!skyhook) {
		return null
	}

	const reagentTotals = skyhook.reagents.reduce(
		(accumulator: { secured: number; unsecured: number }, reagent: { securedStock: number; unsecuredStock: number }) => {
			accumulator.secured += reagent.securedStock
			accumulator.unsecured += reagent.unsecuredStock
			return accumulator
		},
		{ secured: 0, unsecured: 0 }
	)

	return {
		planetId: skyhook.planetId,
		state: skyhook.state,
		isActive: skyhook.isActive,
		effectiveWorkforce: skyhook.effectiveWorkforce ?? null,
		totalReagents: skyhook.reagents.length,
		totalSecuredStock: reagentTotals.secured,
		totalUnsecuredStock: reagentTotals.unsecured,
		reinforcementTimerEnd: skyhook.reinforcementTimerEnd ? skyhook.reinforcementTimerEnd.toISOString() : null,
		theftVulnerabilityStart: skyhook.theftVulnerabilityStart ? skyhook.theftVulnerabilityStart.toISOString() : null,
		theftVulnerabilityEnd: skyhook.theftVulnerabilityEnd ? skyhook.theftVulnerabilityEnd.toISOString() : null,
		isRaidable: skyhook.isRaidable,
		becomesRaidableAt: skyhook.becomesRaidableAt ? skyhook.becomesRaidableAt.toISOString() : null,
		vulnerableAt: skyhook.vulnerableAt ? skyhook.vulnerableAt.toISOString() : null,
	}
}

function summarizeStructureMining(
	mining: typeof structureMiningStates.$inferSelect | null
): StructureMiningSummary | null {
	if (!mining) {
		return null
	}

	return {
		planetId: mining.planetId,
		currentStockVolume: mining.currentStockVolume ?? null,
		capacityVolume: mining.capacityVolume ?? null,
		fillRatePerHour:
			mining.fillRatePerHour !== null && mining.fillRatePerHour !== undefined
				? String(mining.fillRatePerHour)
				: null,
		lastEmptiedAt: mining.lastEmptiedAt ? mining.lastEmptiedAt.toISOString() : null,
		estimatedFullAt: mining.estimatedFullAt ? mining.estimatedFullAt.toISOString() : null,
		lastObservedVolume: mining.lastObservedVolume ?? null,
		lastObservedAt: mining.lastObservedAt ? mining.lastObservedAt.toISOString() : null,
	}
}

function buildStructureListItem(context: VisibleStructureContext): StructureListItem {
	const { structure, corporationName, config, canViewSensitive } = context
	const nextStateAt = structure.stateTimerEnd ?? structure.nextReinforceApply ?? structure.unanchorsAt

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
		profileId: structure.profileId,
		state: structure.state,
		nextStateAt: toIso(nextStateAt),
		fuelExpires: toIso(structure.fuelExpires),
		fuelAmount: structure.fuelAmount,
		lowPower: structure.lowPower,
		hidden: config?.hidden ?? false,
		lowPowerAllowed: config?.lowPowerAllowed ?? false,
		assignedGroupId: config?.assignedGroupId ?? null,
		syncStatus: structure.syncStatus,
		syncFailureReason: structure.syncFailureReason,
		lastSyncedAt: toIso(structure.lastSyncedAt),
		updatedAt: structure.updatedAt.toISOString(),
		canViewSensitive,
		canEdit: canViewSensitive,
	}
}

async function loadStructureTabDetailData(
	db: DbClient<DbSchema>,
	structure: DirectCorporationStructureRecord
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
		const skyhookRow = await db.query.structureSkyhookStates.findFirst({
			where: eq(structureSkyhookStates.structureId, structure.structureId),
		})
		return {
			skyhook: skyhookRow ? summarizeStructureSkyhook(skyhookRow) : null,
		}
	}

	if (tab === 'mining') {
		const miningRow = await db.query.structureMiningStates.findFirst({
			where: eq(structureMiningStates.structureId, structure.structureId),
		})
		return {
			mining: miningRow ? summarizeStructureMining(miningRow) : null,
		}
	}

	return null
}

async function loadStructureInventoryDetailData(
	db: DbClient<DbSchema>,
	structure: DirectCorporationStructureRecord
): Promise<StructureInventoryBaySummary[]> {
	const rows = await db.query.corporationStructureInventory.findMany({
		where: and(
			eq(corporationStructureInventory.corporationId, structure.corporationId),
			eq(corporationStructureInventory.structureId, structure.structureId)
		),
	})
	return summarizeInventoryRows(rows)
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
		return updated
	}

	const [created] = await db.insert(structureGroupSettings).values(values).returning()
	return created
}

export async function deleteStructureGroupSetting(db: DbClient<DbSchema>, input: DeleteStructureGroupSettingInput) {
	const [deleted] = await db
		.delete(structureGroupSettings)
		.where(eq(structureGroupSettings.groupId, input.groupId))
		.returning()
	return deleted ?? null
}

export async function listStructureCorporationGroupDefaults(db: DbClient<DbSchema>) {
	return db.query.structureCorporationGroupDefaults.findMany({
		where: isNotNull(structureCorporationGroupDefaults.groupId),
		orderBy: desc(structureCorporationGroupDefaults.updatedAt),
	})
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

export async function getStructureModuleConfig(db: DbClient<DbSchema>): Promise<StructureModuleConfigResult> {
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
			lowFuelTimeThresholdHours: input.lowFuelTimeThresholdHours ?? existing.lowFuelTimeThresholdHours,
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
				lowFuelAmountThreshold:
					input.lowFuelAmountThreshold ?? existing.lowFuelAmountThreshold,
				criticalFuelAmountThreshold:
					input.criticalFuelAmountThreshold ?? existing.criticalFuelAmountThreshold,
				updatedBy: input.updatedBy ?? existing.updatedBy ?? null,
				updatedAt: now,
			},
		})
		.returning()
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
		return updated
	}

	const [created] = await db.insert(structureCorporationGroupDefaults).values({
		corporationId: input.corporationId,
		groupId: input.groupId,
		updatedBy: input.updatedBy ?? null,
		createdAt: now,
		updatedAt: now,
	}).returning()
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
		return updated
	}

	const [created] = await db.insert(structureGroupAlertConfigs).values({
		groupId: input.groupId,
		alertType: input.alertType,
		destinationIds: input.destinationIds,
		config: input.config,
		isEnabled: input.isEnabled,
		createdAt: now,
		updatedAt: now,
	}).returning()
	return created
}

export async function deleteStructureGroupAlertConfig(
	db: DbClient<DbSchema>,
	groupId: string,
	id: string
): Promise<void> {
	await db
		.delete(structureGroupAlertConfigs)
		.where(and(eq(structureGroupAlertConfigs.groupId, groupId), eq(structureGroupAlertConfigs.id, id)))
}

type DirectCorporationStructureRecord = typeof corporationStructures.$inferSelect

interface VisibleStructureContext {
	structure: DirectCorporationStructureRecord
	corporationName: string
	config: typeof structureConfigs.$inferSelect | null
	canViewSensitive: boolean
	tabData: StructureTabData | null
	lastRefilledAt: Date | null
}

export function getStructureTab(structure: Pick<StructureListItem, 'typeId'>): StructureTab {
	return getStructureTabForTypeId(structure.typeId)
}

function matchesStructureTab(structure: Pick<StructureListItem, 'typeId'>, tab: StructureTab): boolean {
	return getStructureTab(structure) === tab
}

function buildStructureDetailResult(context: VisibleStructureContext): StructureDetailResult {
	const structure = buildStructureListItem(context)
	return {
		...structure,
		services: context.structure.services ?? [],
		stateTimerStart: toIso(context.structure.stateTimerStart),
		stateTimerEnd: toIso(context.structure.stateTimerEnd),
		unanchorsAt: toIso(context.structure.unanchorsAt),
		nextReinforceApply: toIso(context.structure.nextReinforceApply),
		nextReinforceHour: context.structure.nextReinforceHour,
		reinforceHour: context.structure.reinforceHour,
		lastRefilledAt: toIso(context.lastRefilledAt),
		...(context.tabData ?? {}),
	}
}

async function getVisibleStructureContext(
	db: DbClient<DbSchema>,
	user: SessionUser,
	structureId: string
): Promise<VisibleStructureContext | null> {
	const access = computeStructureAccess(user.roles, user.is_admin)
	const structure = await db.query.corporationStructures.findFirst({
		where: (() => {
			const conditions = [eq(corporationStructures.structureId, structureId)]
			if (!access.viewAll) {
				if (access.viewCorporationIds.size === 0) {
					return and(...conditions, eq(corporationStructures.corporationId, '__no_access__'))
				}
				conditions.push(inArray(corporationStructures.corporationId, [...access.viewCorporationIds]))
			}
			return and(...conditions)
		})(),
	})

	if (!structure) {
		return null
	}

	const config = await db.query.structureConfigs.findFirst({
		where: eq(structureConfigs.structureId, structureId),
	})
	const corporation = await db.query.managedCorporations.findFirst({
		where: eq(managedCorporations.corporationId, structure.corporationId),
		columns: {
			corporationId: true,
			name: true,
		},
	})
	const canViewSensitive =
		user.is_admin || access.managerAll || access.managerCorporationIds.has(structure.corporationId)
	if (config?.hidden && !canViewSensitive) {
		return null
	}

	const [tabData, inventoryBays] = await Promise.all([
		loadStructureTabDetailData(db, structure),
		loadStructureInventoryDetailData(db, structure),
	])

	return {
		structure,
		corporationName: corporation?.name ?? structure.corporationId,
		config: config ?? null,
		canViewSensitive,
		tabData: {
			...(tabData ?? {}),
			inventoryBays,
		},
		lastRefilledAt: structure.lastRefilledAt ?? null,
	}
}

function getStructureSortValue(structure: StructureListItem, field: StructureListSortField): string | number {
	switch (field) {
		case 'updatedAt':
			return new Date(structure.updatedAt).getTime()
		case 'nextStateAt':
			return structure.nextStateAt ? new Date(structure.nextStateAt).getTime() : Number.POSITIVE_INFINITY
		case 'fuel':
			return structure.fuelExpires
				? new Date(structure.fuelExpires).getTime()
				: structure.fuelAmount ?? Number.POSITIVE_INFINITY
		case 'name':
			return structure.name
		case 'corporation':
			return structure.corporationName
		case 'region':
			return structure.regionName ?? ''
		case 'system':
			return structure.systemName ?? structure.systemId
		case 'type':
			return structure.typeName ?? structure.typeId
		case 'state':
			return structure.state
	}
}

function compareFuelStructures(
	left: StructureListItem,
	right: StructureListItem,
	sortDirection: StructureListSortDirection
): number {
	const direction = sortDirection === 'asc' ? 1 : -1
	const leftHasExpiry = left.fuelExpires !== null
	const rightHasExpiry = right.fuelExpires !== null
	if (leftHasExpiry !== rightHasExpiry) {
		return leftHasExpiry ? -1 : 1
	}

	if (leftHasExpiry && rightHasExpiry) {
		return compareNullableDates(left.fuelExpires, right.fuelExpires) * direction
	}

	return compareNullableNumbers(left.fuelAmount, right.fuelAmount) * direction
}

function sortStructures(
	items: StructureListItem[],
	sortBy: StructureListSortField,
	sortDirection: StructureListSortDirection
): StructureListItem[] {
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
			case 'fuel':
				comparison = compareFuelStructures(left, right, sortDirection)
				break
			case 'name':
				comparison = left.name.localeCompare(right.name)
				break
			case 'corporation':
				comparison = compareNullableStrings(left.corporationName, right.corporationName)
				break
			case 'region':
				comparison = compareNullableStrings(left.regionName, right.regionName)
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

function buildStructureFilterOptions<
	TItem extends Pick<StructureListItem, 'corporationId' | 'corporationName' | 'systemId' | 'systemName' | 'state' | 'typeId' | 'typeName'> & {
		assignedGroupId?: string | null
		regionId?: string | null
		regionName?: string | null
		allianceId?: string | null
		planetId?: string | null
		isRaidable?: boolean | null
	}
>(items: TItem[]): StructureListFilterOptions {
	const corporations = new Map<string, string>()
	const assignedGroups = new Map<string, string>()
	const regions = new Map<string, string>()
	const systems = new Map<string, string>()
	const states = new Set<string>()
	const types = new Map<string, string>()
	const alliances = new Set<string>()
	const planets = new Map<string, string>()
	const raidableStates = new Set<string>()

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
		if (structure.allianceId) {
			alliances.add(structure.allianceId)
		}
		if (structure.planetId) {
			planets.set(structure.planetId, structure.planetId)
		}
		if (structure.isRaidable !== null && structure.isRaidable !== undefined) {
			raidableStates.add(structure.isRaidable ? 'true' : 'false')
		}
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
		alliances: Array.from(alliances.values())
			.sort((left, right) => left.localeCompare(right))
			.map((value) => ({ value, label: value })),
		planets: Array.from(planets.entries())
			.sort((left, right) => left[1].localeCompare(right[1]))
			.map(([value, label]) => ({ value, label })),
		raidableStates: Array.from(raidableStates.values())
			.sort((left, right) => left.localeCompare(right))
			.map((value) => ({ value, label: value === 'true' ? 'Raidable' : 'Not raidable' })),
	}
}

function buildStructureSummary(
	items: StructureListItem[],
	moduleConfig: Pick<
		StructureModuleConfigResult,
		'lowFuelTimeThresholdHours' | 'criticalFuelTimeThresholdHours' | 'lowFuelAmountThreshold' | 'criticalFuelAmountThreshold'
	>
): StructureListSummary {
	return {
		total: items.length,
		lowFuel: items.filter((structure) => isFuelBelowThreshold(structure, moduleConfig)).length,
		lowPower: items.filter((structure) => structure.lowPower && !structure.lowPowerAllowed).length,
		reinforced: items.filter((structure) => isReinforcedStructureState(structure.state)).length,
	}
}

async function loadFuelHistorySamplesByStructure(
	db: DbClient<DbSchema>,
	structureIds: string[]
): Promise<Map<string, StructureFuelHistorySample[]>> {
	const samplesByStructure = new Map<string, StructureFuelHistorySample[]>()
	if (structureIds.length === 0) {
		return samplesByStructure
	}

	const rows = await db.query.structureFuelLog.findMany({
		where: inArray(structureFuelLog.structureId, structureIds),
	})

	for (const row of rows) {
		const sample: StructureFuelHistorySample = {
			structureId: row.structureId,
			fuelBlockUnits: row.fuelBlockUnits,
			observedAt: row.observedAt,
			updatedAt: row.updatedAt,
		}
		const existing = samplesByStructure.get(row.structureId)
		if (existing) {
			existing.push(sample)
		} else {
			samplesByStructure.set(row.structureId, [sample])
		}
	}

	return samplesByStructure
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
	return {
		total: 0,
		lowFuel: 0,
		lowPower: 0,
		reinforced: 0,
		estimatedFuelBurnRatePerHour: null,
		fuelBurnRateSampleCount: 0,
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

async function loadVisibleStructureContexts(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureBaseFilterQuery
): Promise<{
	moduleConfig: StructureModuleConfigResult
	access: StructureAccessScope
	contexts: VisibleStructureContext[]
}> {
	const moduleConfig = await getStructureModuleConfig(db)
	const access = computeStructureAccess(user.roles, user.is_admin)

	if (!access.viewAll && access.viewCorporationIds.size === 0) {
		return {
			moduleConfig,
			access,
			contexts: [],
		}
	}

	const corpWhere = (() => {
		const conditions: StructureWhereCondition[] = []
		if (query.corporationId) {
			conditions.push(eq(corporationStructures.corporationId, query.corporationId))
		} else if (!access.viewAll && access.viewCorporationIds.size > 0) {
			conditions.push(inArray(corporationStructures.corporationId, [...access.viewCorporationIds]))
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
		return combineWhereConditions(conditions)
	})()

	const corpStructures = await db.query.corporationStructures.findMany({
		where: corpWhere,
	})

	const structureIds = corpStructures.map((structure) => structure.structureId)
	const configRows = structureIds.length
		? await db.query.structureConfigs.findMany({
				where: inArray(structureConfigs.structureId, structureIds),
			})
		: []
	const configsByStructureId = new Map(configRows.map((row) => [row.structureId, row]))
	const corporationIds = [...new Set(corpStructures.map((structure) => structure.corporationId))]
	const corporationRows = corporationIds.length
		? await db.query.managedCorporations.findMany({
				where: inArray(managedCorporations.corporationId, corporationIds),
				columns: {
					corporationId: true,
					name: true,
				},
			})
		: []
	const corporationNamesById = new Map(corporationRows.map((row) => [row.corporationId, row.name]))

	return {
		moduleConfig,
		access,
		contexts: corpStructures
			.map<VisibleStructureContext | null>((structure) => {
				const config = configsByStructureId.get(structure.structureId) ?? null
				const canViewSensitive =
					user.is_admin || access.managerAll || access.managerCorporationIds.has(structure.corporationId)
				if (config?.hidden && !canViewSensitive) {
					return null
				}

				return {
					structure,
					corporationName: corporationNamesById.get(structure.corporationId) ?? structure.corporationId,
					config,
					canViewSensitive,
					tabData: null,
					lastRefilledAt: null,
				}
			})
			.filter((item): item is VisibleStructureContext => item !== null)
			.filter((context) => {
				if (query.assignedGroupId === '__unassigned__' && context.config?.assignedGroupId !== null) {
					return false
				}
				if (
					query.assignedGroupId &&
					query.assignedGroupId !== '__unassigned__' &&
					context.config?.assignedGroupId !== query.assignedGroupId
				) {
					return false
				}
				if (query.lowPowerAllowed === 'true' && !context.config?.lowPowerAllowed) return false
				if (query.lowPowerAllowed === 'false' && context.config?.lowPowerAllowed) return false
				return true
			}),
	}
}

async function listVisibleOperationalStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureListQuery = {},
	activeTab: StructureTab
): Promise<StructureListResponse> {
	const { moduleConfig, access, contexts } = await loadVisibleStructureContexts(db, user, query)
	if (contexts.length === 0 && !access.viewAll && access.viewCorporationIds.size === 0) {
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
			summary: {
				total: 0,
				lowFuel: 0,
				lowPower: 0,
				reinforced: 0,
			},
		}
	}

	const baseItems = contexts
		.map((context) => buildStructureListItem(context))
		.filter((item) => matchesStructureTab(item, activeTab))
	const filterOptions = buildStructureFilterOptions(baseItems)
	const filteredItems = baseItems
	const sortBy = query.sortBy ?? 'updatedAt'
	const sortDirection = query.sortDirection ?? 'desc'
	const sortedItems = sortStructures(filteredItems, sortBy, sortDirection)
	const summary = buildStructureSummary(filteredItems, moduleConfig)
	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const totalCount = sortedItems.length
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(Math.max(query.page ?? 1, 1), totalPages)
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
	if (contexts.length === 0 && !access.viewAll && access.viewCorporationIds.size === 0) {
		return emptyStructureOverviewMetrics()
	}

	const items = contexts.map((context) => buildStructureListItem(context))
	const summary = buildStructureSummary(items, moduleConfig)
	const fuelHistorySamplesByStructure = await loadFuelHistorySamplesByStructure(
		db,
		contexts.map((context) => context.structure.structureId)
	)
	const burnRate = aggregateFuelBurnRatePerHour(fuelHistorySamplesByStructure)

	return {
		...summary,
		...burnRate,
	}
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

function getSnapshotSyncStatus(lastSyncedAt: Date | null | undefined): 'ok' | 'warning' | 'error' {
	return lastSyncedAt ? 'ok' : 'warning'
}

function buildStructureRowIdentity(
	corporationId: string,
	corporationName: string,
	name: string | null | undefined,
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
		name: name ?? typeName ?? typeId,
		typeId,
		typeName,
		systemId,
		systemName,
		regionId,
		regionName,
	}
}

function buildSovereigntyListItem(input: {
	systemRow: typeof structureSovereigntySystems.$inferSelect | null
	hubRow: typeof structureSovereigntyHubs.$inferSelect | null
	structureRow: typeof corporationStructures.$inferSelect
	corporationName: string
	canViewSensitive: boolean
}): StructureSovereigntyListItem {
	const { systemRow, hubRow, structureRow, corporationName, canViewSensitive } = input
	const hasSystemSnapshot = systemRow !== null
	const lastSyncedAt = systemRow?.lastSyncedAt ?? hubRow?.lastSyncedAt ?? structureRow.lastSyncedAt ?? null
	const sourceUpdatedAt = systemRow?.updatedAt ?? hubRow?.updatedAt ?? structureRow.updatedAt

	const hubSummary = hubRow ? summarizeStructureSovereigntyHub(hubRow) : null
	const structureIdentity = buildStructureRowIdentity(
		structureRow.corporationId,
		corporationName,
		structureRow?.name ?? hubRow?.name ?? null,
		structureRow.typeId ?? hubRow?.typeId ?? systemRow?.sovereigntyHubStructureId ?? 'sovereignty hub',
		structureRow?.typeName ?? hubRow?.name ?? 'Sovereignty Hub',
		structureRow.systemId,
		structureRow.systemName ?? null,
		structureRow.regionId ?? null,
		structureRow.regionName ?? null
	)

	return {
		structureId: structureRow.structureId,
		...structureIdentity,
		state: systemRow?.claimType ?? 'unknown',
		claimType: systemRow?.claimType ?? 'unclaimed',
		allianceId: systemRow?.allianceId ?? null,
		corporationClaimantId: systemRow?.corporationClaimantId ?? null,
		factionId: systemRow?.factionId ?? null,
		claimedSince: toIso(systemRow?.claimedSince ?? null),
		sovereigntyHubStructureId: systemRow?.sovereigntyHubStructureId ?? hubRow?.structureId ?? null,
		vulnerabilityWindowStart: toIso(systemRow?.vulnerabilityWindowStart ?? null),
		vulnerabilityWindowEnd: toIso(systemRow?.vulnerabilityWindowEnd ?? null),
		activityDefenseMultiplier:
			systemRow?.activityDefenseMultiplier !== null && systemRow?.activityDefenseMultiplier !== undefined
				? String(systemRow.activityDefenseMultiplier)
				: null,
		militaryLevel: systemRow?.militaryLevel ?? null,
		industrialLevel: systemRow?.industrialLevel ?? null,
		strategicLevel: systemRow?.strategicLevel ?? null,
		fuelAccessListId: hubSummary?.fuelAccessListId ?? null,
		controllerAllianceId: hubSummary?.controllerAllianceId ?? null,
		reagentBayLastUpdated: hubSummary?.reagentBayLastUpdated ?? null,
		reagentCount: hubSummary?.reagentCount ?? 0,
		totalSecuredStock: hubSummary?.totalSecuredStock ?? 0,
		totalUnsecuredStock: hubSummary?.totalUnsecuredStock ?? 0,
		resourcePowerAllocated: hubSummary?.resourcePowerAllocated ?? 0,
		resourcePowerAvailable: hubSummary?.resourcePowerAvailable ?? 0,
		resourceWorkforceAllocated: hubSummary?.resourceWorkforceAllocated ?? 0,
		resourceWorkforceAvailable: hubSummary?.resourceWorkforceAvailable ?? 0,
		upgradeCount: hubSummary?.upgradeCount ?? 0,
		syncStatus: hasSystemSnapshot ? getSnapshotSyncStatus(lastSyncedAt) : 'warning',
		syncFailureReason: hasSystemSnapshot
			? null
			: 'Sovereignty snapshot has not been ingested yet for this structure.',
		lastSyncedAt: toIso(lastSyncedAt),
		updatedAt: sourceUpdatedAt ? sourceUpdatedAt.toISOString() : structureRow.updatedAt.toISOString(),
		canViewSensitive,
		canEdit: canViewSensitive,
	}
}

function buildSkyhookListItem(input: {
	skyhookRow: typeof structureSkyhookStates.$inferSelect | null
	structureRow: typeof corporationStructures.$inferSelect
	corporationName: string
	canViewSensitive: boolean
}): StructureSkyhookListItem {
	const { skyhookRow, structureRow, corporationName, canViewSensitive } = input
	const hasSkyhookSnapshot = skyhookRow !== null
	const reagentTotals = skyhookRow?.reagents.reduce(
		(accumulator: { secured: number; unsecured: number }, reagent: { securedStock: number; unsecuredStock: number }) => {
			accumulator.secured += reagent.securedStock
			accumulator.unsecured += reagent.unsecuredStock
			return accumulator
		},
		{ secured: 0, unsecured: 0 }
	) ?? { secured: 0, unsecured: 0 }

	return {
		structureId: structureRow.structureId,
		corporationId: structureRow.corporationId,
		corporationName,
		name: structureRow.name ?? structureRow.structureId,
		typeId: structureRow.typeId,
		typeName: structureRow.typeName ?? null,
		systemId: structureRow.systemId,
		systemName: structureRow.systemName ?? null,
		regionId: structureRow.regionId ?? null,
		regionName: structureRow.regionName ?? null,
		planetId: skyhookRow?.planetId ?? '',
		state: skyhookRow?.state ?? 'unknown',
		isActive: skyhookRow?.isActive ?? false,
		effectiveWorkforce: skyhookRow?.effectiveWorkforce ?? null,
		totalReagents: skyhookRow?.reagents.length ?? 0,
		totalSecuredStock: reagentTotals.secured,
		totalUnsecuredStock: reagentTotals.unsecured,
		reinforcementTimerEnd: toIso(skyhookRow?.reinforcementTimerEnd ?? null),
		theftVulnerabilityStart: toIso(skyhookRow?.theftVulnerabilityStart ?? null),
		theftVulnerabilityEnd: toIso(skyhookRow?.theftVulnerabilityEnd ?? null),
		isRaidable: skyhookRow?.isRaidable ?? false,
		becomesRaidableAt: toIso(skyhookRow?.becomesRaidableAt ?? null),
		vulnerableAt: toIso(skyhookRow?.vulnerableAt ?? null),
		syncStatus: hasSkyhookSnapshot ? getSnapshotSyncStatus(skyhookRow.lastSyncedAt) : 'warning',
		syncFailureReason: hasSkyhookSnapshot
			? null
			: 'Skyhook snapshot has not been ingested yet for this structure.',
		lastSyncedAt: toIso(skyhookRow?.lastSyncedAt ?? structureRow.lastSyncedAt),
		updatedAt: (skyhookRow?.updatedAt ?? structureRow.updatedAt).toISOString(),
		canViewSensitive,
		canEdit: canViewSensitive,
	}
}

function buildMiningListItem(input: {
	miningRow: typeof structureMiningStates.$inferSelect | null
	structureRow: typeof corporationStructures.$inferSelect
	corporationName: string
	canViewSensitive: boolean
}): StructureMiningListItem {
	const { miningRow, structureRow, corporationName, canViewSensitive } = input
	const hasMiningSnapshot = miningRow !== null

	return {
		structureId: structureRow.structureId,
		corporationId: structureRow.corporationId,
		corporationName,
		name: structureRow.name ?? structureRow.structureId,
		typeId: structureRow.typeId,
		typeName: structureRow.typeName ?? null,
		systemId: structureRow.systemId,
		systemName: structureRow.systemName ?? null,
		regionId: structureRow.regionId ?? null,
		regionName: structureRow.regionName ?? null,
		state: 'mining',
		planetId: miningRow?.planetId ?? '',
		currentStockVolume: miningRow?.currentStockVolume ?? null,
		capacityVolume: miningRow?.capacityVolume ?? null,
		fillRatePerHour:
			miningRow?.fillRatePerHour !== null && miningRow?.fillRatePerHour !== undefined
				? String(miningRow.fillRatePerHour)
				: null,
		lastEmptiedAt: toIso(miningRow?.lastEmptiedAt ?? null),
		estimatedFullAt: toIso(miningRow?.estimatedFullAt ?? null),
		lastObservedVolume: miningRow?.lastObservedVolume ?? null,
		lastObservedAt: toIso(miningRow?.lastObservedAt ?? null),
		syncStatus: hasMiningSnapshot ? getSnapshotSyncStatus(miningRow.lastSyncedAt) : 'warning',
		syncFailureReason: hasMiningSnapshot
			? null
			: 'Mining state snapshot has not been ingested yet for this structure.',
		lastSyncedAt: toIso(miningRow?.lastSyncedAt ?? structureRow.lastSyncedAt),
		updatedAt: (miningRow?.updatedAt ?? structureRow.updatedAt).toISOString(),
		canViewSensitive,
		canEdit: canViewSensitive,
	}
}

export async function listSovereigntyStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureSovereigntyListQuery = {}
): Promise<StructureListResponse<StructureSovereigntyListItem>> {
	const { contexts, access } = await loadVisibleStructureContexts(db, user, {
		corporationId: query.corporationId,
		systemId: query.systemId,
	})

	if (!access.viewAll && access.viewCorporationIds.size === 0) {
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
			summary: {
				total: 0,
				lowFuel: 0,
				lowPower: 0,
				reinforced: 0,
			},
		}
	}

	const sovereigntyContexts = contexts.filter((context) => getStructureTab(context.structure) === 'sovereignty')
	const structureIds = sovereigntyContexts.map((context) => context.structure.structureId)

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
			summary: {
				total: 0,
				lowFuel: 0,
				lowPower: 0,
				reinforced: 0,
			},
		}
	}

	const systemWhere = (() => {
		const conditions: StructureWhereCondition[] = []
		if (query.allianceId) {
			conditions.push(eq(structureSovereigntySystems.allianceId, query.allianceId))
		}
		return combineWhereConditions(conditions)
	})()

	const systemRows = await db.query.structureSovereigntySystems.findMany({
		where: combineWhereConditions([
			inArray(structureSovereigntySystems.sovereigntyHubStructureId, structureIds),
			systemWhere,
		]),
		orderBy: desc(structureSovereigntySystems.updatedAt),
	})
	const systemByHubStructureId = new Map(
		systemRows
			.filter((row): row is typeof structureSovereigntySystems.$inferSelect & { sovereigntyHubStructureId: string } =>
				Boolean(row.sovereigntyHubStructureId)
			)
			.map((row) => [row.sovereigntyHubStructureId, row])
	)
	const hubRows = await db.query.structureSovereigntyHubs.findMany({
		where: inArray(structureSovereigntyHubs.structureId, structureIds),
	})
	const hubById = new Map(hubRows.map((row) => [row.structureId, row]))

	const items = sovereigntyContexts.map((context) => {
		const systemRow = systemByHubStructureId.get(context.structure.structureId) ?? null
		const hubRow = hubById.get(context.structure.structureId) ?? null
		return buildSovereigntyListItem({
			systemRow,
			hubRow,
			structureRow: context.structure,
			corporationName: context.corporationName,
			canViewSensitive: context.canViewSensitive,
		})
	})

	const sortBy = query.sortBy ?? 'updatedAt'
	const sortDirection = query.sortDirection ?? 'desc'
	const sortedItems = sortStructures(
		items.map((item) => ({
			...item,
			lowPower: false,
			fuelExpires: null,
			fuelAmount: null,
			hidden: false,
			lowPowerAllowed: false,
			assignedGroupId: null,
			profileId: '',
			nextStateAt: item.vulnerabilityWindowEnd,
		})) as StructureListItem[],
		sortBy,
		sortDirection
	)
	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const totalCount = sortedItems.length
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(Math.max(query.page ?? 1, 1), totalPages)
	const start = (page - 1) * pageSize
	const end = start + pageSize

	return {
		items: sortedItems.slice(start, end).map((item) => items.find((row) => row.structureId === item.structureId)!) as StructureSovereigntyListItem[],
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages,
			hasNextPage: page < totalPages,
			hasPreviousPage: page > 1,
		},
		filterOptions: buildStructureFilterOptions(items),
		summary: {
			total: items.length,
			lowFuel: 0,
			lowPower: 0,
			reinforced: 0,
		},
	}
}

export async function listSkyhookStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureSkyhookListQuery = {}
): Promise<StructureListResponse<StructureSkyhookListItem>> {
	const { contexts, access } = await loadVisibleStructureContexts(db, user, {
		corporationId: query.corporationId,
		systemId: query.systemId,
	})

	if (!access.viewAll && access.viewCorporationIds.size === 0) {
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
			summary: {
				total: 0,
				lowFuel: 0,
				lowPower: 0,
				reinforced: 0,
			},
		}
	}

	const skyhookContexts = contexts.filter((context) => getStructureTab(context.structure) === 'skyhooks')
	const structureIds = skyhookContexts.map((context) => context.structure.structureId)

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
			summary: {
				total: 0,
				lowFuel: 0,
				lowPower: 0,
				reinforced: 0,
			},
		}
	}

	const skyhookWhere = (() => {
		const conditions: StructureWhereCondition[] = []
		if (query.planetId) {
			conditions.push(eq(structureSkyhookStates.planetId, query.planetId))
		}
		if (query.state) {
			conditions.push(eq(structureSkyhookStates.state, query.state))
		}
		if (query.isRaidable === 'true') {
			conditions.push(eq(structureSkyhookStates.isRaidable, true))
		} else if (query.isRaidable === 'false') {
			conditions.push(eq(structureSkyhookStates.isRaidable, false))
		}
		return combineWhereConditions(conditions)
	})()

	const skyhookRows = await db.query.structureSkyhookStates.findMany({
		where: combineWhereConditions([
			inArray(structureSkyhookStates.structureId, structureIds),
			skyhookWhere,
		]),
		orderBy: desc(structureSkyhookStates.updatedAt),
	})
	const skyhookByStructureId = new Map(skyhookRows.map((row) => [row.structureId, row]))

	const items = skyhookContexts.map((context) => {
		const skyhookRow = skyhookByStructureId.get(context.structure.structureId) ?? null
		return buildSkyhookListItem({
			skyhookRow,
			structureRow: context.structure,
			corporationName: context.corporationName,
			canViewSensitive: context.canViewSensitive,
		})
	})

	const sortBy = query.sortBy ?? 'updatedAt'
	const sortDirection = query.sortDirection ?? 'desc'
	const sortedItems = sortStructures(
		items.map((item) => ({
			...item,
			state: item.state,
			lowPower: false,
			fuelExpires: null,
			fuelAmount: null,
			hidden: false,
			lowPowerAllowed: false,
			assignedGroupId: null,
			profileId: '',
			nextStateAt: item.theftVulnerabilityEnd,
		})) as StructureListItem[],
		sortBy,
		sortDirection
	)
	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const totalCount = sortedItems.length
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(Math.max(query.page ?? 1, 1), totalPages)
	const start = (page - 1) * pageSize
	const end = start + pageSize

	return {
		items: sortedItems.slice(start, end).map((item) => items.find((row) => row.structureId === item.structureId)!) as StructureSkyhookListItem[],
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages,
			hasNextPage: page < totalPages,
			hasPreviousPage: page > 1,
		},
		filterOptions: buildStructureFilterOptions(items),
		summary: {
			total: items.length,
			lowFuel: 0,
			lowPower: 0,
			reinforced: 0,
		},
	}
}

export async function listMiningStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureMiningListQuery = {}
): Promise<StructureListResponse<StructureMiningListItem>> {
	const { contexts, access } = await loadVisibleStructureContexts(db, user, {
		corporationId: query.corporationId,
		systemId: query.systemId,
		typeId: query.typeId,
	})

	if (!access.viewAll && access.viewCorporationIds.size === 0) {
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
			summary: {
				total: 0,
				lowFuel: 0,
				lowPower: 0,
				reinforced: 0,
			},
		}
	}

	const miningContexts = contexts.filter((context) => getStructureTab(context.structure) === 'mining')
	const structureIds = miningContexts.map((context) => context.structure.structureId)

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
			summary: {
				total: 0,
				lowFuel: 0,
				lowPower: 0,
				reinforced: 0,
			},
		}
	}

	const miningWhere = (() => {
		const conditions: StructureWhereCondition[] = []
		if (query.planetId) {
			conditions.push(eq(structureMiningStates.planetId, query.planetId))
		}
		return combineWhereConditions(conditions)
	})()

	const miningRows = await db.query.structureMiningStates.findMany({
		where: combineWhereConditions([
			inArray(structureMiningStates.structureId, structureIds),
			miningWhere,
		]),
		orderBy: desc(structureMiningStates.updatedAt),
	})
	const miningByStructureId = new Map(miningRows.map((row) => [row.structureId, row]))
	const items = miningContexts.map((context) =>
		buildMiningListItem({
			miningRow: miningByStructureId.get(context.structure.structureId) ?? null,
			structureRow: context.structure,
			corporationName: context.corporationName,
			canViewSensitive: context.canViewSensitive,
		})
	)

	const sortBy = query.sortBy ?? 'updatedAt'
	const sortDirection = query.sortDirection ?? 'desc'
	const sortedItems = sortStructures(
		items.map((item) => ({
			...item,
			state: item.typeName ?? 'mining',
			lowPower: false,
			fuelExpires: null,
			fuelAmount: null,
			hidden: false,
			lowPowerAllowed: false,
			assignedGroupId: null,
			profileId: '',
			nextStateAt: item.estimatedFullAt,
		})) as StructureListItem[],
		sortBy,
		sortDirection
	)
	const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), STRUCTURE_LIST_PAGE_SIZE_MAX)
	const totalCount = sortedItems.length
	const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
	const page = Math.min(Math.max(query.page ?? 1, 1), totalPages)
	const start = (page - 1) * pageSize
	const end = start + pageSize

	return {
		items: sortedItems.slice(start, end).map((item) => items.find((row) => row.structureId === item.structureId)!) as StructureMiningListItem[],
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages,
			hasNextPage: page < totalPages,
			hasPreviousPage: page > 1,
		},
		filterOptions: buildStructureFilterOptions(items),
		summary: {
			total: items.length,
			lowFuel: 0,
			lowPower: 0,
			reinforced: 0,
		},
	}
}

export async function getVisibleStructureDetail(
	db: DbClient<DbSchema>,
	user: SessionUser,
	structureId: string
): Promise<StructureDetailResult | null> {
	const context = await getVisibleStructureContext(db, user, structureId)
	if (!context) {
		return null
	}
	return buildStructureDetailResult(context)
}

export async function updateStructureConfig(
	db: DbClient<DbSchema>,
	user: SessionUser,
	structureId: string,
	input: UpdateStructureConfigInput
): Promise<StructureDetailResult | null> {
	const context = await getVisibleStructureContext(db, user, structureId)
	if (!context) {
		return null
	}

	const access = computeStructureAccess(user.roles, user.is_admin)
	const canEdit =
		user.is_admin ||
		access.managerAll ||
		access.managerCorporationIds.has(context.structure.corporationId)
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
			rawPayload: {
				structureId: structure.structureId,
				corporationId,
				name: structure.name,
				systemId: structure.systemId,
				state: structure.state,
				previousState: previous.state,
			},
		})
	}

	logger.info('[Structures] Synced corporation structures', {
		corporationId,
		structureCount: corpStructures.length,
		stateChangeCount,
	})

	return {
		structureCount: corpStructures.length,
		stateChangeCount,
	}
}
