import { and, desc, eq, inArray, isNotNull } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { corporationStructures } from '@repo/eve-corporation-data-db-schema'
import { managedCorporations } from '@repo/core-db-schema'
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
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Env, SessionUser } from '../context'

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
}

export interface StructureListSummary {
	total: number
	lowFuel: number
	lowPower: number
	reinforced: number
}

export interface StructureListQuery {
	page?: number
	pageSize?: number
	corporationId?: string
	assignedGroupId?: string
	lowPower?: 'true' | 'false'
	lowPowerAllowed?: 'true' | 'false'
	regionId?: string
	systemId?: string
	state?: string
	typeId?: string
	sortBy?: StructureListSortField
	sortDirection?: StructureListSortDirection
}

export interface StructureListResponse {
	items: StructureListItem[]
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

export interface StructureDetailResult extends StructureListItem {
	stateTimerStart: string | null
	stateTimerEnd: string | null
	unanchorsAt: string | null
	nextReinforceApply: string | null
	nextReinforceHour: number | null
	reinforceHour: number | null
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
}

function buildStructureDetailResult(context: VisibleStructureContext): StructureDetailResult {
	const structure = buildStructureListItem(context)
	return {
		...structure,
		stateTimerStart: toIso(context.structure.stateTimerStart),
		stateTimerEnd: toIso(context.structure.stateTimerEnd),
		unanchorsAt: toIso(context.structure.unanchorsAt),
		nextReinforceApply: toIso(context.structure.nextReinforceApply),
		nextReinforceHour: context.structure.nextReinforceHour,
		reinforceHour: context.structure.reinforceHour,
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

	return {
		structure,
		corporationName: corporation?.name ?? structure.corporationId,
		config: config ?? null,
		canViewSensitive,
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

function buildStructureFilterOptions(items: StructureListItem[]): StructureListFilterOptions {
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

export async function listVisibleStructures(
	db: DbClient<DbSchema>,
	user: SessionUser,
	query: StructureListQuery = {}
): Promise<StructureListResponse> {
	const moduleConfig = await getStructureModuleConfig(db)
	const access = computeStructureAccess(user.roles, user.is_admin)

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
			filterOptions: {
				corporations: [],
				regions: [],
				systems: [],
				states: [],
				types: [],
				assignedGroups: [],
			},
			summary: {
				total: 0,
				lowFuel: 0,
				lowPower: 0,
				reinforced: 0,
			},
		}
	}

	const corpWhere = (() => {
		const conditions: any[] = []
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
		return conditions.length > 0 ? and(...conditions) : undefined
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

	const contexts = corpStructures
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
		})

	const items = contexts.map((context) => buildStructureListItem(context))
	const filterOptions = buildStructureFilterOptions(items)
	const filteredItems = items
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

	return {
		items: sortedItems.slice(start, end),
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
