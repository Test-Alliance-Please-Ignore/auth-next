import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { createEveCharacterId } from '@repo/eve-types'
import { logger, TimeCache } from '@repo/hono-helpers'

import { getCachedCharacterPermissions, getCachedUserPermissions } from '../lib/groups-cache'
import { requireAdmin, requireAuth } from '../middleware/session'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { CharacterForFleetJoin, Fleets } from '@repo/fleets'
import type { App } from '../context'

/**
 * Permission check cache - 15 second TTL
 * Caches the boolean result of permission checks
 */
const permissionCache = new TimeCache<boolean>(15000)

/**
 * Helper function to check if a character has a specific permission
 * Checks both user permissions and character permissions
 * Results are cached for 15 seconds to reduce load on Groups DO
 */
async function hasCharacterPermission(
	env: { GROUPS: DurableObjectNamespace },
	userId: string,
	characterId: string,
	permissionUrn: string,
	isAdmin: boolean
): Promise<boolean> {
	// Admins bypass permission checks
	if (isAdmin) {
		return true
	}

	// Check cache or fetch permissions
	const cacheKey = `${userId}:${characterId}:${permissionUrn}`
	return permissionCache.getOrSet(cacheKey, async () => {
		// Check user group permissions first (cached)
		const groupPermissions = await getCachedUserPermissions(env, userId)

		if (groupPermissions.some((p) => p.urn === permissionUrn)) {
			return true
		}

		// Check character permissions (cached)
		const characterPermissions = await getCachedCharacterPermissions(env, characterId)
		return characterPermissions.some((p) => p.urn === permissionUrn)
	})
}

const app = new Hono<App>()

// All fleet endpoints require authentication
app.use('*', requireAuth())

/**
 * GET /fleets/character/:characterId
 * Get character's current fleet information
 */
app.get('/character/:characterId', async (c) => {
	const characterId = c.req.param('characterId')
	const user = c.get('user')!

	// Verify user owns the character
	const ownsCharacter = user.characters.some((char) => char.characterId.toString() === characterId)

	if (!ownsCharacter) {
		return c.json({ error: 'You do not own this character' }, 403)
	}

	try {
		// Get Fleets DO stub
		const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

		// Get character's fleet information
		const eveCharacterId = createEveCharacterId(characterId)

		logger.info('Fetching fleet information for character', {
			characterId,
			eveCharacterId,
			userId: user.id,
		})

		const fleetInfo = await fleetsStub.getCharacterFleetInformation(eveCharacterId)

		logger.info('Fleet information retrieved', {
			characterId,
			fleetInfo,
			fleetId: fleetInfo.fleet_id,
			fleetBossId: fleetInfo.fleet_boss_id,
			role: fleetInfo.role,
			squadId: fleetInfo.squad_id,
			wingId: fleetInfo.wing_id,
		})

		// Check if character is in a fleet (fleet_id !== '0' means in fleet)
		// fleet_id is now a string from the DO
		const isInFleet = fleetInfo.fleet_id !== '0'

		logger.info('Fleet membership status', {
			characterId,
			isInFleet,
			fleetId: fleetInfo.fleet_id,
			fleetBossId: fleetInfo.fleet_boss_id,
			isBoss: fleetInfo.fleet_boss_id === characterId,
		})

		return c.json({
			isInFleet,
			fleet_id: String(fleetInfo.fleet_id),
			fleet_boss_id: String(fleetInfo.fleet_boss_id),
			role: fleetInfo.role,
			squad_id: fleetInfo.squad_id,
			wing_id: fleetInfo.wing_id,
			// Include debug info temporarily
			debug: {
				characterId,
				rawFleetId: fleetInfo.fleet_id,
				isValidFleet: fleetInfo.fleet_id !== '0',
				isBoss: String(fleetInfo.fleet_boss_id) === characterId,
				timestamp: new Date().toISOString(),
			},
		})
	} catch (error) {
		logger.error('Failed to get character fleet info:', error)
		return c.json({ error: 'Failed to get fleet information' }, 500)
	}
})

/**
 * POST /fleets/quick-join/create
 * Create a quick join invitation for a fleet
 *
 * Body: {
 *   characterId: string - FC's character ID
 *   fleetId: string - ESI fleet ID
 *   expiresInHours?: number - Hours until expiry (default 24)
 *   maxUses?: number - Maximum uses for the invitation
 * }
 */
app.post('/quick-join/create', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json<{
		characterId: string
		fleetId: string
		expiresInHours?: number
		maxUses?: number
	}>()

	// Verify user owns the character
	const ownsCharacter = user.characters.some(
		(char) => char.characterId.toString() === body.characterId
	)

	if (!ownsCharacter) {
		return c.json({ error: 'You do not own this character' }, 403)
	}

	try {
		// Get Fleets DO stub (using 'default' instance)
		const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

		// Create the invitation
		const result = await fleetsStub.createQuickJoinInvitation(
			body.characterId,
			body.fleetId,
			body.expiresInHours,
			body.maxUses
		)

		return c.json(result)
	} catch (error) {
		logger.error('Failed to create quick join invitation:', error)
		return c.json({ error: 'Failed to create invitation' }, 500)
	}
})

/**
 * GET /fleets/quick-join/:token/validate
 * Validate a quick join token and get fleet information
 */
app.get('/quick-join/:token/validate', async (c) => {
	const token = c.req.param('token')
	const user = c.get('user')!

	try {
		// Get Fleets DO stub
		const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

		// Validate the token
		const validation = await fleetsStub.validateQuickJoinToken(token)

		if (!validation.valid) {
			return c.json(validation, 400)
		}

		// Get user's characters for selection
		const tokenStore = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
		const characterData = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

		// Fetch character details for all user's characters
		const charactersForJoin: CharacterForFleetJoin[] = await Promise.all(
			user.characters.map(async (char) => {
				const characterId = char.characterId.toString()

				// Check if character has valid ESI token
				const hasValidToken = (await tokenStore.getAccessToken(characterId)) !== null

				const info = await characterData.getCharacterInfo(characterId)

				return {
					characterId,
					characterName: info?.name || char.characterName,
					hasValidToken,
					corporationId: info?.corporationId?.toString(),
					corporationName: undefined, // Will be resolved if needed
				}
			})
		)

		// Sort alphabetically by name
		charactersForJoin.sort((a, b) => a.characterName.localeCompare(b.characterName))

		return c.json({
			...validation,
			characters: charactersForJoin,
		})
	} catch (error) {
		logger.error('Failed to validate quick join token:', error)
		return c.json({ error: 'Failed to validate token' }, 500)
	}
})

/**
 * POST /fleets/quick-join/:token/join
 * Join a fleet using a quick join token
 *
 * Body: {
 *   characterId: string - Character to join with
 * }
 */
app.post('/quick-join/:token/join', async (c) => {
	const token = c.req.param('token')
	const user = c.get('user')!
	const body = await c.req.json<{ characterId: string }>()

	// Verify user owns the character
	const ownsCharacter = user.characters.some(
		(char) => char.characterId.toString() === body.characterId
	)

	if (!ownsCharacter) {
		return c.json({ error: 'You do not own this character' }, 403)
	}

	try {
		// Get Fleets DO stub
		const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

		// Join the fleet
		const result = await fleetsStub.joinFleetViaQuickJoin(
			token,
			user.mainCharacterId.toString(), // User making the request
			body.characterId // Character to join with
		)

		return c.json(result)
	} catch (error) {
		logger.error('Failed to join fleet via quick join:', error)
		return c.json({ error: 'Failed to join fleet' }, 500)
	}
})

/**
 * GET /fleets/:fleetId
 * Get detailed fleet information
 */
app.get('/:fleetId', async (c) => {
	const fleetId = c.req.param('fleetId')
	const user = c.get('user')!

	// Use the user's main character for ESI access
	const characterId = user.mainCharacterId.toString()

	try {
		// Get Fleets DO stub
		const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

		// Get fleet details
		const details = await fleetsStub.getFleetDetails(fleetId, characterId)

		return c.json(details)
	} catch (error) {
		logger.error('Failed to get fleet details:', error)
		return c.json({ error: 'Failed to get fleet details' }, 500)
	}
})

/**
 * DELETE /fleets/quick-join/:token
 * Revoke a quick join invitation
 */
app.delete('/quick-join/:token', async (c) => {
	const token = c.req.param('token')
	const user = c.get('user')!

	// We need to get the characterId from the request or use main
	const characterId = c.req.query('characterId') || user.mainCharacterId.toString()

	// Verify user owns the character if specified
	if (c.req.query('characterId')) {
		const ownsCharacter = user.characters.some(
			(char) => char.characterId.toString() === characterId
		)

		if (!ownsCharacter) {
			return c.json({ error: 'You do not own this character' }, 403)
		}
	}

	try {
		// Get Fleets DO stub
		const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

		// Revoke the invitation
		const success = await fleetsStub.revokeQuickJoinInvitation(token, characterId)

		if (!success) {
			return c.json({ error: 'Failed to revoke invitation' }, 400)
		}

		return c.json({ success: true })
	} catch (error) {
		logger.error('Failed to revoke quick join invitation:', error)
		return c.json({ error: 'Failed to revoke invitation' }, 500)
	}
})

/**
 * GET /fleets/monitoring
 * List all characters that are currently monitored (admin only)
 */
app.get('/monitoring', requireAdmin(), async (c) => {
	try {
		// Get Fleets DO stub
		const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

		// Get all monitored commanders
		const monitoredCommanders = await fleetsStub.listMonitoredFleetCommanders()

		// Get character data for all monitored characters
		const characterData = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

		const characters = await Promise.all(
			monitoredCommanders.map(async (characterId) => {
				// Try to get character info for additional metadata
				try {
					const info = await characterData.getCharacterInfo(characterId)
					return {
						characterId,
						characterName: info?.name || characterId,
					}
				} catch (error) {
					logger.warn('Failed to get character info for monitored character', {
						characterId,
						error: error instanceof Error ? error.message : String(error),
					})
					return {
						characterId,
						characterName: characterId, // Fallback if not found
					}
				}
			})
		)

		return c.json({
			characterIds: monitoredCommanders,
			characters,
		})
	} catch (error) {
		logger.error('Failed to list monitored characters:', error)
		return c.json({ error: 'Failed to list monitored characters' }, 500)
	}
})

/**
 * POST /fleets/monitoring
 * Enable fleet monitoring for a character
 *
 * Body: {
 *   characterId: string - Character ID to enable monitoring for
 * }
 */
app.post('/monitoring', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json<{ characterId: string }>()

	if (!body.characterId || typeof body.characterId !== 'string' || body.characterId.trim() === '') {
		return c.json({ error: 'characterId is required' }, 400)
	}

	const characterId = body.characterId.trim()

	// Verify user owns the character
	const ownsCharacter = user.characters.some((char) => char.characterId.toString() === characterId)

	if (!ownsCharacter) {
		return c.json({ error: 'You do not own this character' }, 403)
	}

	try {
		// Check if user/character has fleet commander permission
		const hasPermission = await hasCharacterPermission(
			c.env,
			user.id,
			characterId,
			'urn:military:is-fleet-commander',
			user.is_admin
		)

		if (!hasPermission) {
			return c.json(
				{
					error:
						'You do not have permission to enable fleet monitoring. Requires fleet commander permission.',
				},
				403
			)
		}

		// Verify character has valid ESI token
		const tokenStore = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
		const tokenInfo = await tokenStore.getTokenInfo(characterId)

		if (!tokenInfo) {
			return c.json(
				{
					error: 'Character does not have a valid ESI token. Please re-authenticate.',
				},
				400
			)
		}

		// Check if token is expired
		if (tokenInfo.expiresAt && new Date(tokenInfo.expiresAt) < new Date()) {
			return c.json(
				{
					error: 'Character token has expired. Please re-authenticate.',
				},
				400
			)
		}

		// Get Fleets DO stub
		const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

		// Add character to monitored list
		const added = await fleetsStub.addMonitoredFleetCommander(characterId)

		if (!added) {
			return c.json(
				{
					error: 'Character is already being monitored',
				},
				409
			)
		}

		logger.info('Fleet monitoring enabled for character', {
			characterId,
			userId: user.id,
		})

		return c.json({ characterId }, 201)
	} catch (error) {
		logger.error('Failed to enable fleet monitoring:', error)
		return c.json({ error: 'Failed to enable fleet monitoring' }, 500)
	}
})

/**
 * DELETE /fleets/monitoring/:characterId
 * Disable fleet monitoring for a character
 */
app.delete('/monitoring/:characterId', async (c) => {
	const characterId = c.req.param('characterId')
	const user = c.get('user')!

	// Verify user owns the character
	const ownsCharacter = user.characters.some((char) => char.characterId.toString() === characterId)

	if (!ownsCharacter) {
		return c.json({ error: 'You do not own this character' }, 403)
	}

	try {
		// Get Fleets DO stub
		const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

		// Remove character from monitored list
		const removed = await fleetsStub.removeMonitoredFleetCommander(characterId)

		if (!removed) {
			return c.json(
				{
					error: 'Character is not being monitored',
				},
				404
			)
		}

		logger.info('Fleet monitoring disabled for character', {
			characterId,
			userId: user.id,
		})

		return new Response(null, { status: 204 })
	} catch (error) {
		logger.error('Failed to disable fleet monitoring:', error)
		return c.json({ error: 'Failed to disable fleet monitoring' }, 500)
	}
})

export default app
