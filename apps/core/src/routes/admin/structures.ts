import { Hono } from 'hono'
import { z } from 'zod'

import { validateAlertDestinationRequirements } from '@repo/alert-destinations'
import { STRUCTURE_ALERT_TYPES } from '@repo/structures'

import type {
	CreateStructureAlertDestinationRequest,
	CreateStructureGroupAlertConfigRequest,
	UpdateStructureAlertDestinationRequest,
	UpdateStructureGroupAlertConfigRequest,
	UpsertStructureCorporationDefaultInput,
	UpsertStructureGroupSettingInput,
} from '@repo/structures'
import type { AlertDestinationType } from '@repo/alert-destinations'
import type { App } from '../../context'

const app = new Hono<App>()

const updateCorporationDefaultSchema = z.object({
	groupId: z.string().trim().min(1).nullable(),
})

const createStructureAlertDestinationSchema = z.object({
	alertType: z.string().trim().min(1),
	destinationType: z.string().trim().min(1),
	discordServerId: z.string().trim().min(1).nullable().optional(),
	channelId: z.string().trim().min(1).nullable().optional(),
	coreUserId: z.string().trim().min(1).nullable().optional(),
	groupId: z.string().trim().min(1).nullable().optional(),
	destinationConfig: z.record(z.string(), z.unknown()).optional(),
	isEnabled: z.boolean().optional(),
})

const updateStructureAlertDestinationSchema = createStructureAlertDestinationSchema.partial()

const createStructureGroupAlertConfigSchema = z.object({
	alertType: z.string().trim().min(1),
	destinationIds: z.array(z.string().trim().min(1)),
	config: z.record(z.string(), z.unknown()).optional(),
	isEnabled: z.boolean().optional(),
})

const updateStructureGroupAlertConfigSchema = createStructureGroupAlertConfigSchema.partial()

function getActor(user: App['Variables']['user']) {
	if (!user) {
		throw new Error('Unauthorized')
	}

	return {
		id: user.id,
		is_admin: user.is_admin,
		roles: user.roles,
	}
}

app.use('*', async (c, next) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	if (!user.is_admin) {
		return c.json({ error: 'Forbidden' }, 403)
	}
	await next()
})

app.get('/alert-types', async (c) => {
	return c.json(STRUCTURE_ALERT_TYPES)
})

app.get('/group-settings', async (c) => {
	const user = c.get('user')
	return c.json(await c.env.STRUCTURES.listStructureGroupSettings(getActor(user)))
})

app.patch('/group-settings/:groupId', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	const input: UpsertStructureGroupSettingInput = { groupId, updatedBy: user!.id }
	return c.json(await c.env.STRUCTURES.upsertStructureGroupSetting(getActor(user), input))
})

app.delete('/group-settings/:groupId', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	await c.env.STRUCTURES.deleteStructureGroupSetting(getActor(user), groupId)
	return c.json({ success: true })
})

app.get('/corporation-defaults', async (c) => {
	const user = c.get('user')
	return c.json(await c.env.STRUCTURES.listStructureCorporationGroupDefaults(getActor(user)))
})

app.patch('/corporation-defaults/:corporationId', async (c) => {
	const user = c.get('user')
	const corporationId = c.req.param('corporationId')
	const body = updateCorporationDefaultSchema.parse(await c.req.json())
	const input: UpsertStructureCorporationDefaultInput = {
		corporationId,
		groupId: body.groupId,
		updatedBy: user!.id,
	}
	return c.json(await c.env.STRUCTURES.upsertStructureCorporationDefault(getActor(user), input))
})

app.get('/groups/:groupId/destinations', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	return c.json(await c.env.STRUCTURES.listStructureGroupAlertDestinations(getActor(user), groupId))
})

app.post('/groups/:groupId/destinations', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	const body = createStructureAlertDestinationSchema.parse(await c.req.json()) satisfies CreateStructureAlertDestinationRequest
	const destinationValidationError = validateAlertDestinationRequirements({
		destinationType: body.destinationType as AlertDestinationType,
		discordServerId: body.discordServerId,
		channelId: body.channelId,
		coreUserId: body.coreUserId,
		groupId: body.groupId,
		destinationConfig: body.destinationConfig,
	})
	if (destinationValidationError) {
		return c.json({ error: destinationValidationError }, 400)
	}
	return c.json(await c.env.STRUCTURES.createStructureAlertDestination(getActor(user), groupId, body))
})

app.put('/groups/:groupId/destinations/:destinationId', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	const destinationId = c.req.param('destinationId')
	const body = updateStructureAlertDestinationSchema.parse(await c.req.json()) satisfies UpdateStructureAlertDestinationRequest
	const existingDestinations = await c.env.STRUCTURES.listStructureGroupAlertDestinations(getActor(user), groupId)
	const existing = Array.isArray(existingDestinations)
		? existingDestinations.find((destination: any) => destination?.id === destinationId)
		: null

	if (!existing) {
		return c.json({ error: 'Alert destination not found' }, 404)
	}

	const destinationValidationError = validateAlertDestinationRequirements({
		destinationType: (body.destinationType ?? existing.destinationType) as AlertDestinationType,
		discordServerId: body.discordServerId ?? existing.discordServerId,
		channelId: body.channelId ?? existing.channelId,
		coreUserId: body.coreUserId ?? existing.coreUserId,
		groupId: body.groupId ?? existing.groupId,
		destinationConfig: body.destinationConfig ?? existing.destinationConfig,
	})
	if (destinationValidationError) {
		return c.json({ error: destinationValidationError }, 400)
	}
	return c.json(
		await c.env.STRUCTURES.updateStructureAlertDestination(getActor(user), groupId, destinationId, body)
	)
})

app.delete('/groups/:groupId/destinations/:destinationId', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	const destinationId = c.req.param('destinationId')
	await c.env.STRUCTURES.deleteStructureAlertDestination(getActor(user), groupId, destinationId)
	return c.json({ success: true })
})

app.get('/groups/:groupId/alert-configs', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	return c.json(await c.env.STRUCTURES.listStructureGroupAlertConfigs(getActor(user), groupId))
})

app.post('/groups/:groupId/alert-configs', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	const body = createStructureGroupAlertConfigSchema.parse(await c.req.json()) satisfies CreateStructureGroupAlertConfigRequest
	return c.json(await c.env.STRUCTURES.createStructureGroupAlertConfig(getActor(user), groupId, body))
})

app.put('/groups/:groupId/alert-configs/:configId', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	const configId = c.req.param('configId')
	const body = updateStructureGroupAlertConfigSchema.parse(await c.req.json()) satisfies UpdateStructureGroupAlertConfigRequest
	return c.json(await c.env.STRUCTURES.updateStructureGroupAlertConfig(getActor(user), groupId, configId, body))
})

app.delete('/groups/:groupId/alert-configs/:configId', async (c) => {
	const user = c.get('user')
	const groupId = c.req.param('groupId')
	const configId = c.req.param('configId')
	await c.env.STRUCTURES.deleteStructureGroupAlertConfig(getActor(user), groupId, configId)
	return c.json({ success: true })
})

export default app
