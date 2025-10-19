import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../middleware/session'
import { getStub } from '@repo/do-utils'
import type { App } from '../context'
import type { EveCharacterData } from '@repo/eve-character-data'

const app = new Hono<App>()

/**
 * GET /characters/:characterId
 * Get detailed character information with access control
 *
 * Returns:
 * - Public data for all authenticated users
 * - Sensitive data only for character owner
 */
app.get('/:characterId', requireAuth(), async (c) => {
	const characterId = Number.parseInt(c.req.param('characterId'))
	const user = c.get('user')!
	const db = c.get('db')

	if (isNaN(characterId)) {
		return c.json({ error: 'Invalid character ID' }, 400)
	}

	// Check if user owns this character
	const isOwner = user.characters.some(char => char.characterId === characterId)

	// Get EVE Character Data DO stub
	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

	try {
		// Fetch all public character data pieces
		const [info, portrait, corporationHistory, skills, attributes, lastUpdated] = await Promise.all([
			eveCharacterDataStub.getCharacterInfo(characterId),
			eveCharacterDataStub.getPortrait(characterId),
			eveCharacterDataStub.getCorporationHistory(characterId),
			eveCharacterDataStub.getSkills(characterId),
			eveCharacterDataStub.getAttributes(characterId),
			eveCharacterDataStub.getLastUpdated(characterId),
		])

		if (!info) {
			return c.json({ error: 'Character not found' }, 404)
		}

		// Build response with public data
		const response: any = {
			characterId,
			isOwner,
			public: {
				info,
				portrait,
				corporationHistory,
				skills,
				attributes,
			},
			lastUpdated,
		}

		// Add sensitive data if user owns the character
		if (isOwner) {
			// Fetch sensitive data from DO (location, wallet, etc.)
			// These would be fetched via authenticated ESI calls
			const sensitiveData = await eveCharacterDataStub.getSensitiveData(characterId)

			if (sensitiveData) {
				response.private = {
					location: sensitiveData.location,
					wallet: sensitiveData.wallet,
					assets: sensitiveData.assets,
					status: sensitiveData.status,
					skillQueue: sensitiveData.skillQueue,
				}
			}
		}

		return c.json(response)
	} catch (error) {
		console.error('Error fetching character data:', error)
		return c.json({ error: 'Failed to fetch character data' }, 500)
	}
})

/**
 * POST /characters/:characterId/refresh
 * Refresh character data from ESI
 * Only available to character owner
 */
app.post('/:characterId/refresh', requireAuth(), async (c) => {
	const characterId = Number.parseInt(c.req.param('characterId'))
	const user = c.get('user')!

	if (isNaN(characterId)) {
		return c.json({ error: 'Invalid character ID' }, 400)
	}

	// Check if user owns this character
	const character = user.characters.find(char => char.characterId === characterId)
	if (!character) {
		return c.json({ error: 'Character not found or not owned by user' }, 403)
	}

	// Get EVE Character Data DO stub
	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

	// Get EVE Token Store DO stub for authenticated data
	const eveTokenStoreStub = c.get('eveTokenStore')!

	try {
		// Check token info first to verify scopes
		const tokenInfo = await eveTokenStoreStub.getTokenInfo(characterId)
		console.log('Token info for character', characterId, ':', tokenInfo)

		// Always fetch public data (doesn't require auth)
		await eveCharacterDataStub.fetchCharacterData(characterId, true)

		// Try to fetch authenticated data - the token store will handle checking if a valid token exists
		let hasValidToken = false
		let authError: string | undefined
		try {
			await eveCharacterDataStub.fetchAuthenticatedData(characterId, true)
			hasValidToken = true
		} catch (error) {
			// If authenticated data fetch fails, token is likely missing or invalid
			authError = error instanceof Error ? error.message : String(error)
			console.error('Could not fetch authenticated data:', authError)
			console.error('Full error:', error)
		}

		// Get the updated data
		const lastUpdated = await eveCharacterDataStub.getLastUpdated(characterId)

		return c.json({
			success: true,
			message: hasValidToken
				? 'Character data refreshed successfully'
				: 'Public character data refreshed (no valid token for private data)',
			lastUpdated,
			hasValidToken,
			tokenInfo: tokenInfo ? {
				hasToken: true,
				scopes: tokenInfo.scopes,
				isExpired: tokenInfo.isExpired,
				expiresAt: tokenInfo.expiresAt,
			} : { hasToken: false },
			authError: hasValidToken ? undefined : authError,
		})
	} catch (error) {
		console.error('Error refreshing character data:', error)
		return c.json({ error: 'Failed to refresh character data' }, 500)
	}
})

export default app