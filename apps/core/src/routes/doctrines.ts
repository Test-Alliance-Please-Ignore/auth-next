import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { TimeCache } from '@repo/hono-helpers'

import { requireAuth } from '../middleware/session'

import type { Doctrines } from '@repo/doctrines'
import type { Groups } from '@repo/groups'
import type { App } from '../context'

/**
 * Permission check cache - 15 second TTL
 */
const permissionCache = new TimeCache<boolean>(15000)

/**
 * Helper function to check if a user has a specific permission
 * Checks both group permissions and corporation permissions
 * Results are cached for 15 seconds to reduce load on Groups DO
 *
 * IMPORTANT: Creates fresh stubs internally to avoid stub invalidation issues.
 * Each RPC operation gets its own isolated stub.
 */
async function hasPermission(
	env: { GROUPS: DurableObjectNamespace },
	userId: string,
	permissionUrn: string,
	isAdmin: boolean,
	characterIds: string[]
): Promise<boolean> {
	console.log('[hasPermission] Checking permission', {
		userId,
		permissionUrn,
		isAdmin,
		characterIds,
	})

	// Admins bypass permission checks
	if (isAdmin) {
		console.log('[hasPermission] User is admin, granting access')
		return true
	}

	// Check cache or fetch user permissions
	const cacheKey = `${userId}:${permissionUrn}`
	return permissionCache.getOrSet(cacheKey, async () => {
		// Create fresh stub for user permissions check
		using groupsStub = getStub<Groups>(env.GROUPS, 'default')
		const groupPermissions = await groupsStub.getUserPermissions(userId)
		console.log('[hasPermission] User group permissions', {
			userId,
			groupPermissions: groupPermissions.map((p) => p.urn),
		})

		if (groupPermissions.some((p) => p.urn === permissionUrn)) {
			console.log('[hasPermission] Permission found in group permissions', { permissionUrn })
			return true
		}

		// Check corporation permissions for all user's characters
		// Each character check gets its own fresh stub
		for (const characterId of characterIds) {
			using charStub = getStub<Groups>(env.GROUPS, 'default')
			const characterPermissions = await charStub.getCharacterPermissions(characterId)
			console.log('[hasPermission] Character permissions', {
				characterId,
				permissions: characterPermissions.map((p) => p.urn),
			})

			if (characterPermissions.some((p) => p.urn === permissionUrn)) {
				console.log('[hasPermission] Permission found in character permissions', {
					characterId,
					permissionUrn,
				})
				return true
			}
		}

		console.log('[hasPermission] Permission not found, denying access', { permissionUrn })
		return false
	})
}

/**
 * Doctrines routes
 *
 * Provides API endpoints for managing doctrines and fittings.
 * All requests are authenticated before being forwarded to the Doctrines Durable Object.
 */
const doctrines = new Hono<App>()

// Apply authentication middleware to all routes
doctrines.use('*', requireAuth())

// =============================================================================
// DOCTRINES
// =============================================================================

/**
 * Get all doctrines with optional filters
 * GET /api/doctrines?category=xxx&maintainer=xxx&search=xxx
 */
doctrines.get('/', async (c) => {
	const user = c.get('user')!
	const characterIds = user.characters.map((ch) => ch.characterId)

	const filters = {
		category: c.req.query('category'),
		maintainer: c.req.query('maintainer'),
		search: c.req.query('search'),
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const doctrinesList = await doctrinesStub.getDoctrines(filters, user.id, characterIds, user.is_admin)

	return c.json(doctrinesList)
})

/**
 * Get a single doctrine with its fittings
 * GET /api/doctrines/:id
 */
doctrines.get('/:id', async (c) => {
	const user = c.get('user')!
	const characterIds = user.characters.map((ch) => ch.characterId)
	const doctrineId = c.req.param('id')

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const doctrine = await doctrinesStub.getDoctrine(doctrineId, user.id, characterIds, user.is_admin)

	if (!doctrine) {
		return c.json({ error: 'Doctrine not found' }, 404)
	}

	return c.json(doctrine)
})

/**
 * Create a new doctrine
 * POST /api/doctrines
 *
 * Requires urn:doctrines:create permission
 */
doctrines.post('/', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	// Check create permission
	const characterIds = user.characters.map((ch) => ch.characterId)
	const allowed = await hasPermission(
		c.env,
		user.id,
		'urn:doctrines:create',
		user.is_admin,
		characterIds
	)

	if (!allowed) {
		return c.json({ error: 'Requires doctrines:create permission' }, 403)
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const doctrine = await doctrinesStub.createDoctrine(body, user.id, characterIds)

	return c.json(doctrine, 201)
})

/**
 * Update a doctrine
 * PATCH /api/doctrines/:id
 *
 * Requires urn:doctrines:edit permission
 */
doctrines.patch('/:id', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')
	const body = await c.req.json()

	// Check edit permission
	const characterIds = user.characters.map((ch) => ch.characterId)
	const allowed = await hasPermission(
		c.env,
		user.id,
		'urn:doctrines:edit',
		user.is_admin,
		characterIds
	)

	if (!allowed) {
		return c.json({ error: 'Requires doctrines:edit permission' }, 403)
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const doctrine = await doctrinesStub.updateDoctrine(doctrineId, body, user.id, characterIds, user.is_admin)

	return c.json(doctrine)
})

/**
 * Delete a doctrine
 * DELETE /api/doctrines/:id
 *
 * Requires urn:doctrines:delete permission
 */
doctrines.delete('/:id', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')

	// Check delete permission
	const characterIds = user.characters.map((ch) => ch.characterId)
	const allowed = await hasPermission(
		c.env,
		user.id,
		'urn:doctrines:delete',
		user.is_admin,
		characterIds
	)

	if (!allowed) {
		return c.json({ error: 'Requires doctrines:delete permission' }, 403)
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.deleteDoctrine(doctrineId, user.id, characterIds, user.is_admin)

	return c.json({ success: true })
})

/**
 * Add a fitting to a doctrine
 * POST /api/doctrines/:id/fittings
 *
 * Body: { fittingId: string }
 *
 * Requires urn:doctrines:edit permission
 */
doctrines.post('/:id/fittings', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')
	const body = await c.req.json()

	if (!body.fittingId) {
		return c.json({ error: 'fittingId is required' }, 400)
	}

	// Check edit permission
	const characterIds = user.characters.map((ch) => ch.characterId)
	const allowed = await hasPermission(
		c.env,
		user.id,
		'urn:doctrines:edit',
		user.is_admin,
		characterIds
	)

	if (!allowed) {
		return c.json({ error: 'Requires doctrines:edit permission' }, 403)
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.addFittingToDoctrine(doctrineId, body.fittingId, user.id, characterIds, user.is_admin)

	return c.json({ success: true })
})

/**
 * Remove a fitting from a doctrine
 * DELETE /api/doctrines/:id/fittings/:fittingId
 *
 * Requires urn:doctrines:edit permission
 */
doctrines.delete('/:id/fittings/:fittingId', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')
	const fittingId = c.req.param('fittingId')

	// Check edit permission
	const characterIds = user.characters.map((ch) => ch.characterId)
	const allowed = await hasPermission(
		c.env,
		user.id,
		'urn:doctrines:edit',
		user.is_admin,
		characterIds
	)

	if (!allowed) {
		return c.json({ error: 'Requires doctrines:edit permission' }, 403)
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.removeFittingFromDoctrine(doctrineId, fittingId, user.id, characterIds, user.is_admin)

	return c.json({ success: true })
})

// =============================================================================
// FITTINGS
// =============================================================================

/**
 * Get all fittings with optional filters
 * GET /api/doctrines/fittings?shipTypeId=xxx&category=xxx&maintainer=xxx&srpEligible=true&search=xxx
 */
doctrines.get('/fittings', async (c) => {
	const user = c.get('user')!
	const characterIds = user.characters.map((ch) => ch.characterId)

	console.log('[GET /fittings] Fetching fittings list', {
		userId: user.id,
		characterIds,
		isAdmin: user.is_admin,
	})

	const filters = {
		shipTypeId: c.req.query('shipTypeId'),
		category: c.req.query('category'),
		maintainer: c.req.query('maintainer'),
		srpEligible: c.req.query('srpEligible') === 'true' ? true : undefined,
		search: c.req.query('search'),
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const fittingsList = await doctrinesStub.getFittings(filters, user.id, characterIds, user.is_admin)

	console.log('[GET /fittings] Fetched fittings', {
		count: fittingsList.length,
		userId: user.id,
	})

	return c.json(fittingsList)
})

/**
 * Get a single fitting with its items
 * GET /api/doctrines/fittings/:id
 */
doctrines.get('/fittings/:id', async (c) => {
	const user = c.get('user')!
	const characterIds = user.characters.map((ch) => ch.characterId)
	const fittingId = c.req.param('id')

	console.log('[GET /fittings/:id] Fetching fitting', {
		fittingId,
		userId: user.id,
		characterIds,
		isAdmin: user.is_admin,
	})

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const fitting = await doctrinesStub.getFitting(fittingId, user.id, characterIds, user.is_admin)

	if (!fitting) {
		console.log('[GET /fittings/:id] Fitting not found', { fittingId, userId: user.id })
		return c.json({ error: 'Fitting not found' }, 404)
	}

	console.log('[GET /fittings/:id] Fetched fitting', {
		fittingId: fitting.id,
		shipName: fitting.shipName,
		userId: user.id,
	})

	return c.json(fitting)
})

/**
 * Create a new fitting
 * POST /api/doctrines/fittings
 *
 * Requires urn:doctrines:create_fitting permission
 */
doctrines.post('/fittings', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	// Check create permission
	const characterIds = user.characters.map((ch) => ch.characterId)
	const allowed = await hasPermission(
		c.env,
		user.id,
		'urn:doctrines:create_fitting',
		user.is_admin,
		characterIds
	)

	if (!allowed) {
		return c.json({ error: 'Requires doctrines:create_fitting permission' }, 403)
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const fitting = await doctrinesStub.createFitting(body, user.id, characterIds)

	return c.json(fitting, 201)
})

/**
 * Update a fitting
 * PATCH /api/doctrines/fittings/:id
 *
 * Requires urn:doctrines:edit_fitting permission
 */
doctrines.patch('/fittings/:id', async (c) => {
	const user = c.get('user')!
	const fittingId = c.req.param('id')
	const body = await c.req.json()

	// Check edit permission
	const characterIds = user.characters.map((ch) => ch.characterId)
	const allowed = await hasPermission(
		c.env,
		user.id,
		'urn:doctrines:edit_fitting',
		user.is_admin,
		characterIds
	)

	if (!allowed) {
		return c.json({ error: 'Requires doctrines:edit_fitting permission' }, 403)
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const fitting = await doctrinesStub.updateFitting(fittingId, body, user.id, characterIds, user.is_admin)

	return c.json(fitting)
})

/**
 * Delete a fitting
 * DELETE /api/doctrines/fittings/:id
 *
 * Requires urn:doctrines:delete_fitting permission
 */
doctrines.delete('/fittings/:id', async (c) => {
	const user = c.get('user')!
	const fittingId = c.req.param('id')

	// Check delete permission
	const characterIds = user.characters.map((ch) => ch.characterId)
	const allowed = await hasPermission(
		c.env,
		user.id,
		'urn:doctrines:delete_fitting',
		user.is_admin,
		characterIds
	)

	if (!allowed) {
		return c.json({ error: 'Requires doctrines:delete_fitting permission' }, 403)
	}

	using doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.deleteFitting(fittingId, user.id, characterIds, user.is_admin)

	return c.json({ success: true })
})

export default doctrines
