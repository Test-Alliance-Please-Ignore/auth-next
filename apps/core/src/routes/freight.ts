/**
 * Freight routes - Administrative operations for managing freight routes
 *
 * All endpoints require authentication and admin privileges.
 * These endpoints call the Freight Durable Object via RPC.
 */

import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { requireAdmin, requireAuth } from '../middleware/session'

import type { Freight } from '@repo/freight'
import type { App } from '../context'

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
 * List all freight routes with optional status filter
 */
app.get('/routes', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
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
 * Create a new freight route
 */
app.post('/routes', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
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
 * Get a specific freight route
 */
app.get('/routes/:routeId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const routeId = c.req.param('routeId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
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
 * Update an existing freight route
 */
app.put('/routes/:routeId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const routeId = c.req.param('routeId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()

		const stub = getStub<Freight>(c.env.FREIGHT, 'default')
		const route = await stub.updateRoute(user.id, routeId, data)

		return c.json(route)
	} catch (error) {
		logger.error('Error updating freight route:', error)

		// Check for specific error messages
		if (error instanceof Error && error.message === 'Route not found') {
			return c.json({ error: 'Route not found' }, 404)
		}

		return c.json({ error: 'Failed to update freight route' }, 500)
	}
})

/**
 * POST /freight/routes/:routeId/activate
 * Activate a freight route (set status to active)
 */
app.post('/routes/:routeId/activate', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const routeId = c.req.param('routeId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
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
 * Deactivate a freight route (set status to inactive)
 */
app.post('/routes/:routeId/deactivate', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const routeId = c.req.param('routeId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
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

export default app
