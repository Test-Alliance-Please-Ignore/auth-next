import { Hono } from 'hono'

import { and, eq, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { managedCorporations, userCharacters } from '../db/schema'
import { waitUntilWithTelemetry } from '../lib/background-task'
import { isNpcCorporationId } from '../lib/corporation-id'
import { getDiscordStatus } from '../lib/discord-helpers'
import { triggerUserRefreshWorkflow } from '../lib/workflow-triggers'
import { requireAuth } from '../middleware/session'
import { ActivityService } from '../services/activity.service'
import { syncUsersMumbleProfiles } from '../services/mumble.service'
import { UserService } from '../services/user.service'

import type { RequestMetadata, UserPreferencesDTO } from '@repo/core'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Hr } from '@repo/hr'
import type { App } from '../context'

/**
 * Cache duration for user corporation data (5 minutes)
 */
const CACHE_TTL = 5 * 60 // 5 minutes in seconds
const CORPORATION_ACCESS_CACHE_TTL = 30 // 30 seconds

function filterManagedNonNpcCorps<T extends { corporationId: string }>(rows: T[]): T[] {
	return rows.filter((row) => !isNpcCorporationId(row.corporationId))
}

/**
 * Helper to get cache instance
 */
function getCache() {
	// @ts-ignore
	return caches.default
}

/**
 * Helper to create cache key for user corporations
 */
function getUserCorpsCacheKey(userId: string): string {
	return `https://cache.local/users/${userId}/my-corporations`
}

function getCorporationAccessCacheKey(userId: string): string {
	return `https://cache.local/users/${userId}/corporation-access/v2`
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

	// Trigger user refresh workflow in background (throttled to every 5 minutes)
	waitUntilWithTelemetry(
		c.executionCtx,
		'users.me.refresh',
		() =>
			triggerUserRefreshWorkflow({
				db,
				env: c.env,
				userId: user.id,
				source: 'users-me',
			}),
		{
			userId: user.id,
			source: 'users-me',
		}
	)

	// Get full user profile
	const profile = await userService.getUserProfile(user.id)

	// Lazy-load Discord status if needed
	const discordStatus = await getDiscordStatus(c)

	// Build legacy auth status
	const isLinked = !!(profile.legacyAuthUserId && profile.legacyAuthUserUsername)
	const legacyAuth = {
		userId: profile.legacyAuthUserId,
		username: profile.legacyAuthUserUsername,
		isLinked,
	}

	return c.json({
		id: profile.id,
		mainCharacterId: profile.mainCharacterId,
		characters: profile.characters,
		is_admin: profile.is_admin,
		preferences: profile.preferences,
		discord: discordStatus,
		legacyAuth,
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

		// Update Discord nickname if user has Discord linked
		if (user.discordUserId) {
			try {
				const discordService = await import('../services/discord.service.js')
				// Only update nickname, don't re-invite or update roles
				await discordService.updateUserDiscordNickname(c.env, user.id)
			} catch (discordError) {
				logger.error('[SetPrimaryCharacter] Discord nickname update failed', {
					userId: user.id,
					error: discordError instanceof Error ? discordError.message : String(discordError),
				})
				// Don't fail the entire request if Discord sync fails
			}
		}

		waitUntilWithTelemetry(
			c.executionCtx,
			'users.me.set-primary.mumble-profile-refresh',
			() => syncUsersMumbleProfiles(c.env, [user.id]),
			{
				userId: user.id,
				source: 'primary-character-changed',
			}
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
		// Site admins have access to all corporations
		if (user.is_admin) {
			return c.json({ hasAccess: true })
		}

		// Get all user's characters
		const characters = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, user.id),
		})

		if (!characters.length) {
			return c.json({ hasAccess: false })
		}

		// Get all active managed corporations (member and special purpose only)
		const managedCorps = filterManagedNonNpcCorps(
			await db.query.managedCorporations.findMany({
				where: and(
					eq(managedCorporations.isActive, true),
					or(
						eq(managedCorporations.isMemberCorporation, true),
						eq(managedCorporations.isSpecialPurpose, true)
					)
				),
			})
		)

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

					// Check if any character is CEO or director
					for (const char of characters) {
						const isCeo = corpInfo && String(corpInfo.ceoId) === char.characterId
						const matchedDirector = directors.find((d) => d.characterId === char.characterId)

						if (isCeo) {
							return c.json({ hasAccess: true })
						}
						if (matchedDirector) {
							return c.json({ hasAccess: true })
						}
					}
				} catch {
					continue
				}
			}
		}

		// Also check if user has any HR roles
		try {
			const hrStub = getStub<Hr>(c.env.HR, 'default')
			const hrCorpIds = await hrStub.getUserHrCorporations(user.id)
			if (hrCorpIds.length > 0) {
				return c.json({ hasAccess: true })
			}
		} catch {
			// Ignore HR check failures
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
		const cacheKey = getCorporationAccessCacheKey(user.id)
		const cached = await getCachedJson<{
			hasAccess: boolean
			corporations: Array<{
				corporationId: string
				name: string
				ticker: string
				userRole: 'CEO' | 'Director' | 'admin' | 'hr_admin' | 'hr_reviewer' | 'hr_viewer'
				characterId: string | null
				characterName: string | null
				isMemberCorporation: boolean
				isAltCorp: boolean
				isSpecialPurpose: boolean
			}>
		}>(cacheKey)
		if (cached) {
			return c.json(cached)
		}

		// Get all managed corporations (member and special purpose only)
		const managedCorps = filterManagedNonNpcCorps(
			await db.query.managedCorporations.findMany({
				where: and(
					eq(managedCorporations.isActive, true),
					or(
						eq(managedCorporations.isMemberCorporation, true),
						eq(managedCorporations.isSpecialPurpose, true)
					)
				),
			})
		)

		// Get all user's characters
		const characters = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, user.id),
		})

		logger.info('[Corporation Access] Found characters', {
			userId: user.id,
			characterCount: characters.length,
			characterIds: characters.map((c) => c.characterId),
		})

		logger.info('[Corporation Access] Found managed corporations', {
			corpCount: managedCorps.length,
			corpIds: managedCorps.map((c) => c.corporationId),
		})

		const accessibleCorporations: Array<{
			corporationId: string
			name: string
			ticker: string
			userRole: 'CEO' | 'Director' | 'admin' | 'hr_admin' | 'hr_reviewer' | 'hr_viewer'
			characterId: string | null
			characterName: string | null
			isMemberCorporation: boolean
			isAltCorp: boolean
			isSpecialPurpose: boolean
		}> = []

		if (characters.length > 0 && managedCorps.length > 0) {
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
					const corpStub = getStub<EveCorporationData>(
						c.env.EVE_CORPORATION_DATA,
						corp.corporationId
					)

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
					let bestRole: { role: 'CEO' | 'Director'; character: (typeof characters)[0] } | null =
						null

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
							isMemberCorporation: corp.isMemberCorporation,
							isAltCorp: corp.isAltCorp,
							isSpecialPurpose: corp.isSpecialPurpose,
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
			accessibleCorporations.push(...corpResults.filter((result) => result !== null))
		}

		// Site admins have access to all managed corporations, but leadership roles
		// should take precedence in corporations where they are CEO/Director.
		if (user.is_admin) {
			const accessibleCorpIds = new Set(accessibleCorporations.map((corp) => corp.corporationId))
			for (const corp of managedCorps) {
				if (accessibleCorpIds.has(corp.corporationId)) continue
				accessibleCorporations.push({
					corporationId: corp.corporationId,
					name: corp.name,
					ticker: corp.ticker,
					userRole: 'admin',
					characterId: null,
					characterName: null,
					isMemberCorporation: corp.isMemberCorporation,
					isAltCorp: corp.isAltCorp,
					isSpecialPurpose: corp.isSpecialPurpose,
				})
			}
		}

		// Also check HR roles across member corporations only (non-admin users only)
		if (!user.is_admin) {
			const accessibleCorpIds = new Set(accessibleCorporations.map((c) => c.corporationId))
			const hrStub = getStub<Hr>(c.env.HR, 'default')
			const hrCorpIds = await hrStub.getUserHrCorporations(user.id)
			const managedCorpById = new Map(managedCorps.map((corp) => [corp.corporationId, corp]))
			const uniqueHrCorpIds = [...new Set(hrCorpIds)].filter((id) => {
				if (accessibleCorpIds.has(id)) return false
				return managedCorpById.get(id)?.isMemberCorporation === true
			})

			if (uniqueHrCorpIds.length > 0) {
				const roleHierarchy: Record<string, number> = {
					hr_admin: 3,
					hr_reviewer: 2,
					hr_viewer: 1,
				}
				const explicitHrRoles = await hrStub.getUserRoles(user.id)
				const highestExplicitRoleByCorp = new Map<
					string,
					'hr_admin' | 'hr_reviewer' | 'hr_viewer'
				>()
				for (const role of explicitHrRoles.filter((r) => r.isActive)) {
					const corpId = role.corporationId
					if (!corpId) continue
					const existing = highestExplicitRoleByCorp.get(corpId)
					if (!existing || (roleHierarchy[role.role] ?? 0) > (roleHierarchy[existing] ?? 0)) {
						highestExplicitRoleByCorp.set(corpId, role.role)
					}
				}

				const hrCorpResults = uniqueHrCorpIds.map((corpId) => {
					const corp = managedCorpById.get(corpId)
					if (!corp) return null
					// getUserHrCorporations() includes inferred leadership access (CEO/Director),
					// which maps to admin-level HR access when no explicit attachment exists.
					const highestRole = highestExplicitRoleByCorp.get(corpId) ?? 'hr_admin'
					return {
						corporationId: corpId,
						name: corp.name,
						ticker: corp.ticker,
						userRole: highestRole,
						characterId: null,
						characterName: null,
						isMemberCorporation: corp.isMemberCorporation,
						isAltCorp: corp.isAltCorp,
						isSpecialPurpose: corp.isSpecialPurpose,
					}
				})

				for (const result of hrCorpResults) {
					if (result) accessibleCorporations.push(result)
				}
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

		await cacheJson(cacheKey, result, CORPORATION_ACCESS_CACHE_TTL)
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
				userRole: 'CEO' | 'Director' | 'Both' | 'admin'
				memberCount: number
				linkedMemberCount: number
				unlinkedMemberCount: number
				allianceId?: string
				isMemberCorporation: boolean
			}>
		>(cacheKey)

		if (cached) {
			return c.json(cached)
		}

		// Site admins have access to ALL corporations (member and special purpose only)
		if (user.is_admin) {
			const managedCorps = filterManagedNonNpcCorps(
				await db.query.managedCorporations.findMany({
					where: and(
						eq(managedCorporations.isActive, true),
						or(
							eq(managedCorporations.isMemberCorporation, true),
							eq(managedCorporations.isSpecialPurpose, true)
						)
					),
				})
			)

			// Fetch all corporation data in parallel
			const corpDataPromises = managedCorps.map(async (corp) => {
				try {
					const corpStub = getStub<EveCorporationData>(
						c.env.EVE_CORPORATION_DATA,
						corp.corporationId
					)
					const coreData = await corpStub.getCoreData(corp.corporationId)

					// Count linked/unlinked members
					let linkedMemberCount = 0
					let unlinkedMemberCount = 0

					if (coreData?.members) {
						const memberCharIds = coreData.members.map((m) => String(m.characterId))
						const linkedChars = await db.query.userCharacters.findMany({
							where: inArray(userCharacters.characterId, memberCharIds),
							columns: { characterId: true },
						})
						const linkedSet = new Set(linkedChars.map((c) => c.characterId))

						for (const member of coreData.members) {
							const memberCharId = String(member.characterId)
							if (linkedSet.has(memberCharId)) {
								linkedMemberCount++
							} else {
								unlinkedMemberCount++
							}
						}
					}

					return {
						corporationId: corp.corporationId,
						name: corp.name,
						ticker: corp.ticker,
						isMemberCorporation: corp.isMemberCorporation,
						userRole: 'admin' as const,
						memberCount: coreData?.members?.length || 0,
						linkedMemberCount,
						unlinkedMemberCount,
						allianceId: coreData?.publicInfo?.allianceId || undefined,
					}
				} catch (error) {
					logger.warn('Error fetching corporation data for admin:', {
						corporationId: corp.corporationId,
						error: error instanceof Error ? error.message : String(error),
					})
					return null
				}
			})

			const adminCorps = (await Promise.all(corpDataPromises)).filter((corp) => corp !== null)

			logger.info('[My Corporations] Admin access granted', {
				userId: user.id,
				reason: 'site_admin',
				corporationCount: adminCorps.length,
			})

			// Cache the admin results
			await cacheJson(cacheKey, adminCorps, CACHE_TTL)

			return c.json(adminCorps)
		}

		// STEP 1: Parallel initial data fetch
		const [characters, managedCorpsRaw] = await Promise.all([
			db.query.userCharacters.findMany({
				where: eq(userCharacters.userId, user.id),
			}),
			db.query.managedCorporations.findMany({
				where: and(
					eq(managedCorporations.isActive, true),
					or(
						eq(managedCorporations.isMemberCorporation, true),
						eq(managedCorporations.isSpecialPurpose, true)
					)
				),
			}),
		])
		const managedCorps = filterManagedNonNpcCorps(managedCorpsRaw)

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

		const corpDataResults = (await Promise.all(corpDataPromises)).filter(
			(result) => result !== null
		)

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
							status: true,
						},
					})
				: []

		// Create fast lookup set (excluding emeritus characters from statistics)
		const linkedCharSet = new Set(
			linkedCharacters.filter((c) => c.status !== 'emeritus').map((c) => c.characterId)
		)

		// Also create a set of emeritus character IDs to exclude from total count
		const emeritusCharSet = new Set(
			linkedCharacters.filter((c) => c.status === 'emeritus').map((c) => c.characterId)
		)

		// STEP 8: Build final response
		const myCorporations: Array<{
			corporationId: string
			name: string
			ticker: string
			isMemberCorporation: boolean
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

			// Count linked/unlinked members using the pre-built set (excluding emeritus)
			let linkedMemberCount = 0
			let unlinkedMemberCount = 0
			let totalActiveMemberCount = 0

			if (coreData?.members) {
				for (const member of coreData.members) {
					const memberCharId = String(member.characterId)

					// Skip emeritus characters from all statistics
					if (emeritusCharSet.has(memberCharId)) {
						continue
					}

					totalActiveMemberCount++

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
				isMemberCorporation: corp.isMemberCorporation,
				userRole: role,
				memberCount: totalActiveMemberCount, // Only count active members (excludes emeritus)
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
