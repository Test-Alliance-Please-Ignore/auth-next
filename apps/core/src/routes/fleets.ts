import { Hono } from 'hono'
import type { Context } from 'hono'

import { and, eq, ilike, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { createEveCharacterId } from '@repo/eve-types'
import { StartTrackingSessionError } from '@repo/fleets'
import { logger, TimeCache } from '@repo/hono-helpers'

import { createDb, schema } from '../db'
import { getCachedCharacterPermissions, getCachedUserPermissions } from '../lib/groups-cache'
import { validatePagination } from '../lib/validation'
import { requireAuth } from '../middleware/session'

import type { EsiTypeResolver } from '@repo/esi'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type {
	CharacterForFleetJoin,
	CharacterStatsResult,
	Fleets,
	StatsRange,
	TrackingSessionStatus,
} from '@repo/fleets'
import type { Universe } from '@repo/universe'
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
				const hasValidToken = (await tokenStore.validateToken(characterId)).isValid

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
 * Get detailed fleet information.
 *
 * Constrained to numeric IDs so it does not collide with sibling routes
 * like /tracking, /quick-join, etc.
 */
app.get('/:fleetId{[0-9]+}', async (c) => {
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

// ============================================================================
// Manual fleet tracking
// ============================================================================

const FLEET_TRACKING_CREATE = 'urn:fleet-tracking:create'
const FLEET_TRACKING_VIEW_ALL = 'urn:fleet-tracking:view-all'

/**
 * Resolve the viewer's tracking permissions in one go.
 * Admin implies both perms.
 */
async function resolveTrackingPerms(
	c: Context<App>
): Promise<{ canCreate: boolean; canViewAll: boolean; isAdmin: boolean }> {
	const user = c.get('user')!
	const isAdmin = !!user.is_admin
	if (isAdmin) {
		return { canCreate: true, canViewAll: true, isAdmin: true }
	}
	const userPerms = await getCachedUserPermissions(c.env, user.id)
	const urns = new Set(userPerms.map((p) => p.urn))
	return {
		canCreate: urns.has(FLEET_TRACKING_CREATE),
		canViewAll: urns.has(FLEET_TRACKING_VIEW_ALL),
		isAdmin: false,
	}
}

/**
 * Resolve a batch of arbitrary EVE entity IDs (characters, ships, systems,
 * corps, alliances, stations) to names using the shared ESI type resolver.
 * Returns a map { id: name }; missing IDs are simply absent from the map.
 */
async function resolveNames(
	c: Context<App>,
	ids: Array<string | number>
): Promise<Record<string, string>> {
	const stringIds = Array.from(
		new Set(ids.filter((x) => x !== null && x !== undefined).map((x) => String(x)))
	)
	if (stringIds.length === 0) return {}
	const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
	try {
		return await resolver.resolveIds(stringIds)
	} catch (error) {
		logger.warn('Failed to resolve IDs via EsiTypeResolver', {
			error: error instanceof Error ? error.message : String(error),
			idCount: stringIds.length,
		})
		return {}
	}
}

/**
 * POST /fleets/tracking
 * Start a new tracking session.
 * Requires :create. Character must be owned by the caller.
 */
app.post('/tracking', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json<{ characterId?: string; name?: string }>()

	const characterId = body.characterId?.trim()
	const name = body.name?.trim()

	if (!characterId) return c.json({ error: 'characterId is required' }, 400)
	if (!name) return c.json({ error: 'name is required' }, 400)

	const ownsCharacter = user.characters.some((char) => char.characterId.toString() === characterId)
	if (!ownsCharacter) {
		return c.json({ error: 'You do not own this character' }, 403)
	}

	const { canCreate } = await resolveTrackingPerms(c)
	if (!canCreate) {
		return c.json(
			{
				error: 'You do not have permission to perform this action.',
			},
			403
		)
	}

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

	try {
		const result = await fleetsStub.startTrackingSession({
			characterId,
			startedByUserId: user.id,
			name,
		})
		return c.json({ sessionId: result.sessionId }, 201)
	} catch (error) {
		if (error instanceof StartTrackingSessionError) {
			const status =
				error.code === 'not_in_fleet' || error.code === 'not_fleet_boss'
					? 400
					: error.code === 'character_session_active' || error.code === 'fleet_session_active'
					? 409
					: 502
			return c.json({ error: error.code, message: error.message }, status)
		}
		logger.error('startTrackingSession failed', {
			characterId,
			userId: user.id,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to start tracking session' }, 500)
	}
})

/**
 * DELETE /fleets/tracking/:sessionId
 * Stop an active session. Only the session owner or an admin can stop.
 */
app.delete('/tracking/:sessionId', async (c) => {
	const user = c.get('user')!
	const sessionId = c.req.param('sessionId')

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const session = await fleetsStub.getTrackingSession(sessionId)
	if (!session) return c.json({ error: 'Session not found' }, 404)
	if (session.status !== 'active') {
		return c.json({ error: 'Session is not active' }, 409)
	}

	const { isAdmin } = await resolveTrackingPerms(c)
	const isOwner = session.startedByUserId === user.id
	if (!isOwner && !isAdmin) {
		return c.json({ error: 'You can only stop your own sessions' }, 403)
	}

	try {
		await fleetsStub.stopTrackingSession({
			sessionId,
			endedReason: isOwner ? 'user_stopped' : 'admin_stopped',
			endedByUserId: user.id,
		})
		return c.json({ ok: true })
	} catch (error) {
		logger.error('stopTrackingSession failed', {
			sessionId,
			userId: user.id,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to stop tracking session' }, 500)
	}
})

/**
 * POST /fleets/tracking/:sessionId/kick-members
 * Remove one or more members from the active tracked fleet via ESI.
 * Owner of the session or admin only.
 */
app.post('/tracking/:sessionId/kick-members', async (c) => {
	const user = c.get('user')!
	const sessionId = c.req.param('sessionId')
	const body = await c.req.json<{ memberCharacterIds?: string[] }>()
	const memberCharacterIds = Array.from(
		new Set((body.memberCharacterIds ?? []).map((id) => id?.trim()).filter(Boolean) as string[])
	)
	if (memberCharacterIds.length === 0) {
		return c.json({ error: 'memberCharacterIds is required' }, 400)
	}

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const session = await fleetsStub.getTrackingSession(sessionId)
	if (!session) return c.json({ error: 'Session not found' }, 404)
	if (session.status !== 'active') {
		return c.json({ error: 'Session is not active' }, 409)
	}

	const { isAdmin } = await resolveTrackingPerms(c)
	const isOwner = session.startedByUserId === user.id
	if (!isOwner && !isAdmin) {
		return c.json({ error: 'You can only manage your own active sessions' }, 403)
	}

	try {
		const results = await fleetsStub.kickTrackingSessionMembers({
			sessionId,
			memberCharacterIds,
		})
		return c.json({
			results,
			summary: {
				total: results.length,
				success: results.filter((r) => r.success).length,
				failed: results.filter((r) => !r.success).length,
			},
		})
	} catch (error) {
		logger.error('kickTrackingSessionMembers failed', {
			sessionId,
			userId: user.id,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to remove members from fleet' }, 500)
	}
})

/**
 * GET /fleets/tracking
 * List sessions, scoped by permissions.
 */
app.get('/tracking', async (c) => {
	const user = c.get('user')!
	const { canCreate, canViewAll } = await resolveTrackingPerms(c)
	if (!canCreate && !canViewAll) {
		return c.json({ error: 'Fleet tracking is not available to you' }, 403)
	}

	const url = new URL(c.req.url)
	const status = url.searchParams.get('status') as TrackingSessionStatus | null
	const characterIdParam = url.searchParams.get('characterId') ?? undefined
	const userIdParam = url.searchParams.get('userId') ?? undefined
	const fromParam = url.searchParams.get('from') ?? undefined
	const toParam = url.searchParams.get('to') ?? undefined
	const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
	if (!pagination.success) {
		return c.json({ error: pagination.error }, pagination.status)
	}

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

	const filter: Parameters<Fleets['listTrackingSessions']>[0] = {
		characterId: characterIdParam,
		status: status ?? undefined,
		from: fromParam,
		to: toParam,
		limit: pagination.data.limit,
		offset: pagination.data.offset,
	}

	if (canViewAll) {
		if (userIdParam) filter.startedByUserId = userIdParam
	} else {
		// :create-only viewers see only their own sessions, regardless of query
		filter.startedByUserId = user.id
	}

	const result = await fleetsStub.listTrackingSessions(filter)

	// Resolve FC character IDs to names so the list shows pilot names instead of IDs.
	const characterIds = Array.from(new Set(result.items.map((s) => s.characterId)))
	const names = await resolveNames(c, characterIds)

	return c.json({
		...result,
		items: result.items.map((s) => ({
			...s,
			characterName: names[s.characterId] ?? null,
		})),
	})
})

/**
 * Helper: load a session and decide whether the caller is allowed to see
 * (a) the summary and (b) the detail tabs.
 *
 * Returns either { mode: 'allow', session, detail } or a Response to short-circuit.
 */
async function resolveSessionAccess(
	c: Context<App>,
	sessionId: string
): Promise<
	| { mode: 'allow'; session: NonNullable<Awaited<ReturnType<Fleets['getTrackingSession']>>>; canViewDetail: boolean }
	| Response
> {
	const user = c.get('user')!
	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const session = await fleetsStub.getTrackingSession(sessionId)
	if (!session) return c.json({ error: 'Session not found' }, 404)

	const { canViewAll, isAdmin } = await resolveTrackingPerms(c)
	const isOwner = session.startedByUserId === user.id

	if (!isOwner && !canViewAll && !isAdmin) {
		return c.json({ error: 'Session not found' }, 404)
	}

	const canViewDetail = canViewAll || isAdmin || (isOwner && session.status === 'active')
	return { mode: 'allow', session, canViewDetail }
}

/**
 * GET /fleets/tracking/:sessionId
 * Summary metadata. Owner can always see summary; detail tabs require additional perms.
 */
app.get('/tracking/:sessionId', async (c) => {
	const result = await resolveSessionAccess(c, c.req.param('sessionId'))
	if (result instanceof Response) return result

	const names = await resolveNames(c, [result.session.characterId])
	return c.json({
		...result.session,
		characterName: names[result.session.characterId] ?? null,
	})
})

/**
 * GET /fleets/tracking/:sessionId/live
 * Live snapshot from fleet_state_cache. Useful while the session is active.
 */
app.get('/tracking/:sessionId/live', async (c) => {
	const result = await resolveSessionAccess(c, c.req.param('sessionId'))
	if (result instanceof Response) return result
	if (!result.canViewDetail) {
		return c.json({ error: 'historical_detail_requires_view_all' }, 403)
	}

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const snapshot = await fleetsStub.getSessionLiveSnapshot(c.req.param('sessionId'))
	if (!snapshot) return c.json({ snapshot: null })
	return c.json({ snapshot })
})

/**
 * GET /fleets/tracking/:sessionId/current-members
 * Current member roster with ship + ship-group resolution.
 *
 * Returns:
 *   members: one row per pilot currently in the fleet (sourced from open ship-event rows).
 *   groupCounts: count of pilots grouped by ship group (Frigate, Cruiser, etc).
 */
app.get('/tracking/:sessionId/current-members', async (c) => {
	const result = await resolveSessionAccess(c, c.req.param('sessionId'))
	if (result instanceof Response) return result
	if (!result.canViewDetail) {
		return c.json({ error: 'historical_detail_requires_view_all' }, 403)
	}

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const members = await fleetsStub.getSessionCurrentMembers(c.req.param('sessionId'))

	if (members.length === 0) {
		return c.json({ members: [], groupCounts: [] })
	}

	// Resolve character names via EsiTypeResolver (cached).
	const charIds = Array.from(new Set(members.map((m) => m.characterId)))
	const nameMap = await resolveNames(c, charIds)

	// Resolve ship type metadata via Universe DO to get type name + groupId.
	const shipTypeIds = Array.from(new Set(members.map((m) => String(m.shipTypeId))))
	const universe = getStub<Universe>(c.env.UNIVERSE, 'global')
	let typeMeta: Record<string, { typeName: string; groupId: string } | null> = {}
	try {
		const raw = await universe.resolveTypeNamesByIds(shipTypeIds)
		for (const [id, t] of Object.entries(raw)) {
			typeMeta[id] = t ? { typeName: t.typeName, groupId: t.groupId } : null
		}
	} catch (error) {
		logger.warn('Failed to resolve type metadata for current members', {
			error: error instanceof Error ? error.message : String(error),
		})
	}

	// Resolve group names from the distinct set of groupIds.
	const groupIds = Array.from(
		new Set(
			Object.values(typeMeta)
				.filter((t): t is { typeName: string; groupId: string } => !!t)
				.map((t) => t.groupId)
		)
	)
	let groupNames: Record<string, string | null> = {}
	if (groupIds.length > 0) {
		try {
			const raw = await universe.resolveInvGroups(groupIds)
			for (const [id, g] of Object.entries(raw)) {
				groupNames[id] = g?.groupName ?? null
			}
		} catch (error) {
			logger.warn('Failed to resolve group names for current members', {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	const resolvedMembers = members.map((m) => {
		const meta = typeMeta[String(m.shipTypeId)] ?? null
		const groupId = meta?.groupId ?? null
		return {
			characterId: m.characterId,
			characterName: nameMap[m.characterId] ?? null,
			shipTypeId: m.shipTypeId,
			shipTypeName: meta?.typeName ?? null,
			solarSystemId: m.solarSystemId,
			systemName: nameMap[String(m.solarSystemId)] ?? null,
			stationId: m.stationId,
			groupId,
			groupName: groupId ? groupNames[groupId] ?? null : null,
			sinceTime: m.sinceTime,
		}
	})

	// Resolve system names for any systems we haven't seen yet.
	const systemIds = Array.from(
		new Set(
			resolvedMembers
				.filter((m) => !m.systemName)
				.map((m) => String(m.solarSystemId))
		)
	)
	if (systemIds.length > 0) {
		const sysNames = await resolveNames(c, systemIds)
		for (const m of resolvedMembers) {
			if (!m.systemName) m.systemName = sysNames[String(m.solarSystemId)] ?? null
		}
	}

	// Aggregate group counts.
	const counts = new Map<string, { groupId: string; groupName: string | null; count: number }>()
	for (const m of resolvedMembers) {
		const key = m.groupId ?? 'unknown'
		const existing = counts.get(key)
		if (existing) {
			existing.count += 1
		} else {
			counts.set(key, {
				groupId: m.groupId ?? 'unknown',
				groupName: m.groupName ?? 'Unknown',
				count: 1,
			})
		}
	}
	const groupCounts = Array.from(counts.values()).sort((a, b) => b.count - a.count)

	return c.json({ members: resolvedMembers, groupCounts })
})

/**
 * GET /fleets/tracking/:sessionId/timeline
 * Join/leave events for the session, paginated.
 */
app.get('/tracking/:sessionId/timeline', async (c) => {
	const result = await resolveSessionAccess(c, c.req.param('sessionId'))
	if (result instanceof Response) return result
	if (!result.canViewDetail) {
		return c.json({ error: 'historical_detail_requires_view_all' }, 403)
	}

	const url = new URL(c.req.url)
	const eventType = url.searchParams.get('eventType') as 'join' | 'leave' | null
	const characterId = url.searchParams.get('characterId') ?? undefined
	const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
	if (!pagination.success) {
		return c.json({ error: pagination.error }, pagination.status)
	}

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const timeline = await fleetsStub.getSessionTimeline({
		sessionId: c.req.param('sessionId'),
		eventType: eventType ?? undefined,
		characterId,
		limit: pagination.data.limit,
		offset: pagination.data.offset,
	})

	// Resolve all distinct character / ship / system / station IDs in the page.
	const ids: Array<string | number> = []
	for (const row of timeline.items) {
		ids.push(row.characterId, row.shipTypeId, row.solarSystemId)
		if (row.stationId) ids.push(row.stationId)
		if (row.previousShipTypeId) ids.push(row.previousShipTypeId)
	}
	const names = await resolveNames(c, ids)

	return c.json({
		...timeline,
		items: timeline.items.map((row) => ({
			...row,
			characterName: row.characterName ?? names[row.characterId] ?? null,
			shipTypeName: row.shipTypeName ?? names[String(row.shipTypeId)] ?? null,
			systemName: row.systemName ?? names[String(row.solarSystemId)] ?? null,
			previousShipTypeName:
				row.previousShipTypeId != null
					? names[String(row.previousShipTypeId)] ?? null
					: null,
		})),
	})
})

/**
 * GET /fleets/tracking/:sessionId/members/:characterId/ship-history
 * Ship-change timeline for one character within the session.
 */
app.get('/tracking/:sessionId/members/:characterId/ship-history', async (c) => {
	const result = await resolveSessionAccess(c, c.req.param('sessionId'))
	if (result instanceof Response) return result
	if (!result.canViewDetail) {
		return c.json({ error: 'historical_detail_requires_view_all' }, 403)
	}

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const characterId = c.req.param('characterId')
	const rows = await fleetsStub.getSessionMemberShipHistory({
		sessionId: c.req.param('sessionId'),
		characterId,
	})

	const ids: Array<string | number> = [characterId]
	for (const row of rows) {
		ids.push(row.shipTypeId, row.solarSystemId)
		if (row.stationId) ids.push(row.stationId)
	}
	const names = await resolveNames(c, ids)

	return c.json({
		characterId,
		characterName: names[characterId] ?? null,
		items: rows.map((row) => ({
			...row,
			shipTypeName: names[String(row.shipTypeId)] ?? null,
			systemName: names[String(row.solarSystemId)] ?? null,
			stationName: row.stationId ? names[String(row.stationId)] ?? null : null,
		})),
	})
})

/**
 * GET /fleets/tracking/:sessionId/roster
 * Full per-pilot roster for the session — every character that ever appeared.
 * Includes total time, ships flown count, last ship, and stayed-to-end flag.
 */
app.get('/tracking/:sessionId/roster', async (c) => {
	const result = await resolveSessionAccess(c, c.req.param('sessionId'))
	if (result instanceof Response) return result
	if (!result.canViewDetail) {
		return c.json({ error: 'historical_detail_requires_view_all' }, 403)
	}

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const rows = await fleetsStub.getSessionRoster(c.req.param('sessionId'))

	if (rows.length === 0) {
		return c.json({ items: [] })
	}

	// Resolve character names + ship type names.
	const charIds = Array.from(new Set(rows.map((r) => r.characterId)))
	const shipIds = Array.from(new Set(rows.map((r) => r.lastShipTypeId)))
	const names = await resolveNames(c, [...charIds, ...shipIds])

	return c.json({
		items: rows.map((r) => ({
			...r,
			characterName: names[r.characterId] ?? null,
			lastShipTypeName: names[String(r.lastShipTypeId)] ?? null,
		})),
	})
})

/**
 * GET /fleets/tracking/:sessionId/summary
 * Archived summary, available after the session has ended.
 * Summary is allowed for the owner of an ended session (counts as summary
 * access, not detail), as well as :view-all viewers.
 */
app.get('/tracking/:sessionId/summary', async (c) => {
	const result = await resolveSessionAccess(c, c.req.param('sessionId'))
	if (result instanceof Response) return result

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const summary = await fleetsStub.getSessionSummary(c.req.param('sessionId'))
	return c.json({ summary })
})

// ============================================================================
// Fleet tracking — analytics / stats
// ============================================================================

/**
 * 5-minute response cache for stats endpoints.
 * Key: scope:url. Different cache entries for :create-only vs :view-all viewers
 * because their visible session set differs (overview cares; per-character does
 * not since we already gated access by URL).
 */
const fleetStatsCache = new TimeCache<unknown>(5 * 60 * 1000)

/** Parse from/to from URL; default to last 30 days. */
function parseStatsRange(c: Context<App>): { success: true; data: StatsRange } | { success: false; error: string } {
	const url = new URL(c.req.url)
	const now = new Date()
	const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

	const fromParam = url.searchParams.get('from')
	const toParam = url.searchParams.get('to')

	const from = fromParam ? new Date(fromParam) : defaultFrom
	const to = toParam ? new Date(toParam) : now
	if (Number.isNaN(from.getTime())) {
		return { success: false, error: 'Invalid from timestamp' }
	}
	if (Number.isNaN(to.getTime())) {
		return { success: false, error: 'Invalid to timestamp' }
	}

	return { success: true, data: { from: from.toISOString(), to: to.toISOString() } }
}

/** Cache key derived from the URL and viewer scope. */
function statsCacheKey(c: Context<App>, scope: 'view-all' | 'self' | string): string {
	const url = new URL(c.req.url)
	const sortedParams: string[] = []
	const keys = Array.from(url.searchParams.keys()).sort()
	for (const k of keys) sortedParams.push(`${k}=${url.searchParams.get(k)}`)
	return `${scope}:${url.pathname}?${sortedParams.join('&')}`
}

async function withStatsCache<T>(
	c: Context<App>,
	scope: string,
	loader: () => Promise<T>
): Promise<T> {
	const key = statsCacheKey(c, scope)
	return (await fleetStatsCache.getOrSet(key, loader)) as T
}

/**
 * Look up the corp/user mapping for a batch of character IDs in core's own DB.
 */
async function resolveCharacterOwnership(
	c: Context<App>,
	characterIds: string[]
): Promise<{
	byCharacter: Record<
		string,
		{
			userId: string | null
			characterName: string | null
			corporationId: string | null
			corporationName: string | null
		}
	>
}> {
	if (characterIds.length === 0) return { byCharacter: {} }
	const db = createDb(c.env.DATABASE_URL)
	const rows = await db
		.select({
			characterId: schema.userCharacters.characterId,
			userId: schema.userCharacters.userId,
			characterName: schema.userCharacters.characterName,
			corporationId: schema.userCharacters.corporationId,
			corporationName: schema.userCharacters.corporationName,
		})
		.from(schema.userCharacters)
		.where(inArray(schema.userCharacters.characterId, characterIds))

	const byCharacter: Record<
		string,
		{
			userId: string | null
			characterName: string | null
			corporationId: string | null
			corporationName: string | null
		}
	> = {}
	for (const cid of characterIds) {
		byCharacter[cid] = {
			userId: null,
			characterName: null,
			corporationId: null,
			corporationName: null,
		}
	}
	for (const row of rows) {
		byCharacter[row.characterId] = {
			userId: row.userId,
			characterName: row.characterName,
			corporationId: row.corporationId,
			corporationName: row.corporationName,
		}
	}
	return { byCharacter }
}

/**
 * GET /fleets/tracking/stats/overview
 * Org-wide overview. Requires :view-all.
 */
app.get('/tracking/stats/overview', async (c) => {
	const { canViewAll } = await resolveTrackingPerms(c)
	if (!canViewAll) return c.json({ error: 'view-all required' }, 403)

	const rangeResult = parseStatsRange(c)
	if (!rangeResult.success) return c.json({ error: rangeResult.error }, 400)
	const range = rangeResult.data
	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

	const data = await withStatsCache(c, 'view-all', async () => {
		const overview = await fleetsStub.getStatsOverview(range)
		const charIds = new Set<string>()
		for (const r of overview.topFCs) charIds.add(r.characterId)
		for (const r of overview.topPilots) charIds.add(r.characterId)
		const { byCharacter } = await resolveCharacterOwnership(c, Array.from(charIds))

		// Top corps come from the historical-corp rollup against fleet_member_history.
		const corpRollup = await fleetsStub.getCorpRollupForOverview(range)
		const topCorpIds = corpRollup.map((r) => r.corporationId)

		// Fill in character names not present in userCharacters via the ESI resolver.
		const missingNameIds: Array<string | number> = []
		for (const cid of charIds) {
			if (!byCharacter[cid]?.characterName) missingNameIds.push(cid)
		}
		// Also resolve ship type names for the top ships listing and corp names.
		for (const s of overview.topShips) missingNameIds.push(s.shipTypeId)
		for (const corpId of topCorpIds) missingNameIds.push(corpId)
		const resolverNames = await resolveNames(c, missingNameIds)

		const topCorps = corpRollup.map((r) => ({
			corporationId: r.corporationId,
			corporationName: resolverNames[r.corporationId] ?? null,
			pilots: r.pilotCount,
		}))

		const nameFor = (cid: string) =>
			byCharacter[cid]?.characterName ?? resolverNames[cid] ?? null

		return {
			range,
			...overview,
			topFCs: overview.topFCs.map((r) => ({
				...r,
				characterName: nameFor(r.characterId),
				corporationId: byCharacter[r.characterId]?.corporationId ?? null,
				corporationName: byCharacter[r.characterId]?.corporationName ?? null,
			})),
			topPilots: overview.topPilots.map((r) => ({
				...r,
				characterName: nameFor(r.characterId),
				corporationId: byCharacter[r.characterId]?.corporationId ?? null,
				corporationName: byCharacter[r.characterId]?.corporationName ?? null,
			})),
			topShips: overview.topShips.map((s) => ({
				...s,
				shipTypeName: resolverNames[String(s.shipTypeId)] ?? null,
			})),
			topCorps,
		}
	})

	return c.json(data)
})

/**
 * GET /fleets/tracking/stats/search?q=...
 * Autocomplete for the stats overview: returns characters whose name matches the
 * query and all distinct corp IDs ever seen in tracked fleets (with names resolved).
 * Requires :view-all. Results are not paginated; corp list is small.
 */
app.get('/tracking/stats/search', async (c) => {
	const { canViewAll } = await resolveTrackingPerms(c)
	if (!canViewAll) return c.json({ error: 'view-all required' }, 403)

	const query = (c.req.query('q') ?? '').trim()
	if (query.length < 2) {
		return c.json({ characters: [], corporations: [] })
	}

	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')
	const data = await withStatsCache(c, 'view-all', async () => {
		const charactersPromise = fleetsStub.searchTrackedCharacters(query, 50)
		const db = createDb(c.env.DATABASE_URL)

		// Name-backed corp search from managed corporations, then intersect with
		// tracked fleet corp IDs in Fleets DO.
		const corpCandidates = await db
			.select({
				corporationId: schema.managedCorporations.corporationId,
				corporationName: schema.managedCorporations.name,
			})
			.from(schema.managedCorporations)
			.where(
				or(
					ilike(schema.managedCorporations.name, `%${query}%`),
					ilike(schema.managedCorporations.corporationId, `%${query}%`)
				)
			)
			.limit(100)

		const trackedCorpIds = await fleetsStub.filterTrackedCorporationIds(
			corpCandidates.map((row) => row.corporationId)
		)
		const trackedCorpSet = new Set(trackedCorpIds)
		const corporations = corpCandidates
			.filter((row) => trackedCorpSet.has(row.corporationId))
			.slice(0, 25)
			.map((row) => ({
				corporationId: row.corporationId,
				corporationName: row.corporationName ?? row.corporationId,
			}))

		const characters = await charactersPromise
		const characterOwnershipRows =
			characters.length > 0
				? await db
						.select({
							characterId: schema.userCharacters.characterId,
							userId: schema.userCharacters.userId,
							isPrimary: schema.userCharacters.is_primary,
						})
						.from(schema.userCharacters)
						.where(inArray(schema.userCharacters.characterId, characters.map((c) => c.characterId)))
				: []

		const ownershipByCharacterId = new Map(
			characterOwnershipRows.map((row) => [
				row.characterId,
				{ userId: row.userId, isPrimary: row.isPrimary },
			])
		)

		const userIds = Array.from(new Set(characterOwnershipRows.map((row) => row.userId)))
		const primaryRows =
			userIds.length > 0
				? await db
						.select({
							userId: schema.userCharacters.userId,
							mainCharacterName: schema.userCharacters.characterName,
						})
						.from(schema.userCharacters)
						.where(
							and(
								inArray(schema.userCharacters.userId, userIds),
								eq(schema.userCharacters.is_primary, true)
							)
						)
				: []
		const mainNameByUserId = new Map(primaryRows.map((row) => [row.userId, row.mainCharacterName]))

		const enrichedCharacters = characters.map((entry) => {
			const ownership = ownershipByCharacterId.get(entry.characterId)
			const ownerMainCharacterName =
				ownership?.userId != null ? (mainNameByUserId.get(ownership.userId) ?? null) : null
			return {
				characterId: entry.characterId,
				characterName: entry.characterName,
				isPrimary: ownership?.isPrimary ?? false,
				ownerMainCharacterName,
			}
		})

		return { characters: enrichedCharacters, corporations }
	})

	return c.json(data)
})

/**
 * GET /fleets/tracking/stats/characters/:characterId
 * Per-character stats. Self OR :view-all.
 */
app.get('/tracking/stats/characters/:characterId', async (c) => {
	const user = c.get('user')!
	const characterId = c.req.param('characterId')
	const { canViewAll, isAdmin } = await resolveTrackingPerms(c)
	const ownsCharacter = user.characters.some((ch) => ch.characterId.toString() === characterId)
	if (!canViewAll && !isAdmin && !ownsCharacter) {
		return c.json({ error: 'Not allowed to view this character' }, 403)
	}

	const rangeResult = parseStatsRange(c)
	if (!rangeResult.success) return c.json({ error: rangeResult.error }, 400)
	const range = rangeResult.data
	const scope = canViewAll || isAdmin ? 'view-all' : `self:${user.id}`
	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

	const data = await withStatsCache(c, scope, async () => {
		const stats = await fleetsStub.getStatsForCharacter(characterId, range)
		const { byCharacter } = await resolveCharacterOwnership(c, [characterId])

		const ids: Array<string | number> = [characterId]
		for (const s of stats.shipsFlown) ids.push(s.shipTypeId)
		const names = await resolveNames(c, ids)

		return {
			range,
			characterId,
			characterName: byCharacter[characterId]?.characterName ?? names[characterId] ?? null,
			corporationId: byCharacter[characterId]?.corporationId ?? null,
			corporationName: byCharacter[characterId]?.corporationName ?? null,
			...stats,
			shipsFlown: stats.shipsFlown.map((s) => ({
				...s,
				shipTypeName: names[String(s.shipTypeId)] ?? null,
			})),
		}
	})

	return c.json(data)
})

/**
 * GET /fleets/tracking/stats/users/:userId
 * Per-user stats. Self OR :view-all.
 */
app.get('/tracking/stats/users/:userId', async (c) => {
	const user = c.get('user')!
	const userId = c.req.param('userId')
	const { canViewAll, isAdmin } = await resolveTrackingPerms(c)
	const isSelf = user.id === userId
	if (!canViewAll && !isAdmin && !isSelf) {
		return c.json({ error: 'Not allowed to view this user' }, 403)
	}

	const rangeResult = parseStatsRange(c)
	if (!rangeResult.success) return c.json({ error: rangeResult.error }, 400)
	const range = rangeResult.data
	const scope = canViewAll || isAdmin ? 'view-all' : `self:${user.id}`
	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

	const data = await withStatsCache(c, scope, async () => {
		const db = createDb(c.env.DATABASE_URL)
		const characterRows = await db
			.select({
				characterId: schema.userCharacters.characterId,
				characterName: schema.userCharacters.characterName,
				is_primary: schema.userCharacters.is_primary,
				corporationId: schema.userCharacters.corporationId,
				corporationName: schema.userCharacters.corporationName,
			})
			.from(schema.userCharacters)
			.where(eq(schema.userCharacters.userId, userId))

		const characterIds = characterRows.map((r) => r.characterId)
		if (characterIds.length === 0) {
			return {
				range,
				userId,
				characters: [],
				totals: {
					fleetsJoined: 0,
					minutesInFleet: 0,
					timesFC: 0,
					avgFleetDurationMinutes: null,
				},
				perCharacter: [],
				shipsFlown: [],
				recentSessions: [],
			}
		}

		const perCharStats = await fleetsStub.getStatsForCharacters(characterIds, range)

		// Sum totals
		const totals = {
			fleetsJoined: 0,
			minutesInFleet: 0,
			timesFC: 0,
			avgFleetDurationMinutes: null as number | null,
		}
		const shipsAcc = new Map<number, { totalMinutes: number }>()
		const allRecent: Array<{ characterId: string; row: ReturnType<typeof Object>['type'] }> = []
		const perCharacter: Array<{
			characterId: string
			characterName: string
			is_primary: boolean
			corporationId: string | null
			corporationName: string | null
			stats: CharacterStatsResult
		}> = []

		for (const row of characterRows) {
			const stats: CharacterStatsResult = perCharStats[row.characterId] ?? {
				totals: {
					fleetsJoined: 0,
					minutesInFleet: 0,
					timesFC: 0,
					avgFleetDurationMinutes: null,
				},
				shipsFlown: [],
				recentSessions: [],
			}
			totals.fleetsJoined += stats.totals.fleetsJoined
			totals.minutesInFleet += stats.totals.minutesInFleet
			totals.timesFC += stats.totals.timesFC
			for (const s of stats.shipsFlown) {
				const cur = shipsAcc.get(s.shipTypeId) ?? { totalMinutes: 0 }
				shipsAcc.set(s.shipTypeId, {
					totalMinutes: cur.totalMinutes + s.totalMinutes,
				})
			}
			for (const r of stats.recentSessions) {
				allRecent.push({ characterId: row.characterId, row: r as any })
			}
			perCharacter.push({
				characterId: row.characterId,
				characterName: row.characterName,
				is_primary: row.is_primary,
				corporationId: row.corporationId,
				corporationName: row.corporationName,
				stats,
			})
		}

		totals.avgFleetDurationMinutes =
			totals.fleetsJoined > 0 ? Math.round(totals.minutesInFleet / totals.fleetsJoined) : null

		const shipsFlown = Array.from(shipsAcc.entries())
			.map(([shipTypeId, v]) => ({ shipTypeId, ...v }))
			.sort((a, b) => b.totalMinutes - a.totalMinutes)
			.slice(0, 25)

		const recentSessions = allRecent
			.sort(
				(a, b) =>
					new Date((b.row as any).startedAt).getTime() -
					new Date((a.row as any).startedAt).getTime()
			)
			.slice(0, 20)
			.map((x) => ({ ...(x.row as object), characterId: x.characterId }))

		// Resolve ship type names for the aggregated ship list
		const shipNames = await resolveNames(c, shipsFlown.map((s) => s.shipTypeId))

		return {
			range,
			userId,
			totals,
			perCharacter,
			shipsFlown: shipsFlown.map((s) => ({
				...s,
				shipTypeName: shipNames[String(s.shipTypeId)] ?? null,
			})),
			recentSessions,
		}
	})

	return c.json(data)
})

/**
 * GET /fleets/tracking/stats/corporations/:corpId
 * Per-corporation stats (current members). Requires :view-all.
 */
app.get('/tracking/stats/corporations/:corpId', async (c) => {
	const { canViewAll } = await resolveTrackingPerms(c)
	if (!canViewAll) return c.json({ error: 'view-all required' }, 403)

	const rangeResult = parseStatsRange(c)
	if (!rangeResult.success) return c.json({ error: rangeResult.error }, 400)
	const range = rangeResult.data
	const corpId = c.req.param('corpId')
	const fleetsStub = getStub<Fleets>(c.env.FLEETS, 'default')

	const data = await withStatsCache(c, 'view-all', async () => {
		const db = createDb(c.env.DATABASE_URL)
		// Historical corp membership at time of fleet — derived from fleet_member_history.
		const characterIds = await fleetsStub.getCharactersByCorpInWindow(corpId, range)
		if (characterIds.length === 0) {
			const [corpRow] = await db
				.select({ name: schema.managedCorporations.name })
				.from(schema.managedCorporations)
				.where(eq(schema.managedCorporations.corporationId, corpId))
				.limit(1)
			return {
				range,
				corporationId: corpId,
				corporationName: corpRow?.name ?? null,
				totals: { pilotsActive: 0, pilotHours: 0, sessionsWithPresence: 0, avgPilotsPerSession: 0 },
				topMembers: [],
				topFCs: [],
				shipsFlown: [],
			}
		}

		const perCharStats = await fleetsStub.getStatsForCharacters(characterIds, range)
		// Resolve names for all candidate characters + the corp itself.
		const names = await resolveNames(c, [...characterIds, corpId])
		const characterNames = new Map(characterIds.map((cid) => [cid, names[cid] ?? cid]))

		let pilotsActive = 0
		let totalMinutes = 0
		let totalTimesFC = 0
		const sessionIds = new Set<string>()
		const shipsAcc = new Map<number, { totalMinutes: number }>()
		const topMembers: Array<{
			characterId: string
			characterName: string
			fleetsJoined: number
			minutesInFleet: number
		}> = []
		const topFCs: Array<{ characterId: string; characterName: string; sessions: number }> = []

		for (const cid of characterIds) {
			const s = perCharStats[cid]
			if (!s) continue
			pilotsActive += 1
			totalMinutes += s.totals.minutesInFleet
			totalTimesFC += s.totals.timesFC
			for (const sh of s.shipsFlown) {
				const cur = shipsAcc.get(sh.shipTypeId) ?? { totalMinutes: 0 }
				shipsAcc.set(sh.shipTypeId, {
					totalMinutes: cur.totalMinutes + sh.totalMinutes,
				})
			}
			for (const sess of s.recentSessions) sessionIds.add(sess.sessionId)
			topMembers.push({
				characterId: cid,
				characterName: characterNames.get(cid) ?? cid,
				fleetsJoined: s.totals.fleetsJoined,
				minutesInFleet: s.totals.minutesInFleet,
			})
			if (s.totals.timesFC > 0) {
				topFCs.push({
					characterId: cid,
					characterName: characterNames.get(cid) ?? cid,
					sessions: s.totals.timesFC,
				})
			}
		}

		topMembers.sort((a, b) => b.minutesInFleet - a.minutesInFleet)
		topFCs.sort((a, b) => b.sessions - a.sessions)

		const sessionsWithPresence = sessionIds.size
		const avgPilotsPerSession =
			sessionsWithPresence > 0 ? Math.round((pilotsActive / sessionsWithPresence) * 10) / 10 : 0

		const shipsFlown = Array.from(shipsAcc.entries())
			.map(([shipTypeId, v]) => ({ shipTypeId, ...v }))
			.sort((a, b) => b.totalMinutes - a.totalMinutes)
			.slice(0, 25)

		const shipNames = await resolveNames(c, shipsFlown.map((s) => s.shipTypeId))
		const [corpRow] = await db
			.select({ name: schema.managedCorporations.name })
			.from(schema.managedCorporations)
			.where(eq(schema.managedCorporations.corporationId, corpId))
			.limit(1)
		const resolvedCorpName = names[corpId] ?? corpRow?.name ?? null

		return {
			range,
			corporationId: corpId,
			corporationName: resolvedCorpName,
			totals: {
				pilotsActive,
				pilotHours: Math.round(totalMinutes / 60),
				sessionsWithPresence,
				avgPilotsPerSession,
			},
			topMembers: topMembers.slice(0, 20),
			topFCs: topFCs.slice(0, 10),
			shipsFlown: shipsFlown.map((s) => ({
				...s,
				shipTypeName: shipNames[String(s.shipTypeId)] ?? null,
			})),
		}
	})

	return c.json(data)
})

export default app
