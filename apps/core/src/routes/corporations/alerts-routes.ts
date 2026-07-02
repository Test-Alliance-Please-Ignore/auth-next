import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'

import { eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'
import { validateAlertDestinationRequirements } from '@repo/alert-destinations'

import { alertDestinations, managedCorporations } from '../../db/schema'
import {
	CORPORATION_ALERT_DESTINATION_TYPES,
	CORPORATION_ALERT_TYPES,
} from '../../lib/corporation-alerts'
import {
	createCorporationAlertDestination,
	deleteCorporationAlertDestination,
	listCorporationAlertDestinations,
	listCorporationAlertTypes,
	updateCorporationAlertDestination,
} from '../../services/corporation-alerts.service'
import { requireAdmin, requireAuth } from '../../middleware/session'

import type { App } from '../../context'

const app = new Hono<App>()

const createAlertDestinationSchema = z.object({
	alertType: z.enum(CORPORATION_ALERT_TYPES),
	destinationType: z.enum(CORPORATION_ALERT_DESTINATION_TYPES),
	discordServerId: z.string().min(1).optional().nullable(),
	channelId: z.string().min(1).optional().nullable(),
	coreUserId: z.string().min(1).optional().nullable(),
	groupId: z.string().min(1).optional().nullable(),
	destinationConfig: z.record(z.string(), z.unknown()).optional(),
	isEnabled: z.boolean().optional(),
})

const updateAlertDestinationSchema = createAlertDestinationSchema.partial()

async function getManagedCorporationOrThrow(
	corporationId: string,
	db: NonNullable<Context<App>['var']['db']>
) {
	const corporation = await db.query.managedCorporations.findFirst({
		where: eq(managedCorporations.corporationId, corporationId),
		columns: {
			corporationId: true,
		},
	})

	return corporation
}

/**
 * GET /alerts/types
 * Return the registry of supported alert types.
 */
app.get('/alerts/types', requireAuth(), requireAdmin(), async (c) => {
	return c.json(listCorporationAlertTypes())
})

/**
 * GET /:corporationId/alerts
 * List alert destinations for a corporation.
 */
app.get('/:corporationId/alerts', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const corporation = await getManagedCorporationOrThrow(corporationId, db)
		if (!corporation) {
			return c.json({ error: 'Corporation not found' }, 404)
		}

		const destinations = await listCorporationAlertDestinations(db, corporationId)
		return c.json(destinations)
	} catch (error) {
		logger.error('[Corporations] Failed to list alert destinations', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to fetch alert destinations' }, 500)
	}
})

/**
 * POST /:corporationId/alerts
 * Create a new alert destination for a corporation.
 */
app.post('/:corporationId/alerts', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const corporation = await getManagedCorporationOrThrow(corporationId, db)
		if (!corporation) {
			return c.json({ error: 'Corporation not found' }, 404)
		}

		const body = createAlertDestinationSchema.parse(await c.req.json())

		if (body.destinationType === 'discord_channel') {
			if (!body.discordServerId || !body.channelId) {
				return c.json(
					{ error: 'discordServerId and channelId are required for discord_channel destinations' },
					400
				)
			}
		}

		if (body.destinationType === 'discord_user' && !body.coreUserId) {
			return c.json({ error: 'coreUserId is required for discord_user destinations' }, 400)
		}

		if (body.destinationType === 'group' && !body.groupId) {
			return c.json({ error: 'groupId is required for group destinations' }, 400)
		}

		const destinationValidationError = validateAlertDestinationRequirements({
			destinationType: body.destinationType,
			discordServerId: body.discordServerId,
			channelId: body.channelId,
			coreUserId: body.coreUserId,
			groupId: body.groupId,
			destinationConfig: body.destinationConfig,
		})
		if (destinationValidationError) {
			return c.json({ error: destinationValidationError }, 400)
		}

		const destination = await createCorporationAlertDestination(db, {
			corporationId,
			alertType: body.alertType,
			destinationType: body.destinationType,
			discordServerId: body.discordServerId ?? null,
			channelId: body.channelId ?? null,
			coreUserId: body.coreUserId ?? null,
			groupId: body.groupId ?? null,
			destinationConfig: body.destinationConfig,
			isEnabled: body.isEnabled,
			createdBy: user.id,
			updatedBy: user.id,
		})

		return c.json(destination, 201)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid alert destination payload', issues: error.issues }, 400)
		}

		if (error instanceof Error && error.message.startsWith('Unsupported alert')) {
			return c.json({ error: error.message }, 400)
		}

		if (error instanceof Error && error.message.includes('webhookUrl')) {
			return c.json({ error: error.message }, 400)
		}

		logger.error('[Corporations] Failed to create alert destination', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to create alert destination' },
			500
		)
	}
})

/**
 * PUT /:corporationId/alerts/:destinationId
 * Update an existing alert destination.
 */
app.put('/:corporationId/alerts/:destinationId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const destinationId = c.req.param('destinationId')
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const corporation = await getManagedCorporationOrThrow(corporationId, db)
		if (!corporation) {
			return c.json({ error: 'Corporation not found' }, 404)
		}

		const existing = await db.query.alertDestinations.findFirst({
			where: (fields, { and, eq }) =>
				and(
					eq(fields.id, destinationId),
					eq(fields.scopeType, 'corporation'),
					eq(fields.scopeId, corporationId)
				),
			columns: {
				destinationType: true,
				discordServerId: true,
				channelId: true,
				coreUserId: true,
				groupId: true,
				destinationConfig: true,
			},
		})

		if (!existing) {
			return c.json({ error: 'Alert destination not found' }, 404)
		}

		const body = updateAlertDestinationSchema.parse(await c.req.json())

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

		const destinationValidationError = validateAlertDestinationRequirements({
			destinationType: body.destinationType ?? 'discord_channel',
			discordServerId: body.discordServerId ?? existing.discordServerId,
			channelId: body.channelId ?? existing.channelId,
			coreUserId: body.coreUserId ?? existing.coreUserId,
			groupId: body.groupId ?? existing.groupId,
			destinationConfig: body.destinationConfig ?? existing.destinationConfig,
		})
		if (destinationValidationError) {
			return c.json({ error: destinationValidationError }, 400)
		}

		const destination = await updateCorporationAlertDestination(db, corporationId, destinationId, {
			alertType: body.alertType,
			destinationType: body.destinationType,
			discordServerId: body.discordServerId,
			channelId: body.channelId,
			coreUserId: body.coreUserId,
			groupId: body.groupId,
			destinationConfig: body.destinationConfig,
			isEnabled: body.isEnabled,
			updatedBy: user.id,
		})

		return c.json(destination)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid alert destination payload', issues: error.issues }, 400)
		}

		if (error instanceof Error && error.message.startsWith('Unsupported alert')) {
			return c.json({ error: error.message }, 400)
		}

		if (error instanceof Error && error.message.includes('webhookUrl')) {
			return c.json({ error: error.message }, 400)
		}

		if (error instanceof Error && error.message === 'Alert destination not found') {
			return c.json({ error: error.message }, 404)
		}

		logger.error('[Corporations] Failed to update alert destination', {
			corporationId,
			destinationId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to update alert destination' },
			500
		)
	}
})

/**
 * DELETE /:corporationId/alerts/:destinationId
 * Remove an alert destination.
 */
app.delete('/:corporationId/alerts/:destinationId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const destinationId = c.req.param('destinationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const corporation = await getManagedCorporationOrThrow(corporationId, db)
		if (!corporation) {
			return c.json({ error: 'Corporation not found' }, 404)
		}

		await deleteCorporationAlertDestination(db, corporationId, destinationId)
		return c.json({ success: true })
	} catch (error) {
		if (error instanceof Error && error.message === 'Alert destination not found') {
			return c.json({ error: error.message }, 404)
		}

		logger.error('[Corporations] Failed to delete alert destination', {
			corporationId,
			destinationId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to delete alert destination' }, 500)
	}
})

export default app
