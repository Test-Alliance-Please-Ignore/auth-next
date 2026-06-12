import { Hono } from 'hono'
import { z } from 'zod'

import { and, eq } from '@repo/db-utils'

import {
	createAlertDestination,
	deleteAlertDestination,
	listAlertDestinations,
	updateAlertDestination,
} from '../../services/alert-destinations.service'
import {
	deleteStructureGroupSetting,
	deleteStructureGroupAlertConfig,
	assertStructureGroupConfigured,
	listStructureCorporationGroupDefaults,
	listStructureGroupAlertConfigs,
	listStructureGroupSettings,
	upsertStructureCorporationGroupDefault,
	upsertStructureGroupAlertConfig,
	upsertStructureGroupSetting,
} from '../../services/structures.service'
import {
	STRUCTURE_ALERT_TYPE_DEFINITIONS,
	STRUCTURE_ALERT_TYPES,
} from '../../lib/structure-alerts'
import { proxyAuthMiddleware, requireProxyAdmin } from '../../lib/proxy-auth'
import { createDb } from '../../db'
import { structureGroupAlertConfigs } from '../../db/schema'
import { STRUCTURE_STATE_CHOICES } from '@repo/structure-states'

import type { App } from '../../context'
import type { AlertDestinationType } from '../../lib/alert-routing'

const app = new Hono<App>()

const destinationTypeSchema = z.enum(['discord_channel', 'discord_user', 'group'])

const groupSettingSchema = z.object({}).strict()

const corporationDefaultSchema = z.object({
	groupId: z.string().min(1).nullable(),
})

const alertDestinationSchema = z.object({
	alertType: z.enum(STRUCTURE_ALERT_TYPES),
	destinationType: destinationTypeSchema,
	discordServerId: z.string().min(1).nullable().optional(),
	channelId: z.string().min(1).nullable().optional(),
	coreUserId: z.string().min(1).nullable().optional(),
	groupId: z.string().min(1).nullable().optional(),
	destinationConfig: z.record(z.string(), z.unknown()).optional(),
	isEnabled: z.boolean().optional(),
})

const alertConfigSchema = z.object({
	alertType: z.enum(STRUCTURE_ALERT_TYPES),
	destinationIds: z.array(z.string().min(1)),
	isEnabled: z.boolean().optional(),
	config: z
		.object({
			stateTransitions: z.array(z.enum(STRUCTURE_STATE_CHOICES)).optional(),
		})
		.optional(),
})

app.use('*', proxyAuthMiddleware(), requireProxyAdmin())

app.get('/', async (c) => {
	return c.json({ status: 'ok', section: 'admin-structures' })
})

app.get('/alert-types', async (c) => {
	return c.json(STRUCTURE_ALERT_TYPE_DEFINITIONS)
})

app.get('/group-settings', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	return c.json(await listStructureGroupSettings(db))
})

app.patch('/group-settings/:groupId', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const groupId = c.req.param('groupId')
	groupSettingSchema.parse(await c.req.json())
	const row = await upsertStructureGroupSetting(db, {
		groupId,
		updatedBy: c.get('user')!.id,
	})
	return c.json(row)
})

app.delete('/group-settings/:groupId', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const groupId = c.req.param('groupId')
	const deleted = await deleteStructureGroupSetting(db, { groupId })
	if (!deleted) {
		return c.json({ error: 'Structure group setting not found' }, 404)
	}
	return c.json({ success: true })
})

app.get('/corporation-defaults', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	return c.json(await listStructureCorporationGroupDefaults(db))
})

app.patch('/corporation-defaults/:corporationId', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const corporationId = c.req.param('corporationId')
	const body = corporationDefaultSchema.parse(await c.req.json())
	if (body.groupId) {
		await assertStructureGroupConfigured(db, body.groupId)
	}
	const row = await upsertStructureCorporationGroupDefault(db, {
		corporationId,
		groupId: body.groupId,
		updatedBy: c.get('user')!.id,
	})
	return c.json(row)
})

app.get('/groups/:groupId/destinations', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const groupId = c.req.param('groupId')
	return c.json(await listAlertDestinations(db, 'structure_group', groupId))
})

app.post('/groups/:groupId/destinations', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const scopeGroupId = c.req.param('groupId')
	await assertStructureGroupConfigured(db, scopeGroupId)
	const body = alertDestinationSchema.parse(await c.req.json())

	if (body.destinationType === 'discord_channel' && (!body.discordServerId || !body.channelId)) {
		return c.json({ error: 'discordServerId and channelId are required for discord_channel destinations' }, 400)
	}
	if (body.destinationType === 'discord_user' && !body.coreUserId) {
		return c.json({ error: 'coreUserId is required for discord_user destinations' }, 400)
	}
	if (body.destinationType === 'group' && !body.groupId) {
		return c.json({ error: 'groupId is required for group destinations' }, 400)
	}

	const destination = await createAlertDestination(db, {
		scopeType: 'structure_group',
		scopeId: scopeGroupId,
		alertType: body.alertType,
		destinationType: body.destinationType as AlertDestinationType,
		discordServerId: body.discordServerId ?? null,
		channelId: body.channelId ?? null,
		coreUserId: body.coreUserId ?? null,
		groupId: body.groupId ?? null,
		destinationConfig: body.destinationConfig,
		isEnabled: body.isEnabled,
		createdBy: c.get('user')!.id,
		updatedBy: c.get('user')!.id,
	})

	return c.json(destination, 201)
})

app.put('/groups/:groupId/destinations/:destinationId', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const groupId = c.req.param('groupId')
	const destinationId = c.req.param('destinationId')
	await assertStructureGroupConfigured(db, groupId)
	const body = alertDestinationSchema.partial().parse(await c.req.json())

	if (body.destinationType === 'discord_channel') {
		if (body.discordServerId !== undefined && body.discordServerId === null) {
			return c.json({ error: 'discordServerId cannot be cleared for discord_channel destinations' }, 400)
		}
		if (body.channelId !== undefined && body.channelId === null) {
			return c.json({ error: 'channelId cannot be cleared for discord_channel destinations' }, 400)
		}
	}
	if (body.destinationType === 'discord_user' && body.coreUserId !== undefined && body.coreUserId === null) {
		return c.json({ error: 'coreUserId cannot be cleared for discord_user destinations' }, 400)
	}

	const destination = await updateAlertDestination(db, 'structure_group', groupId, destinationId, {
		alertType: body.alertType,
		destinationType: body.destinationType,
		discordServerId: body.discordServerId,
		channelId: body.channelId,
		coreUserId: body.coreUserId,
		groupId: body.groupId,
		destinationConfig: body.destinationConfig,
		isEnabled: body.isEnabled,
		updatedBy: c.get('user')!.id,
	})

	return c.json(destination)
})

app.delete('/groups/:groupId/destinations/:destinationId', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const groupId = c.req.param('groupId')
	const destinationId = c.req.param('destinationId')
	await deleteAlertDestination(db, 'structure_group', groupId, destinationId)
	return c.json({ success: true })
})

app.get('/groups/:groupId/alert-configs', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const groupId = c.req.param('groupId')
	await assertStructureGroupConfigured(db, groupId)
	return c.json(await listStructureGroupAlertConfigs(db, groupId))
})

app.post('/groups/:groupId/alert-configs', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const groupId = c.req.param('groupId')
	await assertStructureGroupConfigured(db, groupId)
	const body = alertConfigSchema.parse(await c.req.json())
	const row = await upsertStructureGroupAlertConfig(db, {
		groupId,
		alertType: body.alertType,
		destinationIds: body.destinationIds,
		config: body.config ?? {},
		isEnabled: body.isEnabled ?? true,
	})
	return c.json(row, 201)
})

app.put('/groups/:groupId/alert-configs/:configId', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const groupId = c.req.param('groupId')
	const configId = c.req.param('configId')
	await assertStructureGroupConfigured(db, groupId)
	const body = alertConfigSchema.partial().parse(await c.req.json())
	const existing = await db.query.structureGroupAlertConfigs.findFirst({
		where: and(eq(structureGroupAlertConfigs.id, configId), eq(structureGroupAlertConfigs.groupId, groupId)),
	})
	if (!existing) {
		return c.json({ error: 'Structure alert config not found' }, 404)
	}

	const row = await upsertStructureGroupAlertConfig(db, {
		id: configId,
		groupId,
		alertType: body.alertType ?? existing.alertType,
		destinationIds: body.destinationIds ?? existing.destinationIds,
		config: body.config ?? existing.config,
		isEnabled: body.isEnabled ?? existing.isEnabled,
	})
	return c.json(row)
})

app.delete('/groups/:groupId/alert-configs/:configId', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const groupId = c.req.param('groupId')
	const configId = c.req.param('configId')
	await deleteStructureGroupAlertConfig(db, groupId, configId)
	return c.json({ success: true })
})

export default app
