import { Hono } from 'hono'

import { eq, inArray } from '@repo/db-utils'
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
 * Cache duration for user corporation data (5 minutes)
 */
const CACHE_TTL = 5 * 60 // 5 minutes in seconds

/**
 * Helper to get cache instance
 */
function getCache() {
	return caches.default
}

/**
 * Helper to create cache key for user corporations
 */
function getUserCorpsCacheKey(userId: string): string {
	return `https://cache.local/users/${userId}/my-corporations`
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

		logger.info('[has-corporation-access] Fetched user characters', {
			userId: user.id,
			characterCount: characters.length,
			characters: characters.map(c => ({ id: c.characterId, name: c.characterName }))
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
				return charData ? String(charData.corporationId) : null
			} catch {
				return null
			}
		})

		const characterCorpIds = await Promise.all(charCorpPromises)
		const uniqueCorpIds = new Set(characterCorpIds.filter((id) => id !== null))

		logger.info('[has-corporation-access] Mapped character corporations', {
			uniqueCorpIds: Array.from(uniqueCorpIds),
			managedCorpIds: managedCorps.map(c => c.corporationId)
		})

		// Check if any of these corps are managed and user has a role
		for (const corpId of uniqueCorpIds) {
			const managedCorp = managedCorps.find((c) => c.corporationId === corpId)
			if (managedCorp) {
				// Found a managed corp - quick check for any role
				try {
					const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corpId)
					const [corpInfo, directors] = await Promise.all([
						corpStub.getCorporationInfo(corpId),
						corpStub.getDirectors(corpId),
					])

					logger.info('[has-corporation-access] Checking corporation for access', {
						corporationId: corpId,
						corporationName: managedCorp.name,
						ceoId: corpInfo?.ceoId ? String(corpInfo.ceoId) : null,
						directorCount: directors.length,
						directors: directors.map(d => ({
							characterId: d.characterId,
							characterName: d.characterName,
							isHealthy: d.isHealthy
						})),
						userCharacterIds: characters.map(c => c.characterId)
					})

					// Check if any character is CEO or director
					for (const char of characters) {
						const isCeo = corpInfo && String(corpInfo.ceoId) === char.characterId
						const matchedDirector = directors.find(d => d.characterId === char.characterId)

						logger.info('[has-corporation-access] Comparing character against roles', {
							characterId: char.characterId,
							characterName: char.characterName,
							corporationId: corpId,
							checkingCeo: !!corpInfo,
							ceoId: corpInfo?.ceoId ? String(corpInfo.ceoId) : null,
							isCeo,
							checkingDirectors: directors.length > 0,
							matchedDirector: matchedDirector?.characterName || null
						})

						if (isCeo) {
							logger.info('[has-corporation-access] Access granted', {
								reason: 'CEO',
								characterId: char.characterId,
								characterName: char.characterName,
								corporationId: corpId
							})
							return c.json({ hasAccess: true })
						}
						if (matchedDirector) {
							logger.info('[has-corporation-access] Access granted', {
								reason: 'Director',
								characterId: char.characterId,
								characterName: char.characterName,
								corporationId: corpId,
								directorName: matchedDirector.characterName
							})
							return c.json({ hasAccess: true })
						}
					}
				} catch {
					continue
				}
			}
		}

		logger.info('[has-corporation-access] No access found', {
			userId: user.id,
			checkedCharacters: characters.length,
			checkedCorporations: uniqueCorpIds.size
		})

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

		// OPTIMIZATION: First, fetch all character corporation IDs to reduce checks
		const characterCorpMap = new Map<string, string>() // characterId -> corporationId

		logger.info('[Corporation Access] Fetching character corporation IDs...')

		// Create single character stub (reuse for all calls)
		const charStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

		// Fetch character data in parallel to get corporation IDs
		const charDataPromises = characters.map(async (character) => {
			try {
				const charData = await charStub.getCharacterInfo(character.characterId)
				if (charData?.corporationId) {
					const corpId = String(charData.corporationId)
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

		// Use Set for O(1) lookups instead of O(n) includes
		const characterCorpIds = new Set(characterCorpMap.values())
		const relevantCorps = managedCorps.filter((corp) => characterCorpIds.has(corp.corporationId))

		logger.info('[Corporation Access] Checking relevant corporations', {
			relevantCount: relevantCorps.length,
			relevantCorpIds: relevantCorps.map((c) => c.corporationId),
		})

		// Pre-group characters by corporation for faster lookups
		const charactersByCorpId = new Map<string, typeof characters>()
		for (const [charId, corpId] of characterCorpMap.entries()) {
			if (!charactersByCorpId.has(corpId)) {
				charactersByCorpId.set(corpId, [])
			}
			const char = characters.find((c) => c.characterId === charId)
			if (char) {
				charactersByCorpId.get(corpId)!.push(char)
			}
		}

		// Process corporations in parallel instead of sequential loop
		const corpCheckPromises = relevantCorps.map(async (corp) => {
			try {
				const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corp.corporationId)

				// Get corporation info and directors in parallel
				const [corpInfo, directors] = await Promise.all([
					corpStub.getCorporationInfo(corp.corporationId),
					corpStub.getDirectors(corp.corporationId),
				])

				// Create director lookup Set for O(1) checks
				const directorIds = new Set(directors.map((d) => d.characterId))

				// Only check characters IN this corporation
				const corpCharacters = charactersByCorpId.get(corp.corporationId) || []

				// Find highest priority role for this corporation
				let bestRole: { role: 'CEO' | 'Director'; character: (typeof characters)[0] } | null = null

				for (const character of corpCharacters) {
					let role: 'CEO' | 'Director' | null = null

					// Check if character is CEO
					if (corpInfo && String(corpInfo.ceoId) === character.characterId) {
						role = 'CEO'
					} else if (directorIds.has(character.characterId)) {
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

						// CEO takes precedence over Director
						if (role === 'CEO' || !bestRole) {
							bestRole = { role, character }
							if (role === 'CEO') break // No need to check further
						}
					}
				}

				// Return result for this corporation
				if (bestRole) {
					return {
						corporationId: corp.corporationId,
						name: corp.name,
						ticker: corp.ticker,
						userRole: bestRole.role,
						characterId: bestRole.character.characterId,
						characterName: bestRole.character.characterName,
					}
				}
			} catch (error) {
				logger.error('[Corporation Access] Error checking corporation', {
					corporationId: corp.corporationId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
			return null
		})

		// Wait for all corporation checks in parallel
		const corpResults = await Promise.all(corpCheckPromises)
		const accessibleCorporations = corpResults.filter((result) => result !== null)

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
 * Optimized to eliminate N+1 queries and parallelize all I/O operations.
 * Cached for 5 minutes to improve performance.
 */
users.get('/my-corporations', async (c) => {
	const user = c.get('user')!
	const db = c.get('db') || createDb(c.env.DATABASE_URL)

	try {
		// Check cache first
		const cacheKey = getUserCorpsCacheKey(user.id)
		const cached = await getCachedJson<
			Array<{
				corporationId: string
				name: string
				ticker: string
				userRole: 'CEO' | 'Director' | 'Both'
				memberCount: number
				linkedMemberCount: number
				unlinkedMemberCount: number
				allianceId?: string
			}>
		>(cacheKey)

		if (cached) {
			return c.json(cached)
		}
		// STEP 1: Parallel initial data fetch
		const [characters, managedCorps] = await Promise.all([
			db.query.userCharacters.findMany({
				where: eq(userCharacters.userId, user.id),
			}),
			db.query.managedCorporations.findMany({
				where: eq(managedCorporations.isActive, true),
			}),
		])

		if (!characters.length || !managedCorps.length) {
			return c.json([])
		}

		// STEP 2: Create stubs ONCE (outside loops)
		const charStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')

		// STEP 3: Batch fetch all character data in parallel
		const characterDataMap = new Map<string, any>()
		await Promise.all(
			characters.map(async (char) => {
				try {
					const charData = await charStub.getCharacterInfo(char.characterId)
					if (charData) {
						characterDataMap.set(char.characterId, charData)
					}
				} catch (error) {
					logger.warn('Error fetching character data:', {
						characterId: char.characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			})
		)

		// STEP 4: Build character-to-corporation mapping
		const charToCorpsMap = new Map<string, string[]>()
		for (const [charId, charData] of characterDataMap.entries()) {
			const corpId = String(charData.corporationId)
			if (!charToCorpsMap.has(corpId)) {
				charToCorpsMap.set(corpId, [])
			}
			charToCorpsMap.get(corpId)!.push(charId)
		}

		// STEP 5: Filter to only corporations where user has characters
		const relevantCorps = managedCorps.filter((corp) => charToCorpsMap.has(corp.corporationId))

		// STEP 6: Batch fetch all corporation data in parallel
		const corpDataPromises = relevantCorps.map(async (corp) => {
			try {
				const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corp.corporationId)

				// Fetch all corp data in parallel for each corporation
				const [corpInfo, directors, coreData] = await Promise.all([
					corpStub.getCorporationInfo(corp.corporationId),
					corpStub.getDirectors(corp.corporationId),
					corpStub.getCoreData(corp.corporationId),
				])

				return { corp, corpInfo, directors, coreData }
			} catch (error) {
				logger.warn('Error fetching corporation data:', {
					corporationId: corp.corporationId,
					error: error instanceof Error ? error.message : String(error),
				})
				return null
			}
		})

		const corpDataResults = (await Promise.all(corpDataPromises)).filter((result) => result !== null)

		// STEP 7: Batch check ALL member linkage status with ONE query
		// Collect all unique member character IDs across all corporations
		const allMemberCharIds = new Set<string>()
		for (const result of corpDataResults) {
			if (result && result.coreData?.members) {
				for (const member of result.coreData.members) {
					allMemberCharIds.add(String(member.characterId))
				}
			}
		}

		// SINGLE query to check all linked members at once
		const linkedCharacters =
			allMemberCharIds.size > 0
				? await db.query.userCharacters.findMany({
						where: inArray(userCharacters.characterId, Array.from(allMemberCharIds)),
						columns: {
							characterId: true,
						},
					})
				: []

		// Create fast lookup set
		const linkedCharSet = new Set(linkedCharacters.map((c) => c.characterId))

		// STEP 8: Build final response
		const myCorporations: Array<{
			corporationId: string
			name: string
			ticker: string
			userRole: 'CEO' | 'Director' | 'Both'
			memberCount: number
			linkedMemberCount: number
			unlinkedMemberCount: number
			allianceId?: string
		}> = []

		for (const result of corpDataResults) {
			if (!result) continue

			const { corp, corpInfo, directors, coreData } = result
			const userCharIds = charToCorpsMap.get(corp.corporationId) || []

			// Determine user's role in this corporation
			let role: 'CEO' | 'Director' | 'Both' | null = null

			for (const charId of userCharIds) {
				const isCeo = corpInfo && String(corpInfo.ceoId) === charId
				const isDirector = directors.some((d) => d.characterId === charId)

				if (isCeo && isDirector) {
					role = 'Both'
					break // Highest role found
				} else if (isCeo) {
					role = 'CEO'
				} else if (isDirector && !role) {
					role = 'Director'
				}
			}

			if (!role) continue // User has no leadership role

			// Count linked/unlinked members using the pre-built set
			let linkedMemberCount = 0
			let unlinkedMemberCount = 0

			if (coreData?.members) {
				for (const member of coreData.members) {
					const memberCharId = String(member.characterId)
					if (linkedCharSet.has(memberCharId)) {
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
				memberCount: coreData?.members?.length || 0, // Use actual tracked count, not ESI total
				linkedMemberCount,
				unlinkedMemberCount,
				allianceId: corpInfo?.allianceId ? String(corpInfo.allianceId) : undefined,
			})
		}

		// Store in cache for future requests
		await cacheJson(cacheKey, myCorporations, CACHE_TTL)

		return c.json(myCorporations)
	} catch (error) {
		logger.error('Error fetching my corporations:', error)
		return c.json({ error: 'Failed to fetch my corporations' }, 500)
	}
})

export default users
