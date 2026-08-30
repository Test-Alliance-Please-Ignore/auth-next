import { Hono } from 'hono'
import { z } from 'zod'

import {
	TIMERBOARD_KINDS,
	TIMERBOARD_PRIORITIES,
	TIMERBOARD_SIDES,
	TIMERBOARD_STATES,
} from '@repo/core'

import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAuth } from '../middleware/session'
import {
	TimerboardConflictError,
	TimerboardForbiddenError,
	TimerboardNotFoundError,
	TimerboardService,
	TimerboardValidationError,
} from '../services/timerboard.service'

import type { Context } from 'hono'
import type { App } from '../context'
import type { TimerboardActor } from '../services/timerboard.service'

const app = new Hono<App>()
const timerboardCacheScope = {}

app.use('*', requireAuth())

const timerKindSchema = z.enum(TIMERBOARD_KINDS)
const prioritySchema = z.enum(TIMERBOARD_PRIORITIES)
const sideSchema = z.enum(TIMERBOARD_SIDES)
const stateSchema = z.enum(TIMERBOARD_STATES)
const utcInstantSchema = z.string().datetime({ offset: false })
const nullableEveIdSchema = z.string().trim().regex(/^\d+$/).max(32).nullable()
const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable()

const createEntrySchema = z.object({
	kind: timerKindSchema,
	title: z.string().trim().min(1).max(160),
	priority: prioritySchema.default('normal'),
	side: sideSchema.default('unknown'),
	startsAt: utcInstantSchema,
	endsAt: utcInstantSchema.nullable().default(null),
	systemId: nullableEveIdSchema.default(null),
	systemName: nullableText(120).default(null),
	entityId: nullableEveIdSchema.default(null),
	entityType: nullableText(80).default(null),
	entityName: nullableText(160).default(null),
	notes: nullableText(2000).default(null),
})

const updateEntrySchema = createEntrySchema.partial().extend({
	expectedVersion: z.number().int().min(1),
})
const stateCommandSchema = z.object({
	state: stateSchema,
	expectedVersion: z.number().int().min(1),
})
const assignmentCommandSchema = z.object({
	userId: z.string().uuid().nullable(),
	characterId: nullableEveIdSchema.default(null),
	characterName: nullableText(255).default(null),
	expectedVersion: z.number().int().min(1),
})
const entryIdSchema = z.string().uuid()

const listQuerySchema = z.object({
	state: z.string().optional(),
	kind: timerKindSchema.optional(),
	priority: prioritySchema.optional(),
	side: sideSchema.optional(),
	system: z.string().trim().min(1).max(120).optional(),
	assignedToMe: z.enum(['true', 'false']).optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
const assignmentCandidateQuerySchema = z.object({
	search: z.string().trim().min(2).max(80),
	limit: z.coerce.number().int().min(1).max(50).default(20),
})

async function resolveActor(c: Context<App>): Promise<TimerboardActor> {
	const user = c.get('user')
	if (!user) throw new Error('Authenticated route has no user')
	const permissions = await getCachedUserPermissions(c.env, user.id)
	return {
		userId: user.id,
		isAdmin: user.is_admin,
		permissionUrns: permissions.map((permission) => permission.urn),
	}
}

function mapTimerboardError(c: Context<App>, error: unknown): Response {
	if (error instanceof TimerboardValidationError) {
		return c.json({ error: error.message, fields: error.fields }, 400)
	}
	if (error instanceof TimerboardForbiddenError) return c.json({ error: 'Forbidden' }, 403)
	if (error instanceof TimerboardNotFoundError) return c.json({ error: error.message }, 404)
	if (error instanceof TimerboardConflictError) {
		return c.json({ error: error.message, current: error.current }, 409)
	}
	throw error
}

async function parseJson(c: Context<App>): Promise<unknown> {
	try {
		return await c.req.json()
	} catch {
		throw new TimerboardValidationError({ body: 'Request body must be valid JSON' })
	}
}

app.get('/', async (c) => {
	const parsed = listQuerySchema.safeParse(c.req.query())
	if (!parsed.success) {
		return c.json({ error: 'Invalid query', issues: parsed.error.issues }, 400)
	}
	const states = parsed.data.state?.split(',').map((value) => stateSchema.safeParse(value))
	if (states?.some((state) => !state.success)) {
		return c.json({ error: 'Invalid query', fields: { state: 'Invalid timer state' } }, 400)
	}
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	try {
		const actor = await resolveActor(c)
		const service = new TimerboardService(db, timerboardCacheScope)
		return c.json(
			await service.list(actor, {
				...parsed.data,
				states: states?.map((state) => state.data!),
				assignedToMe: parsed.data.assignedToMe === 'true',
			})
		)
	} catch (error) {
		return mapTimerboardError(c, error)
	}
})

app.post('/', async (c) => {
	try {
		const parsed = createEntrySchema.safeParse(await parseJson(c))
		if (!parsed.success) {
			return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
		}
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not available' }, 500)
		const actor = await resolveActor(c)
		const service = new TimerboardService(db, timerboardCacheScope)
		return c.json(await service.create(actor, parsed.data), 201)
	} catch (error) {
		return mapTimerboardError(c, error)
	}
})

app.get('/assignment-candidates', async (c) => {
	const parsed = assignmentCandidateQuerySchema.safeParse(c.req.query())
	if (!parsed.success) {
		return c.json({ error: 'Invalid query', issues: parsed.error.issues }, 400)
	}
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	try {
		const actor = await resolveActor(c)
		return c.json(
			await new TimerboardService(db, timerboardCacheScope).searchAssignmentCandidates(
				actor,
				parsed.data.search,
				parsed.data.limit
			)
		)
	} catch (error) {
		return mapTimerboardError(c, error)
	}
})

app.get('/:entryId', async (c) => {
	const entryId = entryIdSchema.safeParse(c.req.param('entryId'))
	if (!entryId.success) return c.json({ error: 'Invalid entry id' }, 400)
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	try {
		const actor = await resolveActor(c)
		return c.json(await new TimerboardService(db, timerboardCacheScope).get(actor, entryId.data))
	} catch (error) {
		return mapTimerboardError(c, error)
	}
})

app.patch('/:entryId', async (c) => {
	const entryId = entryIdSchema.safeParse(c.req.param('entryId'))
	if (!entryId.success) return c.json({ error: 'Invalid entry id' }, 400)
	try {
		const parsed = updateEntrySchema.safeParse(await parseJson(c))
		if (!parsed.success) {
			return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
		}
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not available' }, 500)
		const actor = await resolveActor(c)
		const { expectedVersion, ...input } = parsed.data
		return c.json(
			await new TimerboardService(db, timerboardCacheScope).update(
				actor,
				entryId.data,
				input,
				expectedVersion
			)
		)
	} catch (error) {
		return mapTimerboardError(c, error)
	}
})

app.post('/:entryId/state', async (c) => {
	const entryId = entryIdSchema.safeParse(c.req.param('entryId'))
	if (!entryId.success) return c.json({ error: 'Invalid entry id' }, 400)
	try {
		const parsed = stateCommandSchema.safeParse(await parseJson(c))
		if (!parsed.success) {
			return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
		}
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not available' }, 500)
		const actor = await resolveActor(c)
		return c.json(
			await new TimerboardService(db, timerboardCacheScope).setState(
				actor,
				entryId.data,
				parsed.data.state,
				parsed.data.expectedVersion
			)
		)
	} catch (error) {
		return mapTimerboardError(c, error)
	}
})

app.post('/:entryId/assignment', async (c) => {
	const entryId = entryIdSchema.safeParse(c.req.param('entryId'))
	if (!entryId.success) return c.json({ error: 'Invalid entry id' }, 400)
	try {
		const parsed = assignmentCommandSchema.safeParse(await parseJson(c))
		if (!parsed.success) {
			return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
		}
		const db = c.get('db')
		if (!db) return c.json({ error: 'Database not available' }, 500)
		const actor = await resolveActor(c)
		const { expectedVersion, ...assignment } = parsed.data
		return c.json(
			await new TimerboardService(db, timerboardCacheScope).assign(
				actor,
				entryId.data,
				assignment,
				expectedVersion
			)
		)
	} catch (error) {
		return mapTimerboardError(c, error)
	}
})

app.get('/:entryId/activity', async (c) => {
	const entryId = entryIdSchema.safeParse(c.req.param('entryId'))
	if (!entryId.success) return c.json({ error: 'Invalid entry id' }, 400)
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	try {
		const actor = await resolveActor(c)
		return c.json(
			await new TimerboardService(db, timerboardCacheScope).listActivity(actor, entryId.data)
		)
	} catch (error) {
		return mapTimerboardError(c, error)
	}
})

export default app
