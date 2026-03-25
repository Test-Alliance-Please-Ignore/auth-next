/**
 * Freight routes - Administrative operations for managing freight routes
 *
 * All endpoints require authentication and admin privileges.
 * These endpoints call the Freight Durable Object via RPC.
 */

import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { TimeCache, logger } from '@repo/hono-helpers'

import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAuth } from '../middleware/session'

import type { Freight } from '@repo/freight'
import type { App } from '../context'

const FREIGHT_MANAGER_URN = 'urn:freight:manager'

/**
 * Permission check cache - 15 second TTL
 */
const permissionCache = new TimeCache<boolean>(15000)

/**
 * Check if a user has the freight manager permission
 */
async function isFreightManager(
	env: { GROUPS: DurableObjectNamespace },
	userId: string,
	isAdmin: boolean
): Promise<boolean> {
	if (isAdmin) return true

	const cacheKey = `${userId}:${FREIGHT_MANAGER_URN}`
	return permissionCache.getOrSet(cacheKey, async () => {
		const permissions = await getCachedUserPermissions(env, userId)
		return permissions.some((p) => p.urn === FREIGHT_MANAGER_URN)
	})
}

const app = new Hono<App>()

/**
 * GET /freight/routes/active
 * List active freight routes (available to all authenticated users)
 */
app.get('/routes/active', requireAuth(), async (c) => {
	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const routes = await stub.listRoutes({ status: 'active' })

		return c.json(routes)
	} catch (error) {
		logger.error('Error listing active freight routes:', error)
		return c.json({ error: 'Failed to list freight routes' }, 500)
	}
})

/**
 * GET /freight/routes
 * List all freight routes with optional status filter (requires freight:manager permission)
 */
app.get('/routes', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const status = c.req.query('status')

		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const routes = await stub.listRoutes({
			status: status as any,
		})

		return c.json(routes)
	} catch (error) {
		logger.error('Error listing freight routes:', error)
		return c.json({ error: 'Failed to list freight routes' }, 500)
	}
})

/**
 * POST /freight/routes
 * Create a new freight route (requires freight:manager permission)
 */
app.post('/routes', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const data = await c.req.json()

		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.createRoute(user.id, data)

		return c.json(route, 201)
	} catch (error) {
		logger.error('Error creating freight route:', error)
		return c.json({ error: 'Failed to create freight route' }, 500)
	}
})

/**
 * GET /freight/routes/:routeId
 * Get a specific freight route (requires freight:manager permission)
 */
app.get('/routes/:routeId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.getRoute(routeId)

		if (!route) {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json(route)
	} catch (error) {
		logger.error('Error getting freight route:', error)
		return c.json({ error: 'Failed to get freight route' }, 500)
	}
})

/**
 * PUT /freight/routes/:routeId
 * Update an existing freight route (requires freight:manager permission)
 */
app.put('/routes/:routeId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const data = await c.req.json()

		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.updateRoute(user.id, routeId, data)

		return c.json(route)
	} catch (error) {
		logger.error('Error updating freight route:', error)

		if (error instanceof Error && error.message === 'Route not found') {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json({ error: 'Failed to update freight route' }, 500)
	}
})

/**
 * POST /freight/routes/:routeId/activate
 * Activate a freight route (requires freight:manager permission)
 */
app.post('/routes/:routeId/activate', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.activateRoute(user.id, routeId)

		return c.json(route)
	} catch (error) {
		logger.error('Error activating freight route:', error)

		if (error instanceof Error && error.message === 'Route not found') {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json({ error: 'Failed to activate freight route' }, 500)
	}
})

/**
 * POST /freight/routes/:routeId/deactivate
 * Deactivate a freight route (requires freight:manager permission)
 */
app.post('/routes/:routeId/deactivate', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.deactivateRoute(user.id, routeId)

		return c.json(route)
	} catch (error) {
		logger.error('Error deactivating freight route:', error)

		if (error instanceof Error && error.message === 'Route not found') {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json({ error: 'Failed to deactivate freight route' }, 500)
	}
})

/**
 * DELETE /freight/routes/:routeId
 * Delete a freight route (requires freight:manager permission)
 */
app.delete('/routes/:routeId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const routeId = c.req.param('routeId')

	if (!(await isFreightManager(c.env, user.id, user.is_admin))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		await stub.deleteRoute(user.id, routeId)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting freight route:', error)

		if (error instanceof Error && error.message === 'Route not found') {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json({ error: 'Failed to delete freight route' }, 500)
	}
})

export default app
