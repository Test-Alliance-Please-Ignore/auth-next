import { and, asc, eq, ilike, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { userCharacters, users } from '../../db/schema'
import { requireAuth } from '../../middleware/session'
import { canManageTaxFeature, canReadTaxFeature } from '../../middleware/tax-permissions'
import {
	disposeRpcStub,
	filterAlertsForUser,
	logTaxRouteError,
	parseAuditLogFiltersFromQuery,
	parseIntegerQueryParam,
} from './shared'

import type { Hono } from 'hono'
import type { CorporationTax } from '@repo/corporation-tax'
import type { App } from '../../context'

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function registerCorporationTaxAlertsRoutes(
	app: Hono<App>,
	options: {
		validateDiscordDestinationInput: (
			c: { get: (key: 'db') => App['Variables']['db'] | undefined },
			guildId: string,
			channelId: string
		) => Promise<string | null>
	}
): void {
	/**
	 * GET /corporation-tax/alerts
	 * List alerts globally or scoped by corporation query parameter.
	 */
	app.get('/alerts', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.query('corporationId') || undefined
		const status = c.req.query('status')
		const severity = c.req.query('severity')
		const limit = parseIntegerQueryParam(c.req.query('limit'))
		const offset = parseIntegerQueryParam(c.req.query('offset'))

		if (
			status !== undefined &&
			status !== 'open' &&
			status !== 'acknowledged' &&
			status !== 'resolved'
		) {
			return c.json({ error: "status must be one of 'open', 'acknowledged', or 'resolved'" }, 400)
		}
		if (
			severity !== undefined &&
			severity !== 'critical' &&
			severity !== 'warning' &&
			severity !== 'info'
		) {
			return c.json({ error: "severity must be one of 'critical', 'warning', or 'info'" }, 400)
		}
		if (limit !== undefined && (limit < 1 || limit > 200)) {
			return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
		}
		if (offset !== undefined && offset < 0) {
			return c.json({ error: 'offset must be an integer >= 0' }, 400)
		}

		const canRead = await canManageTaxFeature(c.env, user, corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			try {
				const alerts = await stub.listAlerts({
					corporationId,
					status: status as 'open' | 'acknowledged' | 'resolved' | undefined,
					severity: severity as 'critical' | 'warning' | 'info' | undefined,
					limit,
					offset,
				})
				return c.json(filterAlertsForUser(user, alerts))
			} finally {
				disposeRpcStub(stub)
			}
		} catch (error) {
			logTaxRouteError(c, 'Error listing corporation tax alerts', error, {
				userId: user.id,
				corporationId: corporationId ?? null,
			})
			return c.json({ error: 'Failed to list alerts' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/corporations/:corporationId/alerts
	 * Corporation-scoped alert list.
	 */
	app.get('/corporations/:corporationId/alerts', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.param('corporationId')
		const status = c.req.query('status')
		const severity = c.req.query('severity')
		const limit = parseIntegerQueryParam(c.req.query('limit'))
		const offset = parseIntegerQueryParam(c.req.query('offset'))

		if (
			status !== undefined &&
			status !== 'open' &&
			status !== 'acknowledged' &&
			status !== 'resolved'
		) {
			return c.json({ error: "status must be one of 'open', 'acknowledged', or 'resolved'" }, 400)
		}
		if (
			severity !== undefined &&
			severity !== 'critical' &&
			severity !== 'warning' &&
			severity !== 'info'
		) {
			return c.json({ error: "severity must be one of 'critical', 'warning', or 'info'" }, 400)
		}
		if (limit !== undefined && (limit < 1 || limit > 200)) {
			return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
		}
		if (offset !== undefined && offset < 0) {
			return c.json({ error: 'offset must be an integer >= 0' }, 400)
		}

		const canRead = await canManageTaxFeature(c.env, user, corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			try {
				const alerts = await stub.listAlerts({
					corporationId,
					status: status as 'open' | 'acknowledged' | 'resolved' | undefined,
					severity: severity as 'critical' | 'warning' | 'info' | undefined,
					limit,
					offset,
				})
				return c.json(filterAlertsForUser(user, alerts))
			} finally {
				disposeRpcStub(stub)
			}
		} catch (error) {
			logTaxRouteError(c, 'Error listing corporation-scoped tax alerts', error, {
				userId: user.id,
				corporationId,
			})
			return c.json({ error: 'Failed to list corporation alerts' }, 500)
		}
	})

	/**
	 * POST /corporation-tax/alerts/:alertId/acknowledge
	 * Acknowledge alert (auditor/admin).
	 */
	app.post('/alerts/:alertId/acknowledge', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const canAcknowledge = await canManageTaxFeature(c.env, user)
		if (!canAcknowledge) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const updated = await stub.acknowledgeAlert(user.id, c.req.param('alertId'))
			return c.json(updated)
		} catch (error) {
			if (error instanceof Error && error.message === 'Alert not found') {
				return c.json({ error: 'Alert not found' }, 404)
			}
			logTaxRouteError(c, 'Error acknowledging tax alert', error, { userId: user.id })
			return c.json({ error: 'Failed to acknowledge alert' }, 500)
		}
	})

	/**
	 * POST /corporation-tax/alerts/:alertId/resolve
	 * Resolve alert (admin).
	 */
	app.post('/alerts/:alertId/resolve', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const canResolve = await canManageTaxFeature(c.env, user)
		if (!canResolve) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const updated = await stub.resolveAlert(user.id, c.req.param('alertId'))
			return c.json(updated)
		} catch (error) {
			if (error instanceof Error && error.message === 'Alert not found') {
				return c.json({ error: 'Alert not found' }, 404)
			}
			logTaxRouteError(c, 'Error resolving tax alert', error, { userId: user.id })
			return c.json({ error: 'Failed to resolve alert' }, 500)
		}
	})

	/**
	 * POST /corporation-tax/alerts/retry-failed-deliveries
	 * Retry failed Discord worker invocation deliveries.
	 */
	app.post('/alerts/retry-failed-deliveries', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		if (!user.is_admin) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		let body: Record<string, unknown> = {}
		try {
			body = await c.req.json()
		} catch {
			// optional body
		}
		const limit =
			typeof body.limit === 'number' && Number.isInteger(body.limit) ? body.limit : undefined
		if (limit !== undefined && (limit < 1 || limit > 100)) {
			return c.json({ error: 'limit must be an integer between 1 and 100' }, 400)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const retried = await stub.retryFailedAlertDeliveries(user.id, limit)
			return c.json({ retried })
		} catch (error) {
			logTaxRouteError(c, 'Error retrying failed tax alert deliveries', error, {
				userId: user.id,
			})
			return c.json({ error: 'Failed to retry alert deliveries' }, 500)
		}
	})

	/**
	 * PUT /corporation-tax/notification-destinations
	 * Upsert global Discord notification destination.
	 */
	app.put('/notification-destinations', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		let body: Record<string, unknown>
		try {
			body = await c.req.json()
		} catch {
			return c.json({ error: 'Invalid JSON payload' }, 400)
		}

		const guildId = typeof body.guildId === 'string' ? body.guildId : ''
		const channelId = typeof body.channelId === 'string' ? body.channelId : ''
		const name = typeof body.name === 'string' ? body.name.trim() : ''

		if (!name || !guildId || !channelId) {
			return c.json({ error: 'name, guildId and channelId are required' }, 400)
		}
		if (name.length > 120) {
			return c.json({ error: 'name must be 120 characters or fewer' }, 400)
		}

		const destinationValidationError = await options.validateDiscordDestinationInput(
			c,
			guildId,
			channelId
		)
		if (destinationValidationError) {
			return c.json({ error: destinationValidationError }, 400)
		}

		const canManage = await canManageTaxFeature(c.env, user)
		if (!canManage) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const destination = await stub.upsertNotificationDestination(user.id, {
				name,
				guildId,
				channelId,
			})
			return c.json(destination)
		} catch (error) {
			logTaxRouteError(c, 'Error upserting tax notification destination', error, {
				userId: user.id,
			})
			return c.json({ error: 'Failed to upsert notification destination' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/notification-destinations
	 * List global Discord notification destination.
	 */
	app.get('/notification-destinations', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const limit = parseIntegerQueryParam(c.req.query('limit'))
		const offset = parseIntegerQueryParam(c.req.query('offset'))

		if (limit !== undefined && (limit < 1 || limit > 200)) {
			return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
		}
		if (offset !== undefined && offset < 0) {
			return c.json({ error: 'offset must be an integer >= 0' }, 400)
		}

		const canRead = await canManageTaxFeature(c.env, user)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const destinations = await stub.listNotificationDestinations({
				limit,
				offset,
			})
			return c.json(destinations)
		} catch (error) {
			logTaxRouteError(c, 'Error listing tax notification destinations', error, {
				userId: user.id,
			})
			return c.json({ error: 'Failed to list notification destinations' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/audit-log
	 * List tax audit log records.
	 */
	app.get('/audit-log', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const parsed = parseAuditLogFiltersFromQuery(c.req)
		if (parsed.error) {
			return c.json({ error: parsed.error }, 400)
		}

		const filters = parsed.filters ?? {}
		const canRead = await canManageTaxFeature(c.env, user, filters.corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const entries = await stub.listAuditLog(filters)
			return c.json(entries)
		} catch (error) {
			logTaxRouteError(c, 'Error listing tax audit log', error, { userId: user.id })
			return c.json({ error: 'Failed to list tax audit log' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/audit-actors
	 * Resolve actor user IDs to display names and support actor search.
	 */
	app.get('/audit-actors', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.query('corporationId') || undefined
		const canRead = await canReadTaxFeature(c.env, user, corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database unavailable' }, 500)
		}

		const q = c.req.query('q')?.trim()
		const idsParam = c.req.query('ids')?.trim()
		const limit = parseIntegerQueryParam(c.req.query('limit'))
		if (limit !== undefined && (limit < 1 || limit > 100)) {
			return c.json({ error: 'limit must be an integer between 1 and 100' }, 400)
		}

		const ids = Array.from(
			new Set(
				(idsParam ?? '')
					.split(',')
					.map((value) => value.trim())
					.filter(Boolean)
			)
		)

		if (!q && ids.length === 0) {
			return c.json([])
		}
		if (q && q.length < 2 && ids.length === 0) {
			return c.json({ error: 'q must be at least 2 characters when ids are not provided' }, 400)
		}

		const conditions = []
		if (ids.length > 0) {
			conditions.push(inArray(users.id, ids))
		}
		if (q) {
			const qConditions = [ilike(userCharacters.characterName, `%${q}%`)]
			if (UUID_V4_REGEX.test(q)) {
				qConditions.push(eq(users.id, q))
			}
			conditions.push(or(...qConditions))
		}

		const where = conditions.length > 0 ? and(...conditions) : undefined

		try {
			const rows = await db
				.select({
					userId: users.id,
					mainCharacterName: userCharacters.characterName,
				})
				.from(users)
				.leftJoin(
					userCharacters,
					and(
						eq(userCharacters.userId, users.id),
						eq(userCharacters.is_primary, true),
						eq(userCharacters.isDeleted, false)
					)
				)
				.where(where)
				.orderBy(asc(userCharacters.characterName), asc(users.id))
				.limit(limit ?? (ids.length > 0 ? Math.min(ids.length, 100) : 25))

			return c.json(
				rows.map((row) => ({
					userId: row.userId,
					name: row.mainCharacterName ?? null,
				}))
			)
		} catch (error) {
			logTaxRouteError(c, 'Error searching tax audit actors', error, {
				userId: user.id,
				corporationId: corporationId ?? null,
			})
			return c.json({ error: 'Failed to search tax audit actors' }, 500)
		}
	})
}
