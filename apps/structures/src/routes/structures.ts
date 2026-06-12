import { Hono } from 'hono'
import { z } from 'zod'

import { logger } from '@repo/hono-helpers'

import {
	canManageStructureModule,
	getVisibleStructureDetail,
	listVisibleStructures,
	getStructureModuleConfig,
	updateStructureConfig,
	updateStructureModuleConfig,
} from '../services/structures.service'
import { proxyAuthMiddleware } from '../lib/proxy-auth'
import { createDb } from '../db'

import type { App } from '../context'

const app = new Hono<App>()

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

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

app.use('*', proxyAuthMiddleware())

app.get('/', async (c) => {
	const user = c.get('user')!
	const db = createDb(c.env.DATABASE_URL)

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
		})
		const structures = await listVisibleStructures(db, user, query)
		return c.json(structures)
	} catch (error) {
		logger.error('[Structures] Failed to list structures', {
			userId: user.id,
			error: errorMessage(error),
		})
		return c.json({ error: 'Failed to list structures' }, 500)
	}
})

app.get('/config', async (c) => {
	const user = c.get('user')!
	const db = createDb(c.env.DATABASE_URL)
	if (!canManageStructureModule(user)) {
		return c.json({ error: 'Requires structures manager permission' }, 403)
	}
	return c.json(await getStructureModuleConfig(db))
})

app.patch('/config', async (c) => {
	const user = c.get('user')!
	const db = createDb(c.env.DATABASE_URL)
	if (!canManageStructureModule(user)) {
		return c.json({ error: 'Requires structures manager permission' }, 403)
	}

	try {
		const body = structureModuleConfigSchema.parse(await c.req.json())
		const config = await updateStructureModuleConfig(db, {
			lowFuelTimeThresholdHours: body.lowFuelTimeThresholdHours,
			criticalFuelTimeThresholdHours: body.criticalFuelTimeThresholdHours,
			lowFuelAmountThreshold: body.lowFuelAmountThreshold,
			criticalFuelAmountThreshold: body.criticalFuelAmountThreshold,
			updatedBy: user.id,
		})
		return c.json(config)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid structure config payload', issues: error.issues }, 400)
		}
		return c.json({ error: 'Failed to update structure configuration' }, 500)
	}
})

app.get('/:structureId', async (c) => {
	const user = c.get('user')!
	const db = createDb(c.env.DATABASE_URL)
	const structureId = c.req.param('structureId')

	try {
		const structure = await getVisibleStructureDetail(db, user, structureId)
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}

		return c.json(structure)
	} catch (error) {
		logger.error('[Structures] Failed to load structure detail', {
			userId: user.id,
			structureId,
			error: errorMessage(error),
		})
		return c.json({ error: 'Failed to load structure detail' }, 500)
	}
})

app.patch('/:structureId/config', async (c) => {
	const user = c.get('user')!
	const db = createDb(c.env.DATABASE_URL)
	const structureId = c.req.param('structureId')

	try {
		const body = updateStructureConfigSchema.parse(await c.req.json())
		const structure = await updateStructureConfig(db, user, structureId, {
			hidden: body.hidden,
			lowPowerAllowed: body.lowPowerAllowed,
			assignedGroupId: body.assignedGroupId,
			updatedBy: user.id,
		})

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

		logger.error('[Structures] Failed to update structure config', {
			userId: user.id,
			structureId,
			error: errorMessage(error),
		})
		return c.json({ error: 'Failed to update structure config' }, 500)
	}
})

export default app
