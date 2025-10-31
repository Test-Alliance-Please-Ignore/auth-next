import { Hono } from 'hono'

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { managedCorporations, userCharacters } from '../db/schema'
import { requireAuth } from '../middleware/session'
import { ActivityService } from '../services/activity.service'
import { UserService } from '../services/user.service'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { App } from '../context'
import type { RequestMetadata, UserPreferencesDTO } from '../types/user'

/**
 * User management routes
 *
 * Handles user profile, preferences, and character management.
 * All routes require authentication.
 */
const users = new Hono<App>()

// Apply authentication to all routes
users.use('*', requireAuth())

/**
 * Helper to extract request metadata
 */
function getRequestMetadata(c: any): RequestMetadata {
	return {
		ip: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For'),
		userAgent: c.req.header('User-Agent'),
	}
}

/**
 * GET /users/me
 *
 * Get current user profile with all characters, roles, and preferences.
 */
users.get('/me', async (c) => {
	const user = c.get('user')!

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)

	// Get full user profile
	const profile = await userService.getUserProfile(user.id)

	return c.json({
		id: profile.id,
		mainCharacterId: profile.mainCharacterId,
		characters: profile.characters,
		is_admin: profile.is_admin,
		preferences: profile.preferences,
		discord: user.discord || null,
		createdAt: profile.createdAt,
		updatedAt: profile.updatedAt,
	})
})

/**
 * PATCH /users/me/preferences
 *
 * Update user preferences.
 */
users.patch('/me/preferences', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	// Validate preferences
	const preferences: UserPreferencesDTO = body.preferences || body

	// Update preferences
	const updated = await userService.updatePreferences(user.id, preferences)

	await activityService.logPreferencesUpdated(user.id, getRequestMetadata(c))

	return c.json({
		preferences: updated,
	})
})

/**
 * GET /users/me/characters
 *
 * List all linked characters for current user.
 */
users.get('/me/characters', async (c) => {
	const user = c.get('user')!

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)

	const profile = await userService.getUserProfile(user.id)

	return c.json({
		characters: profile.characters,
	})
})

/**
 * DELETE /users/me/characters/:characterId
 *
 * Unlink a character from the current user.
 * Cannot unlink primary character.
 */
users.delete('/me/characters/:characterId', async (c) => {
	const user = c.get('user')!
	const characterId = c.req.param('characterId')

	if (!characterId) {
		return c.json({ error: 'Missing character ID' }, 400)
	}

	// Validate user owns this character (defense in depth)
	const character = user.characters.find((char) => char.characterId === characterId)
	if (!character) {
		return c.json({ error: 'Character not found or not owned by user' }, 404)
	}

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	try {
		// Unlink character
		const success = await userService.unlinkCharacter(user.id, characterId)

		if (!success) {
			return c.json({ error: 'Character not found or already unlinked' }, 404)
		}

		await activityService.logCharacterUnlinked(user.id, characterId, getRequestMetadata(c))

		return c.json({
			success: true,
		})
	} catch (error) {
		if (error instanceof Error && error.message.includes('Cannot unlink primary character')) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

/**
 * POST /users/me/characters/:characterId/set-primary
 *
 * Set a character as the primary character for the user.
 */
users.post('/me/characters/:characterId/set-primary', async (c) => {
	const user = c.get('user')!
	const characterId = c.req.param('characterId')

	if (!characterId) {
		return c.json({ error: 'Missing character ID' }, 400)
	}

	// Validate user owns this character (defense in depth)
	const character = user.characters.find((char) => char.characterId === characterId)
	if (!character) {
		return c.json({ error: 'Character not found or not owned by user' }, 404)
	}

	const db = c.get('db') || createDb(c.env.DATABASE_URL)
	const userService = new UserService(db)
	const activityService = new ActivityService(db)

	try {
		// Set primary character
		const success = await userService.setPrimaryCharacter(user.id, characterId)

		if (!success) {
			return c.json({ error: 'Failed to set primary character' }, 500)
		}

		await activityService.logPrimaryCharacterChanged(
			user.id,
			user.mainCharacterId,
			characterId,
			getRequestMetadata(c)
		)

		return c.json({
			success: true,
		})
	} catch (error) {
		if (error instanceof Error && error.message.includes('Character not found')) {
			return c.json({ error: error.message }, 404)
		}
		throw error
	}
})

/**
 * GET /users/has-corporation-access
 *
 * Quick check if user has any CEO/director access (for UI navigation).
 * This is a lighter-weight version that just returns true/false.
 */
users.get('/has-corporation-access', async (c) => {
	const user = c.get('user')!
	const db = c.get('db') || createDb(c.env.DATABASE_URL)

	try {
		// Get all user's characters
		const characters = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, user.id),
		})

		if (!characters.length) {
			return c.json({ hasAccess: false })
		}

		// Get all active managed corporations
		const managedCorps = await db.query.managedCorporations.findMany({
			where: eq(managedCorporations.isActive, true),
		})

		if (!managedCorps.length) {
			return c.json({ hasAccess: false })
		}

		// Fetch corporation IDs for ALL characters (not just first 10)
		// This ensures we check all managed corporations the user has characters in
		const charCorpPromises = characters.map(async (character) => {
			try {
				const charStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
				const charData = await charStub.getCharacterInfo(character.characterId)
				return charData ? String(charData.corporation_id) : null
			} catch {
				return null
			}
		})

		const characterCorpIds = await Promise.all(charCorpPromises)
		const uniqueCorpIds = new Set(characterCorpIds.filter((id) => id !== null))

		// Check if any of these corps are managed and user has a role
		for (const corpId of uniqueCorpIds) {
			const managedCorp = managedCorps.find((c) => c.corporationId === corpId)
			if (managedCorp) {
				// Found a managed corp - quick check for any role
				try {
					const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corpId)
					const [corpInfo, directors] = await Promise.all([
						corpStub.getCorporationInfo(),
						corpStub.getDirectors(corpId),
					])

					// Check if any character is CEO or director
					for (const char of characters) {
						if (corpInfo && String(corpInfo.ceo_id) === char.characterId) {
							return c.json({ hasAccess: true })
						}
						if (directors.some((d) => d.characterId === char.characterId)) {
							return c.json({ hasAccess: true })
						}
					}
				} catch {
					continue
				}
			}
		}

		return c.json({ hasAccess: false })
	} catch (error) {
		logger.error('Error checking corporation access:', error)
		return c.json({ hasAccess: false })
	}
})

/**
 * GET /users/corporation-access
 *
 * Check if current user has CEO/director access to any managed corporations.
 * Returns list of corporations where user has leadership roles.
 * This is the full check that returns all accessible corporations.
 */
users.get('/corporation-access', async (c) => {
	const user = c.get('user')!
	const db = c.get('db') || createDb(c.env.DATABASE_URL)

	logger.info('[Corporation Access] Checking access for user', { userId: user.id })

	try {
		// Get all user's characters
		const characters = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, user.id),
		})

		logger.info('[Corporation Access] Found characters', {
			userId: user.id,
			characterCount: characters.length,
			characterIds: characters.map((c) => c.characterId),
		})

		if (!characters.length) {
			return c.json({ hasAccess: false, corporations: [] })
		}

		// Get all managed corporations
		const managedCorps = await db.query.managedCorporations.findMany({
			where: eq(managedCorporations.isActive, true),
		})

		logger.info('[Corporation Access] Found managed corporations', {
			corpCount: managedCorps.length,
			corpIds: managedCorps.map((c) => c.corporationId),
		})

		const accessibleCorporations = []

		// OPTIMIZATION: First, fetch all character corporation IDs to reduce checks
		const characterCorpMap = new Map<string, string>() // characterId -> corporationId

		logger.info('[Corporation Access] Fetching character corporation IDs...')

		// Fetch character data in parallel to get corporation IDs
		const charDataPromises = characters.map(async (character) => {
			try {
				const charStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
				const charData = await charStub.getCharacterInfo(character.characterId)
				if (charData && charData.corporation_id) {
					const corpId = String(charData.corporation_id)
					characterCorpMap.set(character.characterId, corpId)
					return { characterId: character.characterId, corporationId: corpId }
				}
			} catch (error) {
				logger.warn('[Corporation Access] Error fetching character data', {
					characterId: character.characterId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
			return null
		})

		await Promise.all(charDataPromises)

		logger.info('[Corporation Access] Character corporations mapped', {
			mappedCount: characterCorpMap.size,
			corporationIds: Array.from(new Set(characterCorpMap.values())),
		})

		// Now only check corporations that our characters are actually in
		const relevantCorps = managedCorps.filter((corp) =>
			Array.from(characterCorpMap.values()).includes(corp.corporationId)
		)

		logger.info('[Corporation Access] Checking relevant corporations', {
			relevantCount: relevantCorps.length,
			relevantCorpIds: relevantCorps.map((c) => c.corporationId),
		})

		// Check each relevant corporation for CEO/director roles
		for (const corp of relevantCorps) {
			try {
				const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corp.corporationId)

				// Get corporation info and directors in parallel
				const [corpInfo, directors] = await Promise.all([
					corpStub.getCorporationInfo(),
					corpStub.getDirectors(corp.corporationId),
				])

				// Check which of our characters have roles in this corp
				for (const character of characters) {
					// Skip if character is not in this corporation
					if (characterCorpMap.get(character.characterId) !== corp.corporationId) {
						continue
					}

					let role: 'CEO' | 'Director' | null = null

					// Check if character is CEO
					if (corpInfo && String(corpInfo.ceo_id) === character.characterId) {
						role = 'CEO'
					} else if (directors.some((d) => d.characterId === character.characterId)) {
						role = 'Director'
					}

					if (role) {
						logger.info('[Corporation Access] Found role for character', {
							characterId: character.characterId,
							characterName: character.characterName,
							corporationId: corp.corporationId,
							corporationName: corp.name,
							role,
						})

						// Check if we already have this corp in the list
						const existing = accessibleCorporations.find((ac) => ac.corporationId === corp.corporationId)
						if (existing) {
							// Update role if CEO (CEO takes precedence over Director)
							if (role === 'CEO' && existing.userRole !== 'CEO') {
								existing.userRole = 'CEO'
								existing.characterId = character.characterId
								existing.characterName = character.characterName
							}
						} else {
							accessibleCorporations.push({
								corporationId: corp.corporationId,
								name: corp.name,
								ticker: corp.ticker,
								userRole: role,
								characterId: character.characterId,
								characterName: character.characterName,
							})
						}
					}
				}
			} catch (error) {
				logger.error('[Corporation Access] Error checking corporation', {
					corporationId: corp.corporationId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		const result = {
			hasAccess: accessibleCorporations.length > 0,
			corporations: accessibleCorporations,
		}

		logger.info('[Corporation Access] Access check complete', {
			userId: user.id,
			hasAccess: result.hasAccess,
			corporationCount: accessibleCorporations.length,
			corporations: accessibleCorporations.map((c) => ({
				corporationId: c.corporationId,
				name: c.name,
				userRole: c.userRole,
			})),
		})

		return c.json(result)
	} catch (error) {
		logger.error('Error checking corporation access:', error)
		return c.json({ error: 'Failed to check corporation access' }, 500)
	}
})

/**
 * GET /users/my-corporations
 *
 * Get list of managed corporations where current user is CEO/director.
 * Includes member counts and basic statistics.
 */
users.get('/my-corporations', async (c) => {
	const user = c.get('user')!
	const db = c.get('db') || createDb(c.env.DATABASE_URL)

	try {
		// First check corporation access
		const characters = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, user.id),
		})

		if (!characters.length) {
			return c.json([])
		}

		// Get all managed corporations
		const managedCorps = await db.query.managedCorporations.findMany({
			where: eq(managedCorporations.isActive, true),
		})

		const myCorporations = []

		// Check each character's role in each managed corporation
		for (const character of characters) {
			for (const corp of managedCorps) {
				try {
					// Get character data from DO to check corporation membership
					const charStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
					const charData = await charStub.getCharacterInfo(character.characterId)

					// Convert corporation_id to string for comparison
					if (!charData || String(charData.corporation_id) !== corp.corporationId) {
						continue // Character is not in this corporation
					}

					// Get corporation data to check CEO and get member info
					const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corp.corporationId)
					const corpInfo = await corpStub.getCorporationInfo()

					let role: 'CEO' | 'Director' | 'Both' | null = null

					// Check if character is CEO (convert ceo_id to string for comparison)
					const isCeo = corpInfo && String(corpInfo.ceo_id) === character.characterId

					// Check if character is a director
					const directors = await corpStub.getDirectors(corp.corporationId)
					const isDirector = directors.some((d) => d.characterId === character.characterId)

					if (isCeo && isDirector) {
						role = 'Both'
					} else if (isCeo) {
						role = 'CEO'
					} else if (isDirector) {
						role = 'Director'
					}

					if (role) {
						// Check if we already have this corp in the list
						const existing = myCorporations.find((mc) => mc.corporationId === corp.corporationId)
						if (existing) {
							// Update role if needed
							if (role === 'CEO' || role === 'Both' || (existing.userRole === 'Director' && role === 'Director')) {
								existing.userRole = role
							}
						} else {
							// Get member statistics
							const members = await corpStub.getCoreData(corp.corporationId)
							let linkedMemberCount = 0
							let unlinkedMemberCount = 0

							if (members && members.members) {
								// Check which members have linked auth accounts
								for (const member of members.members) {
									const linkedChar = await db.query.userCharacters.findFirst({
										where: eq(userCharacters.characterId, String(member.character_id)),
									})
									if (linkedChar) {
										linkedMemberCount++
									} else {
										unlinkedMemberCount++
									}
								}
							}

							myCorporations.push({
								corporationId: corp.corporationId,
								name: corp.name,
								ticker: corp.ticker,
								userRole: role,
								memberCount: corpInfo?.member_count || 0,
								linkedMemberCount,
								unlinkedMemberCount,
								allianceId: corpInfo?.alliance_id ? String(corpInfo.alliance_id) : undefined,
								allianceName: corpInfo?.alliance_name,
							})
						}
					}
				} catch (error) {
					// Log but continue checking other characters/corps
					logger.warn('Error getting corporation data:', {
						characterId: character.characterId,
						corporationId: corp.corporationId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}
		}

		return c.json(myCorporations)
	} catch (error) {
		logger.error('Error fetching my corporations:', error)
		return c.json({ error: 'Failed to fetch my corporations' }, 500)
	}
})

export default users
