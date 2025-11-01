import type { Context } from 'hono'
import { Hono } from 'hono'

import { and, desc, eq, ilike, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	corporationDiscordServerRoles,
	corporationDiscordServers,
	discordRoles,
	discordServers,
	managedCorporations,
	userCharacters,
} from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/session'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { App } from '../context'

const app = new Hono<App>()

/**
 * Cache duration for corporation member data (5 minutes)
 */
const CACHE_TTL = 5 * 60 // 5 minutes in seconds

/**
 * Helper to get cache instance
 */
function getCache() {
	return caches.default
}

/**
 * Helper to create cache key for corporation members
 */
function getCorpMembersCacheKey(corporationId: string): string {
	return `https://cache.local/corporations/${corporationId}/members`
}

/**
 * Helper to check cache for JSON response
 */
async function getCachedJson<T>(cacheKey: string): Promise<T | null> {
	try {
		const cache = getCache()
		const cachedResponse = await cache.match(cacheKey)
		if (cachedResponse) {
			const age = cachedResponse.headers.get('age')
			logger.info('[Cache] Hit', { cacheKey, age: age ? `${age}s` : 'unknown' })
			return await cachedResponse.json()
		}
		logger.info('[Cache] Miss', { cacheKey })
		return null
	} catch (error) {
		logger.warn('[Cache] Error reading cache', {
			cacheKey,
			error: error instanceof Error ? error.message : String(error),
		})
		return null
	}
}

/**
 * Helper to store JSON response in cache
 */
async function cacheJson(cacheKey: string, data: unknown, ttl: number): Promise<void> {
	try {
		const cache = getCache()
		const response = new Response(JSON.stringify(data), {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': `public, max-age=${ttl}`,
			},
		})
		await cache.put(cacheKey, response)
		logger.info('[Cache] Stored', { cacheKey, ttl })
	} catch (error) {
		logger.warn('[Cache] Error storing cache', {
			cacheKey,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

/**
 * Check if the current user has CEO, director, or site admin access to a corporation
 * @returns Object with hasAccess flag and role if access granted
 * @throws Error with 403 status if user has no access
 */
async function checkCorporationAccess(
	c: Context<App>,
	corporationId: string
): Promise<{ hasAccess: true; role: 'admin' | 'CEO' | 'Director' }> {
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		throw new Error('Database not available')
	}

	// Site admins have access to all corporations
	if (user.is_admin) {
		logger.info('[Corporation Access] Admin access granted', {
			corporationId,
			userId: user.id,
			reason: 'site_admin',
		})
		return { hasAccess: true, role: 'admin' }
	}

	// Get user's characters to check CEO/Director status
	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, user.id),
	})

	logger.info('[Corporation Access] Checking user access', {
		corporationId,
		userId: user.id,
		userCharacterCount: userChars.length,
	})

	let userRole: 'CEO' | 'Director' | null = null

	for (const character of userChars) {
		try {
			// Check if character is in this corporation
			const charStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, character.characterId)
			const charData = await charStub.getCharacterInfo(character.characterId)

			// Skip if character is not in the target corporation
			if (!charData || String(charData.corporationId) !== corporationId) {
				continue
			}

			// Get corporation data to check CEO and directors
			const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
			const [corpInfo, directors] = await Promise.all([
				corpStub.getCorporationInfo(corporationId),
				corpStub.getDirectors(corporationId),
			])

			// Check if character is CEO
			const isCeo = corpInfo && String(corpInfo.ceoId) === character.characterId
			if (isCeo) {
				userRole = 'CEO'
				logger.info('[Corporation Access] CEO access granted', {
					characterId: character.characterId,
					characterName: character.characterName,
					corporationId,
					reason: 'corporation_ceo',
				})
				return { hasAccess: true, role: 'CEO' }
			}

			// Check if character is a director
			const matchedDirector = directors.find((d) => d.characterId === character.characterId)
			if (matchedDirector) {
				userRole = 'Director'
				logger.info('[Corporation Access] Director access granted', {
					characterId: character.characterId,
					characterName: character.characterName,
					corporationId,
					reason: 'corporation_director',
				})
				// Continue checking in case another character is CEO
			}
		} catch (error) {
			logger.warn('[Corporation Access] Error checking character access:', {
				characterId: character.characterId,
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// If we found a Director role, return it
	if (userRole === 'Director') {
		return { hasAccess: true, role: 'Director' }
	}

	// No access found
	logger.warn('[Corporation Access] Access denied', {
		corporationId,
		userId: user.id,
		isAdmin: user.is_admin,
		checkedCharacters: userChars.length,
	})

	throw new Error('Access denied. Corporation CEO, Director, or site admin access required.')
}

/**
 * GET /corporations
 * List all configured corporations (admin only)
 *
 * Query parameters:
 *   isMember: boolean - filter by member corporation status
 *   isAlt: boolean - filter by alt corporation status
 */
app.get('/', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const corporationType = c.req.query('corporationType') as
			| 'member'
			| 'alt'
			| 'special'
			| 'other'
			| undefined

		// Build where conditions based on corporation type
		let whereCondition
		if (corporationType === 'member') {
			whereCondition = eq(managedCorporations.isMemberCorporation, true)
		} else if (corporationType === 'alt') {
			whereCondition = eq(managedCorporations.isAltCorp, true)
		} else if (corporationType === 'special') {
			whereCondition = eq(managedCorporations.isSpecialPurpose, true)
		} else if (corporationType === 'other') {
			// "Other" corporations are those that are not member, alt, or special purpose
			whereCondition = and(
				eq(managedCorporations.isMemberCorporation, false),
				eq(managedCorporations.isAltCorp, false),
				eq(managedCorporations.isSpecialPurpose, false)
			)
		}
		// If corporationType is undefined, no filter (show all)

		const corporations = await db.query.managedCorporations.findMany({
			where: whereCondition,
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
 * GET /corporations/browse
 * List member corporations for public browsing (authenticated users only, not admin-only)
 * Returns only corporations where isMemberCorporation = true AND isRecruiting = true
 */
app.get('/browse', requireAuth(), async (c) => {
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// Only return recruiting member corporations
		const corporations = await db.query.managedCorporations.findMany({
			where: and(
				eq(managedCorporations.isMemberCorporation, true),
				eq(managedCorporations.isRecruiting, true)
			),
			orderBy: desc(managedCorporations.updatedAt),
		})

		return c.json(corporations)
	} catch (error) {
		logger.error('Error fetching member corporations:', error)
		return c.json({ error: 'Failed to fetch member corporations' }, 500)
	}
})

/**
 * GET /corporations/browse/search?q=:query
 * Search member corporations by name or ticker (authenticated users only, not admin-only)
 * Returns only corporations where isMemberCorporation = true AND isRecruiting = true
 */
app.get('/browse/search', requireAuth(), async (c) => {
	const query = c.req.query('q')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	if (!query || query.length < 2) {
		return c.json({ error: 'Query must be at least 2 characters' }, 400)
	}

	try {
		// Search only in recruiting member corporations
		const results = await db
			.select()
			.from(managedCorporations)
			.where(
				and(
					eq(managedCorporations.isMemberCorporation, true),
					eq(managedCorporations.isRecruiting, true),
					or(
						ilike(managedCorporations.name, `%${query}%`),
						ilike(managedCorporations.ticker, `%${query}%`)
					)
				)
			)
			.limit(20)

		return c.json(results)
	} catch (error) {
		logger.error('Error searching member corporations:', error)
		return c.json({ error: 'Failed to search member corporations' }, 500)
	}
})

/**
 * GET /corporations/browse/:corporationId
 * Get detailed information about a specific corporation for the detail page
 * Returns full corporation details including description and application instructions
 */
app.get('/browse/:corporationId', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const corporation = await db.query.managedCorporations.findFirst({
			where: and(
				eq(managedCorporations.corporationId, corporationId),
				eq(managedCorporations.isRecruiting, true)
			),
		})

		if (!corporation) {
			return c.json({ error: 'Corporation not found or not recruiting' }, 404)
		}

		// Return corporation details
		return c.json(corporation)
	} catch (error) {
		logger.error('Error fetching corporation details:', error)
		return c.json({ error: 'Failed to fetch corporation details' }, 500)
	}
})

/**
 * PATCH /my-corporations/:corporationId/settings
 * Update corporation recruiting settings (CEO or admin only)
 * Updates isRecruiting, shortDescription, and fullDescription fields
 */
app.patch('/my-corporations/:corporationId/settings', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	// Authorization check - user must be CEO or site admin
	try {
		await checkCeoOrAdminAccess(c, corporationId)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Access denied' }, 403)
	}

	// Parse and validate request body
	const body = await c.req.json()
	const { isRecruiting, shortDescription, fullDescription } = body

	// Validate short description length
	if (shortDescription !== undefined && typeof shortDescription === 'string' && shortDescription.length > 250) {
		return c.json({ error: 'Short description must not exceed 250 characters' }, 400)
	}

	try {
		// Build update object with only provided fields
		const updateData: Record<string, any> = {
			updatedAt: new Date(),
		}

		if (isRecruiting !== undefined) {
			updateData.isRecruiting = isRecruiting
		}
		if (shortDescription !== undefined) {
			updateData.shortDescription = shortDescription || null
		}
		if (fullDescription !== undefined) {
			updateData.fullDescription = fullDescription || null
		}

		// Update corporation
		const [updatedCorporation] = await db
			.update(managedCorporations)
			.set(updateData)
			.where(eq(managedCorporations.corporationId, corporationId))
			.returning()

		logger.info('[Corporations] Settings updated', {
			corporationId,
			updatedBy: user.id,
			fields: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
		})

		return c.json(updatedCorporation)
	} catch (error) {
		logger.error('[Corporations] Failed to update settings', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to update corporation settings' }, 500)
	}
})

/**
 * POST /corporations
 * Add a new corporation for management
 *
 * Body: {
 *   corporationId: string
 *   name: string
 *   ticker: string
 *   assignedCharacterId?: string
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
		const {
			corporationId,
			name,
			ticker,
			assignedCharacterId,
			assignedCharacterName,
			includeInBackgroundRefresh,
		} = body

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
				includeInBackgroundRefresh: includeInBackgroundRefresh ?? false,
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
				const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)

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
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

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
			const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
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
 *   assignedCharacterId?: string
 *   assignedCharacterName?: string
 *   isActive?: boolean
 *   isMemberCorporation?: boolean
 *   isAltCorp?: boolean
 *   isSpecialPurpose?: boolean
 *   discordGuildId?: string | null
 *   discordGuildName?: string | null
 *   discordAutoInvite?: boolean
 * }
 */
app.put('/:corporationId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const {
			assignedCharacterId,
			assignedCharacterName,
			isActive,
			includeInBackgroundRefresh,
			isMemberCorporation,
			isAltCorp,
			isSpecialPurpose,
			discordGuildId,
			discordGuildName,
			discordAutoInvite,
		} = body

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
				...(includeInBackgroundRefresh !== undefined && { includeInBackgroundRefresh }),
				...(isMemberCorporation !== undefined && { isMemberCorporation }),
				...(isAltCorp !== undefined && { isAltCorp }),
				...(isSpecialPurpose !== undefined && { isSpecialPurpose }),
				...(discordGuildId !== undefined && { discordGuildId }),
				...(discordGuildName !== undefined && { discordGuildName }),
				...(discordAutoInvite !== undefined && { discordAutoInvite }),
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
				const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
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
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

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
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	logger.info('[Corporations] Verify access request', { corporationId })

	if (!db) {
		logger.error('[Corporations] Database not available')
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// Verify access via Durable Object
		logger.info('[Corporations] Getting DO stub', { corporationId, stubId: corporationId })
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)

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
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	logger.info('[Corporations] Fetch data request', { corporationId })

	if (!db) {
		logger.error('[Corporations] Database not available for fetch')
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { category = 'all', forceRefresh = false } = body

		logger.info('[Corporations] Fetch parameters', { corporationId, category, forceRefresh })

		// Fetch data via Durable Object
		logger.info('[Corporations] Getting DO stub for fetch', {
			corporationId,
			stubId: corporationId,
		})
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)

		logger.info('[Corporations] Calling fetch method on DO', { corporationId, category })

		switch (category) {
			case 'public':
				logger.info('[Corporations] Fetching public data', { corporationId })
				await stub.fetchPublicData(corporationId, forceRefresh)
				break
			case 'core':
				logger.info('[Corporations] Fetching core data', { corporationId })
				await stub.fetchCoreData(corporationId, forceRefresh)
				break
			case 'financial':
				logger.info('[Corporations] Fetching financial data', { corporationId })
				await stub.fetchFinancialData(corporationId, undefined, forceRefresh)
				break
			case 'assets':
				logger.info('[Corporations] Fetching assets data', { corporationId })
				await stub.fetchAssetsData(corporationId, forceRefresh)
				break
			case 'market':
				logger.info('[Corporations] Fetching market data', { corporationId })
				await stub.fetchMarketData(corporationId, forceRefresh)
				break
			case 'killmails':
				logger.info('[Corporations] Fetching killmails', { corporationId })
				await stub.fetchKillmails(corporationId, forceRefresh)
				break
			case 'all':
			default:
				logger.info('[Corporations] Fetching all corporation data', { corporationId })
				await stub.fetchAllCorporationData(corporationId, forceRefresh)
				break
		}

		logger.info('[Corporations] Data fetch completed, updating last sync timestamp', {
			corporationId,
		})

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
	const corporationId = c.req.param('corporationId')

	logger.info('[Corporations] Get data summary request', { corporationId })

	try {
		logger.info('[Corporations] Getting DO stub for data summary', {
			corporationId,
			stubId: corporationId,
		})
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)

		logger.info('[Corporations] Fetching all data from DO', { corporationId })
		const [publicInfo, coreData, financialData, assetsData, marketData, killmails] =
			await Promise.all([
				stub.getCorporationInfo(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getCorporationInfo failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getCoreData(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getCoreData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getFinancialData(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getFinancialData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getAssetsData(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getAssetsData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getMarketData(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getMarketData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getKillmails(corporationId, 10).catch((e: unknown) => {
					logger.error('[Corporations] getKillmails failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return []
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

		return c.json(responseData)
	} catch (error) {
		logger.error('[Corporations] Error fetching corporation data summary', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to fetch data summary' }, 500)
	}
})

/**
 * GET /corporations/:corporationId/members
 * Get all members of a corporation (requires CEO/director access)
 *
 * Returns comprehensive member data including auth link status
 */
app.get('/:corporationId/members', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	logger.info('[Corporations] Get members request', { corporationId, userId: user.id })

	try {
		// Check if corporation is managed
		const managedCorp = await db.query.managedCorporations.findFirst({
			where: and(
				eq(managedCorporations.corporationId, corporationId),
				eq(managedCorporations.isActive, true)
			),
		})

		if (!managedCorp) {
			return c.json({ error: 'Corporation not found or not managed' }, 404)
		}

		// Check if user has CEO/Director/Admin access
		let userRole: 'admin' | 'CEO' | 'Director'
		try {
			const access = await checkCorporationAccess(c, corporationId)
			userRole = access.role
		} catch (error) {
			// Authorization failed - return 403
			return c.json(
				{ error: error instanceof Error ? error.message : 'Access denied' },
				403
			)
		}

		logger.info('[Corporations] User has access', { corporationId, userId: user.id, userRole })

		// Check cache for member data
		const cacheKey = getCorpMembersCacheKey(corporationId)
		const cached = await getCachedJson<
			Array<{
				characterId: string
				characterName: string
				corporationId: string
				corporationName: string
				role: 'CEO' | 'Director' | 'Member'
				hasAuthAccount: boolean
				authUserId?: string
				authUserName?: string
				joinDate: string
				lastEsiUpdate: string
				lastLogin?: string
				allianceId?: string
				allianceName?: string
				locationSystem?: string
				locationRegion?: string
				activityStatus: 'active' | 'inactive' | 'unknown'
			}>
		>(cacheKey)

		if (cached) {
			logger.info('[Corporations] Returning cached member data', {
				corporationId,
				memberCount: cached.length,
			})
			return c.json(cached)
		}

		// Get corporation members from DO
		const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		const [corpInfo, coreData] = await Promise.all([
			corpStub.getCorporationInfo(corporationId),
			corpStub.getCoreData(corporationId),
		])

		if (!coreData || !coreData.members) {
			return c.json([])
		}

		// Collect all member character IDs first
		const memberCharacterIds = coreData.members.map((m) => String(m.characterId))

		// Batch query: only fetch linked characters for THIS corporation's members
		const linkedCharacters =
			memberCharacterIds.length > 0
				? await db.query.userCharacters.findMany({
						where: inArray(userCharacters.characterId, memberCharacterIds),
					})
				: []

		const linkedCharacterMap = new Map(linkedCharacters.map((c) => [c.characterId, c]))

		// Fetch directors list once for role determination
		const directors = await corpStub.getDirectors(corporationId)
		const directorIds = new Set(directors.map((d) => d.characterId))

		// Batch resolve all character names using ESI bulk endpoint
		// Character ID → name mappings are cached for 1 year (essentially permanent)
		const tokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
		const characterNameMap = await tokenStoreStub.resolveIds(memberCharacterIds)

		logger.info('[Corporations Members] Resolved character names', {
			corporationId,
			totalMembers: memberCharacterIds.length,
			resolvedCount: Object.keys(characterNameMap).length,
			unresolvedCount: memberCharacterIds.length - Object.keys(characterNameMap).length,
		})

		// Process members with comprehensive data
		const membersWithDetails = await Promise.all(
			coreData.members.map(async (member) => {
				const characterId = String(member.characterId)

				// Check auth link status using the map
				const linkedChar = linkedCharacterMap.get(characterId)
				const hasAuthAccount = !!linkedChar

				// Determine role using pre-fetched data
				let role: 'CEO' | 'Director' | 'Member' = 'Member'
				if (corpInfo && String(corpInfo.ceoId) === characterId) {
					role = 'CEO'
				} else if (directorIds.has(characterId)) {
					role = 'Director'
				}

				// Find member tracking data if available
				const tracking = coreData.memberTracking?.find((t) => t.characterId === characterId)

				// Get character name from resolved names (returns Record<string, string>)
				const characterName = characterNameMap[characterId] || 'Unknown'

				return {
					characterId,
					characterName,
					corporationId,
					corporationName: managedCorp.name,
					role,
					hasAuthAccount,
					authUserId: linkedChar?.userId,
					authUserName: linkedChar?.characterName,
					joinDate: tracking?.startDate?.toISOString() || member.updatedAt.toISOString(),
					lastEsiUpdate: member.updatedAt.toISOString(),
					lastLogin: tracking?.logonDate?.toISOString(),
					allianceId: corpInfo?.allianceId ? String(corpInfo.allianceId) : undefined,
					allianceName: undefined, // Not available in CorporationPublicData
					locationSystem: undefined, // Would need additional ESI scopes
					locationRegion: undefined, // Would need to be resolved from system ID
					activityStatus: tracking?.logonDate
						? (new Date().getTime() - tracking.logonDate.getTime() < 7 * 24 * 60 * 60 * 1000
							? 'active'
							: 'inactive')
						: 'unknown',
				}
			})
		)

		// Sort by role (CEO first, then Directors, then Members), then by name
		membersWithDetails.sort((a, b) => {
			const roleOrder = { CEO: 0, Director: 1, Member: 2 }
			const roleDiff = roleOrder[a.role] - roleOrder[b.role]
			if (roleDiff !== 0) return roleDiff
			return a.characterName.localeCompare(b.characterName)
		})

		logger.info('[Corporations] Members fetched successfully', {
			corporationId,
			memberCount: membersWithDetails.length,
		})

		// Store in cache for future requests
		await cacheJson(cacheKey, membersWithDetails, CACHE_TTL)

		return c.json(membersWithDetails)
	} catch (error) {
		logger.error('[Corporations] Error fetching corporation members', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to fetch corporation members' }, 500)
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
 *
 * Body: {
 *   characterId: string
 *   characterName: string
 *   priority?: number
 * }
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

		// Update managedCorporations to set primary director if this is the first one
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
 *
 * Body: {
 *   priority: number
 * }
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

		// Update managedCorporations with healthy director count
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

// ============================================================================
// DISCORD SERVER MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /corporations/:corporationId/discord-servers
 * Get all Discord server attachments for a corporation
 */
app.get('/:corporationId/discord-servers', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const attachments = await db.query.corporationDiscordServers.findMany({
			where: eq(corporationDiscordServers.corporationId, corporationId),
			with: {
				discordServer: {
					with: {
						roles: true,
					},
				},
				roles: {
					with: {
						discordRole: true,
					},
				},
			},
			orderBy: desc(corporationDiscordServers.createdAt),
		})

		return c.json(attachments)
	} catch (error) {
		logger.error('Error fetching corporation Discord servers:', error)
		return c.json({ error: 'Failed to fetch Discord servers' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/discord-servers
 * Attach a Discord server to the corporation
 *
 * Body: {
 *   discordServerId: string (UUID from registry)
 *   autoInvite?: boolean
 *   autoAssignRoles?: boolean
 * }
 */
app.post('/:corporationId/discord-servers', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { discordServerId, autoInvite = false, autoAssignRoles = false } = body

		if (!discordServerId) {
			return c.json({ error: 'discordServerId is required' }, 400)
		}

		// Check if Discord server exists in registry
		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, discordServerId),
		})

		if (!server) {
			return c.json({ error: 'Discord server not found in registry' }, 404)
		}

		// Check if already attached
		const existing = await db.query.corporationDiscordServers.findFirst({
			where: and(
				eq(corporationDiscordServers.corporationId, corporationId),
				eq(corporationDiscordServers.discordServerId, discordServerId)
			),
		})

		if (existing) {
			return c.json({ error: 'Discord server already attached to this corporation' }, 409)
		}

		// Create attachment
		const [attachment] = await db
			.insert(corporationDiscordServers)
			.values({
				corporationId,
				discordServerId,
				autoInvite,
				autoAssignRoles,
			})
			.returning()

		logger.info(`Discord server ${server.guildName} attached to corporation ${corporationId}`)

		return c.json(attachment, 201)
	} catch (error) {
		logger.error('Error attaching Discord server to corporation:', error)
		return c.json({ error: 'Failed to attach Discord server' }, 500)
	}
})

/**
 * GET /corporations/:corporationId/discord-servers/:attachmentId
 * Get a specific Discord server attachment with roles
 */
app.get(
	'/:corporationId/discord-servers/:attachmentId',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const attachmentId = c.req.param('attachmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			const attachment = await db.query.corporationDiscordServers.findFirst({
				where: eq(corporationDiscordServers.id, attachmentId),
				with: {
					discordServer: {
						with: {
							roles: true,
						},
					},
					roles: {
						with: {
							discordRole: true,
						},
					},
				},
			})

			if (!attachment) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			return c.json(attachment)
		} catch (error) {
			logger.error('Error fetching Discord server attachment:', error)
			return c.json({ error: 'Failed to fetch Discord server attachment' }, 500)
		}
	}
)

/**
 * PUT /corporations/:corporationId/discord-servers/:attachmentId
 * Update Discord server attachment settings
 *
 * Body: {
 *   autoInvite?: boolean
 *   autoAssignRoles?: boolean
 * }
 */
app.put(
	'/:corporationId/discord-servers/:attachmentId',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const attachmentId = c.req.param('attachmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			const body = await c.req.json()
			const { autoInvite, autoAssignRoles } = body

			// Check if attachment exists
			const existing = await db.query.corporationDiscordServers.findFirst({
				where: eq(corporationDiscordServers.id, attachmentId),
			})

			if (!existing) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			// Update attachment
			const [updated] = await db
				.update(corporationDiscordServers)
				.set({
					...(autoInvite !== undefined && { autoInvite }),
					...(autoAssignRoles !== undefined && { autoAssignRoles }),
					updatedAt: new Date(),
				})
				.where(eq(corporationDiscordServers.id, attachmentId))
				.returning()

			return c.json(updated)
		} catch (error) {
			logger.error('Error updating Discord server attachment:', error)
			return c.json({ error: 'Failed to update Discord server attachment' }, 500)
		}
	}
)

/**
 * DELETE /corporations/:corporationId/discord-servers/:attachmentId
 * Remove Discord server attachment from corporation
 */
app.delete(
	'/:corporationId/discord-servers/:attachmentId',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const attachmentId = c.req.param('attachmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			// Check if attachment exists
			const existing = await db.query.corporationDiscordServers.findFirst({
				where: eq(corporationDiscordServers.id, attachmentId),
			})

			if (!existing) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			// Delete attachment (cascade will handle role assignments)
			await db
				.delete(corporationDiscordServers)
				.where(eq(corporationDiscordServers.id, attachmentId))

			logger.info(`Discord server attachment ${attachmentId} removed`)

			return c.json({ success: true })
		} catch (error) {
			logger.error('Error removing Discord server attachment:', error)
			return c.json({ error: 'Failed to remove Discord server attachment' }, 500)
		}
	}
)

/**
 * POST /corporations/:corporationId/discord-servers/:attachmentId/roles
 * Assign a role to the Discord server attachment
 *
 * Body: {
 *   discordRoleId: string (UUID from discord_roles table)
 * }
 */
app.post(
	'/:corporationId/discord-servers/:attachmentId/roles',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const attachmentId = c.req.param('attachmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			const body = await c.req.json()
			const { discordRoleId } = body

			if (!discordRoleId) {
				return c.json({ error: 'discordRoleId is required' }, 400)
			}

			// Check if attachment exists
			const attachment = await db.query.corporationDiscordServers.findFirst({
				where: eq(corporationDiscordServers.id, attachmentId),
			})

			if (!attachment) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			// Check if role exists and belongs to this Discord server
			const role = await db.query.discordRoles.findFirst({
				where: eq(discordRoles.id, discordRoleId),
			})

			if (!role) {
				return c.json({ error: 'Discord role not found' }, 404)
			}

			if (role.discordServerId !== attachment.discordServerId) {
				return c.json({ error: 'Role does not belong to this Discord server' }, 400)
			}

			// Check if role already assigned
			const existingAssignment = await db.query.corporationDiscordServerRoles.findFirst({
				where: and(
					eq(corporationDiscordServerRoles.corporationDiscordServerId, attachmentId),
					eq(corporationDiscordServerRoles.discordRoleId, discordRoleId)
				),
			})

			if (existingAssignment) {
				return c.json({ error: 'Role already assigned to this attachment' }, 409)
			}

			// Create role assignment
			const [roleAssignment] = await db
				.insert(corporationDiscordServerRoles)
				.values({
					corporationDiscordServerId: attachmentId,
					discordRoleId,
				})
				.returning()

			logger.info(
				`Role ${role.roleName} assigned to corporation Discord attachment ${attachmentId}`
			)

			return c.json(roleAssignment, 201)
		} catch (error) {
			logger.error('Error assigning role to Discord server attachment:', error)
			return c.json({ error: 'Failed to assign role' }, 500)
		}
	}
)

/**
 * DELETE /corporations/:corporationId/discord-servers/:attachmentId/roles/:roleAssignmentId
 * Remove a role assignment from the Discord server attachment
 */
app.delete(
	'/:corporationId/discord-servers/:attachmentId/roles/:roleAssignmentId',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const roleAssignmentId = c.req.param('roleAssignmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			// Check if role assignment exists
			const existing = await db.query.corporationDiscordServerRoles.findFirst({
				where: eq(corporationDiscordServerRoles.id, roleAssignmentId),
			})

			if (!existing) {
				return c.json({ error: 'Role assignment not found' }, 404)
			}

			// Delete role assignment
			await db
				.delete(corporationDiscordServerRoles)
				.where(eq(corporationDiscordServerRoles.id, roleAssignmentId))

			logger.info(`Role assignment ${roleAssignmentId} removed`)

			return c.json({ success: true })
		} catch (error) {
			logger.error('Error removing role assignment:', error)
			return c.json({ error: 'Failed to remove role assignment' }, 500)
		}
	}
)

export default app
