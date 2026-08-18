import { Hono } from 'hono'

import { getStub, withRpcResult } from '@repo/do-utils'
import {
	AddFittingToDoctrineSchema,
	CreateCategorySchema,
	CreateDoctrineSchema,
	CreateFittingSchema,
	CreateStagingSystemSchema,
	PreviewEftSchema,
	SaveIngameSchema,
	SetDoctrineStagingSchema,
	SLOT_FLAGS,
	UpdateCategorySchema,
	UpdateDoctrineFittingSchema,
	UpdateDoctrineSchema,
	UpdateFittingSchema,
	UpdateStagingSystemSchema,
} from '@repo/doctrines'
import { getEsiInstanceForCharacter } from '@repo/esi'
import { TimeCache } from '@repo/hono-helpers'

import { getCachedCharacterPermissions, getCachedUserPermissions } from '../lib/groups-cache'
import { requireAllianceMember, requireAuth } from '../middleware/session'

import type { Doctrines } from '@repo/doctrines'
import type { App } from '../context'

/**
 * Permission check cache - 15 second TTL
 */
const permissionCache = new TimeCache<boolean>(15000)

/**
 * Check if a user has the doctrine manager permission.
 * Admins bypass permission checks.
 */
async function isDoctrineManager(
	env: { GROUPS: DurableObjectNamespace },
	user: { id: string; is_admin: boolean; characters: Array<{ characterId: string }> }
): Promise<boolean> {
	if (user.is_admin) return true

	const permissionUrn = 'urn:doctrines:manager'
	const characterIds = user.characters.map((ch) => ch.characterId)
	const cacheKey = `${user.id}:${permissionUrn}:${characterIds.join(',')}`
	return permissionCache.getOrSet(cacheKey, async () => {
		const groupPermissions = await getCachedUserPermissions(env, user.id)
		if (groupPermissions.some((p) => p.urn === permissionUrn)) {
			return true
		}

		for (const characterId of characterIds) {
			const characterPermissions = await getCachedCharacterPermissions(env, characterId)
			if (characterPermissions.some((p) => p.urn === permissionUrn)) {
				return true
			}
		}

		return false
	})
}

/**
 * Doctrines routes
 *
 * Read endpoints: all authenticated users can access.
 * Write endpoints: require urn:doctrines:manager permission.
 */
const doctrines = new Hono<App>()

doctrines.use('*', requireAuth())
doctrines.use('*', requireAllianceMember())

// =============================================================================
// DOCTRINES
// =============================================================================

/**
 * Helper to get the current user's main character name.
 */
function getUserCharacterName(user: {
	characters: Array<{ characterName: string; is_primary: boolean }>
}): string {
	const primary = user.characters.find((ch) => ch.is_primary)
	return primary?.characterName ?? user.characters[0]?.characterName ?? 'Unknown'
}

/**
 * Get all doctrines
 * GET /api/doctrines?search=xxx
 */
doctrines.get('/', async (c) => {
	const filters = {
		search: c.req.query('search')?.slice(0, 500),
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const doctrinesList = await doctrinesStub.getDoctrines(filters)

	return c.json(doctrinesList)
})

/**
 * Search ship types for doctrine icons
 * GET /api/doctrines/search/types?q=xxx
 */
doctrines.get('/search/types', async (c) => {
	const q = c.req.query('q')
	if (!q || q.trim().length < 2) {
		return c.json([])
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const results = await withRpcResult(
		doctrinesStub.searchShipTypes(q.trim().slice(0, 500)),
		(value) => value.map((result) => ({ ...result }))
	)

	return c.json(results)
})

/**
 * Create a new doctrine
 * POST /api/doctrines
 */
doctrines.post('/', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = CreateDoctrineSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const doctrine = await doctrinesStub.createDoctrine({
		...validation.data,
		updatedBy: getUserCharacterName(user),
	})

	return c.json(doctrine, 201)
})

// =============================================================================
// CATEGORIES (must be before /:id routes to avoid path collision)
// =============================================================================

/**
 * Get all doctrine categories
 * GET /api/doctrines/categories
 */
doctrines.get('/categories', async (c) => {
	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const categories = await doctrinesStub.getCategories()
	return c.json(categories)
})

/**
 * Create a doctrine category
 * POST /api/doctrines/categories
 */
doctrines.post('/categories', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = CreateCategorySchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const category = await doctrinesStub.createCategory(validation.data)

	return c.json(category, 201)
})

/**
 * Update a doctrine category
 * PATCH /api/doctrines/categories/:categoryId
 */
doctrines.patch('/categories/:categoryId', async (c) => {
	const user = c.get('user')!
	const categoryId = c.req.param('categoryId')
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = UpdateCategorySchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const category = await doctrinesStub.updateCategory(categoryId, validation.data)

	return c.json(category)
})

/**
 * Delete a doctrine category
 * DELETE /api/doctrines/categories/:categoryId
 */
doctrines.delete('/categories/:categoryId', async (c) => {
	const user = c.get('user')!
	const categoryId = c.req.param('categoryId')

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.deleteCategory(categoryId)

	return c.json({ success: true })
})

// =============================================================================
// STAGING SYSTEMS (must be before /:id routes to avoid path collision)
// =============================================================================

/**
 * Get all staging systems
 * GET /api/doctrines/staging-systems
 */
doctrines.get('/staging-systems', async (c) => {
	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const systems = await doctrinesStub.getStagingSystems()
	return c.json(systems)
})

/**
 * Create a staging system
 * POST /api/doctrines/staging-systems
 */
doctrines.post('/staging-systems', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = CreateStagingSystemSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const system = await doctrinesStub.createStagingSystem(validation.data)

	return c.json(system, 201)
})

/**
 * Update a staging system
 * PATCH /api/doctrines/staging-systems/:systemId
 */
doctrines.patch('/staging-systems/:systemId', async (c) => {
	const user = c.get('user')!
	const systemId = c.req.param('systemId')
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = UpdateStagingSystemSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const system = await doctrinesStub.updateStagingSystem(systemId, validation.data)

	return c.json(system)
})

/**
 * Delete a staging system
 * DELETE /api/doctrines/staging-systems/:systemId
 */
doctrines.delete('/staging-systems/:systemId', async (c) => {
	const user = c.get('user')!
	const systemId = c.req.param('systemId')

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.deleteStagingSystem(systemId)

	return c.json({ success: true })
})

// =============================================================================
// FITTINGS (must be before /:id routes to avoid path collision)
// =============================================================================

/**
 * Get all fittings
 * GET /api/doctrines/fittings?shipTypeId=xxx&category=xxx&srpEligible=true&search=xxx
 */
doctrines.get('/fittings', async (c) => {
	const filters = {
		shipTypeId: c.req.query('shipTypeId')?.slice(0, 50),
		category: c.req.query('category')?.slice(0, 200),
		srpEligible: c.req.query('srpEligible') === 'true' ? true : undefined,
		search: c.req.query('search')?.slice(0, 500),
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const fittingsList = await doctrinesStub.getFittings(filters)

	return c.json(fittingsList)
})

/**
 * Get all fittings with doctrine associations
 * GET /api/doctrines/fittings/with-doctrines
 */
doctrines.get('/fittings/with-doctrines', async (c) => {
	const user = c.get('user')!

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const fittings = await doctrinesStub.getFittingsWithDoctrines()

	return c.json(fittings)
})

/**
 * Get a single fitting with its items
 * GET /api/doctrines/fittings/:id
 */
doctrines.get('/fittings/:id', async (c) => {
	const fittingId = c.req.param('id')

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const fitting = await doctrinesStub.getFitting(fittingId)

	if (!fitting) {
		return c.json({ error: 'Fitting not found' }, 404)
	}

	return c.json(fitting)
})

/**
 * Preview-parse an EFT string (returns parsed items without saving)
 * POST /api/doctrines/fittings/preview
 */
doctrines.post('/fittings/preview', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = PreviewEftSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')

	try {
		const preview = await doctrinesStub.parseEft(validation.data.eftString)
		return c.json(preview)
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to parse EFT'
		return c.json({ error: message }, 422)
	}
})

/**
 * Create a new fitting
 * POST /api/doctrines/fittings
 */
doctrines.post('/fittings', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = CreateFittingSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')

	try {
		const fitting = await doctrinesStub.createFitting(validation.data)
		return c.json(fitting, 201)
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to create fitting'
		return c.json({ error: message }, 422)
	}
})

/**
 * Update a fitting
 * PATCH /api/doctrines/fittings/:id
 */
doctrines.patch('/fittings/:id', async (c) => {
	const user = c.get('user')!
	const fittingId = c.req.param('id')
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = UpdateFittingSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const fitting = await doctrinesStub.updateFitting(fittingId, validation.data)

	return c.json(fitting)
})

/**
 * Delete a fitting
 * DELETE /api/doctrines/fittings/:id
 */
doctrines.delete('/fittings/:id', async (c) => {
	const user = c.get('user')!
	const fittingId = c.req.param('id')

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.deleteFitting(fittingId, getUserCharacterName(user))

	return c.json({ success: true })
})

/**
 * Save a fitting to a character's in-game fitting list via ESI
 * POST /api/doctrines/fittings/:id/save-ingame
 */
doctrines.post('/fittings/:id/save-ingame', async (c) => {
	const user = c.get('user')!
	const fittingId = c.req.param('id')

	const validation = SaveIngameSchema.safeParse(await c.req.json())
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const { characterId } = validation.data

	// Verify the character belongs to the user
	const userChar = user.characters.find((ch) => ch.characterId.toString() === characterId)
	if (!userChar) {
		return c.json({ error: 'Character not found' }, 404)
	}
	if (!userChar.hasValidToken) {
		return c.json({ error: 'Character does not have a valid ESI token' }, 400)
	}

	// Get the fitting from doctrines DO
	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const fitting = await doctrinesStub.getFitting(fittingId)
	if (!fitting) {
		return c.json({ error: 'Fitting not found' }, 404)
	}

	// Save via ESI — use shared SLOT_FLAGS for flag mapping
	const slotCounters: Record<string, number> = {}
	const esiItems = fitting.fittingItems
		.filter((item) => {
			// Filter out items that can't be saved to ESI (e.g. implants)
			const flag = SLOT_FLAGS[item.flagId]
			return flag?.esiPrefix !== null
		})
		.map((item) => {
			const flag = SLOT_FLAGS[item.flagId]
			const prefix = flag?.esiPrefix ?? 'Cargo'
			let esiFlag: string
			if (!flag?.indexed) {
				esiFlag = prefix
			} else {
				const count = slotCounters[prefix] ?? 0
				esiFlag = `${prefix}${count}`
				slotCounters[prefix] = count + 1
			}
			return {
				typeId: item.typeId,
				flag: esiFlag,
				quantity: parseInt(item.quantity),
			}
		})

	const esiStub = getEsiInstanceForCharacter(c.env.ESI, characterId)
	const result = await esiStub.saveCharacterFitting(characterId, {
		name: fitting.name.slice(0, 50),
		description: (fitting.description || '').slice(0, 500),
		shipTypeId: fitting.shipTypeId,
		items: esiItems,
	})

	return c.json(result, 201)
})

// =============================================================================
// SINGLE DOCTRINE ROUTES (/:id wildcard - must be after all specific paths)
// =============================================================================

/**
 * Get a single doctrine with its fittings
 * GET /api/doctrines/:id
 */
doctrines.get('/:id', async (c) => {
	const doctrineId = c.req.param('id')

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const doctrine = await doctrinesStub.getDoctrine(doctrineId)

	if (!doctrine) {
		return c.json({ error: 'Doctrine not found' }, 404)
	}

	return c.json(doctrine)
})

/**
 * Update a doctrine
 * PATCH /api/doctrines/:id
 */
doctrines.patch('/:id', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = UpdateDoctrineSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	const doctrine = await doctrinesStub.updateDoctrine(doctrineId, {
		...validation.data,
		updatedBy: getUserCharacterName(user),
	})

	return c.json(doctrine)
})

/**
 * Delete a doctrine
 * DELETE /api/doctrines/:id
 */
doctrines.delete('/:id', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.deleteDoctrine(doctrineId, getUserCharacterName(user))

	return c.json({ success: true })
})

/**
 * Add a fitting to a doctrine
 * POST /api/doctrines/:id/fittings
 */
doctrines.post('/:id/fittings', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = AddFittingToDoctrineSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.addFittingToDoctrine(doctrineId, validation.data)

	return c.json({ success: true })
})

/**
 * Update a fitting's category/sort within a doctrine
 * PATCH /api/doctrines/:id/fittings/:fittingId
 */
doctrines.patch('/:id/fittings/:fittingId', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')
	const fittingId = c.req.param('fittingId')
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = UpdateDoctrineFittingSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.updateDoctrineFitting(doctrineId, fittingId, validation.data)

	return c.json({ success: true })
})

/**
 * Remove a fitting from a doctrine
 * DELETE /api/doctrines/:id/fittings/:fittingId
 */
doctrines.delete('/:id/fittings/:fittingId', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')
	const fittingId = c.req.param('fittingId')

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.removeFittingFromDoctrine(doctrineId, fittingId)

	return c.json({ success: true })
})

/**
 * Set/update a doctrine's staging system entry
 * PUT /api/doctrines/:id/staging-systems
 */
doctrines.put('/:id/staging-systems', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')
	const body = await c.req.json()

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const validation = SetDoctrineStagingSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: validation.error.issues[0]?.message ?? 'Invalid request' }, 400)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.setDoctrineStagingSystem(doctrineId, validation.data)

	return c.json({ success: true })
})

/**
 * Remove a staging system from a doctrine
 * DELETE /api/doctrines/:id/staging-systems/:systemId
 */
doctrines.delete('/:id/staging-systems/:systemId', async (c) => {
	const user = c.get('user')!
	const doctrineId = c.req.param('id')
	const systemId = c.req.param('systemId')

	if (!(await isDoctrineManager(c.env, user))) {
		return c.json({ error: 'Requires doctrines:manager permission' }, 403)
	}

	const doctrinesStub = getStub<Doctrines>(c.env.DOCTRINES, 'default')
	await doctrinesStub.removeDoctrineStagingSystem(doctrineId, systemId)

	return c.json({ success: true })
})

export default doctrines
