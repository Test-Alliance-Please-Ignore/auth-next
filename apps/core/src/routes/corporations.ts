import { and, desc, eq, ilike, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import { logger } from '@repo/hono-helpers'
import { Hono } from 'hono'

import type { App } from '../context'
import { managedCorporations } from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/session'

/**
 * Helper to convert BigInt values to strings for JSON serialization
 */
function serializeBigInt(obj: any): any {
	if (obj === null || obj === undefined) {
		return obj
	}

	if (typeof obj === 'bigint') {
		return obj.toString()
	}

	if (Array.isArray(obj)) {
		return obj.map(serializeBigInt)
	}

	if (typeof obj === 'object') {
		const result: any = {}
		for (const key in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, key)) {
				result[key] = serializeBigInt(obj[key])
			}
		}
		return result
	}

	return obj
}

const app = new Hono<App>()

/**
 * GET /corporations
 * List all configured corporations (admin only)
 */
app.get('/', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const corporations = await db.query.managedCorporations.findMany({
			orderBy: desc(managedCorporations.updatedAt),
		})

		return c.json(corporations)
	} catch (error) {
		logger.error('Error fetching corporations:', error)
		return c.json({ error: 'Failed to fetch corporations' }, 500)
	}
})

/**
 * GET /corporations/search?q=:query
 * Search corporations by name or ticker
 */
app.get('/search', requireAuth(), requireAdmin(), async (c) => {
	const query = c.req.query('q')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	if (!query || query.length < 2) {
		return c.json({ error: 'Query must be at least 2 characters' }, 400)
	}

	try {
		// Search in both managed corporations and ESI
		const results = await db
			.select()
			.from(managedCorporations)
			.where(
				or(
					ilike(managedCorporations.name, `%${query}%`),
					ilike(managedCorporations.ticker, `%${query}%`)
				)
			)
			.limit(20)

		return c.json(results)
	} catch (error) {
		logger.error('Error searching corporations:', error)
		return c.json({ error: 'Failed to search corporations' }, 500)
	}
})

/**
 * POST /corporations
 * Add a new corporation for management
 *
 * Body: {
 *   corporationId: number
 *   name: string
 *   ticker: string
 *   assignedCharacterId?: number
 *   assignedCharacterName?: string
 * }
 */
app.post('/', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')
	const user = c.get('user')!

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { corporationId, name, ticker, assignedCharacterId, assignedCharacterName } = body

		if (!corporationId || !name || !ticker) {
			return c.json({ error: 'corporationId, name, and ticker are required' }, 400)
		}

		// Check if corporation already exists
		const existing = await db.query.managedCorporations.findFirst({
			where: eq(managedCorporations.corporationId, corporationId),
		})

		if (existing) {
			return c.json({ error: 'Corporation already configured' }, 409)
		}

		// Insert new corporation
		const [corporation] = await db
			.insert(managedCorporations)
			.values({
				corporationId,
				name,
				ticker,
				assignedCharacterId: assignedCharacterId || null,
				assignedCharacterName: assignedCharacterName || null,
				isActive: true,
				isVerified: false,
				configuredBy: user.id,
			})
			.returning()

		// If character assigned, configure the Durable Object
		if (assignedCharacterId && assignedCharacterName) {
			try {
				logger.info('[Corporations] Setting character in DO', {
					corporationId,
					assignedCharacterId,
					assignedCharacterName,
				})
				const stub = getStub<EveCorporationData>(
					c.env.EVE_CORPORATION_DATA,
					`corp-${corporationId}`
				)

				await stub.setCharacter(corporationId, assignedCharacterId, assignedCharacterName)
				logger.info('[Corporations] Character set in DO successfully', { corporationId })
			} catch (error) {
				logger.error('[Corporations] Error configuring corporation DO', {
					corporationId,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				})
				// Don't fail the request, just log the error
			}
		}

		return c.json(corporation, 201)
	} catch (error) {
		logger.error('Error adding corporation:', error)
		return c.json({ error: 'Failed to add corporation' }, 500)
	}
})

/**
 * GET /corporations/:corporationId
 * Get detailed corporation information
 */
app.get('/:corporationId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const db = c.get('db')

	if (isNaN(corporationId)) {
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const corporation = await db.query.managedCorporations.findFirst({
			where: eq(managedCorporations.corporationId, corporationId),
		})

		if (!corporation) {
			return c.json({ error: 'Corporation not found' }, 404)
		}

		// Get configuration from Durable Object if exists
		let doConfig = null
		try {
			const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)
			doConfig = await stub.getConfiguration()
		} catch (error) {
			logger.error('Error fetching DO config:', error)
		}

		return c.json({
			...corporation,
			doConfig,
		})
	} catch (error) {
		logger.error('Error fetching corporation:', error)
		return c.json({ error: 'Failed to fetch corporation' }, 500)
	}
})

/**
 * PUT /corporations/:corporationId
 * Update corporation configuration
 *
 * Body: {
 *   assignedCharacterId?: number
 *   assignedCharacterName?: string
 *   isActive?: boolean
 * }
 */
app.put('/:corporationId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const db = c.get('db')

	if (isNaN(corporationId)) {
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { assignedCharacterId, assignedCharacterName, isActive } = body

		// Check if corporation exists
		const existing = await db.query.managedCorporations.findFirst({
			where: eq(managedCorporations.corporationId, corporationId),
		})

		if (!existing) {
			return c.json({ error: 'Corporation not found' }, 404)
		}

		// Update database
		const [updated] = await db
			.update(managedCorporations)
			.set({
				...(assignedCharacterId !== undefined && { assignedCharacterId }),
				...(assignedCharacterName !== undefined && { assignedCharacterName }),
				...(isActive !== undefined && { isActive }),
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))
			.returning()

		// Update Durable Object if character assignment changed
		if (assignedCharacterId && assignedCharacterName) {
			try {
				logger.info('[Corporations] Updating character in DO', {
					corporationId,
					assignedCharacterId,
					assignedCharacterName,
				})
				const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)
				await stub.setCharacter(corporationId, assignedCharacterId, assignedCharacterName)
				logger.info('[Corporations] Character updated in DO successfully', { corporationId })
			} catch (error) {
				logger.error('[Corporations] Error updating corporation DO', {
					corporationId,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				})
			}
		}

		return c.json(updated)
	} catch (error) {
		logger.error('Error updating corporation:', error)
		return c.json({ error: 'Failed to update corporation' }, 500)
	}
})

/**
 * DELETE /corporations/:corporationId
 * Remove a corporation from management
 */
app.delete('/:corporationId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const db = c.get('db')

	if (isNaN(corporationId)) {
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		await db.delete(managedCorporations).where(eq(managedCorporations.corporationId, corporationId))

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting corporation:', error)
		return c.json({ error: 'Failed to delete corporation' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/verify
 * Verify director character access and roles
 */
app.post('/:corporationId/verify', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const db = c.get('db')

	logger.info('[Corporations] Verify access request', { corporationId })

	if (isNaN(corporationId)) {
		logger.warn('[Corporations] Invalid corporation ID', { corporationId: c.req.param('corporationId') })
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	if (!db) {
		logger.error('[Corporations] Database not available')
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// Verify access via Durable Object
		logger.info('[Corporations] Getting DO stub', { corporationId, stubId: `corp-${corporationId}` })
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)

		logger.info('[Corporations] Calling verifyAccess on DO', { corporationId })
		const verification = await stub.verifyAccess()

		logger.info('[Corporations] Verification result received', {
			corporationId,
			hasAccess: verification.hasAccess,
			characterId: verification.characterId,
			rolesCount: verification.verifiedRoles.length,
			roles: verification.verifiedRoles,
		})

		// Update database with verification result
		logger.info('[Corporations] Updating database with verification result', { corporationId })
		await db
			.update(managedCorporations)
			.set({
				isVerified: verification.hasAccess,
				lastVerified: verification.lastVerified || new Date(),
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))

		logger.info('[Corporations] Verification complete', {
			corporationId,
			hasAccess: verification.hasAccess,
			missingRoles: verification.missingRoles,
		})

		return c.json(verification)
	} catch (error) {
		logger.error('[Corporations] Error verifying corporation access', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to verify access' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/fetch
 * Trigger data fetch for corporation
 *
 * Body: {
 *   category?: 'all' | 'public' | 'core' | 'financial' | 'assets' | 'market' | 'killmails'
 *   forceRefresh?: boolean
 * }
 */
app.post('/:corporationId/fetch', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const db = c.get('db')

	logger.info('[Corporations] Fetch data request', { corporationId })

	if (isNaN(corporationId)) {
		logger.warn('[Corporations] Invalid corporation ID for fetch', { corporationId: c.req.param('corporationId') })
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	if (!db) {
		logger.error('[Corporations] Database not available for fetch')
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { category = 'all', forceRefresh = false } = body

		logger.info('[Corporations] Fetch parameters', { corporationId, category, forceRefresh })

		// Fetch data via Durable Object
		logger.info('[Corporations] Getting DO stub for fetch', { corporationId, stubId: `corp-${corporationId}` })
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)

		logger.info('[Corporations] Calling fetch method on DO', { corporationId, category })

		switch (category) {
			case 'public':
				logger.info('[Corporations] Fetching public data', { corporationId })
				await stub.fetchPublicData(corporationId, forceRefresh)
				break
			case 'core':
				logger.info('[Corporations] Fetching core data', { corporationId })
				await stub.fetchCoreData(forceRefresh)
				break
			case 'financial':
				logger.info('[Corporations] Fetching financial data', { corporationId })
				await stub.fetchFinancialData(undefined, forceRefresh)
				break
			case 'assets':
				logger.info('[Corporations] Fetching assets data', { corporationId })
				await stub.fetchAssetsData(forceRefresh)
				break
			case 'market':
				logger.info('[Corporations] Fetching market data', { corporationId })
				await stub.fetchMarketData(forceRefresh)
				break
			case 'killmails':
				logger.info('[Corporations] Fetching killmails', { corporationId })
				await stub.fetchKillmails(forceRefresh)
				break
			case 'all':
			default:
				logger.info('[Corporations] Fetching all corporation data', { corporationId })
				await stub.fetchAllCorporationData(forceRefresh)
				break
		}

		logger.info('[Corporations] Data fetch completed, updating last sync timestamp', { corporationId })

		// Update last sync timestamp
		await db
			.update(managedCorporations)
			.set({
				lastSync: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))

		logger.info('[Corporations] Fetch successful', { corporationId, category })
		return c.json({ success: true, category })
	} catch (error) {
		logger.error('[Corporations] Error fetching corporation data', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to fetch data' }, 500)
	}
})

/**
 * GET /corporations/:corporationId/data
 * Get summary of fetched corporation data
 */
app.get('/:corporationId/data', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))

	logger.info('[Corporations] Get data summary request', { corporationId })

	if (isNaN(corporationId)) {
		logger.warn('[Corporations] Invalid corporation ID for data summary', { corporationId: c.req.param('corporationId') })
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	try {
		logger.info('[Corporations] Getting DO stub for data summary', { corporationId, stubId: `corp-${corporationId}` })
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)

		logger.info('[Corporations] Fetching all data from DO', { corporationId })
		const [publicInfo, coreData, financialData, assetsData, marketData, killmails] =
			await Promise.all([
				stub.getCorporationInfo().catch((e: unknown) => {
					logger.error('[Corporations] getCorporationInfo failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					});
					return null;
				}),
				stub.getCoreData().catch((e: unknown) => {
					logger.error('[Corporations] getCoreData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					});
					return null;
				}),
				stub.getFinancialData().catch((e: unknown) => {
					logger.error('[Corporations] getFinancialData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					});
					return null;
				}),
				stub.getAssetsData().catch((e: unknown) => {
					logger.error('[Corporations] getAssetsData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					});
					return null;
				}),
				stub.getMarketData().catch((e: unknown) => {
					logger.error('[Corporations] getMarketData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					});
					return null;
				}),
				stub.getKillmails(10).catch((e: unknown) => {
					logger.error('[Corporations] getKillmails failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					});
					return [];
				}),
			])

		logger.info('[Corporations] Data fetched successfully', {
			corporationId,
			hasPublicInfo: !!publicInfo,
			hasCoreData: !!coreData,
			hasFinancialData: !!financialData,
			hasAssetsData: !!assetsData,
			hasMarketData: !!marketData,
			killmailsCount: killmails.length,
		})

		const responseData = {
			publicInfo,
			coreData: coreData
				? {
						memberCount: coreData.members.length,
						trackingCount: coreData.memberTracking.length,
					}
				: null,
			financialData: financialData
				? {
						walletCount: financialData.wallets.length,
						journalCount: financialData.journalEntries.length,
						transactionCount: financialData.transactions.length,
					}
				: null,
			assetsData: assetsData
				? {
						assetCount: assetsData.assets.length,
						structureCount: assetsData.structures.length,
					}
				: null,
			marketData: marketData
				? {
						orderCount: marketData.orders.length,
						contractCount: marketData.contracts.length,
						industryJobCount: marketData.industryJobs.length,
					}
				: null,
			killmailCount: killmails.length,
		}

		// Serialize BigInt values to strings for JSON compatibility
		return c.json(serializeBigInt(responseData))
	} catch (error) {
		logger.error('[Corporations] Error fetching corporation data summary', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to fetch data summary' }, 500)
	}
})

// ============================================================================
// DIRECTOR MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /corporations/:corporationId/directors
 * Get all directors for a corporation
 */
app.get('/:corporationId/directors', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))

	if (isNaN(corporationId)) {
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	try {
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)
		const directors = await stub.getDirectors()

		return c.json(directors)
	} catch (error) {
		logger.error('Error fetching directors:', error)
		return c.json({ error: 'Failed to fetch directors' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/directors
 * Add a director to the corporation
 *
 * Body: {
 *   characterId: number
 *   characterName: string
 *   priority?: number
 * }
 */
app.post('/:corporationId/directors', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const db = c.get('db')

	if (isNaN(corporationId)) {
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { characterId, characterName, priority = 100 } = body

		if (!characterId || !characterName) {
			return c.json({ error: 'characterId and characterName are required' }, 400)
		}

		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)
		await stub.addDirector(characterId, characterName, priority)

		// Update managedCorporations to set primary director if this is the first one
		const directors = await stub.getDirectors()
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
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const characterId = Number.parseInt(c.req.param('characterId'))

	if (isNaN(corporationId) || isNaN(characterId)) {
		return c.json({ error: 'Invalid corporation or character ID' }, 400)
	}

	try {
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)
		await stub.removeDirector(characterId)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error removing director:', error)
		return c.json({ error: 'Failed to remove director' }, 500)
	}
})

/**
 * PUT /corporations/:corporationId/directors/:characterId
 * Update director priority
 *
 * Body: {
 *   priority: number
 * }
 */
app.put('/:corporationId/directors/:characterId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const characterId = Number.parseInt(c.req.param('characterId'))

	if (isNaN(corporationId) || isNaN(characterId)) {
		return c.json({ error: 'Invalid corporation or character ID' }, 400)
	}

	try {
		const body = await c.req.json()
		const { priority } = body

		if (priority === undefined || typeof priority !== 'number') {
			return c.json({ error: 'priority is required and must be a number' }, 400)
		}

		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)
		await stub.updateDirectorPriority(characterId, priority)

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
app.post('/:corporationId/directors/:directorId/verify', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const directorId = c.req.param('directorId')

	if (isNaN(corporationId)) {
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	try {
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)
		const isHealthy = await stub.verifyDirectorHealth(directorId)

		return c.json({ success: true, directorId, isHealthy })
	} catch (error) {
		logger.error('Error verifying director health:', error)
		return c.json({ error: 'Failed to verify director health' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/directors/verify-all
 * Verify health of all directors
 */
app.post('/:corporationId/directors/verify-all', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = Number.parseInt(c.req.param('corporationId'))
	const db = c.get('db')

	if (isNaN(corporationId)) {
		return c.json({ error: 'Invalid corporation ID' }, 400)
	}

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, `corp-${corporationId}`)
		const result = await stub.verifyAllDirectorsHealth()

		// Update managedCorporations with healthy director count
		const healthyDirectors = await stub.getHealthyDirectors()
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
