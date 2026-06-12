import { Hono } from 'hono'
import { z } from 'zod'

import { hasAllStructureManagerPermission } from '@repo/groups'

import type { StructureListQuery, UpdateStructureConfigInput, UpdateStructureModuleConfigInput } from '@repo/structures'
import type { App } from '../context'

const app = new Hono<App>()

const structureListSortFields = [
	'updatedAt',
	'nextStateAt',
	'fuel',
	'name',
	'corporation',
	'region',
	'system',
	'type',
	'state',
] as const

const structureListQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
	corporationId: z.string().trim().min(1).optional(),
	assignedGroupId: z.string().trim().min(1).optional(),
	lowPower: z.enum(['true', 'false']).optional(),
	lowPowerAllowed: z.enum(['true', 'false']).optional(),
	regionId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	state: z.string().trim().min(1).optional(),
	typeId: z.string().trim().min(1).optional(),
	sortBy: z.enum(structureListSortFields).default('updatedAt'),
	sortDirection: z.enum(['asc', 'desc']).default('desc'),
})

const updateStructureConfigSchema = z.object({
	hidden: z.boolean().optional(),
	lowPowerAllowed: z.boolean().optional(),
	assignedGroupId: z.string().min(1).nullable().optional(),
})

const structureModuleConfigSchema = z.object({
	lowFuelTimeThresholdHours: z.coerce.number().int().min(0).optional(),
	criticalFuelTimeThresholdHours: z.coerce.number().int().min(0).optional(),
	lowFuelAmountThreshold: z.coerce.number().int().min(0).optional(),
	criticalFuelAmountThreshold: z.coerce.number().int().min(0).optional(),
})

function getStructureActor(user: App['Variables']['user']) {
	if (!user) {
		throw new Error('Unauthorized')
	}

	return {
		id: user.id,
		is_admin: user.is_admin,
		roles: user.roles,
	}
}

function canManageStructures(user: App['Variables']['user']): boolean {
	return Boolean(
		user &&
			(user.is_admin ||
				hasAllStructureManagerPermission(user.roles.map((urn) => ({ urn }))))
	)
}

app.get('/', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const query = structureListQuerySchema.parse({
			page: c.req.query('page'),
			pageSize: c.req.query('pageSize'),
			corporationId: c.req.query('corporationId') || undefined,
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			lowPower: c.req.query('lowPower') || undefined,
			lowPowerAllowed: c.req.query('lowPowerAllowed') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			state: c.req.query('state') || undefined,
			typeId: c.req.query('typeId') || undefined,
			sortBy: c.req.query('sortBy') || undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
		}) satisfies StructureListQuery

		return c.json(await c.env.STRUCTURES.listVisibleStructures(getStructureActor(user), query))
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to list structures',
			},
			error instanceof z.ZodError ? 400 : 500
		)
	}
})

app.get('/config', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	if (!canManageStructures(user)) {
		return c.json({ error: 'Requires structures manager permission' }, 403)
	}

	return c.json(await c.env.STRUCTURES.getStructureModuleConfig(getStructureActor(user)))
})

app.patch('/config', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	if (!canManageStructures(user)) {
		return c.json({ error: 'Requires structures manager permission' }, 403)
	}

	try {
		const body = structureModuleConfigSchema.parse(await c.req.json()) satisfies UpdateStructureModuleConfigInput
		return c.json(await c.env.STRUCTURES.updateStructureModuleConfig(getStructureActor(user), body))
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid structure config payload', issues: error.issues }, 400)
		}
		return c.json({ error: 'Failed to update structure configuration' }, 500)
	}
})

app.get('/:structureId', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const structureId = c.req.param('structureId')
	try {
		const structure = await c.env.STRUCTURES.getVisibleStructureDetail(getStructureActor(user), structureId)
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}
		return c.json(structure)
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to load structure detail',
			},
			500
		)
	}
})

app.patch('/:structureId/config', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const structureId = c.req.param('structureId')

	try {
		const body = updateStructureConfigSchema.parse(await c.req.json()) satisfies UpdateStructureConfigInput
		const structure = await c.env.STRUCTURES.updateStructureConfig(getStructureActor(user), structureId, body)
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}
		return c.json(structure)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid structure config payload', issues: error.issues }, 400)
		}
		if (error instanceof Error && error.message.startsWith('Structure group ')) {
			return c.json({ error: error.message }, 400)
		}
		return c.json({ error: 'Failed to update structure config' }, 500)
	}
})

export default app
