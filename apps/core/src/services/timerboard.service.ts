import { getTableColumns } from 'drizzle-orm'

import { TIMERBOARD_PERMISSION_URNS } from '@repo/core'
import { and, asc, eq, gte, ilike, inArray, lte, sql } from '@repo/db-utils'
import { parseDateOrNull } from '@repo/worker-utils'

import { timerboardActivity, timerboardEntries, userCharacters } from '../db/schema'

import type {
	CreateTimerboardEntryInput,
	TimerboardActivity as TimerboardActivityContract,
	TimerboardAssignmentCandidate,
	TimerboardAssignmentInput,
	TimerboardEntry as TimerboardEntryContract,
	TimerKind,
	TimerPriority,
	TimerSide,
	TimerState,
} from '@repo/core'
import type { createDb } from '../db'

export { TIMERBOARD_PERMISSION_URNS }
export type { CreateTimerboardEntryInput }

export type TimerboardActor = {
	userId: string
	isAdmin: boolean
	permissionUrns: readonly string[]
}

export type UpdateTimerboardEntryInput = Partial<
	Pick<
		CreateTimerboardEntryInput,
		| 'kind'
		| 'title'
		| 'priority'
		| 'side'
		| 'startsAt'
		| 'endsAt'
		| 'systemId'
		| 'systemName'
		| 'entityId'
		| 'entityType'
		| 'entityName'
		| 'notes'
	>
>

export type TimerboardAssignment = Omit<TimerboardAssignmentInput, 'expectedVersion'>

export type TimerboardListQuery = {
	states?: TimerboardState[]
	kind?: TimerKind
	priority?: TimerPriority
	side?: TimerSide
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
type CoreTransaction = Parameters<Parameters<CoreDb['transaction']>[0]>[0]
type TimerboardEntryUpdate = Partial<typeof timerboardEntries.$inferInsert>

type TimerboardEntryBundle = {
	entry: TimerboardEntryRow
	activity: TimerboardActivityWithActor[]
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

function serializeEntry(row: TimerboardEntryRow, actor: TimerboardActor): TimerboardEntry {
	const active = row.state === 'planned' || row.state === 'covered'
	const ownsEditableEntry = canEdit(actor) && row.createdByUserId === actor.userId
	const manages = canManage(actor)
	return {
		...row,
		startsAt: row.startsAt.toISOString(),
		endsAt: row.endsAt?.toISOString() ?? null,
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
		entityType: 80,
		entityName: 160,
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

	for (const field of ['systemId', 'entityId'] as const) {
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

export class TimerboardService {
	private readonly readCache: TimerboardReadCache

	constructor(
		private readonly db: CoreDb,
		cacheScope: object = db
	) {
		this.readCache = getTimerboardReadCache(cacheScope)
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
		if (query.kind) conditions.push(eq(timerboardEntries.kind, query.kind))
		if (query.priority) conditions.push(eq(timerboardEntries.priority, query.priority))
		if (query.side) conditions.push(eq(timerboardEntries.side, query.side))
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
			states: [...states].sort(),
			kind: query.kind ?? null,
			priority: query.priority ?? null,
			side: query.side ?? null,
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

		return {
			items: result.rows.map((row) => serializeEntry(row, actor)),
			page: query.page,
			pageSize: query.pageSize,
			total: result.total,
		}
	}

	async get(actor: TimerboardActor, entryId: string): Promise<TimerboardEntry> {
		if (!canView(actor)) throw new TimerboardForbiddenError()
		const bundle = await this.getEntryBundle(entryId)
		return serializeEntry(bundle.entry, actor)
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
				with: {
					activity: {
						orderBy: (table, { asc }) => asc(table.createdAt),
						with: {
							actor: {
								columns: { id: true },
								with: {
									characters: {
										where: (table, { and, eq }) =>
											and(eq(table.is_primary, true), eq(table.isDeleted, false)),
										columns: { characterName: true },
										limit: 1,
									},
								},
							},
						},
					},
				},
			})
			if (!row) throw new TimerboardNotFoundError()
			const { activity, ...entry } = row
			return { entry, activity }
		})
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

		const startsAt = parseDateOrNull(input.startsAt)
		const endsAt = parseDateOrNull(input.endsAt)
		if (!startsAt) {
			throw new TimerboardValidationError({ startsAt: 'Start time must be a valid UTC instant' })
		}
		if (input.endsAt !== null && !endsAt) {
			throw new TimerboardValidationError({ endsAt: 'End time must be a valid UTC instant' })
		}
		if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
			throw new TimerboardValidationError({
				endsAt: 'End time must be later than start time',
			})
		}

		const created = await this.db.transaction(async (tx) => {
			const [entry] = await tx
				.insert(timerboardEntries)
				.values({
					...input,
					startsAt,
					endsAt,
					state: 'planned',
					sourceKind: 'manual',
					sourceReference: null,
					createdByUserId: actor.userId,
					updatedByUserId: actor.userId,
				})
				.returning()

			if (!entry) throw new Error('Timerboard entry insert returned no row')

			await tx
				.insert(timerboardActivity)
				.values({
					entryId: entry.id,
					actorUserId: actor.userId,
					action: 'created',
					payload: { created: true },
				})
				.returning()

			return serializeEntry(entry, actor)
		})
		this.readCache.clear()
		return created
	}

	async listActivity(actor: TimerboardActor, entryId: string): Promise<TimerboardActivity[]> {
		if (!canView(actor)) throw new TimerboardForbiddenError()
		const bundle = await this.getEntryBundle(entryId)
		return bundle.activity.map(serializeActivity)
	}

	async update(
		actor: TimerboardActor,
		entryId: string,
		input: UpdateTimerboardEntryInput,
		expectedVersion: number
	): Promise<TimerboardEntry> {
		const updatedEntry = await this.db.transaction(async (tx) => {
			const current = await tx.query.timerboardEntries.findFirst({
				where: (table, { eq }) => eq(table.id, entryId),
			})
			if (!current) throw new TimerboardNotFoundError()
			if (!canManage(actor) && !(canEdit(actor) && current.createdByUserId === actor.userId)) {
				throw new TimerboardForbiddenError()
			}
			const serialized = serializeEntry(current, actor)
			if (current.version !== expectedVersion) {
				this.readCache.clear()
				throw new TimerboardConflictError(serialized)
			}
			validateEntryFields(input)

			const startsAt =
				input.startsAt === undefined ? current.startsAt : parseDateOrNull(input.startsAt)
			if (!startsAt) {
				throw new TimerboardValidationError({
					startsAt: 'Start time must be a valid UTC instant',
				})
			}
			const endsAt = input.endsAt === undefined ? current.endsAt : parseDateOrNull(input.endsAt)
			if (input.endsAt !== undefined && input.endsAt !== null && !endsAt) {
				throw new TimerboardValidationError({
					endsAt: 'End time must be a valid UTC instant',
				})
			}
			if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
				throw new TimerboardValidationError({
					endsAt: 'End time must be later than start time',
				})
			}

			const updates = {
				...(input.kind === undefined ? {} : { kind: input.kind }),
				...(input.title === undefined ? {} : { title: input.title }),
				...(input.priority === undefined ? {} : { priority: input.priority }),
				...(input.side === undefined ? {} : { side: input.side }),
				...(input.startsAt === undefined ? {} : { startsAt }),
				...(input.endsAt === undefined ? {} : { endsAt }),
				...(input.systemId === undefined ? {} : { systemId: input.systemId }),
				...(input.systemName === undefined ? {} : { systemName: input.systemName }),
				...(input.entityId === undefined ? {} : { entityId: input.entityId }),
				...(input.entityType === undefined ? {} : { entityType: input.entityType }),
				...(input.entityName === undefined ? {} : { entityName: input.entityName }),
				...(input.notes === undefined ? {} : { notes: input.notes }),
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
		})
		this.readCache.clear()
		return updatedEntry
	}

	async setState(
		actor: TimerboardActor,
		entryId: string,
		state: TimerboardState,
		expectedVersion: number
	): Promise<TimerboardEntry> {
		const updatedEntry = await this.db.transaction(async (tx) => {
			const current = await tx.query.timerboardEntries.findFirst({
				where: (table, { eq }) => eq(table.id, entryId),
			})
			if (!current) throw new TimerboardNotFoundError()
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
		})
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

		const updatedEntry = await this.db.transaction(async (tx) => {
			const current = await tx.query.timerboardEntries.findFirst({
				where: (table, { eq }) => eq(table.id, entryId),
			})
			if (!current) throw new TimerboardNotFoundError()
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
		})
		this.readCache.clear()
		return updatedEntry
	}
}
