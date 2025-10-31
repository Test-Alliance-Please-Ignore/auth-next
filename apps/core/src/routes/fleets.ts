import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { createEveCharacterId } from '@repo/eve-types'
import { logger } from '@repo/hono-helpers'

import { requireAuth } from '../middleware/session'

import type { Fleets, CharacterForFleetJoin } from '@repo/fleets'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { App } from '../context'

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
	const ownsCharacter = user.characters.some(
		char => char.characterId.toString() === characterId
	)

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
			userId: user.id
		})

		const fleetInfo = await fleetsStub.getCharacterFleetInformation(eveCharacterId)

		logger.info('Fleet information retrieved', {
			characterId,
			fleetInfo,
			fleetId: fleetInfo.fleet_id,
			fleetBossId: fleetInfo.fleet_boss_id,
			role: fleetInfo.role,
			squadId: fleetInfo.squad_id,
			wingId: fleetInfo.wing_id
		})

		// Check if character is in a fleet (fleet_id !== '0' means in fleet)
		// fleet_id is now a string from the DO
		const isInFleet = fleetInfo.fleet_id !== '0'

		logger.info('Fleet membership status', {
			characterId,
			isInFleet,
			fleetId: fleetInfo.fleet_id,
			fleetBossId: fleetInfo.fleet_boss_id,
			isBoss: fleetInfo.fleet_boss_id === characterId
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
				timestamp: new Date().toISOString()
			}
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
		char => char.characterId.toString() === body.characterId
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
				const hasValidToken = await tokenStore.getAccessToken(characterId) !== null

				// Get character info and portrait
				const [info, portrait] = await Promise.all([
					characterData.getCharacterInfo(characterId),
					characterData.getPortrait(characterId)
				])

				return {
					characterId,
					characterName: info?.name || char.characterName,
					portrait: portrait ? {
						px64x64: portrait.px64x64 || '',
						px128x128: portrait.px128x128 || '',
						px256x256: portrait.px256x256 || '',
						px512x512: portrait.px512x512 || ''
					} : undefined,
					hasValidToken,
					corporationId: info?.corporationId?.toString(),
					corporationName: undefined // Will be resolved if needed
				}
			})
		)

		// Sort alphabetically by name
		charactersForJoin.sort((a, b) => a.characterName.localeCompare(b.characterName))

		return c.json({
			...validation,
			characters: charactersForJoin
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
		char => char.characterId.toString() === body.characterId
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
			char => char.characterId.toString() === characterId
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

export default app