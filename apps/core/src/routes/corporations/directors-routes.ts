import { Hono } from 'hono'

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { managedCorporations } from '../../db/schema'
import { requireAdmin, requireAuth } from '../../middleware/session'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { App } from '../../context'

const app = new Hono<App>()

/**
 * GET /corporations/:corporationId/directors
 * Get all directors for a corporation
 */
app.get('/:corporationId/directors', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')

	try {
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		const directors = await stub.getDirectors(corporationId)

		return c.json(directors)
	} catch (error) {
		logger.error('Error fetching directors:', error)
		return c.json({ error: 'Failed to fetch directors' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/directors
 * Add a director to the corporation
 */
app.post('/:corporationId/directors', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { characterId, characterName, priority = 100 } = body

		if (!characterId || !characterName) {
			return c.json({ error: 'characterId and characterName are required' }, 400)
		}

		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		await stub.addDirector(corporationId, characterId, characterName, priority)

		// If this is the first director, persist as primary configured character.
		const directors = await stub.getDirectors(corporationId)
		if (directors.length === 1) {
			await db
				.update(managedCorporations)
				.set({
					assignedCharacterId: characterId,
					assignedCharacterName: characterName,
					updatedAt: new Date(),
				})
				.where(eq(managedCorporations.corporationId, corporationId))
		}

		return c.json({ success: true, characterId, characterName, priority })
	} catch (error) {
		logger.error('Error adding director:', error)
		return c.json({ error: 'Failed to add director' }, 500)
	}
})

/**
 * DELETE /corporations/:corporationId/directors/:characterId
 * Remove a director from the corporation
 */
app.delete('/:corporationId/directors/:characterId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const characterId = c.req.param('characterId')

	try {
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		await stub.removeDirector(corporationId, characterId)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error removing director:', error)
		return c.json({ error: 'Failed to remove director' }, 500)
	}
})

/**
 * PUT /corporations/:corporationId/directors/:characterId
 * Update director priority
 */
app.put('/:corporationId/directors/:characterId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const characterId = c.req.param('characterId')

	try {
		const body = await c.req.json()
		const { priority } = body

		if (priority === undefined || typeof priority !== 'number') {
			return c.json({ error: 'priority is required and must be a number' }, 400)
		}

		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		await stub.updateDirectorPriority(corporationId, characterId, priority)

		return c.json({ success: true, characterId, priority })
	} catch (error) {
		logger.error('Error updating director priority:', error)
		return c.json({ error: 'Failed to update director priority' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/directors/:directorId/verify
 * Verify a specific director's health
 */
app.post(
	'/:corporationId/directors/:directorId/verify',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const corporationId = c.req.param('corporationId')
		const directorId = c.req.param('directorId')

		try {
			const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
			const isHealthy = await stub.verifyDirectorHealth(corporationId, directorId)

			return c.json({ success: true, directorId, isHealthy })
		} catch (error) {
			logger.error('Error verifying director health:', error)
			return c.json({ error: 'Failed to verify director health' }, 500)
		}
	}
)

/**
 * POST /corporations/:corporationId/directors/verify-all
 * Verify health of all directors
 */
app.post('/:corporationId/directors/verify-all', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		const result = await stub.verifyAllDirectorsHealth(corporationId)

		const healthyDirectors = await stub.getHealthyDirectors(corporationId)
		await db
			.update(managedCorporations)
			.set({
				healthyDirectorCount: healthyDirectors.length,
				isVerified: healthyDirectors.length > 0,
				lastVerified: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))

		return c.json({
			success: true,
			verified: result.verified,
			failed: result.failed,
			healthyCount: healthyDirectors.length,
		})
	} catch (error) {
		logger.error('Error verifying all directors:', error)
		return c.json({ error: 'Failed to verify all directors' }, 500)
	}
})

export default app
