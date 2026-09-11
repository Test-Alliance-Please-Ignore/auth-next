import { exists, getTableColumns } from 'drizzle-orm'

import { TIMERBOARD_PERMISSION_URNS } from '@repo/core'
import { and, asc, eq, gte, ilike, inArray, lte, not, or, sql } from '@repo/db-utils'
import { parseDateOrNull } from '@repo/worker-utils'

import {
	timerboardActivity,
	timerboardEntries,
	timerboardEntryVisibilityGroups,
	timerboardSyncOutbox,
	userCharacters,
} from '../db/schema'

import type { SQL } from 'drizzle-orm'
import type {
	CreateTimerboardEntryInput,
	TimerboardActivity as TimerboardActivityContract,
	TimerboardAssignmentCandidate,
	TimerboardAssignmentInput,
	TimerboardDestinationCatalogItem,
	TimerboardDestinationSyncState,
	TimerboardEntry as TimerboardEntryContract,
	TimerCategory,
	TimerHostility,
	TimerPriority,
	TimerState,
	TimerType,
} from '@repo/core'
import type { createDb } from '../db'

export { TIMERBOARD_PERMISSION_URNS }
export type { CreateTimerboardEntryInput }

export type TimerboardActor = {
	userId: string
	isAdmin: boolean
	permissionUrns: readonly string[]
}

export type TimerboardVisibilityResolver = {
	getUserGroupIds(userId: string): Promise<string[]>
	resolveStructureVisibility(
		userId: string,
		structureIds: string[]
	): Promise<Array<{ structureId: string; canView: boolean }>>
}

export type UpdateTimerboardEntryInput = Partial<
	Pick<
		CreateTimerboardEntryInput,
		| 'category'
		| 'timerType'
		| 'title'
		| 'priority'
		| 'hostility'
		| 'startsAt'
		| 'systemId'
		| 'systemName'
		| 'regionId'
		| 'regionName'
		| 'planetId'
		| 'planetName'
		| 'moonId'
		| 'moonName'
		| 'corporationId'
		| 'corporationName'
		| 'allianceId'
		| 'allianceName'
		| 'subjectId'
		| 'subjectType'
		| 'subjectName'
		| 'notes'
		| 'structureVisibilityEnforced'
		| 'visibilityGroupIds'
		| 'sharingEnabled'
		| 'shareDestinations'
	>
>

export type TimerboardAssignment = Omit<TimerboardAssignmentInput, 'expectedVersion'>

export type TimerboardListQuery = {
	states?: TimerboardState[]
	category?: TimerCategory
	timerTypes?: TimerType[]
	priorities?: TimerPriority[]
	hostilities?: TimerHostility[]
	subjectTypes?: string[]
	organizations?: string[]
	system?: string
	assignedToMe?: boolean
	from?: string
	to?: string
	page: number
	pageSize: number
}

export type TimerboardListResult = {
	items: TimerboardEntry[]
	page: number
	pageSize: number
	total: number
}

export class TimerboardValidationError extends Error {
	constructor(readonly fields: Record<string, string>) {
		super('Invalid timerboard entry')
		this.name = 'TimerboardValidationError'
	}
}

export class TimerboardForbiddenError extends Error {
	constructor() {
		super('Forbidden')
		this.name = 'TimerboardForbiddenError'
	}
}

export class TimerboardNotFoundError extends Error {
	constructor() {
		super('Timerboard entry not found')
		this.name = 'TimerboardNotFoundError'
	}
}

type TimerboardEntryRow = typeof timerboardEntries.$inferSelect
type TimerboardActivityRow = typeof timerboardActivity.$inferSelect
type TimerboardActivityWithActor = TimerboardActivityRow & {
	actor: {
		characters: Array<{ characterName: string }>
	} | null
}
type CoreDb = ReturnType<typeof createDb>
type CoreTransaction = CoreDb
type TimerboardEntryUpdate = Partial<typeof timerboardEntries.$inferInsert>

type TimerboardEntryBundle = {
	entry: TimerboardEntryRow
	activity: TimerboardActivityWithActor[]
	visibilityGroupIds: string[]
}

const TIMERBOARD_READ_CACHE_TTL_MS = 30_000
const TIMERBOARD_READ_CACHE_MAX_ENTRIES = 256

class TimerboardReadCache {
	private readonly entries = new Map<string, { expiresAt: number; value: Promise<unknown> }>()

	getOrLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
		const now = Date.now()
		const cached = this.entries.get(key)
		if (cached && cached.expiresAt > now) {
			// Refresh insertion order so the size bound behaves as an LRU bound.
			this.entries.delete(key)
			this.entries.set(key, cached)
			return cached.value as Promise<T>
		}
		if (cached) this.entries.delete(key)

		while (this.entries.size >= TIMERBOARD_READ_CACHE_MAX_ENTRIES) {
			const oldestKey = this.entries.keys().next().value
			if (oldestKey === undefined) break
			this.entries.delete(oldestKey)
		}

		const entry = {
			expiresAt: Number.POSITIVE_INFINITY,
			value: Promise.resolve().then(load) as Promise<unknown>,
		}
		this.entries.set(key, entry)
		void entry.value.then(
			() => {
				entry.expiresAt = Date.now() + TIMERBOARD_READ_CACHE_TTL_MS
			},
			() => {
				if (this.entries.get(key) === entry) this.entries.delete(key)
			}
		)
		return entry.value as Promise<T>
	}

	clear(): void {
		this.entries.clear()
	}
}

// Tests default to their database object as the scope. The production route
// passes one module-stable scope, ensuring all requests in a Worker isolate
// share entries without coupling the cache to secret binding values.
const timerboardReadCaches = new WeakMap<object, TimerboardReadCache>()

function getTimerboardReadCache(scope: object): TimerboardReadCache {
	let cache = timerboardReadCaches.get(scope)
	if (!cache) {
		cache = new TimerboardReadCache()
		timerboardReadCaches.set(scope, cache)
	}
	return cache
}

export type TimerboardEntry = TimerboardEntryContract
export type TimerboardActivity = TimerboardActivityContract
export type TimerboardState = TimerState

export class TimerboardConflictError extends Error {
	constructor(readonly current: TimerboardEntry) {
		super('Timerboard entry was modified by another user')
		this.name = 'TimerboardConflictError'
	}
}

function canManage(actor: TimerboardActor): boolean {
	return actor.isAdmin || actor.permissionUrns.includes(TIMERBOARD_PERMISSION_URNS.manage)
}

function canEdit(actor: TimerboardActor): boolean {
	return (
		actor.isAdmin ||
		actor.permissionUrns.includes(TIMERBOARD_PERMISSION_URNS.edit) ||
		actor.permissionUrns.includes(TIMERBOARD_PERMISSION_URNS.manage)
	)
}

function canView(actor: TimerboardActor): boolean {
	return canEdit(actor) || actor.permissionUrns.includes(TIMERBOARD_PERMISSION_URNS.view)
}

const allowedStateTransitions: Record<TimerboardState, readonly TimerboardState[]> = {
	planned: ['covered', 'completed', 'cancelled'],
	covered: ['completed', 'cancelled'],
	completed: [],
	cancelled: [],
}

function serializeEntry(
	row: TimerboardEntryRow,
	actor: TimerboardActor,
	visibilityGroupIds: string[] = []
): TimerboardEntry {
	const active = row.state === 'planned' || row.state === 'covered'
	const ownsEditableEntry = canEdit(actor) && row.createdByUserId === actor.userId
	const manages = canManage(actor)
	return {
		...row,
		structureVisibilityEnforced: row.structureVisibilityEnforced,
		visibilityGroupIds,
		sharingEnabled: row.sharingEnabled,
		shareDestinations: row.shareDestinations,
		startsAt: row.startsAt.toISOString(),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		isOverdue: active && row.startsAt.getTime() < Date.now(),
		actions: {
			canEdit: manages || ownsEditableEntry,
			canAssign: manages,
			canSetCovered: row.state === 'planned' && (manages || ownsEditableEntry),
			canComplete: active && (manages || ownsEditableEntry),
			canCancel: active && manages,
		},
	}
}

function serializeActivity(row: TimerboardActivityWithActor): TimerboardActivity {
	const { actor, ...activity } = row
	return {
		...activity,
		actorCharacterName: actor?.characters[0]?.characterName ?? null,
		createdAt: row.createdAt.toISOString(),
	}
}

function serializeActivityValue(value: unknown): unknown {
	return value instanceof Date ? value.toISOString() : value
}

function validateEntryFields(input: UpdateTimerboardEntryInput): void {
	const fields: Record<string, string> = {}
	if (input.title !== undefined) {
		if (input.title.trim().length === 0) fields.title = 'Title is required'
		else if (input.title.length > 160) fields.title = 'Title must be at most 160 characters'
	}

	const textLimits = {
		systemName: 120,
		regionName: 120,
		planetName: 120,
		moonName: 120,
		corporationName: 160,
		allianceName: 160,
		subjectType: 80,
		subjectName: 160,
		notes: 2000,
	} as const
	for (const [field, max] of Object.entries(textLimits) as Array<
		[keyof typeof textLimits, number]
	>) {
		const value = input[field]
		if (value !== undefined && value !== null) {
			if (value.trim().length === 0) fields[field] = `${field} must not be blank`
			else if (value.length > max) fields[field] = `${field} must be at most ${max} characters`
		}
	}

	for (const field of [
		'systemId',
		'regionId',
		'corporationId',
		'allianceId',
		'subjectId',
		'planetId',
		'moonId',
	] as const) {
		const value = input[field]
		if (value !== undefined && value !== null && (!/^\d+$/.test(value) || value.length > 32)) {
			fields[field] = `${field} must be a numeric EVE ID`
		}
	}

	if (Object.keys(fields).length > 0) throw new TimerboardValidationError(fields)
}

function validateAssignment(assignment: TimerboardAssignment): void {
	const fields: Record<string, string> = {}
	if (
		assignment.userId !== null &&
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			assignment.userId
		)
	) {
		fields.userId = 'Assigned user must be a valid UUID'
	}
	if (
		assignment.characterId !== null &&
		(!/^\d+$/.test(assignment.characterId) || assignment.characterId.length > 32)
	) {
		fields.characterId = 'Character ID must be a numeric EVE ID'
	}
	if (assignment.characterName !== null) {
		if (assignment.characterName.trim().length === 0) {
			fields.characterName = 'Character name must not be blank'
		} else if (assignment.characterName.length > 255) {
			fields.characterName = 'Character name must be at most 255 characters'
		}
	}
	if (Object.keys(fields).length > 0) throw new TimerboardValidationError(fields)
}

function validateSharing(
	input: Pick<CreateTimerboardEntryInput, 'visibilityGroupIds' | 'shareDestinations'>
): void {
	const fields: Record<string, string> = {}
	const groupIds = input.visibilityGroupIds ?? []
	if (groupIds.length > 100 || groupIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
		fields.visibilityGroupIds = 'Visibility groups must contain at most 100 valid UUIDs'
	}
	const destinations = input.shareDestinations ?? []
	if (destinations.length > 25) fields.shareDestinations = 'At most 25 destinations may be selected'
	for (const destination of destinations) {
		if (
			!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(destination.adapterKey) ||
			!destination.targetKey.trim() ||
			destination.targetKey.length > 255 ||
			JSON.stringify(destination.selectionMeta ?? {}).length > 4096
		) {
			fields.shareDestinations = 'Destination references are invalid or too large'
			break
		}
	}
	if (Object.keys(fields).length > 0) throw new TimerboardValidationError(fields)
}

function isSupportedStructureSubjectType(subjectType: string | null): boolean {
	return subjectType === 'structure' || subjectType?.startsWith('structure:') === true
}

export class TimerboardService {
	private readonly readCache: TimerboardReadCache
	private readonly visibilityResolver: TimerboardVisibilityResolver

	constructor(
		private readonly db: CoreDb,
		cacheScope: object = db,
		visibilityResolver: TimerboardVisibilityResolver = {
			getUserGroupIds: async () => [],
			resolveStructureVisibility: async (_userId, structureIds) =>
				structureIds.map((structureId) => ({ structureId, canView: true })),
		}
	) {
		this.readCache = getTimerboardReadCache(cacheScope)
		this.visibilityResolver = visibilityResolver
	}

	private async visibleStructureIds(actor: TimerboardActor): Promise<string[]> {
		const rows = await this.db
			.select({
				subjectId: timerboardEntries.subjectId,
				subjectType: timerboardEntries.subjectType,
			})
			.from(timerboardEntries)
			.where(
				and(
					eq(timerboardEntries.structureVisibilityEnforced, true),
					sql`${timerboardEntries.subjectId} is not null`
				)
			)
		const subjectIds = rows.flatMap((row) =>
			row.subjectId && isSupportedStructureSubjectType(row.subjectType) ? [row.subjectId] : []
		)
		if (subjectIds.length === 0) return []
		const results = await this.visibilityResolver.resolveStructureVisibility(
			actor.userId,
			subjectIds
		)
		return results.filter((result) => result.canView).map((result) => result.structureId)
	}

	private async visibilityConditions(actor: TimerboardActor) {
		const groupIds = await this.visibilityResolver.getUserGroupIds(actor.userId)
		const visibleStructures = await this.visibleStructureIds(actor)
		const groupVisibility = or(
			not(
				exists(
					this.db
						.select({ entryId: timerboardEntryVisibilityGroups.entryId })
						.from(timerboardEntryVisibilityGroups)
						.where(eq(timerboardEntryVisibilityGroups.entryId, timerboardEntries.id))
				)
			),
			groupIds.length > 0
				? exists(
						this.db
							.select({ entryId: timerboardEntryVisibilityGroups.entryId })
							.from(timerboardEntryVisibilityGroups)
							.where(
								and(
									eq(timerboardEntryVisibilityGroups.entryId, timerboardEntries.id),
									inArray(timerboardEntryVisibilityGroups.groupId, groupIds)
								)
							)
					)
				: sql`false`
		)
		const structureVisibility = or(
			eq(timerboardEntries.structureVisibilityEnforced, false),
			visibleStructures.length > 0
				? and(
						eq(timerboardEntries.structureVisibilityEnforced, true),
						inArray(timerboardEntries.subjectId, visibleStructures)
					)
				: sql`false`
		)
		return [groupVisibility, structureVisibility].filter((condition): condition is SQL =>
			Boolean(condition)
		)
	}

	async list(actor: TimerboardActor, query: TimerboardListQuery): Promise<TimerboardListResult> {
		if (!canView(actor)) throw new TimerboardForbiddenError()
		const paginationFields: Record<string, string> = {}
		if (!Number.isInteger(query.page) || query.page < 1) {
			paginationFields.page = 'Page must be at least 1'
		}
		if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
			paginationFields.pageSize = 'Page size must be between 1 and 100'
		}
		if (Object.keys(paginationFields).length > 0) {
			throw new TimerboardValidationError(paginationFields)
		}
		const states: TimerboardState[] = query.states?.length ? query.states : ['planned', 'covered']
		const from = query.from ? parseDateOrNull(query.from) : null
		const to = query.to ? parseDateOrNull(query.to) : null
		if (query.from && !from) {
			throw new TimerboardValidationError({ from: 'From must be a valid UTC instant' })
		}
		if (query.to && !to) {
			throw new TimerboardValidationError({ to: 'To must be a valid UTC instant' })
		}
		if (from && to && to.getTime() <= from.getTime()) {
			throw new TimerboardValidationError({ to: 'To must be later than from' })
		}
		const system = query.system?.trim() || undefined

		const conditions = [inArray(timerboardEntries.state, states)]
		conditions.push(...(await this.visibilityConditions(actor)))
		if (query.category) conditions.push(eq(timerboardEntries.category, query.category))
		if (query.timerTypes?.length)
			conditions.push(inArray(timerboardEntries.timerType, query.timerTypes))
		if (query.priorities?.length)
			conditions.push(inArray(timerboardEntries.priority, query.priorities))
		if (query.hostilities?.length)
			conditions.push(inArray(timerboardEntries.hostility, query.hostilities))
		if (query.subjectTypes?.length)
			conditions.push(inArray(timerboardEntries.subjectType, query.subjectTypes))
		const organizations = [
			...new Set(query.organizations?.map((value) => value.trim()).filter(Boolean)),
		]
		if (organizations.length) {
			const organizationCondition = or(
				inArray(timerboardEntries.corporationId, organizations),
				inArray(timerboardEntries.allianceId, organizations)
			)
			if (organizationCondition) conditions.push(organizationCondition)
		}
		if (system) conditions.push(ilike(timerboardEntries.systemName, `%${system}%`))
		if (query.assignedToMe) {
			conditions.push(eq(timerboardEntries.assignedUserId, actor.userId))
		}
		if (from) conditions.push(gte(timerboardEntries.startsAt, from))
		if (to) conditions.push(lte(timerboardEntries.startsAt, to))
		const where = and(...conditions)
		const priorityOrder = sql<number>`CASE ${timerboardEntries.priority}
			WHEN 'critical' THEN 0
			WHEN 'high' THEN 1
			WHEN 'normal' THEN 2
			ELSE 3
		END`

		const cacheKey = JSON.stringify({
			type: 'list',
			viewer: actor.userId,
			states: [...states].sort(),
			category: query.category ?? null,
			timerTypes: query.timerTypes ?? [],
			priorities: query.priorities ?? [],
			hostilities: query.hostilities ?? [],
			subjectTypes: query.subjectTypes ?? [],
			organizations,
			system: system?.toLocaleLowerCase() ?? null,
			assignedUserId: query.assignedToMe ? actor.userId : null,
			from: from?.toISOString() ?? null,
			to: to?.toISOString() ?? null,
			page: query.page,
			pageSize: query.pageSize,
		})
		const result = await this.readCache.getOrLoad(cacheKey, async () => {
			const rows = await this.db
				.select({
					...getTableColumns(timerboardEntries),
					timerboardTotal: sql<number>`count(*) over()::int`,
				})
				.from(timerboardEntries)
				.where(where)
				.orderBy(priorityOrder, asc(timerboardEntries.startsAt))
				.limit(query.pageSize)
				.offset((query.page - 1) * query.pageSize)

			// A window count normally keeps pagination to one statement. Only an
			// out-of-range page has no row to carry that count, so preserve an exact
			// total with a fallback query for that uncommon boundary case.
			const total =
				rows[0]?.timerboardTotal ??
				(query.page === 1
					? 0
					: ((
							await this.db
								.select({ count: sql<number>`count(*)::int` })
								.from(timerboardEntries)
								.where(where)
						)[0]?.count ?? 0))

			return {
				rows: rows.map(({ timerboardTotal: _total, ...row }) => row),
				total,
			}
		})

		const visibilityGroups = result.rows.length
			? await this.db.query.timerboardEntryVisibilityGroups.findMany({
					where: (table, { inArray }) =>
						inArray(
							table.entryId,
							result.rows.map((row) => row.id)
						),
					columns: { entryId: true, groupId: true },
				})
			: []
		const groupIdsByEntry = new Map<string, string[]>()
		for (const group of visibilityGroups) {
			const ids = groupIdsByEntry.get(group.entryId) ?? []
			ids.push(group.groupId)
			groupIdsByEntry.set(group.entryId, ids)
		}
		return {
			items: result.rows.map((row) =>
				serializeEntry(row, actor, groupIdsByEntry.get(row.id) ?? [])
			),
			page: query.page,
			pageSize: query.pageSize,
			total: result.total,
		}
	}

	async get(actor: TimerboardActor, entryId: string): Promise<TimerboardEntry> {
		if (!canView(actor)) throw new TimerboardForbiddenError()
		const bundle = await this.getEntryBundle(entryId)
		if (!(await this.isVisible(actor, bundle.entry))) throw new TimerboardNotFoundError()
		return serializeEntry(bundle.entry, actor, bundle.visibilityGroupIds)
	}

	async searchAssignmentCandidates(
		actor: TimerboardActor,
		search: string,
		limit = 20
	): Promise<TimerboardAssignmentCandidate[]> {
		if (!canManage(actor)) throw new TimerboardForbiddenError()
		const normalizedSearch = search.trim()
		const fields: Record<string, string> = {}
		if (normalizedSearch.length < 2 || normalizedSearch.length > 80) {
			fields.search = 'Search must be between 2 and 80 characters'
		}
		if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
			fields.limit = 'Limit must be between 1 and 50'
		}
		if (Object.keys(fields).length > 0) throw new TimerboardValidationError(fields)

		const cacheKey = `assignment-candidates:${normalizedSearch.toLocaleLowerCase()}:${limit}`
		return this.readCache.getOrLoad(cacheKey, async () => {
			const rows = await this.db.query.userCharacters.findMany({
				where: and(
					ilike(userCharacters.characterName, `%${normalizedSearch}%`),
					eq(userCharacters.isDeleted, false),
					eq(userCharacters.status, 'active')
				),
				columns: {
					userId: true,
					characterId: true,
					characterName: true,
					is_primary: true,
				},
				orderBy: (table, { asc }) => asc(table.characterName),
				limit,
			})

			return rows.map((row) => ({
				userId: row.userId,
				characterId: row.characterId,
				characterName: row.characterName,
				isPrimary: row.is_primary,
			}))
		})
	}

	private getEntryBundle(entryId: string): Promise<TimerboardEntryBundle> {
		return this.readCache.getOrLoad(`entry:${entryId}`, async () => {
			const row = await this.db.query.timerboardEntries.findFirst({
				where: (table, { eq }) => eq(table.id, entryId),
			})
			if (!row) throw new TimerboardNotFoundError()
			const [visibilityGroups, activityRows] = await Promise.all([
				this.db.query.timerboardEntryVisibilityGroups.findMany({
					where: (table, { eq }) => eq(table.entryId, entryId),
					columns: { groupId: true },
				}),
				this.db
					.select({
						activity: timerboardActivity,
						characterName: userCharacters.characterName,
					})
					.from(timerboardActivity)
					.leftJoin(
						userCharacters,
						and(
							eq(userCharacters.userId, timerboardActivity.actorUserId),
							eq(userCharacters.is_primary, true),
							eq(userCharacters.isDeleted, false)
						)
					)
					.where(eq(timerboardActivity.entryId, entryId))
					.orderBy(asc(timerboardActivity.createdAt)),
			])
			const activity = activityRows.map(({ activity, characterName }) => ({
				...activity,
				actor: characterName ? { characters: [{ characterName }] } : null,
			}))
			return {
				entry: row,
				activity,
				visibilityGroupIds: visibilityGroups.map((group) => group.groupId),
			}
		})
	}

	private async isVisible(actor: TimerboardActor, entry: TimerboardEntryRow): Promise<boolean> {
		const groupIds = await this.visibilityResolver.getUserGroupIds(actor.userId)
		const groups = await this.db.query.timerboardEntryVisibilityGroups.findMany({
			where: (table, { eq }) => eq(table.entryId, entry.id),
			columns: { groupId: true },
		})
		if (groups.length > 0 && !groups.some((group) => groupIds.includes(group.groupId))) return false
		if (!entry.structureVisibilityEnforced) return true
		if (!entry.subjectId || !isSupportedStructureSubjectType(entry.subjectType)) return false
		const result = await this.visibilityResolver.resolveStructureVisibility(actor.userId, [
			entry.subjectId,
		])
		return result.some((item) => item.structureId === entry.subjectId && item.canView)
	}

	private async assertVisible(actor: TimerboardActor, entry: TimerboardEntryRow): Promise<void> {
		if (!(await this.isVisible(actor, entry))) throw new TimerboardNotFoundError()
	}

	private async persistVersionedUpdate(
		tx: CoreTransaction,
		actor: TimerboardActor,
		current: TimerboardEntryRow,
		expectedVersion: number,
		values: TimerboardEntryUpdate
	): Promise<TimerboardEntryRow> {
		// The version predicate is the concurrency boundary. The row read earlier
		// authorizes and validates the command, while this conditional write ensures
		// a racing command cannot silently overwrite it.
		const [updated] = await tx
			.update(timerboardEntries)
			.set({
				...values,
				updatedByUserId: actor.userId,
				updatedAt: new Date(),
				version: current.version + 1,
			})
			.where(
				and(eq(timerboardEntries.id, current.id), eq(timerboardEntries.version, expectedVersion))
			)
			.returning()

		if (updated) return updated

		// A failed conditional write means another transaction won after our read.
		// Return that row with the conflict so clients can recover without a second
		// round trip.
		const latest = await tx.query.timerboardEntries.findFirst({
			where: (table, { eq }) => eq(table.id, current.id),
		})
		if (!latest) throw new TimerboardNotFoundError()
		this.readCache.clear()
		throw new TimerboardConflictError(serializeEntry(latest, actor))
	}

	async create(
		actor: TimerboardActor,
		input: CreateTimerboardEntryInput
	): Promise<TimerboardEntry> {
		if (!canEdit(actor)) throw new TimerboardForbiddenError()
		validateEntryFields(input)
		validateSharing(input)

		const startsAt = parseDateOrNull(input.startsAt)
		if (!startsAt) {
			throw new TimerboardValidationError({ startsAt: 'Start time must be a valid UTC instant' })
		}

		const created = await (async () => {
			const tx = this.db
			const [entry] = await tx
				.insert(timerboardEntries)
				.values({
					...input,
					structureVisibilityEnforced: input.structureVisibilityEnforced ?? false,
					sharingEnabled: input.sharingEnabled ?? false,
					shareDestinations: input.sharingEnabled ? (input.shareDestinations ?? []) : [],
					startsAt,
					state: 'planned',
					sourceKind: 'manual',
					sourceReference: null,
					createdByUserId: actor.userId,
					updatedByUserId: actor.userId,
				})
				.returning()

			if (!entry) throw new Error('Timerboard entry insert returned no row')
			if (input.visibilityGroupIds?.length) {
				await tx
					.insert(timerboardEntryVisibilityGroups)
					.values(input.visibilityGroupIds.map((groupId) => ({ entryId: entry.id, groupId })))
			}
			if (entry.sharingEnabled && entry.shareDestinations.length > 0) {
				await tx.insert(timerboardSyncOutbox).values({
					entryId: entry.id,
					operation: 'upsert',
					version: entry.version,
					payload: { entryId: entry.id, destinations: entry.shareDestinations },
				})
			}

			await tx
				.insert(timerboardActivity)
				.values({
					entryId: entry.id,
					actorUserId: actor.userId,
					action: 'created',
					payload: { created: true },
				})
				.returning()

			return serializeEntry(entry, actor, input.visibilityGroupIds ?? [])
		})()
		this.readCache.clear()
		return created
	}

	async listActivity(actor: TimerboardActor, entryId: string): Promise<TimerboardActivity[]> {
		if (!canView(actor)) throw new TimerboardForbiddenError()
		const bundle = await this.getEntryBundle(entryId)
		await this.assertVisible(actor, bundle.entry)
		return bundle.activity.map(serializeActivity)
	}

	async listShareDestinations(actor: TimerboardActor): Promise<TimerboardDestinationCatalogItem[]> {
		if (!canView(actor)) throw new TimerboardForbiddenError()
		return []
	}

	async getTimerDestinationSync(
		actor: TimerboardActor,
		entryId: string
	): Promise<
		Array<{
			adapterKey: string
			targetKey: string
			state: TimerboardDestinationSyncState
			remoteId: string | null
			lastError: string | null
		}>
	> {
		if (!canView(actor)) throw new TimerboardForbiddenError()
		const entry = await this.db.query.timerboardEntries.findFirst({
			where: (table, { eq }) => eq(table.id, entryId),
		})
		if (!entry) throw new TimerboardNotFoundError()
		await this.assertVisible(actor, entry)
		return this.db.query.timerboardEntryDestinationSync.findMany({
			where: (table, { eq }) => eq(table.entryId, entryId),
			columns: { adapterKey: true, targetKey: true, state: true, remoteId: true, lastError: true },
		}) as Promise<
			Array<{
				adapterKey: string
				targetKey: string
				state: TimerboardDestinationSyncState
				remoteId: string | null
				lastError: string | null
			}>
		>
	}

	async update(
		actor: TimerboardActor,
		entryId: string,
		input: UpdateTimerboardEntryInput,
		expectedVersion: number
	): Promise<TimerboardEntry> {
		const updatedEntry = await (async () => {
			const tx = this.db
			const current = await tx.query.timerboardEntries.findFirst({
				where: (table, { eq }) => eq(table.id, entryId),
			})
			if (!current) throw new TimerboardNotFoundError()
			await this.assertVisible(actor, current)
			if (!canManage(actor) && !(canEdit(actor) && current.createdByUserId === actor.userId)) {
				throw new TimerboardForbiddenError()
			}
			const serialized = serializeEntry(current, actor)
			if (current.version !== expectedVersion) {
				this.readCache.clear()
				throw new TimerboardConflictError(serialized)
			}
			validateEntryFields(input)
			validateSharing(input)

			const startsAt =
				input.startsAt === undefined ? current.startsAt : parseDateOrNull(input.startsAt)
			if (!startsAt) {
				throw new TimerboardValidationError({
					startsAt: 'Start time must be a valid UTC instant',
				})
			}

			const updates = {
				...(input.category === undefined ? {} : { category: input.category }),
				...(input.timerType === undefined ? {} : { timerType: input.timerType }),
				...(input.title === undefined ? {} : { title: input.title }),
				...(input.priority === undefined ? {} : { priority: input.priority }),
				...(input.hostility === undefined ? {} : { hostility: input.hostility }),
				...(input.startsAt === undefined ? {} : { startsAt }),
				...(input.systemId === undefined ? {} : { systemId: input.systemId }),
				...(input.systemName === undefined ? {} : { systemName: input.systemName }),
				...(input.regionId === undefined ? {} : { regionId: input.regionId }),
				...(input.regionName === undefined ? {} : { regionName: input.regionName }),
				...(input.planetId === undefined ? {} : { planetId: input.planetId }),
				...(input.planetName === undefined ? {} : { planetName: input.planetName }),
				...(input.moonId === undefined ? {} : { moonId: input.moonId }),
				...(input.moonName === undefined ? {} : { moonName: input.moonName }),
				...(input.corporationId === undefined ? {} : { corporationId: input.corporationId }),
				...(input.corporationName === undefined ? {} : { corporationName: input.corporationName }),
				...(input.allianceId === undefined ? {} : { allianceId: input.allianceId }),
				...(input.allianceName === undefined ? {} : { allianceName: input.allianceName }),
				...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
				...(input.subjectType === undefined ? {} : { subjectType: input.subjectType }),
				...(input.subjectName === undefined ? {} : { subjectName: input.subjectName }),
				...(input.notes === undefined ? {} : { notes: input.notes }),
				...(input.structureVisibilityEnforced === undefined
					? {}
					: { structureVisibilityEnforced: input.structureVisibilityEnforced }),
				...(input.sharingEnabled === undefined ? {} : { sharingEnabled: input.sharingEnabled }),
				...(input.shareDestinations === undefined
					? {}
					: { shareDestinations: input.sharingEnabled === false ? [] : input.shareDestinations }),
			}
			const changes: Record<string, { previous: unknown; next: unknown }> = {}
			for (const key of Object.keys(updates) as Array<keyof typeof updates>) {
				const previous = current[key as keyof TimerboardEntryRow]
				const next = updates[key]
				if (serializeActivityValue(previous) !== serializeActivityValue(next)) {
					changes[key] = {
						previous: serializeActivityValue(previous),
						next: serializeActivityValue(next),
					}
				}
			}
			if (input.visibilityGroupIds !== undefined && Object.keys(changes).length === 0) {
				changes.visibilityGroupIds = { previous: 'unchanged', next: input.visibilityGroupIds }
			}
			if (Object.keys(changes).length === 0) {
				throw new TimerboardValidationError({ update: 'At least one field must change' })
			}

			const updated = await this.persistVersionedUpdate(
				tx,
				actor,
				current,
				expectedVersion,
				updates
			)

			if (input.visibilityGroupIds !== undefined) {
				await tx
					.delete(timerboardEntryVisibilityGroups)
					.where(eq(timerboardEntryVisibilityGroups.entryId, entryId))
				if (input.visibilityGroupIds.length > 0) {
					await tx
						.insert(timerboardEntryVisibilityGroups)
						.values(input.visibilityGroupIds.map((groupId) => ({ entryId, groupId })))
				}
			}
			if (updated.sharingEnabled || current.sharingEnabled) {
				await tx.insert(timerboardSyncOutbox).values({
					entryId,
					operation: updated.sharingEnabled ? 'upsert' : 'delete',
					version: updated.version,
					payload: { entryId, destinations: updated.shareDestinations },
				})
			}

			await tx
				.insert(timerboardActivity)
				.values({
					entryId,
					actorUserId: actor.userId,
					action: 'updated',
					payload: { changes },
				})
				.returning()

			return serializeEntry(updated, actor)
		})()
		this.readCache.clear()
		return updatedEntry
	}

	async setState(
		actor: TimerboardActor,
		entryId: string,
		state: TimerboardState,
		expectedVersion: number
	): Promise<TimerboardEntry> {
		const updatedEntry = await (async () => {
			const tx = this.db
			const current = await tx.query.timerboardEntries.findFirst({
				where: (table, { eq }) => eq(table.id, entryId),
			})
			if (!current) throw new TimerboardNotFoundError()
			await this.assertVisible(actor, current)
			const ownsEditableEntry = canEdit(actor) && current.createdByUserId === actor.userId
			if (!canManage(actor) && !ownsEditableEntry) throw new TimerboardForbiddenError()
			if (!canManage(actor) && !['covered', 'completed'].includes(state)) {
				throw new TimerboardForbiddenError()
			}
			if (current.version !== expectedVersion) {
				this.readCache.clear()
				throw new TimerboardConflictError(serializeEntry(current, actor))
			}
			if (current.state === state) {
				throw new TimerboardValidationError({ state: `Timer is already ${state}` })
			}
			if (!allowedStateTransitions[current.state].includes(state)) {
				throw new TimerboardValidationError({
					state: `Cannot transition a ${current.state} timer to ${state}`,
				})
			}

			const updated = await this.persistVersionedUpdate(tx, actor, current, expectedVersion, {
				state,
			})

			await tx
				.insert(timerboardActivity)
				.values({
					entryId,
					actorUserId: actor.userId,
					action: state === 'cancelled' ? 'cancelled' : 'state_changed',
					payload: { previous: current.state, next: state },
				})
				.returning()

			return serializeEntry(updated, actor)
		})()
		this.readCache.clear()
		return updatedEntry
	}

	async assign(
		actor: TimerboardActor,
		entryId: string,
		assignment: TimerboardAssignment,
		expectedVersion: number
	): Promise<TimerboardEntry> {
		if (!canManage(actor)) throw new TimerboardForbiddenError()
		validateAssignment(assignment)
		if (
			assignment.userId === null &&
			(assignment.characterId !== null || assignment.characterName !== null)
		) {
			throw new TimerboardValidationError({
				assignment: 'Character assignment requires an assigned user',
			})
		}

		const updatedEntry = await (async () => {
			const tx = this.db
			const current = await tx.query.timerboardEntries.findFirst({
				where: (table, { eq }) => eq(table.id, entryId),
			})
			if (!current) throw new TimerboardNotFoundError()
			await this.assertVisible(actor, current)
			if (current.version !== expectedVersion) {
				this.readCache.clear()
				throw new TimerboardConflictError(serializeEntry(current, actor))
			}
			if (
				current.assignedUserId === assignment.userId &&
				current.assignedCharacterId === assignment.characterId &&
				current.assignedCharacterName === assignment.characterName
			) {
				throw new TimerboardValidationError({ assignment: 'Assignment must change' })
			}

			const updated = await this.persistVersionedUpdate(tx, actor, current, expectedVersion, {
				assignedUserId: assignment.userId,
				assignedCharacterId: assignment.characterId,
				assignedCharacterName: assignment.characterName,
			})

			await tx
				.insert(timerboardActivity)
				.values({
					entryId,
					actorUserId: actor.userId,
					action: 'assigned',
					payload: {
						previous: {
							userId: current.assignedUserId,
							characterId: current.assignedCharacterId,
							characterName: current.assignedCharacterName,
						},
						next: assignment,
					},
				})
				.returning()

			return serializeEntry(updated, actor)
		})()
		this.readCache.clear()
		return updatedEntry
	}
}
