import { eq, ilike } from 'drizzle-orm'
import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { createEveCharacterId } from '@repo/eve-types'
import { logger } from '@repo/hono-helpers'

import { userCharacters } from '../db/schema'
import { requireAuth } from '../middleware/session'
import { EntityResolverService } from '../services/entity-resolver.service'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { App } from '../context'

const app = new Hono<App>()

/**
 * GET /characters/search?q=:query
 * Search for users by main character name (for autocomplete)
 *
 * Returns array of matching main characters with userId
 */
app.get('/search', requireAuth(), async (c) => {
	const query = c.req.query('q')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	if (!query || query.length < 2) {
		return c.json({ error: 'Query must be at least 2 characters' }, 400)
	}

	try {
		// Search for main characters matching the query
		const results = await db
			.select({
				userId: userCharacters.userId,
				characterId: userCharacters.characterId,
				characterName: userCharacters.characterName,
			})
			.from(userCharacters)
			.where(ilike(userCharacters.characterName, `%${query}%`))
			.limit(20) // Limit for autocomplete performance

		return c.json(results)
	} catch (error) {
		logger.error('Error searching characters:', error)
		return c.json({ error: 'Failed to search characters' }, 500)
	}
})

/**
 * GET /characters/:characterId
 * Get detailed character information with access control
 *
 * Returns:
 * - Public data for all authenticated users
 * - Sensitive data only for character owner
 */
app.get('/:characterId', requireAuth(), async (c) => {
	const characterIdStr = c.req.param('characterId')
	const characterId = createEveCharacterId(characterIdStr)
	const user = c.get('user')!
	const db = c.get('db')

	// Check if user owns this character
	const isOwner = user.characters.some((char) => char.characterId.toString() === characterIdStr)

	// Get EVE Character Data DO stub
	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

	try {
		// Fetch all public character data pieces
		const [info, portrait, corporationHistory, skills, attributes, lastUpdated] = await Promise.all(
			[
				eveCharacterDataStub.getCharacterInfo(characterIdStr),
				eveCharacterDataStub.getPortrait(characterIdStr),
				eveCharacterDataStub.getCorporationHistory(characterIdStr),
				eveCharacterDataStub.getSkills(characterIdStr),
				eveCharacterDataStub.getAttributes(characterIdStr),
				eveCharacterDataStub.getLastUpdated(characterIdStr),
			]
		)

		if (!info) {
			return c.json({ error: 'Character not found' }, 404)
		}

		// Initialize entity resolver service
		const eveTokenStore = c.get('eveTokenStore')

		if (!eveTokenStore) {
			logger.error('eveTokenStore not found in context!')
			return c.json({ error: 'Token store not initialized' }, 500)
		}

		const resolver = new EntityResolverService(eveTokenStore)

		// Collect all entity IDs that need resolution
		const idsToResolve: string[] = [String(info.corporationId)]
		if (info.allianceId) {
			idsToResolve.push(String(info.allianceId))
		}

		// Add corporation history IDs
		if (corporationHistory && corporationHistory.length > 0) {
			const historyCorpIds: string[] = [
				...new Set<string>(
					corporationHistory.map(
						(entry: { corporationId: string; recordId: string; startDate: string; isDeleted?: boolean }) =>
							String(entry.corporationId)
					)
				),
			]
			idsToResolve.push(...historyCorpIds)
		}

		// Deduplicate all IDs (alliance might be same as a corp in history)
		const uniqueIds = [...new Set(idsToResolve)]

		// Resolve all entity names in bulk
		const entityNames = await resolver.resolveEntityNames(uniqueIds)

		// Enrich character info with resolved names
		const enrichedInfo = {
			...info,
			corporationName: entityNames.get(String(info.corporationId)) || undefined,
			allianceName: info.allianceId ? entityNames.get(String(info.allianceId)) || undefined : undefined,
		}

		// Enrich corporation history with resolved names
		const enrichedCorporationHistory = corporationHistory
			? corporationHistory.map(
					(entry: { corporationId: string; recordId: string; startDate: string; isDeleted?: boolean }) => ({
						...entry,
						corporationName: entityNames.get(String(entry.corporationId)) || `Corporation #${entry.corporationId}`,
					})
				)
			: []

		// Build response with public data
		const response: any = {
			characterId: characterIdStr,
			isOwner,
			public: {
				info: enrichedInfo,
				portrait,
				corporationHistory: enrichedCorporationHistory,
				skills,
				attributes,
			},
			lastUpdated,
		}

		// Add sensitive data if user owns the character
		if (isOwner) {
			// Fetch sensitive data from DO (location, wallet, etc.)
			// These would be fetched via authenticated ESI calls
			const sensitiveData = await eveCharacterDataStub.getSensitiveData(characterIdStr)

			if (sensitiveData) {
				// Resolve location names if available
				if (sensitiveData.location) {
					const locationIds: string[] = []

					if (sensitiveData.location.solarSystemId) {
						locationIds.push(String(sensitiveData.location.solarSystemId))
					}
					if (sensitiveData.location.stationId) {
						locationIds.push(String(sensitiveData.location.stationId))
					}

					if (locationIds.length > 0) {
						const locationNames = await resolver.resolveEntityNames(locationIds)

						response.private = {
							location: {
								...sensitiveData.location,
								solarSystemName: sensitiveData.location.solarSystemId
									? locationNames.get(String(sensitiveData.location.solarSystemId)) || undefined
									: undefined,
								stationName: sensitiveData.location.stationId
									? locationNames.get(String(sensitiveData.location.stationId)) || undefined
									: undefined,
							},
							wallet: sensitiveData.wallet,
							assets: sensitiveData.assets,
							status: sensitiveData.status,
							skillQueue: sensitiveData.skillQueue,
						}
					} else {
						response.private = {
							location: sensitiveData.location,
							wallet: sensitiveData.wallet,
							assets: sensitiveData.assets,
							status: sensitiveData.status,
							skillQueue: sensitiveData.skillQueue,
						}
					}
				} else {
					response.private = {
						wallet: sensitiveData.wallet,
						assets: sensitiveData.assets,
						status: sensitiveData.status,
						skillQueue: sensitiveData.skillQueue,
					}
				}
			}
		}

		return c.json(response)
	} catch (error) {
		logger.error('Error fetching character data:', error)
		return c.json({ error: 'Failed to fetch character data' }, 500)
	}
})

/**
 * POST /characters/:characterId/refresh
 * Refresh character data from ESI
 * Only available to character owner
 */
app.post('/:characterId/refresh', requireAuth(), async (c) => {
	const characterIdStr = c.req.param('characterId')
	const characterId = createEveCharacterId(characterIdStr)
	const user = c.get('user')!

	// Check if user owns this character
	const character = user.characters.find((char) => char.characterId.toString() === characterIdStr)
	if (!character) {
		return c.json({ error: 'Character not found or not owned by user' }, 403)
	}

	// Get EVE Character Data DO stub
	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

	// Get EVE Token Store DO stub for authenticated data
	const eveTokenStoreStub = c.get('eveTokenStore')

	if (!eveTokenStoreStub) {
		logger.error('eveTokenStore not found in context!')
		return c.json({ error: 'Token store not initialized' }, 500)
	}

	try {
		// Check token info first to verify scopes
		const tokenInfo = await eveTokenStoreStub.getTokenInfo(characterIdStr)

		// Always fetch public data (doesn't require auth)
		try {
			logger.info('Calling fetchCharacterData with characterId:', characterIdStr, 'type:', typeof characterIdStr)
			await eveCharacterDataStub.fetchCharacterData(characterIdStr, true)
			logger.info('fetchCharacterData completed successfully')
		} catch (error) {
			logger.error('Failed to fetch public character data:', error)
			logger.error('Error details - characterId:', characterId, 'characterIdStr:', characterIdStr, 'error type:', typeof error)
			throw new Error(`Failed to fetch public character data: ${error && typeof error === 'object' && 'remote' in error ? 'Durable Object connection failed' : error instanceof Error ? error.message : String(error)}`)
		}

		// Try to fetch authenticated data - the token store will handle checking if a valid token exists
		let hasValidToken = false
		let authError: string | undefined
		try {
			await eveCharacterDataStub.fetchAuthenticatedData(characterIdStr, true)
			hasValidToken = true
		} catch (error) {
			// If authenticated data fetch fails, token is likely missing or invalid
			authError = error instanceof Error ? error.message :
				(error && typeof error === 'object' && 'remote' in error ? 'Durable Object connection failed' : String(error))
			logger.error('Could not fetch authenticated data:', authError)
			logger.error('Full error:', error)
		}

		// Get the updated data
		let lastUpdated: string | null = null
		try {
			lastUpdated = await eveCharacterDataStub.getLastUpdated(characterIdStr)
		} catch (error) {
			logger.error('Failed to get last updated timestamp:', error)
			// Don't throw here, just set to null and continue
		}

		return c.json({
			success: true,
			message: hasValidToken
				? 'Character data refreshed successfully'
				: 'Public character data refreshed (no valid token for private data)',
			lastUpdated,
			hasValidToken,
			tokenInfo: tokenInfo
				? {
						hasToken: true,
						scopes: tokenInfo.scopes,
						isExpired: tokenInfo.isExpired,
						expiresAt: tokenInfo.expiresAt,
					}
				: { hasToken: false },
			authError: hasValidToken ? undefined : authError,
		})
	} catch (error) {
		// Handle specific error types for better user feedback
		let errorMessage: string
		if (error instanceof Error) {
			errorMessage = error.message
		} else if (error && typeof error === 'object' && 'remote' in error) {
			errorMessage = 'Durable Object service unavailable - please try again later'
			logger.error('Durable Object remote error:', error)
		} else {
			errorMessage = 'Unknown error occurred'
			logger.error('Unknown error refreshing character data:', error)
		}

		return c.json({
			error: 'Failed to refresh character data',
			details: errorMessage,
			success: false
		}, 500)
	}
})

export default app
