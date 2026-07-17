import { eq, ilike, inArray, or } from 'drizzle-orm'
import { Hono, type Context } from 'hono'

import { getStub } from '@repo/do-utils'
import { createEveCharacterId } from '@repo/eve-types'
import { logger } from '@repo/hono-helpers'

import { userCharacters } from '../db/schema'
import { waitUntilWithTelemetry } from '../lib/background-task'
import {
	canViewCharacterPrivateDetails,
	resolveCharacterAccessContext,
	shouldBlockCharacterPrivateAccess,
} from '../lib/character-access'
import { queueImmunitasAccessAlertForUser } from '../lib/immunitas-alerts'
import { didTokenTransitionFromValidToInvalid, queueTokenInvalidationAlertsForUser } from '../lib/token-invalid-alerts'
import { validateAndSyncCharacterTokenValidity } from '../lib/token-validity'
import { markCharacterTokenInvalidFromAuthFailure } from '../lib/token-validity'
import { triggerUserRefreshWorkflow } from '../lib/workflow-triggers'
import { requireAuth } from '../middleware/session'
import { checkAndUpdateDirectorStatus } from '../services/corporation-auto-register.service'
import { markCharacterDeletedEverywhere } from '../services/character-deletion.service'
import { EntityResolverService } from '../services/entity-resolver.service'
import { shouldTreatSensitiveDataAsLive } from './characters-utils'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { Core as CoreRpc } from '@repo/core'
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

function transformCharacterSkills(skills: any): {
	skills: Array<{
		activeSkillLevel: number
		skillId: number | string
		skillpointsInSkill: number
		trainedSkillLevel: number
	}>
	totalSp: number
	unallocatedSp: number | undefined
} | null {
	if (!skills) return null

	return {
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

function getExecutionContextOrNull(c: Context<App>): ExecutionContext | null {

	try {
		return c.executionCtx
	} catch {
		return null
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
 * POST /characters/ownership
 * Resolve ownership for a batch of character IDs.
 *
 * Request body: { characterIds: string[] }
 * Response: { ownerships: Record<string, { userId: string }> }
 */
app.post('/ownership', requireAuth(), async (c) => {
	const db = c.get('db')
	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	let body: unknown
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'Invalid request body' }, 400)
	}

	const characterIds = Array.isArray((body as { characterIds?: unknown } | null)?.characterIds)
		? [...new Set(
				((body as { characterIds?: unknown }).characterIds as unknown[])
					.map((characterId) => String(characterId).trim())
					.filter(Boolean),
			)]
		: []

	if (characterIds.length === 0) {
		return c.json({ ownerships: {} }, 200)
	}

	try {
		const rows = await db
			.select({
				characterId: userCharacters.characterId,
				userId: userCharacters.userId,
			})
			.from(userCharacters)
			.where(inArray(userCharacters.characterId, characterIds))

		const ownerships: Record<string, { userId: string }> = {}
		for (const row of rows) {
			ownerships[row.characterId] = { userId: row.userId }
		}

		return c.json({ ownerships })
	} catch (error) {
		logger.error('Error resolving character ownership:', error)
		return c.json({ error: 'Failed to resolve character ownership' }, 500)
	}
})

/**
 * GET /characters/:characterId/private
 * Fetch private profile data and skills for intentional profile-detail hydration only.
 * This route shares the same visibility matrix as the overview route, with the
 * additional immunitas gate for non-owner access. The backend derives HR scope
 * from viewer/target corp attachments and open applications; no frontend corp
 * scope is accepted. It is the only character profile route that queues
 * profile-data immunitas access alerts.
 */
app.get('/:characterId/private', requireAuth(), async (c) => {
	const characterIdStr = c.req.param('characterId')
	const characterId = createEveCharacterId(characterIdStr)
	const accessOrResponse = await resolveCharacterAccessContext(c, characterIdStr)

	if (accessOrResponse instanceof Response) {
		return accessOrResponse
	}

	const access = accessOrResponse
	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, characterId)
	const eveCharacterData = await eveCharacterDataStub.getInstance(characterId)
	const eveTokenStore = c.get('eveTokenStore')

	if (!eveTokenStore) {
		logger.error('eveTokenStore not found in context!')
		return c.json({ error: 'Token store not initialized' }, 500)
	}

	try {
		const targetOwner = access.targetOwner
		if (targetOwner && shouldBlockCharacterPrivateAccess(access)) {
			const coreStub = getStub<CoreRpc>(c.env.CORE, 'default')
			const requestorCharacterLabel =
				access.user.characters.find((char) => char.characterId === access.user.mainCharacterId)
					?.characterName ??
				access.user.characters.find((char) => char.is_primary)?.characterName ??
				access.user.characters[0]?.characterName ??
				null
			const executionCtx = getExecutionContextOrNull(c)
			const queueAlert = () =>
				queueImmunitasAccessAlertForUser(coreStub, {
					targetUserId: targetOwner.userId,
					targetCharacterLabel: targetOwner.characterName,
					requestorUserId: access.user.id,
					requestorCharacterLabel,
					accessType: 'profile-data',
					source: 'characters.private',
				})
			if (executionCtx) {
				await waitUntilWithTelemetry(executionCtx, 'characters.immunitas-profile-alert', queueAlert)
			} else {
				await queueAlert()
			}
			return c.json({ error: 'You do not have permission to view this character' }, 403)
		}

		const canViewSensitiveData = canViewCharacterPrivateDetails(access)

		if (!canViewSensitiveData) {
			return c.json({ error: 'You do not have permission to view this character' }, 403)
		}

		const [skills, allSkills] = await Promise.all([
			eveCharacterData.getSkills(),
			getStub<any>(c.env.SKILLS, 'default').getAllSkills().catch((error: unknown) => {
				logger.warn('[Character Detail] Failed to fetch skill catalog, falling back to trained-only', {
					characterId: characterIdStr,
					requestingUserId: access.user.id,
					error: error instanceof Error ? error.message : String(error),
				})
				return []
			}),
		])

		const [enrichedSkills, sensitiveData] = await Promise.all([
			transformAndEnrichSkillsData(skills, c.env),
			eveCharacterData.getSensitiveData(),
		])

		const response: any = {
			characterId: characterIdStr,
			isOwner: access.isActualOwner || access.isAdmin,
			viewedAsAdmin: access.viewedAsAdmin,
			viewedAsCeoOrDirector: access.viewedAsCeoOrDirector,
			viewedAsHrViewer: access.viewedAsHrViewer,
			viewerRole: access.viewerRole,
			skills: enrichedSkills,
			allSkills,
		}

		if (access.viewedAsAdmin && access.actualOwner) {
			response.owner = {
				userId: access.actualOwner.userId,
				mainCharacterName: access.actualOwner.characterName,
			}
		}

		if (sensitiveData) {
			const tokenState = await access.db
				.select({ hasValidToken: userCharacters.hasValidToken })
				.from(userCharacters)
				.where(eq(userCharacters.characterId, characterIdStr))
				.limit(1)
			const sensitiveDataIsLive = shouldTreatSensitiveDataAsLive(tokenState[0]?.hasValidToken)

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

			// Fetch live snapshot data for the profile detail panel.
			if (sensitiveData.location) {
				const locationIds: string[] = []

				if (sensitiveData.location.solarSystemId) {
					locationIds.push(String(sensitiveData.location.solarSystemId))
				}
				if (sensitiveData.location.stationId) {
					locationIds.push(String(sensitiveData.location.stationId))
				}

				if (locationIds.length > 0) {
					const resolver = new EntityResolverService(eveTokenStore)
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
						skillQueue: await transformAndEnrichSkillQueue(sensitiveData.skillQueue, c.env),
					}
				} else {
					response.private = {
						location: sensitiveData.location,
						wallet: sensitiveData.wallet,
						assets: sensitiveData.assets,
						status: sensitiveData.status,
						sensitiveDataIsLive,
						skillQueue: await transformAndEnrichSkillQueue(sensitiveData.skillQueue, c.env),
					}
				}
			} else {
				response.private = {
					wallet: sensitiveData.wallet,
					assets: sensitiveData.assets,
					status: sensitiveData.status,
					sensitiveDataIsLive,
					skillQueue: await transformAndEnrichSkillQueue(sensitiveData.skillQueue, c.env),
				}
			}
		}

		return c.json(response)
	} catch (error) {
		logger.error('Error fetching private character data:', error)
		return c.json({ error: 'Failed to fetch character data' }, 500)
	}
})

/**
 * GET /characters/:characterId/skills
 * Fetch trained skill levels for owned characters and skill-planning UIs.
 * This route is intentionally separate from profile hydration and does not queue alerts.
 */
app.get('/:characterId/skills', requireAuth(), async (c) => {
	const characterIdStr = c.req.param('characterId')
	const characterId = createEveCharacterId(characterIdStr)
	const accessOrResponse = await resolveCharacterAccessContext(c, characterIdStr)

	if (accessOrResponse instanceof Response) {
		return accessOrResponse
	}

	const access = accessOrResponse
	if (!access.isActualOwner && !access.isAdmin) {
		return c.json({ error: 'You do not have permission to view this character' }, 403)
	}

	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, characterId)
	const eveCharacterData = await eveCharacterDataStub.getInstance(characterId)

	try {
		let info = await eveCharacterData.getCharacterInfo()
		if (!info) {
			await eveCharacterData.fetchCharacterData()
			info = await eveCharacterData.getCharacterInfo()
		}

		if (!info) {
			return c.json({ error: 'Character not found' }, 404)
		}

		const skillsData = transformCharacterSkills(await eveCharacterData.getSkills())

		return c.json({
			characterId: characterIdStr,
			characterName: info.name,
			skills: skillsData?.skills ?? [],
			totalSp: skillsData?.totalSp ?? 0,
			unallocatedSp: skillsData?.unallocatedSp ?? null,
		})
	} catch (error) {
		logger.error('Error fetching character skills:', error)
		return c.json({ error: 'Failed to fetch character skills' }, 500)
	}
})

/**
 * GET /characters/:characterId
 * Public overview for character detail pages and lightweight cards.
 * This route intentionally excludes private profile fields and skill data.
 */
app.get('/:characterId', requireAuth(), async (c) => {
	const characterIdStr = c.req.param('characterId')
	const characterId = createEveCharacterId(characterIdStr)
	const accessOrResponse = await resolveCharacterAccessContext(c, characterIdStr)

	if (accessOrResponse instanceof Response) {
		return accessOrResponse
	}

	const access = accessOrResponse
	const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, characterId)
	const eveCharacterData = await eveCharacterDataStub.getInstance(characterId)

	try {
		let [info, corporationHistory, attributes, lastUpdated] = await Promise.all([
			eveCharacterData.getCharacterInfo(),
			eveCharacterData.getCorporationHistory(),
			eveCharacterData.getAttributes(),
			eveCharacterData.getLastUpdated(),
		])

		if (!info) {
			logger.info('[Character Detail] Character not in database, attempting auto-fetch', {
				characterId: characterIdStr,
			})

			try {
				await eveCharacterData.fetchCharacterData()

				const [newInfo, newCorporationHistory] = await Promise.all([
					eveCharacterData.getCharacterInfo(),
					eveCharacterData.getCorporationHistory(),
				])

				if (newInfo) {
					info = newInfo
					corporationHistory = newCorporationHistory

					logger.info('[Character Detail] Auto-fetch successful', {
						characterId: characterIdStr,
						characterName: newInfo.name,
					})
				} else {
					logger.warn('[Character Detail] Character not found in ESI', {
						characterId: characterIdStr,
					})
					return c.json({ error: 'Character not found' }, 404)
				}
			} catch (error) {
				logger.error('[Character Detail] Auto-fetch failed', {
					characterId: characterIdStr,
					error: error instanceof Error ? error.message : String(error),
				})
				return c.json({ error: 'Character not found' }, 404)
			}
		}

		const eveTokenStore = c.get('eveTokenStore')
		if (!eveTokenStore) {
			logger.error('eveTokenStore not found in context!')
			return c.json({ error: 'Token store not initialized' }, 500)
		}

		const resolver = new EntityResolverService(eveTokenStore)
		const idsToResolve: string[] = [String(info.corporationId)]
		if (info.allianceId) {
			idsToResolve.push(String(info.allianceId))
		}

		if (corporationHistory && corporationHistory.length > 0) {
			const historyCorpIds: string[] = [
				...new Set<string>(
					corporationHistory.map((entry: { corporationId: string }) => String(entry.corporationId))
				),
			]
			idsToResolve.push(...historyCorpIds)
		}

		const uniqueIds = [...new Set(idsToResolve)]
		const entityNames = await resolver.resolveEntityNames(uniqueIds)

		const response: any = {
			characterId: characterIdStr,
			isOwner: access.isActualOwner || access.isAdmin,
			viewedAsAdmin: access.viewedAsAdmin,
			viewedAsCeoOrDirector: access.viewedAsCeoOrDirector,
			viewedAsHrViewer: access.viewedAsHrViewer,
			viewerRole: access.viewerRole,
			public: {
				info: {
					...info,
					corporationName: entityNames.get(String(info.corporationId)) || undefined,
					allianceName: info.allianceId
						? entityNames.get(String(info.allianceId)) || undefined
						: undefined,
				},
				corporationHistory: corporationHistory
					? corporationHistory.map((entry: { corporationId: string; recordId: string; startDate: string; isDeleted?: boolean }) => ({
							...entry,
							corporationName:
								entityNames.get(String(entry.corporationId)) || `Corporation #${entry.corporationId}`,
						}))
					: [],
				attributes,
			},
			lastUpdated,
		}

		if (access.viewedAsAdmin && access.actualOwner) {
			response.owner = {
				userId: access.actualOwner.userId,
				mainCharacterName: access.actualOwner.characterName,
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
					forceValidate: true,
				})
			: null
		const fallbackValidation = tokenStatus ? null : await eveTokenStoreStub.validateToken(characterIdStr)
		let hasValidToken = tokenStatus
			? tokenStatus.nextHasValidToken === true
			: fallbackValidation?.isValid === true
		let authError: string | undefined = tokenStatus?.validation.error ?? fallbackValidation?.error
		let tokenInvalidated = didTokenTransitionFromValidToInvalid(
			tokenStatus?.previousHasValidToken,
			tokenStatus?.nextHasValidToken
		)

		// Try to fetch authenticated data if token is valid and the character is still live.
		if (hasValidToken && !isDeletedCharacter) {
			try {
				await eveCharacterData.fetchAuthenticatedData(true)
			} catch (error) {
				const downgradedToken = db
					? await markCharacterTokenInvalidFromAuthFailure({
							db,
							characterId: characterIdStr,
							error,
							touchLastCharacterRefresh: true,
						})
					: false
				if (downgradedToken) {
					hasValidToken = false
					tokenInvalidated =
						didTokenTransitionFromValidToInvalid(
							tokenStatus?.previousHasValidToken,
							false
						) || tokenInvalidated
				}
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

		if (tokenInvalidated && tokenStatus) {
			waitUntilWithTelemetry(
				c.executionCtx,
				'characters.token-invalid-alert',
				async () => {
					const coreStub = getStub<CoreRpc>(c.env.CORE, 'default')
					await queueTokenInvalidationAlertsForUser(coreStub, {
						userId: user.id,
						characterIds: [characterIdStr],
						source: 'character-refresh-token-invalidated',
					})
				},
				{
					userId: user.id,
					characterId: characterIdStr,
				}
			)
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
