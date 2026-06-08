import { eq, ilike, or } from 'drizzle-orm'
import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { createEveCharacterId } from '@repo/eve-types'
import { logger } from '@repo/hono-helpers'

import { userCharacters } from '../db/schema'
import { waitUntilWithTelemetry } from '../lib/background-task'
import { validateAndSyncCharacterTokenValidity } from '../lib/token-validity'
import { triggerUserRefreshWorkflow } from '../lib/workflow-triggers'
import { requireAuth } from '../middleware/session'
import { checkAndUpdateDirectorStatus } from '../services/corporation-auto-register.service'
import { markCharacterDeletedEverywhere } from '../services/character-deletion.service'
import { EntityResolverService } from '../services/entity-resolver.service'
import { shouldTreatSensitiveDataAsLive } from './characters-utils'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Hr } from '@repo/hr'
import type { App } from '../context'

// Helper to transform and enrich skills data
async function transformAndEnrichSkillsData(skills: any, env: any) {
	if (!skills) return null

	// Transform to camelCase first
	const transformed = {
		skills:
			skills.skills?.map((skill: any) => ({
				activeSkillLevel: skill.active_skill_level ?? skill.activeSkillLevel,
				skillId: skill.skill_id ?? skill.skillId,
				skillpointsInSkill: skill.skillpoints_in_skill ?? skill.skillpointsInSkill,
				trainedSkillLevel: skill.trained_skill_level ?? skill.trainedSkillLevel,
			})) ?? [],
		totalSp: skills.total_sp ?? skills.totalSp ?? 0,
		unallocatedSp: skills.unallocated_sp ?? skills.unallocatedSp,
	}

	// If no skills, return as-is
	if (transformed.skills.length === 0) {
		return transformed
	}

	// Get Skills DO stub to fetch metadata
	const skillsStub = getStub<any>(env.SKILLS, 'default')

	// Extract all skill IDs
	const skillIds = transformed.skills.map((s: any) => String(s.skillId))

	try {
		// Fetch metadata for all skills in one batch
		const skillMetadata = await skillsStub.getSkillsMetadata(skillIds)

		// Create map for quick lookup
		const metadataMap = new Map<string, any>(skillMetadata.map((m: any) => [String(m.id), m]))

		// Enrich skills with metadata
		transformed.skills = transformed.skills.map((skill: any) => {
			const metadata = metadataMap.get(String(skill.skillId))
			if (metadata) {
				return {
					...skill,
					skillName: metadata.name,
					skillGroup: metadata.groupName,
					skillCategory: metadata.categoryName,
					rank: metadata.rank,
					description: metadata.description,
				}
			}
			// Fallback if metadata not found
			return {
				...skill,
				skillName: `Unknown Skill (${skill.skillId})`,
				skillGroup: 'Unknown',
				skillCategory: 'Unknown',
			}
		})
	} catch (error) {
		logger.warn('[Character Skills] Failed to enrich skills with metadata', {
			error: error instanceof Error ? error.message : String(error),
			skillCount: transformed.skills.length,
		})
		// Return unenriched skills on error
	}

	return transformed
}

// Helper to transform and enrich skill queue data
async function transformAndEnrichSkillQueue(queue: any, env: any) {
	if (!queue || !Array.isArray(queue)) return []

	// Transform to camelCase first
	const transformed = queue.map((entry: any) => ({
		finishDate: entry.finish_date ?? entry.finishDate,
		finishedLevel: entry.finished_level ?? entry.finishedLevel,
		levelEndSp: entry.level_end_sp ?? entry.levelEndSp,
		levelStartSp: entry.level_start_sp ?? entry.levelStartSp,
		queuePosition: entry.queue_position ?? entry.queuePosition,
		skillId: entry.skill_id ?? entry.skillId,
		startDate: entry.start_date ?? entry.startDate,
		trainingStartSp: entry.training_start_sp ?? entry.trainingStartSp,
	}))

	// If no queue entries, return as-is
	if (transformed.length === 0) {
		return transformed
	}

	// Get Skills DO stub to fetch metadata
	const skillsStub = getStub<any>(env.SKILLS, 'default')

	// Extract unique skill IDs
	const skillIds = [...new Set(transformed.map((e: any) => String(e.skillId)))]

	try {
		// Fetch metadata for all skills in one batch
		const skillMetadata = await skillsStub.getSkillsMetadata(skillIds)

		// Create map for quick lookup
		const metadataMap = new Map<string, any>(skillMetadata.map((m: any) => [String(m.id), m]))

		// Enrich queue entries with metadata
		return transformed.map((entry: any) => {
			const metadata = metadataMap.get(String(entry.skillId))
			if (metadata) {
				return {
					...entry,
					skillName: metadata.name,
					skillGroup: metadata.groupName,
					skillCategory: metadata.categoryName,
				}
			}
			// Fallback if metadata not found
			return {
				...entry,
				skillName: `Unknown Skill (${entry.skillId})`,
				skillGroup: 'Unknown',
				skillCategory: 'Unknown',
			}
		})
	} catch (error) {
		logger.warn('[Skill Queue] Failed to enrich queue with metadata', {
			error: error instanceof Error ? error.message : String(error),
			queueLength: transformed.length,
		})
		// Return unenriched queue on error
		return transformed
	}
}

const app = new Hono<App>()

/**
 * GET /characters/search?q=:query
 * Search for users by main character name (for autocomplete)
 *
 * Returns array of matching main characters with userId
 */
app.get('/search', requireAuth(), async (c) => {
	const query = c.req.query('q')
	const trimmedQuery = query?.trim() ?? ''
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	if (trimmedQuery.length < 2) {
		return c.json({ error: 'Query must be at least 2 characters' }, 400)
	}

	try {
		const isNumericQuery = /^[0-9]+$/.test(trimmedQuery)
		const whereClause = isNumericQuery
			? or(
					eq(userCharacters.characterId, trimmedQuery),
					ilike(userCharacters.characterName, `%${trimmedQuery}%`)
				)
			: ilike(userCharacters.characterName, `%${trimmedQuery}%`)

		// Search for main characters matching the query
		const results = await db
			.select({
				userId: userCharacters.userId,
				characterId: userCharacters.characterId,
				characterName: userCharacters.characterName,
			})
			.from(userCharacters)
			.where(whereClause)
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
 * Authorization:
 * - Character owner can view their own character
 * - Site admins can view any character
 * - All others receive 403 Forbidden
 *
 * Returns:
 * - Sensitive data for owner or admin
 * - viewedAsAdmin flag when admin views another user's character
 */
app.get('/:characterId', requireAuth(), async (c) => {
	const characterIdStr = c.req.param('characterId')
	const characterId = createEveCharacterId(characterIdStr)
	const hrCorporationId = c.req.query('corporationId')?.trim() || null
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	// Check if user owns this character
	const isActualOwner = user.characters.some(
		(char) => char.characterId.toString() === characterIdStr
	)
	const isAdmin = user.is_admin

	// Check if user is CEO/Director of character's corporation
	let isCeoOrDirector = false
	let viewerRole: 'CEO' | 'Director' | null = null
	let hasHrViewerAccess = false

	if (!isActualOwner && !isAdmin) {
		if (hrCorporationId) {
			try {
				const hrStub = getStub<Hr>(c.env.HR, 'default')
				hasHrViewerAccess = await hrStub.checkPermission(user.id, hrCorporationId, 'hr_viewer')
			} catch (error) {
				logger.warn('[Character Detail] Error checking HR viewer access:', {
					characterId: characterIdStr,
					hrCorporationId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		// Get character's corporation to check CEO/Director access
		const eveCharacterDataStubForAuth = getStub<EveCharacterData>(
			c.env.EVE_CHARACTER_DATA,
			characterId
		)
		try {
			const charInfoInstance = await eveCharacterDataStubForAuth.getInstance(characterId)
			const charInfo = await charInfoInstance.getCharacterInfo()

			if (charInfo?.corporationId) {
				const corporationId = String(charInfo.corporationId)

				// Check if any of user's characters are CEO/Director of this corporation
				for (const userChar of user.characters) {
					const userCharStub = getStub<EveCharacterData>(
						c.env.EVE_CHARACTER_DATA,
						userChar.characterId
					)
					try {
						const userCharInstance = await userCharStub.getInstance(userChar.characterId)
						const userCharInfo = await userCharInstance.getCharacterInfo()

						// Skip if user's character not in the same corporation
						if (!userCharInfo || String(userCharInfo.corporationId) !== corporationId) {
							continue
						}

						// Get corporation info and directors
						const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
						try {
							const [corpInfo, directors] = await Promise.all([
								corpStub.getCorporationInfo(corporationId),
								corpStub.getDirectors(corporationId),
							])

							// Check if CEO
							if (corpInfo && String(corpInfo.ceoId) === userChar.characterId) {
								isCeoOrDirector = true
								viewerRole = 'CEO'
								logger.info('[Character Detail] CEO access granted', {
									characterId: characterIdStr,
									viewerCharacterId: userChar.characterId,
									corporationId,
								})
								break
							}

							// Check if Director
							const isDirector = directors.some(
								(d: { characterId: string }) => d.characterId === userChar.characterId
							)
							if (isDirector) {
								isCeoOrDirector = true
								viewerRole = 'Director'
								logger.info('[Character Detail] Director access granted', {
									characterId: characterIdStr,
									viewerCharacterId: userChar.characterId,
									corporationId,
								})
								break
							}
						} catch (error) {
							logger.warn('[Character Detail] Error checking corporation access:', {
								characterId: characterIdStr,
								error: error instanceof Error ? error.message : String(error),
							})
							// Continue to authorization check below
						}
					} catch (error) {
						logger.warn('[Character Detail] Error checking character access:', {
							characterId: characterIdStr,
							error: error instanceof Error ? error.message : String(error),
						})
						// Continue to authorization check below
					}
					// If we found CEO/Director access, break out of the loop
					if (isCeoOrDirector) break
				}
			}
		} catch (error) {
			logger.warn('[Character Detail] Error checking corporation access:', {
				characterId: characterIdStr,
				error: error instanceof Error ? error.message : String(error),
			})
			// Continue to authorization check below
		}
	}

	// Authorization: Must be owner OR admin OR HR viewer (for provided corporation) OR CEO/Director of same corp
	if (!isActualOwner && !isAdmin && !hasHrViewerAccess && !isCeoOrDirector) {
		return c.json({ error: 'You do not have permission to view this character' }, 403)
	}

	// For admins viewing someone else's character, fetch the actual owner info
	let actualOwner: { userId: string; characterName: string } | null = null
	const viewedAsAdmin = isAdmin && !isActualOwner
	const viewedAsCeoOrDirector = isCeoOrDirector && !isActualOwner

	if (viewedAsAdmin) {
		try {
			const ownerRecord = await db
				.select({
					userId: userCharacters.userId,
					characterName: userCharacters.characterName,
				})
				.from(userCharacters)
				.where(eq(userCharacters.characterId, characterIdStr))
				.limit(1)

			if (ownerRecord.length > 0) {
				actualOwner = ownerRecord[0]
			}
		} catch (error) {
			logger.error('Error fetching character owner:', error)
			// Continue anyway - this is just for context
		}
	}

	// Treat admins/HR viewers as privileged for private data access purposes
	const canViewSensitiveData = isActualOwner || isAdmin || hasHrViewerAccess
	const isOwner = isActualOwner || isAdmin

	// Get EVE Character Data DO stub
	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, characterId)
	const eveCharacterData = await eveCharacterDataStub.getInstance(characterId)

	try {
		// Fetch all public character data pieces
		let [info, corporationHistory, skills, attributes, lastUpdated] = await Promise.all([
			eveCharacterData.getCharacterInfo(),
			eveCharacterData.getCorporationHistory(),
			eveCharacterData.getSkills(),
			eveCharacterData.getAttributes(),
			eveCharacterData.getLastUpdated(),
		])

		// If character not found in database, try to auto-fetch from ESI
		if (!info) {
			logger.info('[Character Detail] Character not in database, attempting auto-fetch', {
				characterId: characterIdStr,
			})

			try {
				// Fetch public character data from ESI and store in database
				await eveCharacterData.fetchCharacterData()

				// Retry fetching from database after auto-fetch
				const [newInfo, newCorporationHistory] = await Promise.all([
					eveCharacterData.getCharacterInfo(),
					eveCharacterData.getCorporationHistory(),
				])

				if (newInfo) {
					// Successfully fetched and stored - update variables
					info = newInfo
					corporationHistory = newCorporationHistory

					logger.info('[Character Detail] Auto-fetch successful', {
						characterId: characterIdStr,
						characterName: newInfo.name,
					})
				} else {
					// Still not found after fetch - character doesn't exist in ESI
					logger.warn('[Character Detail] Character not found in ESI', {
						characterId: characterIdStr,
					})
					return c.json({ error: 'Character not found' }, 404)
				}
			} catch (error) {
				// Auto-fetch failed - log and return 404
				logger.error('[Character Detail] Auto-fetch failed', {
					characterId: characterIdStr,
					error: error instanceof Error ? error.message : String(error),
				})
				return c.json({ error: 'Character not found' }, 404)
			}
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
						(entry: {
							corporationId: string
							recordId: string
							startDate: string
							isDeleted?: boolean
						}) => String(entry.corporationId)
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
			allianceName: info.allianceId
				? entityNames.get(String(info.allianceId)) || undefined
				: undefined,
		}

		// Enrich corporation history with resolved names
		const enrichedCorporationHistory = corporationHistory
			? corporationHistory.map(
					(entry: {
						corporationId: string
						recordId: string
						startDate: string
						isDeleted?: boolean
					}) => ({
						...entry,
						corporationName:
							entityNames.get(String(entry.corporationId)) || `Corporation #${entry.corporationId}`,
					})
				)
			: []

		// Enrich skills with metadata and fetch full skill catalog
		const skillsStub = getStub<any>(c.env.SKILLS, 'default')
		const [enrichedSkills, allSkills] = await Promise.all([
			transformAndEnrichSkillsData(skills, c.env),
			skillsStub.getAllSkills().catch((error: unknown) => {
				logger.warn('[Character Detail] Failed to fetch skill catalog, falling back to trained-only', {
					characterId: characterIdStr,
					requestingUserId: user.id,
					isOwner,
					viewedAsAdmin,
					viewedAsCeoOrDirector,
					error: error instanceof Error ? error.message : String(error),
				})
				return []
			}),
		])

		// Build response with public data
		const response: any = {
			characterId: characterIdStr,
			isOwner,
			viewedAsAdmin,
			viewedAsCeoOrDirector,
			viewerRole,
			public: {
				info: enrichedInfo,
				corporationHistory: enrichedCorporationHistory,
				skills: enrichedSkills,
				allSkills,
				attributes,
			},
			lastUpdated,
		}

		// Add owner info when admin views someone else's character
		if (viewedAsAdmin && actualOwner) {
			response.owner = {
				userId: actualOwner.userId,
				mainCharacterName: actualOwner.characterName,
			}
		}

		// Add sensitive data for owner/admin/authorized HR viewers
		if (canViewSensitiveData) {
			const tokenState = await db
				.select({ hasValidToken: userCharacters.hasValidToken })
				.from(userCharacters)
				.where(eq(userCharacters.characterId, characterIdStr))
				.limit(1)
			const sensitiveDataIsLive = shouldTreatSensitiveDataAsLive(tokenState[0]?.hasValidToken)

			// Fetch live location and status only when the character still has a valid token.
			// If the token is invalid, we keep the stored snapshot as "last known" state and
			// let the UI render it as stale rather than overwriting it with misleading live state.
			if (sensitiveDataIsLive) {
				await Promise.all([
					(async () => {
						try {
							await eveCharacterData.fetchLocation()
						} catch (err: unknown) {
							logger.warn('[Character Detail] Failed to fetch live location', {
								characterId: characterIdStr,
								error: err instanceof Error ? err.message : String(err),
							})
						}
					})(),
					(async () => {
						try {
							await eveCharacterData.fetchStatus()
						} catch (err: unknown) {
							logger.warn('[Character Detail] Failed to fetch live status', {
								characterId: characterIdStr,
								error: err instanceof Error ? err.message : String(err),
							})
						}
					})(),
				])
			}

			const sensitiveData = await eveCharacterData.getSensitiveData()

			if (sensitiveData) {
				// Enrich skill queue with metadata
				const enrichedSkillQueue = await transformAndEnrichSkillQueue(
					sensitiveData.skillQueue,
					c.env
				)

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
							sensitiveDataIsLive,
							skillQueue: enrichedSkillQueue,
						}
					} else {
						response.private = {
							location: sensitiveData.location,
							wallet: sensitiveData.wallet,
							assets: sensitiveData.assets,
							status: sensitiveData.status,
							sensitiveDataIsLive,
							skillQueue: enrichedSkillQueue,
						}
					}
				} else {
					response.private = {
						wallet: sensitiveData.wallet,
						assets: sensitiveData.assets,
						status: sensitiveData.status,
						sensitiveDataIsLive,
						skillQueue: enrichedSkillQueue,
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
 * Available to character owner and site admins
 */
app.post('/:characterId/refresh', requireAuth(), async (c) => {
	const characterIdStr = c.req.param('characterId')
	const characterId = createEveCharacterId(characterIdStr)
	const user = c.get('user')!
	const isAdmin = user.is_admin

	// Check if user owns this character or is an admin
	const character = user.characters.find((char) => char.characterId.toString() === characterIdStr)
	if (!character && !isAdmin) {
		return c.json({ error: 'Character not found or not owned by user' }, 403)
	}

	// Get EVE Character Data DO stub
	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, characterId)
	const eveCharacterData = await eveCharacterDataStub.getInstance(characterId)

	// Get EVE Token Store DO stub for authenticated data
	const eveTokenStoreStub = c.get('eveTokenStore')
	const db = c.get('db')

	if (!eveTokenStoreStub) {
		logger.error('eveTokenStore not found in context!')
		return c.json({ error: 'Token store not initialized' }, 500)
	}
	if (!db) {
		logger.error('Database not found in context!')
		return c.json({ error: 'Database not initialized' }, 500)
	}

	let isDeletedCharacter = false

	try {
		// Check token info first to verify scopes
		const tokenInfo = await eveTokenStoreStub.getTokenInfo(characterIdStr)

		// Always fetch public data (doesn't require auth)
		try {
			logger.info('Calling refreshPublicCharacterData with characterId:', characterIdStr)
			const publicRefreshResult = await eveCharacterData.refreshPublicCharacterData(true)
			isDeletedCharacter = publicRefreshResult.isDeleted === true
			logger.info('refreshPublicCharacterData completed successfully', {
				characterId: characterIdStr,
				isDeleted: isDeletedCharacter,
				affiliationChanged: publicRefreshResult.affiliationChanged === true,
			})

			if (isDeletedCharacter) {
				await markCharacterDeletedEverywhere(db, c.env, characterIdStr)

				const ownerUserId = character
					? user.id
					: (
							await db.query.userCharacters.findFirst({
								where: eq(userCharacters.characterId, characterIdStr),
								columns: { userId: true },
							})
						)?.userId

				if (ownerUserId) {
					await triggerUserRefreshWorkflow({
						db,
						env: c.env,
						userId: ownerUserId,
						source: 'character-refresh-deleted',
						bypassThrottle: true,
						refreshMode: 'manual',
					})
				}
			}
		} catch (error) {
			logger.error('Failed to refresh public character data:', error)
			logger.error(
				'Error details - characterId:',
				characterId,
				'characterIdStr:',
				characterIdStr,
				'error type:',
				typeof error
			)
			throw new Error(
				`Failed to refresh public character data: ${error instanceof Error ? error.message : String(error)}`
			)
		}

		const tokenStatus = db
			? await validateAndSyncCharacterTokenValidity({
					db,
					tokenStore: eveTokenStoreStub,
					characterId: characterIdStr,
					touchLastCharacterRefresh: true,
				})
			: null
		const fallbackValidation = tokenStatus ? null : await eveTokenStoreStub.validateToken(characterIdStr)
		const hasValidToken = tokenStatus
			? tokenStatus.nextHasValidToken === true
			: fallbackValidation?.isValid === true
		let authError: string | undefined = tokenStatus?.validation.error ?? fallbackValidation?.error

		// Try to fetch authenticated data if token is valid and the character is still live.
		if (hasValidToken && !isDeletedCharacter) {
			try {
				await eveCharacterData.fetchAuthenticatedData(true)
			} catch (error) {
				authError =
					error instanceof Error
						? error.message
						: error && typeof error === 'object' && 'remote' in error
							? 'Durable Object connection failed'
							: String(error)
				logger.error('Could not fetch authenticated data:', authError)
				logger.error('Full error:', error)
			}
		}

		// Get the updated data
		let lastUpdated: string | null = null
		try {
			const lastUpdatedDate = await eveCharacterData.getLastUpdated()
			lastUpdated = lastUpdatedDate ? lastUpdatedDate.toISOString() : null
		} catch (error) {
			logger.error('Failed to get last updated timestamp:', error)
			// Don't throw here, just set to null and continue
		}

		// Check and update director status (fire and forget) — only for owned characters
		if (character) {
			waitUntilWithTelemetry(
				c.executionCtx,
				'characters.director-status',
				() => checkAndUpdateDirectorStatus(
					characterIdStr,
					character.characterName,
					user.id,
					db!,
					c.env.EVE_CHARACTER_DATA,
					c.env.EVE_TOKEN_STORE,
					c.env.EVE_CORPORATION_DATA
				),
				{
					characterId: characterIdStr,
					userId: user.id,
				}
			)
		}

		return c.json({
			success: true,
			message: isDeletedCharacter
				? 'Character marked as deleted during refresh'
				: hasValidToken
				? 'Character data refreshed successfully'
				: 'Public character data refreshed (no valid token for private data)',
			lastUpdated,
			hasValidToken: isDeletedCharacter ? false : hasValidToken,
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

		return c.json(
			{
				error: 'Failed to refresh character data',
				details: errorMessage,
				success: false,
			},
			500
		)
	}
})

export default app
