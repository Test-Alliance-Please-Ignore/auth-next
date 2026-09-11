import { Hono } from 'hono'
import { z } from 'zod'

import {
	TIMERBOARD_CATEGORIES,
	TIMERBOARD_HOSTILITIES,
	TIMERBOARD_PRIORITIES,
	TIMERBOARD_STATES,
	TIMERBOARD_TYPES,
} from '@repo/core'
import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAuth } from '../middleware/session'

import type { Context } from 'hono'
import type { TimerboardActor, TimerboardWorker } from '@repo/core'
import type { Universe, UniverseOrganization } from '@repo/universe'
import type { App } from '../context'

const app = new Hono<App>().use('*', requireAuth())
const entryIdSchema = z.string().uuid()
const category = z.enum(TIMERBOARD_CATEGORIES)
const timerType = z.enum(TIMERBOARD_TYPES)
const priority = z.enum(TIMERBOARD_PRIORITIES)
const hostility = z.enum(TIMERBOARD_HOSTILITIES)
const state = z.enum(TIMERBOARD_STATES)
const instant = z.string().datetime({ offset: false })
const eveId = z.string().trim().regex(/^\d+$/).max(32).nullable()
const text = (max: number) => z.string().trim().min(1).max(max).nullable()
const destinationRef = z.object({
	adapterKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
	targetKey: z.string().trim().min(1).max(255),
	selectionMeta: z.record(z.string(), z.unknown()).optional(),
})
const entry = z.object({
	category,
	timerType: timerType.default('custom'),
	title: z.string().trim().min(1).max(160),
	priority: priority.default('normal'),
	hostility: hostility.default('unknown'),
	startsAt: instant,
	systemId: eveId.default(null),
	systemName: text(120).default(null),
	regionId: eveId.default(null),
	regionName: text(120).default(null),
	planetId: eveId.default(null),
	planetName: text(120).default(null),
	moonId: eveId.default(null),
	moonName: text(120).default(null),
	corporationId: eveId.default(null),
	corporationName: text(160).default(null),
	allianceId: eveId.default(null),
	allianceName: text(160).default(null),
	subjectId: eveId.default(null),
	subjectType: text(80).default(null),
	subjectName: text(160).default(null),
	notes: text(2000).default(null),
	structureVisibilityEnforced: z.boolean().default(false),
	visibilityGroupIds: z.array(z.string().uuid()).max(100).default([]),
	sharingEnabled: z.boolean().default(false),
	shareDestinations: z.array(destinationRef).max(25).default([]),
})
const update = entry.partial().extend({ expectedVersion: z.number().int().min(1) })
const command = z.object({ state, expectedVersion: z.number().int().min(1) })
const assignment = z.object({
	userId: z.string().uuid().nullable(),
	characterId: eveId.default(null),
	characterName: text(255).default(null),
	expectedVersion: z.number().int().min(1),
})
const list = z.object({
	state: z.string().optional(),
	category: category.optional(),
	timerType: z.string().optional(),
	priority: z.string().optional(),
	hostility: z.string().optional(),
	subjectType: z.string().optional(),
	organization: z.string().optional(),
	system: z.string().trim().min(1).max(120).optional(),
	assignedToMe: z.enum(['true', 'false']).optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
const candidates = z.object({
	search: z.string().trim().min(2).max(80),
	limit: z.coerce.number().int().min(1).max(50).default(20),
})

async function actor(c: Context<App>): Promise<TimerboardActor> {
	const user = c.get('user')
	if (!user) throw new Error('Authenticated route has no user')
	const permissions = await getCachedUserPermissions(c.env, user.id)
	return {
		userId: user.id,
		isAdmin: user.is_admin,
		permissionUrns: permissions.map(({ urn }) => urn),
	}
}
function service(c: Context<App>): TimerboardWorker {
	if (!c.env.TIMERBOARD) throw new Error('Timerboard service binding is not configured')
	return c.env.TIMERBOARD
}
function remoteError(c: Context<App>, error: unknown): Response {
	const value = error as {
		name?: string
		message?: string
		fields?: Record<string, string>
		current?: unknown
	}
	if (value.name === 'TimerboardValidationError')
		return c.json({ error: value.message, fields: value.fields }, 400)
	if (value.name === 'TimerboardForbiddenError') return c.json({ error: 'Forbidden' }, 403)
	if (value.name === 'TimerboardNotFoundError') return c.json({ error: value.message }, 404)
	if (value.name === 'TimerboardConflictError')
		return c.json({ error: value.message, current: value.current }, 409)
	throw error
}
async function body(c: Context<App>): Promise<unknown> {
	try {
		return await c.req.json()
	} catch {
		return null
	}
}

app.get('/', async (c) => {
	const parsed = list.safeParse(c.req.query())
	if (!parsed.success) return c.json({ error: 'Invalid query', issues: parsed.error.issues }, 400)
	const states = parsed.data.state?.split(',').map((value) => state.safeParse(value))
	if (states?.some((value) => !value.success))
		return c.json({ error: 'Invalid query', fields: { state: 'Invalid timer state' } }, 400)
	try {
		const parseList = <T>(value: string | undefined, parser: z.ZodType<T>) => {
			if (!value) return [] as T[]
			const values = value.split(',').map((item) => parser.safeParse(item.trim()))
			return values.every((item) => item.success) ? values.map((item) => item.data as T) : null
		}
		const timerTypes = parseList(parsed.data.timerType, timerType)
		const priorities = parseList(parsed.data.priority, priority)
		const hostilities = parseList(parsed.data.hostility, hostility)
		const subjectTypes = parsed.data.subjectType
			?.split(',')
			.map((item) => item.trim())
			.filter(Boolean)
		const filterOrganizations = parsed.data.organization
			?.split(',')
			.map((item) => item.trim())
			.filter(Boolean)
		if (!timerTypes || !priorities || !hostilities) {
			return c.json({ error: 'Invalid filter value' }, 400)
		}
		const result = await service(c).list(await actor(c), {
			...parsed.data,
			states: states?.map((value) => value.data!),
			timerTypes,
			priorities,
			hostilities,
			subjectTypes,
			organizations: filterOrganizations,
			assignedToMe: parsed.data.assignedToMe === 'true',
		})
		if (!c.env.UNIVERSE) return c.json(result)
		let byId = new Map<string, UniverseOrganization>()
		try {
			const universe = getStub<Universe>(c.env.UNIVERSE, 'default')
			const organizationIds = result.items.flatMap((item) =>
				[item.corporationId, item.allianceId].filter((id): id is string => Boolean(id))
			)
			const hydratedOrganizations = await universe.getOrganizationsByIds(organizationIds)
			byId = new Map(hydratedOrganizations.map((organization) => [organization.id, organization]))
		} catch {
			return c.json(result)
		}
		return c.json({
			...result,
			items: result.items.map((item) => ({
				...item,
				corporationTicker: item.corporationId
					? (byId.get(item.corporationId)?.ticker ?? null)
					: null,
				allianceTicker: item.allianceId ? (byId.get(item.allianceId)?.ticker ?? null) : null,
			})),
		})
	} catch (error) {
		return remoteError(c, error)
	}
})
app.post('/', async (c) => {
	const parsed = entry.safeParse(await body(c))
	if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
	try {
		return c.json(await service(c).create(await actor(c), parsed.data), 201)
	} catch (error) {
		return remoteError(c, error)
	}
})
app.get('/assignment-candidates', async (c) => {
	const parsed = candidates.safeParse(c.req.query())
	if (!parsed.success) return c.json({ error: 'Invalid query', issues: parsed.error.issues }, 400)
	try {
		return c.json(
			await service(c).searchAssignmentCandidates(
				await actor(c),
				parsed.data.search,
				parsed.data.limit
			)
		)
	} catch (error) {
		return remoteError(c, error)
	}
})
app.get('/share-destinations', async (c) => {
	try {
		return c.json(await service(c).listShareDestinations(await actor(c)))
	} catch (error) {
		return remoteError(c, error)
	}
})
app.get('/:entryId', async (c) => {
	const id = entryIdSchema.safeParse(c.req.param('entryId'))
	if (!id.success) return c.json({ error: 'Invalid entry id' }, 400)
	try {
		return c.json(await service(c).get(await actor(c), id.data))
	} catch (error) {
		return remoteError(c, error)
	}
})
app.patch('/:entryId', async (c) => {
	const id = entryIdSchema.safeParse(c.req.param('entryId'))
	const parsed = update.safeParse(await body(c))
	if (!id.success) return c.json({ error: 'Invalid entry id' }, 400)
	if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
	try {
		const { expectedVersion, ...input } = parsed.data
		return c.json(await service(c).update(await actor(c), id.data, input, expectedVersion))
	} catch (error) {
		return remoteError(c, error)
	}
})
app.post('/:entryId/state', async (c) => {
	const id = entryIdSchema.safeParse(c.req.param('entryId'))
	const parsed = command.safeParse(await body(c))
	if (!id.success) return c.json({ error: 'Invalid entry id' }, 400)
	if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
	try {
		return c.json(
			await service(c).setState(
				await actor(c),
				id.data,
				parsed.data.state,
				parsed.data.expectedVersion
			)
		)
	} catch (error) {
		return remoteError(c, error)
	}
})
app.post('/:entryId/assignment', async (c) => {
	const id = entryIdSchema.safeParse(c.req.param('entryId'))
	const parsed = assignment.safeParse(await body(c))
	if (!id.success) return c.json({ error: 'Invalid entry id' }, 400)
	if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
	try {
		const { expectedVersion, ...input } = parsed.data
		return c.json(await service(c).assign(await actor(c), id.data, input, expectedVersion))
	} catch (error) {
		return remoteError(c, error)
	}
})
app.get('/:entryId/activity', async (c) => {
	const id = entryIdSchema.safeParse(c.req.param('entryId'))
	if (!id.success) return c.json({ error: 'Invalid entry id' }, 400)
	try {
		return c.json(await service(c).listActivity(await actor(c), id.data))
	} catch (error) {
		return remoteError(c, error)
	}
})
app.get('/:entryId/destination-sync', async (c) => {
	const id = entryIdSchema.safeParse(c.req.param('entryId'))
	if (!id.success) return c.json({ error: 'Invalid entry id' }, 400)
	try {
		return c.json(await service(c).getTimerDestinationSync(await actor(c), id.data))
	} catch (error) {
		return remoteError(c, error)
	}
})

export default app
