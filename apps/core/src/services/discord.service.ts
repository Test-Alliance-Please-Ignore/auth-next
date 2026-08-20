import { and, eq, inArray } from '@repo/db-utils'
import { DISCORD_EXCLUDED_AUTH_GIGACHAD_ROLE_ID, getDiscordStub } from '@repo/discord'
import { getStub } from '@repo/do-utils'
import { getPublicEsiInstance } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import {
	corporationDiscordServers,
	discordRoles,
	discordServers,
	managedCorporations,
	oauthStates,
	userCharacters,
	users,
} from '../db/schema'

import type { DiscordProfile, JoinServerResult } from '@repo/discord'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Groups } from '@repo/groups'
import type { Hr } from '@repo/hr'
import type { Env } from '../context'
import type { TemporaryRoleAssignments } from '../temporary-role-assignments-do'

/**
 * Discord linking service
 *
 * Handles Discord account linking via service binding to Discord worker.
 */

/**
 * Start Discord linking flow (PKCE)
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns OAuth state for CSRF protection
 */
export async function startLinkFlow(env: Env, userId: string): Promise<string> {
	const db = createDb(env.DATABASE_URL)

	// Generate OAuth state
	const state = crypto.randomUUID()
	const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

	// Store OAuth state in database
	await db.insert(oauthStates).values({
		state,
		flowType: 'discord',
		userId,
		redirectUrl: null,
		expiresAt,
	})

	return state
}

async function blacklistLinkedCharacterTargetsForUser(
	db: ReturnType<typeof createDb>,
	hrStub: Hr,
	userId: string,
	blacklistedBy: string,
	userBlacklistEntryId: string
): Promise<void> {
	const linkedCharacters = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
		columns: { characterId: true, characterName: true },
	})

	for (const linkedCharacter of linkedCharacters) {
		await hrStub.createCharacterBlacklist({
			characterId: linkedCharacter.characterId,
			characterName: linkedCharacter.characterName,
			reason: `Auto-blacklisted: owned by blacklisted user ${userId}`,
			blacklistedBy,
			triggeredBy: userBlacklistEntryId,
			metadata: {
				triggeredByUserBlacklist: userBlacklistEntryId,
			},
		})
	}
}

/**
 * Handle Discord tokens from client (PKCE flow)
 * @param env - Worker environment
 * @param sessionUserId - User ID from session (authenticated request)
 * @param accessToken - Discord access token from client
 * @param refreshToken - Discord refresh token from client
 * @param expiresIn - Token expiration in seconds
 * @param scope - OAuth scopes granted
 * @param state - OAuth state parameter
 * @returns Result with success status
 */
export async function handleTokens(
	env: Env,
	sessionUserId: string,
	accessToken: string,
	refreshToken: string,
	expiresIn: number,
	scope: string,
	state: string
): Promise<{
	success: boolean
	error?: string
}> {
	const db = createDb(env.DATABASE_URL)

	// Validate OAuth state
	const oauthState = await db.query.oauthStates.findFirst({
		where: eq(oauthStates.state, state),
	})

	if (!oauthState) {
		return {
			success: false,
			error: 'Invalid OAuth state',
		}
	}

	// Check if state is expired
	if (oauthState.expiresAt < new Date()) {
		await db.delete(oauthStates).where(eq(oauthStates.state, state))
		return {
			success: false,
			error: 'OAuth state expired',
		}
	}

	// Check if this is a Discord flow
	if (oauthState.flowType !== 'discord') {
		return {
			success: false,
			error: 'Invalid flow type',
		}
	}

	// Get user ID from state
	const coreUserId = oauthState.userId
	if (!coreUserId) {
		return {
			success: false,
			error: 'No user ID in OAuth state',
		}
	}

	// SECURITY: Verify session user matches state user (prevents account takeover)
	if (sessionUserId !== coreUserId) {
		return {
			success: false,
			error: 'Session mismatch - you can only link Discord to your own account',
		}
	}

	try {
		// Call Discord DO to fetch user info and store tokens (uses proxy + retry)
		const discordStub = getDiscordStub(env)
		const linkResult = await discordStub.linkAccountWithTokens(
			accessToken,
			refreshToken,
			expiresIn,
			scope || '',
			coreUserId
		)

		if (!linkResult.success) {
			return {
				success: false,
				error: linkResult.error || 'Failed to link Discord account',
			}
		}

		const discordUserId = linkResult.discordUserId!
		const hrStub = getStub<Hr>(env.HR, 'default')

		// SECURITY: If this Discord account is blacklisted, suspend this core user instead of linking.
		const isDiscordBlacklisted = await hrStub.isDiscordUserBlacklisted(discordUserId)
		if (isDiscordBlacklisted) {
			const discordBlacklists = await hrStub.getBlacklistsForDiscordUser(discordUserId)
			const sourceBlacklist = discordBlacklists[0]
			const blacklistedBy = sourceBlacklist?.blacklistedBy ?? coreUserId
			const userBlacklistEntry = await hrStub.createUserBlacklist({
				userId: coreUserId,
				discordUserId,
				reason: `Auto-blacklisted: attempted to link blacklisted Discord account ${discordUserId}`,
				blacklistedBy,
				triggeredBy: sourceBlacklist?.id,
				isAutoBlacklist: true,
				metadata: {
					triggeredByDiscordUserId: discordUserId,
				},
			})
			await blacklistLinkedCharacterTargetsForUser(
				db,
				hrStub,
				coreUserId,
				blacklistedBy,
				userBlacklistEntry.id
			)

			await db.delete(oauthStates).where(eq(oauthStates.state, state))

			return {
				success: false,
				error: 'Account suspended',
			}
		}

		logger.info('Got Discord user info', {
			discordUserId,
			username: linkResult.username,
		})

		// Update user record with Discord user ID
		logger.info('Updating user with Discord ID', { coreUserId, discordUserId })

		const updateResult = await db
			.update(users)
			.set({
				discordUserId: discordUserId,
				updatedAt: new Date(),
			})
			.where(eq(users.id, coreUserId))
			.returning({ id: users.id })

		logger.info('User update complete', {
			coreUserId,
			discordUserId,
			updated: updateResult.length > 0,
		})

		// Clean up OAuth state
		await db.delete(oauthStates).where(eq(oauthStates.state, state))

		return { success: true }
	} catch (error) {
		logger.error('Error handling tokens:', error)
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		}
	}
}

/**
 * Get Discord profile for a user
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Discord profile or null
 */
export async function getProfile(env: Env, userId: string): Promise<DiscordProfile | null> {
	const discordStub = getDiscordStub(env)
	return discordStub.getProfileByCoreUserId(userId)
}

/**
 * Get Discord user status including authorization revocation info
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Discord user status or null if not found
 */
export async function getUserStatus(env: Env, userId: string) {
	const discordStub = getDiscordStub(env)
	return discordStub.getDiscordUserStatus(userId)
}

/**
 * Refresh Discord OAuth token for a user
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Success status
 */
export async function refreshToken(env: Env, userId: string): Promise<boolean> {
	const discordStub = getDiscordStub(env)
	return discordStub.refreshTokenByCoreUserId(userId)
}

/**
 * Completely unlink a user's Discord account (admin action)
 * Removes Discord link from core user, revokes authorization,
 * deletes tokens, and removes user from all managed Discord servers
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Success status
 */
export async function unlinkUser(env: Env, userId: string): Promise<boolean> {
	const db = createDb(env.DATABASE_URL)

	// Get user to verify they have Discord linked
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
	})

	if (!user) {
		logger.error('[Discord] User not found for unlinking', { userId })
		return false
	}

	if (!user.discordUserId) {
		logger.warn('[Discord] User does not have Discord linked', { userId })
		return true // Already unlinked, so technically successful
	}

	try {
		// Get all active Discord servers to check for membership
		const activeServers = await db.query.discordServers.findMany({
			where: eq(discordServers.isActive, true),
			columns: { guildId: true },
		})
		const guildIds = activeServers.map((s) => s.guildId)

		// Call Discord DO to unlink on Discord side
		const discordStub = getDiscordStub(env)
		const success = await discordStub.unlinkCoreUser(userId, guildIds)

		if (!success) {
			logger.error('[Discord] Failed to unlink user on Discord side', { userId })
			return false
		}

		// Clear Discord user ID from core users table
		await db
			.update(users)
			.set({
				discordUserId: null,
				updatedAt: new Date(),
			})
			.where(eq(users.id, userId))

		logger.info('[Discord] Successfully unlinked Discord account', {
			userId,
			previousDiscordUserId: user.discordUserId,
		})

		return true
	} catch (error) {
		logger.error('[Discord] Error unlinking Discord account', {
			userId,
			error: String(error),
		})
		return false
	}
}

/**
 * Get all system-managed role IDs for a Discord guild
 *
 * Returns a Set of Discord role IDs (text) that are managed by the system
 * for the specified guild across all sources: auto-apply, corporations, and groups.
 *
 * This function is optimized for frequent calls during role updates with in-memory caching.
 *
 * @param db - Database client
 * @param env - Worker environment (for Groups DO access)
 * @param guildId - Discord guild/server ID
 * @param cache - Optional cache Map to store results (scoped to request)
 * @returns Set of Discord role IDs managed by the system
 */
async function getAllManagedRolesForGuild(
	db: ReturnType<typeof createDb>,
	env: Env,
	guildId: string,
	cache?: Map<string, string[]>
): Promise<string[]> {
	const startTime = Date.now()

	// Check cache first
	if (cache?.has(guildId)) {
		return cache.get(guildId)!
	}

	// Get the Discord server ID from the guild ID
	const discordServer = await db.query.discordServers.findFirst({
		where: and(eq(discordServers.guildId, guildId), eq(discordServers.isActive, true)),
		columns: { id: true },
	})

	if (!discordServer) {
		// Guild not in our registry or inactive
		const result: string[] = []
		cache?.set(guildId, result)
		return result
	}

	const discordServerId = discordServer.id
	const managedRoleIds = new Set<string>()

	// Query 1: Auto-apply roles
	// Uses: discord_roles_server_auto_apply_active_idx (new index)
	const autoApplyRoles = await db.query.discordRoles.findMany({
		where: and(
			eq(discordRoles.discordServerId, discordServerId),
			eq(discordRoles.autoApply, true),
			eq(discordRoles.isActive, true)
		),
		columns: { roleId: true },
	})

	for (const role of autoApplyRoles) {
		managedRoleIds.add(role.roleId)
	}

	// Query 2: Corporation-managed roles and scenario roles
	const corpAttachments = await db.query.corporationDiscordServers.findMany({
		where: eq(corporationDiscordServers.discordServerId, discordServerId),
		columns: { autoAssignRoles: true },
		with: {
			roles: {
				with: {
					discordRole: {
						columns: { roleId: true, isActive: true },
					},
				},
			},
			scenarioRoles: {
				columns: { bucket: true, discordRoleId: true, autoApply: true },
			},
		},
	})

	const scenarioRoleDbIds = new Set<string>()
	for (const attachment of corpAttachments) {
		if (attachment.autoAssignRoles) {
			for (const roleAssignment of attachment.roles) {
				// Only include active roles
				if (roleAssignment.discordRole.isActive) {
					managedRoleIds.add(roleAssignment.discordRole.roleId)
				}
			}
		}

		for (const roleDbId of getScenarioManagedRoleDbIds(attachment)) {
			scenarioRoleDbIds.add(roleDbId)
		}
	}

	if (scenarioRoleDbIds.size > 0) {
		const scenarioRoles = await db.query.discordRoles.findMany({
			where: and(
				inArray(discordRoles.id, Array.from(scenarioRoleDbIds)),
				eq(discordRoles.isActive, true)
			),
			columns: { roleId: true },
		})

		for (const role of scenarioRoles) {
			managedRoleIds.add(role.roleId)
		}
	}

	// Query 3: Group-managed roles
	// Uses: group_discord_servers_server_auto_assign_idx (new index)
	const groupsStub = getStub<Groups>(env.GROUPS, 'default')
	const groupAttachments = await groupsStub.getGroupsByDiscordServer(discordServerId)

	if (groupAttachments.length > 0) {
		// Get role assignments for all group attachments
		const groupDiscordRoleIds: string[] = []
		for (const attachment of groupAttachments) {
			if (attachment.autoAssignRoles) {
				const config = await groupsStub.getDiscordServerAttachmentConfig(attachment.id)
				groupDiscordRoleIds.push(...getGroupManagedRoleDbIds(config))
			}
		}

		if (groupDiscordRoleIds.length > 0) {
			// Verify roles are still active (roleIds are already Discord snowflake IDs)
			const groupRoles = await db.query.discordRoles.findMany({
				where: and(
					inArray(discordRoles.roleId, groupDiscordRoleIds),
					eq(discordRoles.isActive, true)
				),
				columns: { roleId: true },
			})

			for (const role of groupRoles) {
				managedRoleIds.add(role.roleId)
			}
		}
	}

	try {
		const discordStub = getDiscordStub(env)
		const guildRoles = await discordStub.getGuildRoles(guildId)
		if (guildRoles.some((role) => role.id === DISCORD_EXCLUDED_AUTH_GIGACHAD_ROLE_ID)) {
			managedRoleIds.add(DISCORD_EXCLUDED_AUTH_GIGACHAD_ROLE_ID)
		}
	} catch (error) {
		logger.warn('[Discord] Error resolving special auth role presence for managed role build', {
			guildId,
			error: String(error),
		})
	}

	const result = Array.from(managedRoleIds)

	// Store in cache
	cache?.set(guildId, result)

	// Log slow queries
	const duration = Date.now() - startTime
	if (duration > 100) {
		logger.warn('[Discord] Slow getAllManagedRolesForGuild', {
			guildId,
			duration,
			roleCount: result.length,
		})
	}

	return result
}

export async function getTemporaryRoleIdsByGuild(
	db: ReturnType<typeof createDb>,
	env: Env,
	guildIds: string[],
	coreUserId: string
): Promise<{
	activeRoleIdsByGuild: Map<string, string[]>
	cleanupRoleIdsByGuild: Map<string, string[]>
	configuredRoleIdsByGuild: Map<string, Set<string>>
	failedGuildIds: Set<string>
	preserveAllCurrentRolesGuildIds: Set<string>
}> {
	const activeRoleIdsByGuild = new Map<string, string[]>()
	const cleanupAssignmentsByGuild = new Map<string, string[]>()
	const failedGuildIds = new Set<string>()
	const preserveAllCurrentRolesGuildIds = new Set<string>()
	const assignmentStubs = new Map<string, TemporaryRoleAssignments>()
	const assignmentRowsByGuild = new Map<
		string,
		{
			active: Awaited<ReturnType<TemporaryRoleAssignments['listActiveAssignments']>>
			pending: Awaited<ReturnType<TemporaryRoleAssignments['listPendingRemovalAssignments']>>
		}
	>()
	for (const guildId of guildIds) {
		const assignments = getStub<TemporaryRoleAssignments>(env.TEMPORARY_ROLE_ASSIGNMENTS, guildId)
		if (
			typeof assignments.listActiveAssignments !== 'function' ||
			typeof assignments.listPendingRemovalAssignments !== 'function'
		) {
			failedGuildIds.add(guildId)
			continue
		}
		assignmentStubs.set(guildId, assignments)
	}
	await Promise.all(
		Array.from(assignmentStubs.entries()).map(async ([guildId, assignments]) => {
			try {
				const activeAssignments =
					(await assignments.listActiveAssignments(guildId, undefined, coreUserId)) ?? []
				const pendingAssignments =
					(await assignments.listPendingRemovalAssignments(guildId, undefined, coreUserId)) ?? []
				// Pending assignments retain their historical role IDs so expiry cleanup
				// still removes a role after its managed-role record is deactivated.
				assignmentRowsByGuild.set(guildId, {
					active: activeAssignments,
					pending: pendingAssignments,
				})
			} catch (error) {
				failedGuildIds.add(guildId)
				logger.error('[Discord] Failed to resolve temporary role assignments for guild', {
					userId: coreUserId,
					guildId,
					error: String(error),
				})
			}
		})
	)

	let configuredRoles: Array<{
		roleId: string
		discordServer: { guildId: string; isActive: boolean } | null
	}> = []
	const hasAssignments = Array.from(assignmentRowsByGuild.values()).some(
		({ active, pending }) => active.length > 0 || pending.length > 0
	)
	// Resolve configured role IDs after an assignment-source failure so the refresh
	// can preserve temporary roles instead of treating the failed read as empty state.
	if (hasAssignments || failedGuildIds.size > 0) {
		try {
			configuredRoles = await db.query.discordRoles.findMany({
				with: { discordServer: { columns: { guildId: true, isActive: true } } },
				columns: { roleId: true },
			})
		} catch (error) {
			for (const guildId of new Set([...assignmentStubs.keys(), ...failedGuildIds])) {
				failedGuildIds.add(guildId)
				preserveAllCurrentRolesGuildIds.add(guildId)
			}
			logger.error('[Discord] Failed to resolve configured roles for temporary assignments', {
				guildIds,
				error: String(error),
			})
		}
	}
	const configuredRoleIdsByGuild = new Map<string, Set<string>>()
	for (const role of configuredRoles) {
		if (!role.discordServer?.isActive || !guildIds.includes(role.discordServer.guildId)) continue
		const roleIds = configuredRoleIdsByGuild.get(role.discordServer.guildId) ?? new Set<string>()
		roleIds.add(role.roleId)
		configuredRoleIdsByGuild.set(role.discordServer.guildId, roleIds)
	}
	for (const [guildId, { active, pending }] of assignmentRowsByGuild) {
		const configuredRoleIds = configuredRoleIdsByGuild.get(guildId) ?? new Set<string>()
		const latestByRoleId = new Map<string, { revision: number; status: 'active' | 'pending' }>()
		for (const assignment of active) {
			latestByRoleId.set(assignment.roleId, {
				revision: Number(assignment.revision ?? 0),
				status: 'active',
			})
		}
		for (const assignment of pending) {
			const revision = Number(assignment.revision ?? 0)
			const current = latestByRoleId.get(assignment.roleId)
			if (!current || revision >= current.revision) {
				latestByRoleId.set(assignment.roleId, { revision, status: 'pending' })
			}
		}

		const activeRoleIds: string[] = []
		const cleanupRoleIds: string[] = []
		for (const [roleId, assignment] of latestByRoleId) {
			if (assignment.status === 'active') {
				if (configuredRoleIds.has(roleId)) activeRoleIds.push(roleId)
			} else {
				// Pending assignments retain historical role IDs so expiry cleanup
				// still removes a role after its managed-role record is deactivated.
				cleanupRoleIds.push(roleId)
			}
		}
		if (activeRoleIds.length > 0) {
			activeRoleIdsByGuild.set(guildId, activeRoleIds)
		}
		if (cleanupRoleIds.length > 0) {
			cleanupAssignmentsByGuild.set(guildId, cleanupRoleIds)
		}
	}
	return {
		activeRoleIdsByGuild,
		cleanupRoleIdsByGuild: cleanupAssignmentsByGuild,
		configuredRoleIdsByGuild,
		failedGuildIds,
		preserveAllCurrentRolesGuildIds,
	}
}

/**
 * Get corporation IDs for a user's registered characters
 * Uses the corporation_members table for efficient bulk lookup
 * @param env - Worker environment
 * @param characterIds - Array of character IDs to check
 * @returns Set of corporation IDs the user's characters belong to
 */
async function getUserCorporationIds(env: Env, characterIds: string[]): Promise<Set<string>> {
	logger.debug('[Discord] getUserCorporationIds: Starting', {
		characterIds,
		characterCount: characterIds.length,
	})

	if (characterIds.length === 0) {
		logger.debug('[Discord] getUserCorporationIds: No character IDs provided')
		return new Set()
	}

	try {
		// Use the new bulk lookup function from EveCorporationData
		const corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, 'default')
		const corporationMap = await corpStub.getCorporationIdsByCharacterIds(characterIds)

		// Convert the Record to a Set of unique corporation IDs
		const corporationIdsSet = new Set(Object.values(corporationMap))

		// Log which characters were found and which weren't
		const foundCharacterIds = Object.keys(corporationMap)
		const missingCharacterIds = characterIds.filter((id) => !foundCharacterIds.includes(id))

		if (corporationIdsSet.size === 0) {
			logger.warn('[Discord] getUserCorporationIds: No corporation IDs found', {
				characterIds,
				checkedCharacterCount: characterIds.length,
				missingCharacterIds,
			})
		} else {
			logger.debug('[Discord] getUserCorporationIds: Found corporation IDs', {
				corporationIds: Array.from(corporationIdsSet),
				corporationCount: corporationIdsSet.size,
				characterIds,
				foundCharacterIds,
				missingCharacterIds,
				characterCorporationMap: corporationMap,
			})
		}

		return corporationIdsSet
	} catch (error) {
		logger.error('[Discord] getUserCorporationIds: Error fetching corporation IDs', {
			characterIds,
			error: String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		})
		// Return empty set on error to prevent blocking the invitation flow
		return new Set()
	}
}

type CorpAttachmentScenarioKey = 'corp-member' | 'alliance-guest' | 'non-alliance-guest'
type CorporationDiscordScenarioRoleBucket = 'alliance_guest' | 'non_alliance_guest'
type CorporationDiscordNicknameBucket = 'corp_member' | 'alliance_guest' | 'non_alliance_guest'

type CorporationDiscordAttachmentScenarioFields = {
	corporationId: string
	corporation: {
		isMemberCorporation: boolean
	}
	scenarioRoles?: Array<{
		bucket: CorporationDiscordScenarioRoleBucket
		discordRoleId: string | null
		autoApply: boolean
	}>
}

type CorporationDiscordScenarioRoleFields = {
	scenarioRoles?: Array<{
		bucket: CorporationDiscordScenarioRoleBucket
		discordRoleId: string | null
		autoApply: boolean
	}>
}

type DiscordNicknameSource = 'corp' | 'alliance' | 'custom'

type CorporationDiscordNicknameFields = {
	corporationId: string
	nicknameConfigs?: Array<{
		bucket: CorporationDiscordNicknameBucket
		enabled: boolean
		source: DiscordNicknameSource
		customTicker: string | null
	}>
	corporation: {
		isMemberCorporation: boolean
	}
}

type CorporationTickerSources = {
	corpTicker: string | null
	allianceTicker: string | null
}

function normalizeCustomTicker(ticker?: string | null): string | null {
	const normalized = ticker
		?.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
	if (!normalized) {
		return null
	}

	return normalized.slice(0, 5)
}

function buildDiscordNicknameWithTickerPrefixes(baseName: string, prefixes: string[]): string {
	if (prefixes.length === 0) {
		return baseName
	}

	return `${prefixes.map((prefix) => `[${prefix}]`).join(' ')} ${baseName}`
}

function getScenarioRoleRecord(
	attachment: CorporationDiscordScenarioRoleFields,
	bucket: CorporationDiscordScenarioRoleBucket
): { discordRoleId: string | null; autoApply: boolean } {
	const row = attachment.scenarioRoles?.find((candidate) => candidate.bucket === bucket)
	return row ?? { discordRoleId: null, autoApply: false }
}

function getNicknameConfigRecord(
	attachment: CorporationDiscordNicknameFields,
	bucket: CorporationDiscordNicknameBucket
): {
	enabled: boolean
	source: DiscordNicknameSource
	customTicker: string | null
} {
	const row = attachment.nicknameConfigs?.find((candidate) => candidate.bucket === bucket)
	return row ?? { enabled: false, source: 'corp', customTicker: null }
}

function resolveTickerPreference(
	source: DiscordNicknameSource,
	tickerSources: CorporationTickerSources,
	customTicker: string | null
): string | null {
	if (source === 'custom') {
		return normalizeCustomTicker(customTicker)
	}

	const corpTicker = tickerSources.corpTicker?.length ? tickerSources.corpTicker : null
	const allianceTicker = tickerSources.allianceTicker?.length ? tickerSources.allianceTicker : null

	if (source === 'alliance') {
		return allianceTicker ?? corpTicker
	}

	return corpTicker ?? allianceTicker
}

function resolveAttachmentNicknamePrefix(
	attachment: CorporationDiscordNicknameFields,
	isCorpMember: boolean,
	isAllianceMember: boolean,
	tickerSources: CorporationTickerSources
): string | null {
	const bucketConfigs = [
		{
			matches: isCorpMember,
			...getNicknameConfigRecord(attachment, 'corp_member'),
		},
		{
			matches: !isCorpMember && attachment.corporation.isMemberCorporation && isAllianceMember,
			...getNicknameConfigRecord(attachment, 'alliance_guest'),
		},
		{
			matches: !isCorpMember,
			...getNicknameConfigRecord(attachment, 'non_alliance_guest'),
		},
	] as const

	for (const bucket of bucketConfigs) {
		if (!bucket.matches || !bucket.enabled) {
			continue
		}

		const prefix = resolveTickerPreference(bucket.source, tickerSources, bucket.customTicker)
		if (prefix) {
			return prefix
		}
	}

	return null
}

async function getPrimaryCharacterTickerSources(
	db: ReturnType<typeof createDb>,
	env: Env,
	userId: string
): Promise<{
	primaryCharacterName: string
	primaryCharacterCorporationId: string
	primaryCharacterAllianceId: string | null
	tickerSources: CorporationTickerSources
} | null> {
	const primaryCharacter = await db.query.userCharacters.findFirst({
		where: and(eq(userCharacters.userId, userId), eq(userCharacters.is_primary, true)),
		columns: {
			characterName: true,
			corporationId: true,
			allianceId: true,
		},
	})

	if (!primaryCharacter?.characterName || !primaryCharacter.corporationId) {
		return null
	}

	const corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, 'default')
	let corpTicker: string | null = null
	try {
		const corpInfo = await corpStub.getCorporationInfo(primaryCharacter.corporationId)
		corpTicker = corpInfo?.ticker ?? null
	} catch (error) {
		logger.warn(
			'[Discord] Failed to resolve primary character corporation info for nickname routing',
			{
				userId,
				corporationId: primaryCharacter.corporationId,
				error: String(error),
			}
		)
	}

	let allianceTicker: string | null = null
	if (primaryCharacter.allianceId) {
		try {
			const allianceInfo = await getPublicEsiInstance(env.ESI).fetchAlliancePublicInfo(
				primaryCharacter.allianceId
			)
			allianceTicker = allianceInfo?.ticker ?? null
		} catch (error) {
			logger.warn(
				'[Discord] Failed to resolve primary character alliance info for nickname routing',
				{
					userId,
					allianceId: primaryCharacter.allianceId,
					error: String(error),
				}
			)
		}
	}

	return {
		primaryCharacterName: primaryCharacter.characterName,
		primaryCharacterCorporationId: primaryCharacter.corporationId,
		primaryCharacterAllianceId: primaryCharacter.allianceId ?? null,
		tickerSources: {
			corpTicker,
			allianceTicker,
		},
	}
}

async function getUserAllianceMemberCorporationIds(
	db: ReturnType<typeof createDb>,
	userCorporationIds: Set<string>
): Promise<Set<string>> {
	if (userCorporationIds.size === 0) {
		return new Set()
	}

	const memberCorporations = await db.query.managedCorporations.findMany({
		where: and(
			inArray(managedCorporations.corporationId, Array.from(userCorporationIds)),
			eq(managedCorporations.isActive, true),
			eq(managedCorporations.isMemberCorporation, true)
		),
		columns: { corporationId: true },
	})

	return new Set(memberCorporations.map((corporation) => corporation.corporationId))
}

function resolveScenarioRoleId(
	attachment: CorporationDiscordAttachmentScenarioFields,
	isCorpMember: boolean,
	isAllianceMember: boolean,
	attachmentIsMemberCorp: boolean,
	activeRoleIdByDbId: Map<string, string>
): { roleId: string | null; scenario: CorpAttachmentScenarioKey | null } {
	const allianceGuestRole = getScenarioRoleRecord(attachment, 'alliance_guest')
	if (
		attachmentIsMemberCorp &&
		isAllianceMember &&
		allianceGuestRole.autoApply &&
		allianceGuestRole.discordRoleId
	) {
		const roleId = activeRoleIdByDbId.get(allianceGuestRole.discordRoleId) ?? null
		if (roleId) {
			return { roleId, scenario: 'alliance-guest' }
		}
	}

	const nonAllianceGuestRole = getScenarioRoleRecord(attachment, 'non_alliance_guest')
	if (nonAllianceGuestRole.autoApply && nonAllianceGuestRole.discordRoleId) {
		const roleId = activeRoleIdByDbId.get(nonAllianceGuestRole.discordRoleId) ?? null
		if (roleId) {
			return { roleId, scenario: 'non-alliance-guest' }
		}
	}

	return { roleId: null, scenario: null }
}

function getScenarioManagedRoleDbIds(attachment: CorporationDiscordScenarioRoleFields): string[] {
	const roleIds = [
		getScenarioRoleRecord(attachment, 'alliance_guest').autoApply
			? getScenarioRoleRecord(attachment, 'alliance_guest').discordRoleId
			: null,
		getScenarioRoleRecord(attachment, 'non_alliance_guest').autoApply
			? getScenarioRoleRecord(attachment, 'non_alliance_guest').discordRoleId
			: null,
	].filter((roleId): roleId is string => !!roleId)

	return roleIds
}

type GroupDiscordRoleConfig = {
	roleIds?: string[]
	memberRoleIds?: string[]
	ownerAdminRoleIds?: string[]
	autoAssignRoles?: boolean
}

function getGroupMemberRoleDbIds(config: GroupDiscordRoleConfig): string[] {
	return config.memberRoleIds ?? config.roleIds ?? []
}

function getGroupOwnerAdminRoleDbIds(config: GroupDiscordRoleConfig): string[] {
	return config.ownerAdminRoleIds ?? []
}

function getGroupManagedRoleDbIds(config: GroupDiscordRoleConfig): string[] {
	return [...new Set([...getGroupMemberRoleDbIds(config), ...getGroupOwnerAdminRoleDbIds(config)])]
}

function mapDiscordRoleIdsByDbId(
	roleDbIds: string[],
	roleRows: Array<{ id?: string; roleId: string }>
): Map<string, string> {
	const roleIdByDbId = new Map<string, string>()

	for (let index = 0; index < roleRows.length; index += 1) {
		const row = roleRows[index]
		const dbId = row.id ?? roleDbIds[index]
		if (dbId) {
			roleIdByDbId.set(dbId, row.roleId)
		}
	}

	return roleIdByDbId
}

async function getGroupMembershipFlags(
	groupsStub: Groups,
	groupId: string,
	userId: string
): Promise<{ isMember: boolean; isOwnerAdmin: boolean }> {
	const [memberUserIds, ownerAdminUserIds] = await Promise.all([
		groupsStub.getGroupMemberUserIds(groupId),
		groupsStub.getGroupOwnerAndAdminUserIds(groupId),
	])

	return {
		isMember: memberUserIds.includes(userId),
		isOwnerAdmin: ownerAdminUserIds.includes(userId),
	}
}

/**
 * Build the set of managed roles a user is expected to have per guild based on core grants.
 * This intentionally does not query Discord membership state.
 */
export async function getExpectedManagedRoleIdsByGuild(
	env: Env,
	userId: string
): Promise<Map<string, Set<string>>> {
	const db = createDb(env.DATABASE_URL)
	const knownServers = await db.query.discordServers.findMany({
		where: eq(discordServers.isActive, true),
		columns: { id: true, guildId: true, guildName: true },
	})

	const expectedRoleIdsByGuild = new Map<string, Set<string>>()
	const ensureExpectedSet = (guildId: string): Set<string> => {
		const existing = expectedRoleIdsByGuild.get(guildId)
		if (existing) return existing
		const created = new Set<string>()
		expectedRoleIdsByGuild.set(guildId, created)
		return created
	}

	if (knownServers.length === 0) {
		return expectedRoleIdsByGuild
	}

	const temporaryRoleState = await getTemporaryRoleIdsByGuild(
		db,
		env,
		knownServers.map((server) => server.guildId),
		userId
	)
	for (const [guildId, roleIds] of temporaryRoleState.activeRoleIdsByGuild) {
		for (const roleId of roleIds) ensureExpectedSet(guildId).add(roleId)
	}

	const knownServerDbIds = knownServers.map((server) => server.id)
	const serverByDbId = new Map(knownServers.map((server) => [server.id, server]))

	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
		columns: { characterId: true },
	})
	const characterIds = userChars.map((char) => char.characterId)
	const userCorporationIds = await getUserCorporationIds(env, characterIds)
	const userAllianceMemberCorporationIds = await getUserAllianceMemberCorporationIds(
		db,
		userCorporationIds
	)
	const isAllianceMember = userAllianceMemberCorporationIds.size > 0

	const corpAttachments =
		knownServerDbIds.length > 0
			? await db.query.corporationDiscordServers.findMany({
					where: inArray(corporationDiscordServers.discordServerId, knownServerDbIds),
					columns: { corporationId: true, autoAssignRoles: true },
					with: {
						corporation: {
							columns: { isMemberCorporation: true },
						},
						discordServer: true,
						roles: {
							with: {
								discordRole: {
									columns: { id: true, roleId: true, isActive: true },
								},
							},
						},
						scenarioRoles: {
							columns: { bucket: true, discordRoleId: true, autoApply: true },
						},
					},
				})
			: []

	const scenarioRoleDbIds = new Set<string>()
	for (const attachment of corpAttachments) {
		for (const roleDbId of getScenarioManagedRoleDbIds(attachment)) {
			scenarioRoleDbIds.add(roleDbId)
		}
	}

	let scenarioRoleIdByDbId = new Map<string, string>()
	if (scenarioRoleDbIds.size > 0) {
		const scenarioRoles = await db.query.discordRoles.findMany({
			where: and(
				inArray(discordRoles.id, Array.from(scenarioRoleDbIds)),
				eq(discordRoles.isActive, true)
			),
			columns: { id: true, roleId: true },
		})
		scenarioRoleIdByDbId = new Map(scenarioRoles.map((role) => [role.id, role.roleId]))
	}

	const userEntitledGuildIds = new Set<string>()
	const corpGatedGuildIds = new Set<string>()

	for (const attachment of corpAttachments) {
		if (!attachment.discordServer.isActive) continue

		const guildId = attachment.discordServer.guildId
		corpGatedGuildIds.add(guildId)

		const isCorpMember = userCorporationIds.has(attachment.corporationId)
		const { roleId: scenarioRoleId } = resolveScenarioRoleId(
			attachment,
			isCorpMember,
			isAllianceMember,
			attachment.corporation.isMemberCorporation,
			scenarioRoleIdByDbId
		)

		if (isCorpMember || scenarioRoleId) {
			userEntitledGuildIds.add(guildId)
		}

		if (scenarioRoleId) {
			ensureExpectedSet(guildId).add(scenarioRoleId)
		}

		if (!isCorpMember || !attachment.autoAssignRoles) continue

		const expectedSet = ensureExpectedSet(guildId)
		for (const roleAssignment of attachment.roles) {
			if (roleAssignment.discordRole.isActive) {
				expectedSet.add(roleAssignment.discordRole.roleId)
			}
		}
	}

	try {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')
		const groupsWithDiscord = await groupsStub.getGroupsWithDiscordAutoInvite()

		const pendingGroupRoleLookups: Array<{
			guildId: string
			isMember: boolean
			isOwnerAdmin: boolean
			memberRoleDbIds: string[]
			ownerAdminRoleDbIds: string[]
		}> = []
		const groupRoleDbIds = new Set<string>()

		for (const group of groupsWithDiscord) {
			const membership = await getGroupMembershipFlags(groupsStub, group.groupId, userId)
			if (!membership.isMember && !membership.isOwnerAdmin) continue

			for (const attachment of group.discordServers) {
				if (!attachment.autoAssignRoles) continue

				const server = serverByDbId.get(attachment.discordServerId)
				if (!server) continue

				const isCorpGatedWithoutEntitlement =
					corpGatedGuildIds.has(server.guildId) && !userEntitledGuildIds.has(server.guildId)
				if (isCorpGatedWithoutEntitlement) continue

				const memberRoleDbIds = getGroupMemberRoleDbIds(attachment)
				const ownerAdminRoleDbIds = getGroupOwnerAdminRoleDbIds(attachment)
				pendingGroupRoleLookups.push({
					guildId: server.guildId,
					isMember: membership.isMember,
					isOwnerAdmin: membership.isOwnerAdmin,
					memberRoleDbIds,
					ownerAdminRoleDbIds,
				})
				for (const roleDbId of getGroupManagedRoleDbIds(attachment)) {
					groupRoleDbIds.add(roleDbId)
				}
			}
		}

		let roleIdByDbId = new Map<string, string>()
		const uniqueGroupRoleDbIds = Array.from(groupRoleDbIds)
		if (uniqueGroupRoleDbIds.length > 0) {
			const roleRows = await db.query.discordRoles.findMany({
				where: and(inArray(discordRoles.id, uniqueGroupRoleDbIds), eq(discordRoles.isActive, true)),
				columns: { id: true, roleId: true },
			})
			roleIdByDbId = mapDiscordRoleIdsByDbId(uniqueGroupRoleDbIds, roleRows)
		}

		for (const lookup of pendingGroupRoleLookups) {
			const expectedSet = ensureExpectedSet(lookup.guildId)
			if (lookup.isMember) {
				for (const roleDbId of lookup.memberRoleDbIds) {
					const resolvedRoleId = roleIdByDbId.get(roleDbId)
					if (resolvedRoleId) {
						expectedSet.add(resolvedRoleId)
					}
				}
			}
			if (lookup.isOwnerAdmin) {
				for (const roleDbId of lookup.ownerAdminRoleDbIds) {
					const resolvedRoleId = roleIdByDbId.get(roleDbId)
					if (resolvedRoleId) {
						expectedSet.add(resolvedRoleId)
					}
				}
			}
		}
	} catch (error) {
		logger.error('[Discord] Error resolving group roles for Discord access expectation build', {
			userId,
			error: String(error),
		})
	}

	if (knownServerDbIds.length > 0) {
		const autoApplyRoles = await db.query.discordRoles.findMany({
			where: and(
				eq(discordRoles.autoApply, true),
				eq(discordRoles.isActive, true),
				inArray(discordRoles.discordServerId, knownServerDbIds)
			),
			columns: { roleId: true, discordServerId: true },
		})
		for (const role of autoApplyRoles) {
			const server = serverByDbId.get(role.discordServerId)
			if (server) {
				ensureExpectedSet(server.guildId).add(role.roleId)
			}
		}
	}

	try {
		const discordStub = getDiscordStub(env)
		for (const server of knownServers) {
			try {
				const guildRoles = await discordStub.getGuildRoles(server.guildId)
				if (guildRoles.some((role) => role.id === DISCORD_EXCLUDED_AUTH_GIGACHAD_ROLE_ID)) {
					ensureExpectedSet(server.guildId).add(DISCORD_EXCLUDED_AUTH_GIGACHAD_ROLE_ID)
				}
			} catch (error) {
				logger.warn(
					'[Discord] Error resolving special auth role presence for expected role build',
					{
						userId,
						guildId: server.guildId,
						error: String(error),
					}
				)
			}
		}
	} catch (error) {
		logger.error('[Discord] Error creating Discord stub for expected role build', {
			userId,
			error: String(error),
		})
	}

	return expectedRoleIdsByGuild
}

/**
 * ONLY invites a user to Discord servers they are NOT already a member of
 * Based on their corporation and group memberships with autoInvite=true
 * Does NOT update roles for existing members
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Invite results with statistics
 */
export async function inviteUserToDiscordServers(
	env: Env,
	userId: string
): Promise<{
	results: Array<{
		guildId: string
		guildName: string
		corporationName?: string
		groupName?: string
		success: boolean
		errorMessage?: string
		alreadyMember?: boolean
		type?: 'corporation' | 'group'
	}>
	totalInvited: number
	totalFailed: number
}> {
	logger.debug('[Discord] inviteUserToDiscordServers: Starting', {
		userId,
	})

	const db = createDb(env.DATABASE_URL)

	// Get user to check if they have Discord linked
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
	})

	if (!user) {
		logger.error('[Discord] inviteUserToDiscordServers: User not found', { userId })
		throw new Error('User not found')
	}

	if (!user.discordUserId) {
		logger.warn('[Discord] inviteUserToDiscordServers: Discord account not linked', { userId })
		throw new Error('Discord account not linked')
	}

	// Check if user is blacklisted - prevent Discord invites for blacklisted users
	const hrStub = getStub<Hr>(env.HR, 'default')
	const isBlacklisted = await hrStub.isUserBlacklisted(userId)

	if (isBlacklisted) {
		logger.warn('[Discord] Blocked Discord invite for blacklisted user', {
			userId,
			discordUserId: user.discordUserId,
		})
		return {
			results: [],
			totalInvited: 0,
			totalFailed: 0,
		}
	}

	// Get all user's characters
	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
	})

	const characterIds = userChars.map((char) => char.characterId)

	logger.debug('[Discord] inviteUserToDiscordServers: User characters', {
		userId,
		characterIds,
		characterCount: characterIds.length,
		characterNames: userChars.map((char) => char.characterName),
	})

	// Get primary character name for nickname management
	const primaryCharacter = userChars.find((char) => char.is_primary)
	const primaryCharacterName = primaryCharacter?.characterName

	if (characterIds.length === 0) {
		logger.warn('[Discord] inviteUserToDiscordServers: User has no characters', { userId })
		return {
			results: [],
			totalInvited: 0,
			totalFailed: 0,
		}
	}

	// === GET USER'S CHARACTER CORPORATION IDs ===
	// This is much more efficient than fetching all corporation members
	const userCorporationIds = await getUserCorporationIds(env, characterIds)

	logger.debug('[Discord] inviteUserToDiscordServers: Corporation IDs retrieved', {
		userId,
		userCorporationIds: Array.from(userCorporationIds),
		corporationCount: userCorporationIds.size,
		characterIds,
	})

	if (userCorporationIds.size === 0) {
		// User has no corporation memberships, skip corporation checks
		logger.warn('[Discord] inviteUserToDiscordServers: User has no corporation memberships', {
			userId,
			characterIds,
		})
	}

	const userAllianceMemberCorporationIds = await getUserAllianceMemberCorporationIds(
		db,
		userCorporationIds
	)
	const isAllianceMember = userAllianceMemberCorporationIds.size > 0

	// === CHECK CORPORATIONS (ONLY autoInvite=true) ===
	// Fetch all corporation attachments that may apply to this user via corp, alliance, or guest fallback.
	const corpAttachments = await db.query.corporationDiscordServers.findMany({
		where: eq(corporationDiscordServers.autoInvite, true),
		columns: { corporationId: true, discordServerId: true, autoAssignRoles: true },
		with: {
			corporation: {
				columns: { name: true, isMemberCorporation: true },
			},
			discordServer: true,
			roles: {
				with: {
					discordRole: {
						columns: { id: true, roleId: true, isActive: true },
					},
				},
			},
			scenarioRoles: {
				columns: { bucket: true, discordRoleId: true, autoApply: true },
			},
		},
	})

	logger.debug('[Discord] inviteUserToDiscordServers: Corporation attachments found', {
		userId,
		corpAttachmentsCount: corpAttachments.length,
		corpAttachments: corpAttachments.map((att) => ({
			corporationId: att.corporationId,
			corporationName: att.corporation.name,
			guildId: att.discordServer.guildId,
			guildName: att.discordServer.guildName,
			isActive: att.discordServer.isActive,
		})),
	})

	// Filter out inactive Discord servers
	const activeCorpAttachments = corpAttachments.filter(
		(attachment) => attachment.discordServer.isActive
	)

	const scenarioRoleDbIds = new Set<string>()
	for (const attachment of activeCorpAttachments) {
		for (const roleDbId of getScenarioManagedRoleDbIds(attachment)) {
			scenarioRoleDbIds.add(roleDbId)
		}
	}

	let scenarioRoleIdByDbId = new Map<string, string>()
	if (scenarioRoleDbIds.size > 0) {
		const scenarioRoles = await db.query.discordRoles.findMany({
			where: and(
				inArray(discordRoles.id, Array.from(scenarioRoleDbIds)),
				eq(discordRoles.isActive, true)
			),
			columns: { id: true, roleId: true },
		})
		scenarioRoleIdByDbId = new Map(scenarioRoles.map((role) => [role.id, role.roleId]))
	}

	logger.debug('[Discord] inviteUserToDiscordServers: Active corporation attachments', {
		userId,
		activeCorpAttachmentsCount: activeCorpAttachments.length,
		filteredOutCount: corpAttachments.length - activeCorpAttachments.length,
	})

	const guildsToJoin: Array<{
		guildId: string
		guildName: string
		type: 'corporation' | 'group'
		corporationId?: string
		corporationName?: string
		groupId?: string
		groupName?: string
		discordServerId?: string
		roleIds?: string[]
	}> = []

	// Add corporation attachments - evaluate corp/alliance/guest scenarios per attachment.
	for (const attachment of activeCorpAttachments) {
		const isCorpMember = userCorporationIds.has(attachment.corporationId)
		const { roleId: scenarioRoleId, scenario } = resolveScenarioRoleId(
			attachment,
			isCorpMember,
			isAllianceMember,
			attachment.corporation.isMemberCorporation,
			scenarioRoleIdByDbId
		)

		const roleIds: string[] = []
		if (isCorpMember && attachment.autoAssignRoles) {
			for (const roleAssignment of attachment.roles) {
				if (roleAssignment.discordRole.isActive) {
					roleIds.push(roleAssignment.discordRole.roleId)
				}
			}
		}
		if (scenarioRoleId) {
			roleIds.push(scenarioRoleId)
		}

		// Auto-invite is intentionally reserved for actual corporation members.
		// Guest buckets may still resolve a role for existing members, but they
		// must not be used as a reason to join an unaffiliated user to the guild.
		const shouldInvite = isCorpMember
		if (!shouldInvite) {
			logger.debug('[Discord] inviteUserToDiscordServers: Skipping corporation attachment', {
				userId,
				guildId: attachment.discordServer.guildId,
				guildName: attachment.discordServer.guildName,
				corporationId: attachment.corporationId,
				corporationName: attachment.corporation.name,
				isCorpMember,
				isAllianceMember,
				scenario,
			})
			continue
		}

		logger.debug('[Discord] inviteUserToDiscordServers: Adding corporation guild to join', {
			userId,
			guildId: attachment.discordServer.guildId,
			guildName: attachment.discordServer.guildName,
			corporationId: attachment.corporationId,
			corporationName: attachment.corporation.name,
			roleIds,
			roleCount: roleIds.length,
			isCorpMember,
			isAllianceMember,
			scenario,
		})

		guildsToJoin.push({
			type: 'corporation',
			guildId: attachment.discordServer.guildId,
			guildName: attachment.discordServer.guildName,
			corporationId: attachment.corporationId,
			corporationName: attachment.corporation.name,
			discordServerId: attachment.discordServerId,
			roleIds,
		})
	}

	// === CHECK GROUPS (ONLY autoInvite=true) ===

	try {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')
		const groupsWithDiscord = await groupsStub.getGroupsWithDiscordAutoInvite()

		logger.debug('[Discord] inviteUserToDiscordServers: Groups with Discord auto-invite', {
			userId,
			groupsCount: groupsWithDiscord.length,
			groupIds: groupsWithDiscord.map((g) => g.groupId),
		})

		for (const group of groupsWithDiscord) {
			try {
				const membership = await getGroupMembershipFlags(groupsStub, group.groupId, userId)

				logger.debug('[Discord] inviteUserToDiscordServers: Checking group membership', {
					userId,
					groupId: group.groupId,
					groupName: group.groupName,
					isMember: membership.isMember,
					isOwnerAdmin: membership.isOwnerAdmin,
				})

				// Auto-invite is reserved for actual group members.
				// Owner/admin status can still matter for role assignment on existing members,
				// but it must not cause a join for someone who is not a member.
				if (membership.isMember) {
					for (const discordServer of group.discordServers) {
						// ONLY process servers with autoInvite=true
						if (!discordServer.autoInvite) {
							logger.debug(
								'[Discord] inviteUserToDiscordServers: Skipping group server (autoInvite=false)',
								{
									userId,
									groupId: group.groupId,
									discordServerId: discordServer.discordServerId,
								}
							)
							continue
						}

						const serverInfo = await db.query.discordServers.findFirst({
							where: and(
								eq(discordServers.id, discordServer.discordServerId),
								eq(discordServers.isActive, true) // SECURITY: Only active servers
							),
						})

						if (serverInfo) {
							const roleDbIds = discordServer.autoAssignRoles
								? getGroupMemberRoleDbIds(discordServer)
								: []
							const actualRoleIds: string[] = []
							if (roleDbIds.length > 0) {
								const roleRecords = await db.query.discordRoles.findMany({
									where: and(inArray(discordRoles.id, roleDbIds), eq(discordRoles.isActive, true)),
								})
								actualRoleIds.push(...roleRecords.map((r) => r.roleId))
							}

							logger.debug('[Discord] inviteUserToDiscordServers: Adding group guild to join', {
								userId,
								guildId: serverInfo.guildId,
								guildName: serverInfo.guildName,
								groupId: group.groupId,
								groupName: group.groupName,
								roleIds: actualRoleIds,
								roleCount: actualRoleIds.length,
								isMember: membership.isMember,
								isOwnerAdmin: membership.isOwnerAdmin,
							})

							guildsToJoin.push({
								type: 'group',
								guildId: serverInfo.guildId,
								guildName: serverInfo.guildName,
								groupId: group.groupId,
								groupName: group.groupName,
								discordServerId: serverInfo.id,
								roleIds: actualRoleIds,
							})
						} else {
							logger.warn(
								'[Discord] inviteUserToDiscordServers: Group server not found or inactive',
								{
									userId,
									groupId: group.groupId,
									discordServerId: discordServer.discordServerId,
								}
							)
						}
					}
				}
			} catch (error) {
				logger.error('[Discord] inviteUserToDiscordServers: Error checking group members', {
					userId,
					groupId: group.groupId,
					error: String(error),
				})
			}
		}
	} catch (error) {
		logger.error('[Discord] inviteUserToDiscordServers: Error fetching groups with Discord', {
			userId,
			error: String(error),
		})
	}

	logger.debug('[Discord] inviteUserToDiscordServers: Guilds to join (before deduplication)', {
		userId,
		guildsToJoinCount: guildsToJoin.length,
		guildsToJoin: guildsToJoin.map((g) => ({
			guildId: g.guildId,
			guildName: g.guildName,
			type: g.type,
			corporationName: g.corporationName,
			groupName: g.groupName,
			roleCount: g.roleIds?.length || 0,
		})),
	})

	if (guildsToJoin.length === 0) {
		logger.warn('[Discord] inviteUserToDiscordServers: No guilds to join', {
			userId,
			characterIds,
			userCorporationIds: Array.from(userCorporationIds),
		})
		return {
			results: [],
			totalInvited: 0,
			totalFailed: 0,
		}
	}

	// === FETCH AUTO-APPLY ROLES (for initial invite) ===

	const autoApplyRoles = await db.query.discordRoles.findMany({
		where: and(eq(discordRoles.autoApply, true), eq(discordRoles.isActive, true)),
		with: {
			discordServer: true,
		},
	})

	// Filter to only include roles from active servers
	const activeAutoApplyRoles = autoApplyRoles.filter((role) => role.discordServer.isActive)

	// Build map of guildId -> auto-apply role IDs
	const autoApplyRolesByGuild = new Map<string, string[]>()
	for (const role of activeAutoApplyRoles) {
		const guildId = role.discordServer.guildId
		const existing = autoApplyRolesByGuild.get(guildId)
		if (existing) {
			existing.push(role.roleId)
		} else {
			autoApplyRolesByGuild.set(guildId, [role.roleId])
		}
	}

	// === DEDUPLICATE AND MERGE ROLES ===

	const guildMap = new Map<
		string,
		{
			guildId: string
			guildName: string
			roleIds: string[]
			discordServerDbIds: string[]
			sources: Array<{ type: 'corporation' | 'group'; name: string }>
		}
	>()

	for (const guild of guildsToJoin) {
		const existing = guildMap.get(guild.guildId)
		if (existing) {
			const combinedRoles = [...new Set([...existing.roleIds, ...(guild.roleIds || [])])]
			const allDbIds = [...existing.discordServerDbIds]
			if (guild.discordServerId) {
				allDbIds.push(guild.discordServerId)
			}

			existing.sources.push({
				type: guild.type,
				name: guild.type === 'corporation' ? guild.corporationName! : guild.groupName!,
			})

			guildMap.set(guild.guildId, {
				...existing,
				roleIds: combinedRoles,
				discordServerDbIds: [...new Set(allDbIds)],
			})
		} else {
			guildMap.set(guild.guildId, {
				guildId: guild.guildId,
				guildName: guild.guildName,
				roleIds: guild.roleIds || [],
				discordServerDbIds: guild.discordServerId ? [guild.discordServerId] : [],
				sources: [
					{
						type: guild.type,
						name: guild.type === 'corporation' ? guild.corporationName! : guild.groupName!,
					},
				],
			})
		}
	}

	logger.debug('[Discord] inviteUserToDiscordServers: Guild map after deduplication', {
		userId,
		guildMapSize: guildMap.size,
		guildMap: Array.from(guildMap.entries()).map(([guildId, data]) => ({
			guildId,
			guildName: data.guildName,
			roleCount: data.roleIds.length,
			sources: data.sources,
		})),
	})

	// Merge auto-apply roles
	for (const [guildId, guildData] of guildMap.entries()) {
		const autoRoles = autoApplyRolesByGuild.get(guildId)
		if (autoRoles && autoRoles.length > 0) {
			const mergedRoles = [...new Set([...guildData.roleIds, ...autoRoles])]
			guildData.roleIds = mergedRoles
		}
	}

	// === FETCH NICKNAME SETTINGS ===

	const uniqueDbIds = [
		...new Set(
			Array.from(guildMap.values())
				.flatMap((g) => g.discordServerDbIds)
				.filter((id): id is string => id !== undefined && id !== '')
		),
	]

	const discordServerSettings = await db.query.discordServers.findMany({
		where: and(
			inArray(discordServers.id, uniqueDbIds),
			eq(discordServers.isActive, true) // SECURITY: Only active servers
		),
	})

	const manageNicknamesByGuildId = new Map<string, boolean>()
	for (const server of discordServerSettings) {
		const currentValue = manageNicknamesByGuildId.get(server.guildId) ?? false
		manageNicknamesByGuildId.set(server.guildId, currentValue || server.manageNicknames)
	}

	// === INVITE TO GUILDS ===

	const guildIds = Array.from(guildMap.values()).map((guild) => guild.guildId)

	logger.info('[Discord] inviteUserToDiscordServers: Inviting user to servers', {
		userId,
		guildIds,
		guildCount: guildIds.length,
		guildNames: Array.from(guildMap.values()).map((g) => g.guildName),
	})

	const discordStub = getDiscordStub(env)
	const inviteResults = await discordStub.joinUserToServers(userId, guildIds)

	// Track which guilds were successfully joined (or user was already a member)
	const successfulGuildIds = new Set<string>()
	for (const result of inviteResults) {
		if (result.success) {
			successfulGuildIds.add(result.guildId)
		}
	}

	logger.debug('[Discord] inviteUserToDiscordServers: Invite results received', {
		userId,
		resultsCount: inviteResults.length,
		successfulCount: successfulGuildIds.size,
		results: inviteResults.map((r) => ({
			guildId: r.guildId,
			success: r.success,
			alreadyMember: r.alreadyMember,
			errorMessage: r.errorMessage,
		})),
	})

	// === UPDATE NICKNAMES (only for successful joins) ===
	// NOTE: Nicknames are updated BEFORE roles to ensure proper display name setup

	const guildsForNicknameUpdate = Array.from(guildMap.values())
		.filter((guild) => {
			const manageNicknames = manageNicknamesByGuildId.get(guild.guildId)
			return manageNicknames && primaryCharacterName && successfulGuildIds.has(guild.guildId)
		})
		.map((guild) => guild.guildId)

	logger.info('[Discord] inviteUserToDiscordServers: Nickname update check', {
		userId,
		primaryCharacterName,
		guildsForNicknameUpdate,
		successfulGuildIds: Array.from(successfulGuildIds),
		manageNicknamesByGuildId: Object.fromEntries(manageNicknamesByGuildId),
	})

	if (guildsForNicknameUpdate.length > 0) {
		logger.info('[Discord] inviteUserToDiscordServers: Updating nicknames', {
			userId,
			guilds: guildsForNicknameUpdate,
			primaryCharacterName,
		})
		await updateUserDiscordNickname(env, userId, guildsForNicknameUpdate)
	}

	// === UPDATE ROLES (only for successful joins) ===

	const roleUpdateRequests = await Promise.all(
		Array.from(guildMap.values())
			.filter((guild) => guild.roleIds.length > 0 && successfulGuildIds.has(guild.guildId))
			.map(async (guild) => {
				// Get all managed roles for this guild
				const managedRoleIds = await getAllManagedRolesForGuild(db, env, guild.guildId)

				return {
					guildId: guild.guildId,
					roleIds: guild.roleIds,
					managedRoleIds,
				}
			})
	)

	if (roleUpdateRequests.length > 0) {
		await discordStub.updateUserRoles(userId, roleUpdateRequests)
	}

	// Build final results
	const results = inviteResults.map((result: JoinServerResult) => {
		const guildData = guildMap.get(result.guildId)
		return {
			guildId: result.guildId,
			guildName: guildData?.guildName ?? result.guildName ?? result.guildId,
			corporationName: guildData?.sources.find((s) => s.type === 'corporation')?.name,
			groupName: guildData?.sources.find((s) => s.type === 'group')?.name,
			success: result.success,
			errorMessage: result.errorMessage,
			alreadyMember: result.alreadyMember,
			type: guildData?.sources[0]?.type,
		}
	})

	// Count only actual invites (not already members)
	const totalInvited = results.filter((r) => r.success && !r.alreadyMember).length
	const totalFailed = results.filter((r) => !r.success).length

	logger.info('[Discord] inviteUserToDiscordServers: Completed', {
		userId,
		totalInvited,
		totalFailed,
		totalResults: results.length,
		alreadyMemberCount: results.filter((r) => r.alreadyMember).length,
	})

	return {
		results,
		totalInvited,
		totalFailed,
	}
}

/**
 * ONLY updates Discord roles for a user who is ALREADY a member of servers
 * Does NOT invite users to new servers
 * @param env - Worker environment
 * @param userId - Core user ID
 * @param guildIds - Optional list of specific guild IDs to update (if not provided, updates all)
 * @returns Role update results with statistics
 */
export async function updateUserDiscordRoles(
	env: Env,
	userId: string,
	guildIds?: string[],
	allowRemoval?: boolean,
	hardStripAllRoles?: boolean
): Promise<{
	results: Array<{
		guildId: string
		guildName: string
		attemptedRoleIds: string[]
		attemptedRoleNames: string[]
		rolesAdded: string[]
		roleNamesAdded: string[]
		rolesRemoved: string[]
		roleNamesRemoved: string[]
		success: boolean
		errorMessage?: string
		warningMessages: string[]
	}>
	totalUpdated: number
	totalFailed: number
}> {
	const db = createDb(env.DATABASE_URL)

	// Get user to check if they have Discord linked
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
	})

	if (!user) {
		throw new Error('User not found')
	}

	if (!user.discordUserId) {
		throw new Error('Discord account not linked')
	}

	// Check if user is blacklisted - prevent role updates for blacklisted users
	const hrStub = getStub<Hr>(env.HR, 'default')
	const isBlacklisted = await hrStub.isUserBlacklisted(userId)

	if (isBlacklisted) {
		logger.warn('[Discord] Blocked Discord role update for blacklisted user', {
			userId,
			discordUserId: user.discordUserId,
		})
		return {
			results: [],
			totalUpdated: 0,
			totalFailed: 0,
		}
	}

	const discordStub = getDiscordStub(env)
	const discordStatus = await discordStub.getDiscordUserStatus(userId)
	const isAuthorizationRevoked = discordStatus?.authRevoked ?? false

	// === DETERMINE WHICH SERVERS TO UPDATE ===

	let serversToUpdate: string[]

	if (guildIds && guildIds.length > 0) {
		// Use provided guild IDs
		serversToUpdate = guildIds
	} else {
		// Get all active Discord servers from our database
		const knownServers = await db.query.discordServers.findMany({
			where: eq(discordServers.isActive, true),
			columns: { guildId: true },
		})

		const knownGuildIds = knownServers.map((s) => s.guildId)

		if (knownGuildIds.length > 0) {
			// Use bot token to check which guilds the user is a member of
			serversToUpdate = await discordStub.checkGuildMembershipWithBot(userId, knownGuildIds)
		} else {
			serversToUpdate = []
		}
	}

	if (serversToUpdate.length === 0) {
		return {
			results: [],
			totalUpdated: 0,
			totalFailed: 0,
		}
	}

	// === CALCULATE WHAT ROLES USER SHOULD HAVE ===

	const rolesByGuild = new Map<
		string,
		{
			guildId: string
			guildName: string
			expectedRoleIds: string[]
			sources: Array<{ type: 'corporation' | 'group' | 'auto-apply' | 'temporary'; name: string }>
			temporaryRoleSourceUnavailable: boolean
		}
	>()

	// Initialize map with empty role sets
	for (const guildId of serversToUpdate) {
		rolesByGuild.set(guildId, {
			guildId,
			guildName: guildId, // Will be updated if we find the name
			expectedRoleIds: [],
			sources: [],
			temporaryRoleSourceUnavailable: false,
		})
	}

	if (!isAuthorizationRevoked) {
		// Get all user's characters
		const userChars = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		const characterIds = userChars.map((char) => char.characterId)

		// === CHECK CORPORATION ROLES (all attachments, not just auto-invite) ===
		// Resolve the user's corp/alliance memberships once, then evaluate every
		// attached corporation on the target guilds with the exclusive scenario order.
		const userCorporationIds = await getUserCorporationIds(env, characterIds)
		const userAllianceMemberCorporationIds = await getUserAllianceMemberCorporationIds(
			db,
			userCorporationIds
		)
		const isAllianceMember = userAllianceMemberCorporationIds.size > 0

		const targetServerRecords = await db.query.discordServers.findMany({
			where: and(
				inArray(discordServers.guildId, serversToUpdate),
				eq(discordServers.isActive, true)
			),
			columns: { id: true, guildId: true, guildName: true },
		})
		const targetServerDbIds = targetServerRecords.map((s) => s.id)

		const corpAttachments =
			targetServerDbIds.length > 0
				? await db.query.corporationDiscordServers.findMany({
						where: inArray(corporationDiscordServers.discordServerId, targetServerDbIds),
						columns: { corporationId: true, autoAssignRoles: true },
						with: {
							corporation: {
								columns: { name: true, isMemberCorporation: true },
							},
							discordServer: true,
							roles: {
								with: {
									discordRole: {
										columns: { id: true, roleId: true, isActive: true },
									},
								},
							},
							scenarioRoles: {
								columns: { bucket: true, discordRoleId: true, autoApply: true },
							},
						},
					})
				: []

		const scenarioRoleDbIds = new Set<string>()
		for (const attachment of corpAttachments) {
			for (const roleDbId of getScenarioManagedRoleDbIds(attachment)) {
				scenarioRoleDbIds.add(roleDbId)
			}
		}

		let scenarioRoleIdByDbId = new Map<string, string>()
		if (scenarioRoleDbIds.size > 0) {
			const scenarioRoles = await db.query.discordRoles.findMany({
				where: and(
					inArray(discordRoles.id, Array.from(scenarioRoleDbIds)),
					eq(discordRoles.isActive, true)
				),
				columns: { id: true, roleId: true },
			})
			scenarioRoleIdByDbId = new Map(scenarioRoles.map((role) => [role.id, role.roleId]))
		}

		const userEntitledGuildIds = new Set<string>()
		const corpGatedGuildIds = new Set<string>()

		for (const attachment of corpAttachments) {
			if (!attachment.discordServer.isActive) continue

			const guildId = attachment.discordServer.guildId
			corpGatedGuildIds.add(guildId)

			const isCorpMember = userCorporationIds.has(attachment.corporationId)
			const { roleId: scenarioRoleId } = resolveScenarioRoleId(
				attachment,
				isCorpMember,
				isAllianceMember,
				attachment.corporation.isMemberCorporation,
				scenarioRoleIdByDbId
			)

			if (isCorpMember || scenarioRoleId) {
				userEntitledGuildIds.add(guildId)
			}

			if (isCorpMember && attachment.autoAssignRoles) {
				const guildData = rolesByGuild.get(guildId)
				if (guildData) {
					for (const roleAssignment of attachment.roles) {
						if (roleAssignment.discordRole.isActive) {
							guildData.expectedRoleIds.push(roleAssignment.discordRole.roleId)
						}
					}
					guildData.sources.push({
						type: 'corporation',
						name: attachment.corporation.name,
					})
					guildData.guildName = attachment.discordServer.guildName
				}
			}

			if (scenarioRoleId) {
				const guildData = rolesByGuild.get(guildId)
				if (guildData) {
					guildData.expectedRoleIds.push(scenarioRoleId)
					guildData.sources.push({
						type: 'corporation',
						name: attachment.corporation.name,
					})
					guildData.guildName = attachment.discordServer.guildName
				}
			}
		}

		// === CHECK GROUP ROLES (all attachments, not just auto-invite) ===

		try {
			const groupsStub = getStub<Groups>(env.GROUPS, 'default')
			const groupsWithDiscord = await groupsStub.getGroupsWithDiscordAutoInvite()

			for (const group of groupsWithDiscord) {
				try {
					const membership = await getGroupMembershipFlags(groupsStub, group.groupId, userId)

					if (membership.isMember || membership.isOwnerAdmin) {
						for (const discordServer of group.discordServers) {
							// Check ALL servers, not just auto-invite
							const serverInfo = await db.query.discordServers.findFirst({
								where: and(
									eq(discordServers.id, discordServer.discordServerId),
									eq(discordServers.isActive, true)
								),
							})

							// Don't grant group roles on corp-gated guilds where user has no corp/alliance entitlement.
							// Losing corp access should also revoke group roles on that guild.
							const isCorpGatedWithoutEntitlement =
								!!serverInfo &&
								corpGatedGuildIds.has(serverInfo.guildId) &&
								!userEntitledGuildIds.has(serverInfo.guildId)

							if (
								serverInfo &&
								serversToUpdate.includes(serverInfo.guildId) &&
								discordServer.autoAssignRoles &&
								!isCorpGatedWithoutEntitlement
							) {
								let actualRoleIds: string[] = []

								const memberRoleDbIds =
									discordServer.autoAssignRoles && membership.isMember
										? getGroupMemberRoleDbIds(discordServer)
										: []
								const ownerAdminRoleDbIds =
									discordServer.autoAssignRoles && membership.isOwnerAdmin
										? getGroupOwnerAdminRoleDbIds(discordServer)
										: []
								const roleDbIds = [...new Set([...memberRoleDbIds, ...ownerAdminRoleDbIds])]

								if (roleDbIds.length > 0) {
									const roleRecords = await db.query.discordRoles.findMany({
										where: and(
											inArray(discordRoles.id, roleDbIds),
											eq(discordRoles.isActive, true)
										),
									})
									actualRoleIds = roleRecords.map((r) => r.roleId)
								}

								const guildData = rolesByGuild.get(serverInfo.guildId)
								if (guildData) {
									guildData.expectedRoleIds.push(...actualRoleIds)
									guildData.sources.push({
										type: 'group',
										name: group.groupName,
									})
									guildData.guildName = serverInfo.guildName
								}
							}
						}
					}
				} catch (error) {
					logger.error('[Discord] Error checking group members for role update', {
						groupId: group.groupId,
						error: String(error),
					})
				}
			}
		} catch (error) {
			logger.error('[Discord] Error fetching groups for role update', {
				error: String(error),
			})
		}

		// === ADD AUTO-APPLY ROLES ===

		const autoApplyRoles = await db.query.discordRoles.findMany({
			where: and(eq(discordRoles.autoApply, true), eq(discordRoles.isActive, true)),
			with: {
				discordServer: true,
			},
		})

		for (const role of autoApplyRoles) {
			if (role.discordServer?.isActive && serversToUpdate.includes(role.discordServer.guildId)) {
				const guildData = rolesByGuild.get(role.discordServer.guildId)
				if (guildData) {
					guildData.expectedRoleIds.push(role.roleId)
					guildData.sources.push({
						type: 'auto-apply',
						name: role.roleName,
					})
				}
			}
		}
	}

	const temporaryRoleState = await getTemporaryRoleIdsByGuild(db, env, serversToUpdate, userId)
	for (const [guildId, roleIds] of temporaryRoleState.activeRoleIdsByGuild) {
		const guildData = rolesByGuild.get(guildId)
		if (!guildData) continue
		guildData.expectedRoleIds.push(...roleIds)
		guildData.sources.push({ type: 'temporary', name: 'Temporary role assignment' })
	}
	for (const [guildId, roleIds] of temporaryRoleState.cleanupRoleIdsByGuild) {
		const guildData = rolesByGuild.get(guildId)
		if (!guildData) continue
		guildData.sources.push({ type: 'temporary', name: 'Temporary role cleanup' })
		guildData.expectedRoleIds = guildData.expectedRoleIds.filter(
			(roleId) => !roleIds.includes(roleId)
		)
	}
	for (const guildId of temporaryRoleState.failedGuildIds) {
		const guildData = rolesByGuild.get(guildId)
		if (guildData) guildData.temporaryRoleSourceUnavailable = true
	}

	// === DEDUPLICATE ROLES PER GUILD ===

	for (const guildData of rolesByGuild.values()) {
		guildData.expectedRoleIds = [...new Set(guildData.expectedRoleIds)]
	}

	// === BUILD ROLE UPDATE REQUESTS ===
	let updateRequests: Array<{
		guildId: string
		roleIds: string[]
		managedRoleIds: string[]
		preserveRoleIds?: string[]
		preserveAllCurrentRoles?: boolean
		clearAllRoles?: boolean
	}>

	if (hardStripAllRoles) {
		updateRequests = Array.from(rolesByGuild.values()).map((guild) => ({
			guildId: guild.guildId,
			roleIds: [],
			managedRoleIds: [],
			clearAllRoles: true,
		}))
	} else {
		updateRequests = await Promise.all(
			Array.from(rolesByGuild.values())
				// When removal is allowed, include guilds with no expected roles so managed roles are cleaned up.
				// Without this, a user who loses all entitlements to a guild would silently retain managed roles.
				.filter((guild) => guild.expectedRoleIds.length > 0 || allowRemoval === true)
				.map(async (guild) => {
					// Get all managed roles for this guild
					const managedRoleIds = [
						...new Set([
							...(await getAllManagedRolesForGuild(db, env, guild.guildId)),
							...(temporaryRoleState.cleanupRoleIdsByGuild.get(guild.guildId) ?? []),
							...(temporaryRoleState.activeRoleIdsByGuild.get(guild.guildId) ?? []),
						]),
					]

					return {
						guildId: guild.guildId,
						roleIds: guild.expectedRoleIds,
						managedRoleIds,
						preserveRoleIds: guild.temporaryRoleSourceUnavailable
							? [...(temporaryRoleState.configuredRoleIdsByGuild.get(guild.guildId) ?? [])]
							: [],
						preserveAllCurrentRoles: temporaryRoleState.preserveAllCurrentRolesGuildIds.has(
							guild.guildId
						),
					}
				})
		)
	}

	if (updateRequests.length === 0) {
		return {
			results: [],
			totalUpdated: 0,
			totalFailed: 0,
		}
	}

	// === CALL DISCORD DO - UPDATE ROLES ONLY ===

	const updateResults = await discordStub.updateUserRoles(userId, updateRequests, allowRemoval)

	// Best-effort nickname sync for servers that opt into nickname management.
	// Skip when Discord authorization has been revoked so we avoid extra user lookups.
	if (!isAuthorizationRevoked) {
		try {
			await updateUserDiscordNickname(env, userId, serversToUpdate)
		} catch (error) {
			logger.error('[Discord] updateUserDiscordRoles: Nickname update failed', {
				userId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// Resolve role names for display/debug output.
	const serverRecords = await db.query.discordServers.findMany({
		where: and(inArray(discordServers.guildId, serversToUpdate), eq(discordServers.isActive, true)),
		columns: { id: true, guildId: true },
	})
	const guildIdByServerId = new Map(serverRecords.map((record) => [record.id, record.guildId]))
	const serverIds = serverRecords.map((record) => record.id)
	const configuredRoles =
		serverIds.length > 0
			? await db.query.discordRoles.findMany({
					where: inArray(discordRoles.discordServerId, serverIds),
					columns: { discordServerId: true, roleId: true, roleName: true },
				})
			: []
	const roleNameByGuildAndRoleId = new Map<string, Map<string, string>>()
	for (const role of configuredRoles) {
		const guildId = guildIdByServerId.get(role.discordServerId)
		if (!guildId) continue
		const guildMap = roleNameByGuildAndRoleId.get(guildId) ?? new Map<string, string>()
		guildMap.set(role.roleId, role.roleName)
		roleNameByGuildAndRoleId.set(guildId, guildMap)
	}

	// Build final results
	const results = updateResults.map((result: any) => {
		const guildData = rolesByGuild.get(result.guildId)
		const roleNameMap = roleNameByGuildAndRoleId.get(result.guildId) ?? new Map<string, string>()
		const attemptedRoleIds = guildData?.expectedRoleIds ?? []
		const rolesAdded = result.rolesAdded || []
		const rolesRemoved = result.rolesRemoved || []
		return {
			guildId: result.guildId,
			guildName: guildData?.guildName ?? result.guildId,
			attemptedRoleIds,
			attemptedRoleNames: attemptedRoleIds.map((roleId) => roleNameMap.get(roleId) ?? roleId),
			rolesAdded,
			roleNamesAdded: rolesAdded.map((roleId: string) => roleNameMap.get(roleId) ?? roleId),
			rolesRemoved,
			roleNamesRemoved: rolesRemoved.map((roleId: string) => roleNameMap.get(roleId) ?? roleId),
			success: result.success,
			errorMessage: result.errorMessage,
			warningMessages: guildData?.temporaryRoleSourceUnavailable
				? [
						'Temporary role assignments could not be checked; configured managed roles were preserved.',
					]
				: [],
		}
	})

	const totalUpdated = results.filter((r) => r.success).length
	const totalFailed = results.filter((r) => !r.success).length

	return {
		results,
		totalUpdated,
		totalFailed,
	}
}

export interface DiscordRoleInspectionItem {
	roleId: string
	roleName: string | null
	nameSource: 'discord' | 'configured' | 'unknown'
}

export interface DiscordGuildAccessInspection {
	guildId: string
	guildName: string
	isMember: boolean
	membershipError?: string
	temporaryRoleSourceUnavailable?: boolean
	expectedManagedRoles: DiscordRoleInspectionItem[]
	currentManagedRoles: DiscordRoleInspectionItem[]
	currentUnmanagedRoles: DiscordRoleInspectionItem[]
	missingExpectedManagedRoles: DiscordRoleInspectionItem[]
	unexpectedManagedRoles: DiscordRoleInspectionItem[]
}

export interface UserDiscordAccessInspectionResult {
	userId: string
	discordUserId: string
	inspectedAt: string
	guilds: DiscordGuildAccessInspection[]
	summary: {
		guildsInspected: number
		memberGuilds: number
		guildsWithDrift: number
		totalMissingExpectedManagedRoles: number
		totalUnexpectedManagedRoles: number
		totalUnmanagedCurrentRoles: number
	}
}

/**
 * Inspect a user's Discord access state per guild without mutating roles.
 * Compares current guild roles to expected managed roles and surfaces drift.
 */
export async function inspectUserDiscordAccess(
	env: Env,
	userId: string
): Promise<UserDiscordAccessInspectionResult> {
	const db = createDb(env.DATABASE_URL)

	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { id: true, discordUserId: true },
	})

	if (!user) {
		throw new Error('User not found')
	}

	if (!user.discordUserId) {
		throw new Error('Discord account not linked')
	}

	const hrStub = getStub<Hr>(env.HR, 'default')
	const isBlacklisted = await hrStub.isUserBlacklisted(userId)
	const discordStub = getDiscordStub(env)
	const discordStatus = await discordStub.getDiscordUserStatus(userId)
	const isAuthorizationRevoked = discordStatus?.authRevoked ?? false

	const knownServers = await db.query.discordServers.findMany({
		where: eq(discordServers.isActive, true),
		columns: { id: true, guildId: true, guildName: true },
	})

	if (knownServers.length === 0) {
		return {
			userId,
			discordUserId: user.discordUserId,
			inspectedAt: new Date().toISOString(),
			guilds: [],
			summary: {
				guildsInspected: 0,
				memberGuilds: 0,
				guildsWithDrift: 0,
				totalMissingExpectedManagedRoles: 0,
				totalUnexpectedManagedRoles: 0,
				totalUnmanagedCurrentRoles: 0,
			},
		}
	}

	const knownGuildIds = knownServers.map((server) => server.guildId)
	const serverByDbId = new Map(knownServers.map((server) => [server.id, server]))
	const serverByGuildId = new Map(knownServers.map((server) => [server.guildId, server]))
	let expectedRoleIdsByGuild = new Map<string, Set<string>>()

	const membershipDetails = await discordStub.getUserGuildMembershipDetails(userId, knownGuildIds)
	const membershipByGuild = new Map(
		membershipDetails.map((detail) => [detail.guildId, detail] as const)
	)

	if (!isBlacklisted && !isAuthorizationRevoked) {
		expectedRoleIdsByGuild = await getExpectedManagedRoleIdsByGuild(env, userId)
	}

	// Only inspect guilds the user is actually in. Non-member guilds are intentionally
	// suppressed from the access inspection view.
	const inspectGuildIds = new Set<string>()
	for (const guildId of knownGuildIds) {
		const member = membershipByGuild.get(guildId)
		if (member?.isMember) {
			inspectGuildIds.add(guildId)
		}
	}

	const managedRoleCache = new Map<string, string[]>()
	const managedRoleIdsByGuild = new Map<string, Set<string>>()
	for (const guildId of inspectGuildIds) {
		const managedRoleIds = await getAllManagedRolesForGuild(db, env, guildId, managedRoleCache)
		managedRoleIdsByGuild.set(guildId, new Set(managedRoleIds))
	}
	const temporaryRoleState = await getTemporaryRoleIdsByGuild(
		db,
		env,
		Array.from(inspectGuildIds),
		userId
	)
	for (const [guildId, roleIds] of temporaryRoleState.activeRoleIdsByGuild) {
		const managedRoleIds = managedRoleIdsByGuild.get(guildId) ?? new Set<string>()
		for (const roleId of roleIds) managedRoleIds.add(roleId)
		managedRoleIdsByGuild.set(guildId, managedRoleIds)
	}
	for (const [guildId, roleIds] of temporaryRoleState.cleanupRoleIdsByGuild) {
		const managedRoleIds = managedRoleIdsByGuild.get(guildId) ?? new Set<string>()
		for (const roleId of roleIds) managedRoleIds.add(roleId)
		managedRoleIdsByGuild.set(guildId, managedRoleIds)
	}

	// Configured role-name lookup by guild for best-effort naming of expected/stale roles.
	const inspectServerDbIds = Array.from(inspectGuildIds)
		.map((guildId) => serverByGuildId.get(guildId)?.id)
		.filter((id): id is string => !!id)
	const configuredRoleNamesByGuild = new Map<string, Map<string, string>>()
	if (inspectServerDbIds.length > 0) {
		const configuredRoles = await db.query.discordRoles.findMany({
			where: inArray(discordRoles.discordServerId, inspectServerDbIds),
			columns: { discordServerId: true, roleId: true, roleName: true },
		})
		for (const role of configuredRoles) {
			const server = serverByDbId.get(role.discordServerId)
			if (!server) continue
			const byRoleId = configuredRoleNamesByGuild.get(server.guildId) ?? new Map<string, string>()
			byRoleId.set(role.roleId, role.roleName)
			configuredRoleNamesByGuild.set(server.guildId, byRoleId)
		}
	}

	const discordRoleNamesByGuild = new Map<string, Map<string, string>>()
	for (const detail of membershipDetails) {
		const byRoleId = new Map<string, string>()
		for (const role of detail.currentRoles) {
			if (role.roleName) byRoleId.set(role.roleId, role.roleName)
		}
		discordRoleNamesByGuild.set(detail.guildId, byRoleId)
	}

	const toRoleItems = (guildId: string, roleIds: string[]): DiscordRoleInspectionItem[] => {
		const uniqueRoleIds = Array.from(new Set(roleIds))
		const discordNames = discordRoleNamesByGuild.get(guildId) ?? new Map<string, string>()
		const configuredNames = configuredRoleNamesByGuild.get(guildId) ?? new Map<string, string>()

		return uniqueRoleIds
			.map((roleId) => {
				const discordName = discordNames.get(roleId)
				if (discordName) {
					return {
						roleId,
						roleName: discordName,
						nameSource: 'discord' as const,
					}
				}

				const configuredName = configuredNames.get(roleId)
				if (configuredName) {
					return {
						roleId,
						roleName: configuredName,
						nameSource: 'configured' as const,
					}
				}

				return {
					roleId,
					roleName: null,
					nameSource: 'unknown' as const,
				}
			})
			.sort((a, b) => (a.roleName || a.roleId).localeCompare(b.roleName || b.roleId))
	}

	const guilds: DiscordGuildAccessInspection[] = []
	for (const guildId of inspectGuildIds) {
		const server = serverByGuildId.get(guildId)
		if (!server) continue

		const membership = membershipByGuild.get(guildId)
		const isMember = membership?.isMember ?? false
		const expectedRoleIds = Array.from(expectedRoleIdsByGuild.get(guildId) ?? [])
		const currentRoleIds = membership?.currentRoleIds ?? []
		const managedRoleIds = managedRoleIdsByGuild.get(guildId) ?? new Set<string>()

		const currentRoleSet = new Set(currentRoleIds)
		const expectedRoleSet = new Set(expectedRoleIds)

		const currentManagedRoleIds = currentRoleIds.filter((roleId) => managedRoleIds.has(roleId))
		const currentUnmanagedRoleIds = currentRoleIds.filter((roleId) => !managedRoleIds.has(roleId))
		const missingExpectedRoleIds = isMember
			? expectedRoleIds.filter((roleId) => !currentRoleSet.has(roleId))
			: []
		const unexpectedManagedRoleIds = isMember
			? currentManagedRoleIds.filter((roleId) => !expectedRoleSet.has(roleId))
			: []

		guilds.push({
			guildId,
			guildName: server.guildName,
			isMember,
			membershipError: membership?.errorMessage,
			temporaryRoleSourceUnavailable: temporaryRoleState.failedGuildIds.has(guildId),
			expectedManagedRoles: toRoleItems(guildId, expectedRoleIds),
			currentManagedRoles: toRoleItems(guildId, currentManagedRoleIds),
			currentUnmanagedRoles: toRoleItems(guildId, currentUnmanagedRoleIds),
			missingExpectedManagedRoles: toRoleItems(guildId, missingExpectedRoleIds),
			unexpectedManagedRoles: toRoleItems(guildId, unexpectedManagedRoleIds),
		})
	}
	guilds.sort((a, b) => a.guildName.localeCompare(b.guildName))

	const memberGuilds = guilds.filter((guild) => guild.isMember).length
	const memberGuildRows = guilds.filter((guild) => guild.isMember)
	const guildsWithDrift = memberGuildRows.filter(
		(guild) =>
			guild.missingExpectedManagedRoles.length > 0 || guild.unexpectedManagedRoles.length > 0
	).length
	const totalMissingExpectedManagedRoles = memberGuildRows.reduce(
		(total, guild) => total + guild.missingExpectedManagedRoles.length,
		0
	)
	const totalUnexpectedManagedRoles = memberGuildRows.reduce(
		(total, guild) => total + guild.unexpectedManagedRoles.length,
		0
	)
	const totalUnmanagedCurrentRoles = memberGuildRows.reduce(
		(total, guild) => total + guild.currentUnmanagedRoles.length,
		0
	)

	return {
		userId,
		discordUserId: user.discordUserId,
		inspectedAt: new Date().toISOString(),
		guilds,
		summary: {
			guildsInspected: guilds.length,
			memberGuilds,
			guildsWithDrift,
			totalMissingExpectedManagedRoles,
			totalUnexpectedManagedRoles,
			totalUnmanagedCurrentRoles,
		},
	}
}

/**
 * Helper function that performs both invite and role update operations
 * Combines the results from both operations into a single response
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Combined results from both operations
 */
export async function syncUserDiscordAccess(
	env: Env,
	userId: string,
	allowRemoval?: boolean,
	hardStripAllRoles?: boolean
): Promise<{
	results: Array<{
		guildId: string
		guildName: string
		corporationName?: string
		groupName?: string
		success: boolean
		errorMessage?: string
		alreadyMember?: boolean
		type?: 'corporation' | 'group'
		operation?: 'invite' | 'update' | 'revoke-ban'
		attemptedRoleIds?: string[]
		attemptedRoleNames?: string[]
		rolesAdded?: string[]
		roleNamesAdded?: string[]
		rolesRemoved?: string[]
		roleNamesRemoved?: string[]
	}>
	totalInvited: number
	totalUpdated: number
	totalFailed: number
}> {
	// Check if user is blacklisted early for efficiency
	const hrStub = getStub<Hr>(env.HR, 'default')
	const isBlacklisted = await hrStub.isUserBlacklisted(userId)

	if (isBlacklisted) {
		logger.warn('[Discord] Enforcing Discord access revocation for blacklisted user', {
			userId,
		})
		return enforceBlacklistedDiscordAccess(env, userId, 'User is blacklisted')
	}

	// First invite to new servers
	logger.info('[Discord] syncUserDiscordAccess: Starting invitation process', { userId })
	const inviteResult = await inviteUserToDiscordServers(env, userId)
	logger.info('[Discord] syncUserDiscordAccess: Invitation process completed', {
		userId,
		totalInvited: inviteResult.totalInvited,
		totalFailed: inviteResult.totalFailed,
		resultsCount: inviteResult.results.length,
	})

	// Then update roles on all servers
	logger.info('[Discord] syncUserDiscordAccess: Starting role update process', { userId })
	const updateResult = await updateUserDiscordRoles(
		env,
		userId,
		undefined,
		allowRemoval,
		hardStripAllRoles
	)
	logger.info('[Discord] syncUserDiscordAccess: Role update process completed', {
		userId,
		totalUpdated: updateResult.totalUpdated,
		totalFailed: updateResult.totalFailed,
		resultsCount: updateResult.results.length,
	})

	// Update last refreshed timestamp after successful sync
	try {
		const discordStub = getDiscordStub(env)
		await discordStub.updateLastRefreshed(userId)
		logger.debug('[Discord] Updated lastRefreshed timestamp', {
			userId,
		})
	} catch (error) {
		// Log error but don't fail the sync operation
		logger.error('[Discord] Failed to update lastRefreshed timestamp', {
			userId,
			error: error instanceof Error ? error.message : String(error),
		})
	}

	// Combine results from both operations
	const combinedResults = [
		...inviteResult.results.map((r) => ({ ...r, operation: 'invite' as const })),
		...updateResult.results.map((r) => ({ ...r, operation: 'update' as const })),
	]

	return {
		results: combinedResults,
		totalInvited: inviteResult.totalInvited,
		totalUpdated: updateResult.totalUpdated,
		totalFailed: inviteResult.totalFailed + updateResult.totalFailed,
	}
}

/**
 * Enforce Discord revocation for blacklisted users across all active managed guilds.
 * Clears roles and bans via Discord DO.
 */
export async function enforceBlacklistedDiscordAccess(
	env: Env,
	userId: string,
	reason?: string
): Promise<{
	results: Array<{
		guildId: string
		guildName: string
		success: boolean
		errorMessage?: string
		operation?: 'revoke-ban'
	}>
	totalInvited: number
	totalUpdated: number
	totalFailed: number
}> {
	const db = createDb(env.DATABASE_URL)
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { discordUserId: true },
	})

	if (!user?.discordUserId) {
		return {
			results: [],
			totalInvited: 0,
			totalUpdated: 0,
			totalFailed: 0,
		}
	}

	const servers = await db.query.discordServers.findMany({
		where: eq(discordServers.isActive, true),
		columns: { guildId: true, guildName: true },
	})
	const guildIds = servers.map((s) => s.guildId)

	if (guildIds.length === 0) {
		return {
			results: [],
			totalInvited: 0,
			totalUpdated: 0,
			totalFailed: 0,
		}
	}

	const discordStub = getDiscordStub(env)
	const membershipGuildIds = await discordStub.checkGuildMembershipWithBot(userId, guildIds)
	if (membershipGuildIds.length === 0) {
		return {
			results: [],
			totalInvited: 0,
			totalUpdated: 0,
			totalFailed: 0,
		}
	}

	const guildNameById = new Map(servers.map((s) => [s.guildId, s.guildName]))
	const revokeResults = await discordStub.revokeAccessAndBan(userId, membershipGuildIds, reason)

	const results = revokeResults.map((item) => ({
		guildId: item.guildId,
		guildName: guildNameById.get(item.guildId) ?? item.guildId,
		success: item.success,
		errorMessage: item.errorMessage,
		operation: 'revoke-ban' as const,
	}))

	return {
		results,
		totalInvited: 0,
		totalUpdated: revokeResults.filter((r) => r.success).length,
		totalFailed: revokeResults.filter((r) => !r.success).length,
	}
}

/**
 * Enforce Discord role stripping for users with revoked Discord authorization.
 * Removes managed roles across all active managed guilds but does not ban.
 */
export async function enforceRevokedAuthorizationDiscordAccess(
	env: Env,
	userId: string
): Promise<{
	results: Array<{
		guildId: string
		guildName: string
		rolesAdded: string[]
		rolesRemoved: string[]
		success: boolean
		errorMessage?: string
	}>
	totalUpdated: number
	totalFailed: number
}> {
	return updateUserDiscordRoles(env, userId, undefined, true)
}

/**
 * Update Discord nickname only for servers with manageNicknames enabled
 * This is a lightweight operation that only updates the user's display name
 * @param env - Worker environment
 * @param userId - Core user ID
 */
export async function updateUserDiscordNickname(
	env: Env,
	userId: string,
	guildIds?: string[]
): Promise<void> {
	const db = createDb(env.DATABASE_URL)

	// Get user
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
	})

	if (!user || !user.discordUserId) {
		return // User doesn't have Discord linked
	}

	// Resolve the ticker prefix from the primary character and configured attachment buckets.
	const primaryCharacter = await getPrimaryCharacterTickerSources(db, env, userId)
	if (!primaryCharacter) {
		return // No primary character set
	}

	// Get all servers with nickname management enabled.
	// When guildIds are provided, only inspect that subset.
	const serverSettings = await db.query.discordServers.findMany({
		where:
			guildIds && guildIds.length > 0
				? and(
						eq(discordServers.manageNicknames, true),
						eq(discordServers.isActive, true),
						inArray(discordServers.guildId, guildIds)
					)
				: and(eq(discordServers.manageNicknames, true), eq(discordServers.isActive, true)),
		columns: { id: true, guildId: true },
	})

	if (serverSettings.length === 0) {
		return // No servers have nickname management enabled
	}

	const candidateGuildIds = serverSettings.map((s) => s.guildId)

	// Use bot token to check which servers the user is a member of
	const discordStub = getDiscordStub(env)
	const userGuildIds = await discordStub.checkGuildMembershipWithBot(userId, candidateGuildIds)

	if (userGuildIds.length === 0) {
		return // User is not in any Discord servers with nickname management
	}

	const activeServerSettings = serverSettings.filter((server) =>
		userGuildIds.includes(server.guildId)
	)
	if (activeServerSettings.length === 0) {
		return
	}

	const corpAttachments = await db.query.corporationDiscordServers.findMany({
		where: inArray(
			corporationDiscordServers.discordServerId,
			activeServerSettings.map((server) => server.id)
		),
		columns: { corporationId: true, discordServerId: true },
		with: {
			corporation: {
				columns: { isMemberCorporation: true },
			},
			nicknameConfigs: {
				columns: { bucket: true, enabled: true, source: true, customTicker: true },
			},
		},
	})

	const nicknameToGuildIds = new Map<string, string[]>()
	for (const server of activeServerSettings) {
		const prefixes = new Set<string>()
		const attachmentsForServer = corpAttachments.filter(
			(attachment) => attachment.discordServerId === server.id
		)

		for (const attachment of attachmentsForServer) {
			const isCorpMember =
				attachment.corporation.isMemberCorporation &&
				attachment.corporationId === primaryCharacter.primaryCharacterCorporationId
			const prefix = resolveAttachmentNicknamePrefix(
				attachment as CorporationDiscordNicknameFields,
				isCorpMember,
				Boolean(primaryCharacter.primaryCharacterAllianceId),
				primaryCharacter.tickerSources
			)

			if (prefix) {
				prefixes.add(prefix)
			}
		}

		const nickname = buildDiscordNicknameWithTickerPrefixes(
			primaryCharacter.primaryCharacterName,
			Array.from(prefixes)
		)
		const existingGuildIds = nicknameToGuildIds.get(nickname) ?? []
		existingGuildIds.push(server.guildId)
		nicknameToGuildIds.set(nickname, existingGuildIds)
	}

	// Update nickname on each guild, grouping guilds that share the same resolved nickname.
	for (const [nickname, guildIdGroup] of nicknameToGuildIds.entries()) {
		await discordStub.updateUserNickname(userId, guildIdGroup, nickname)
	}

	logger.info('[Discord] Updated user nickname', {
		userId,
		discordUserId: user.discordUserId,
		nicknameGroups: Array.from(nicknameToGuildIds.entries()).map(
			([resolvedNickname, guildIdGroup]) => ({
				nickname: resolvedNickname,
				guildIds: guildIdGroup,
			})
		),
		serverCount: serverSettings.length,
	})
}

/**
 * Calculate which roles a user should have on a specific Discord server
 * Based on their corporation and group memberships
 * @param db - Database client
 * @param env - Worker environment
 * @param userId - Core user ID
 * @param serverId - Discord server DB ID
 * @returns Array of Discord role IDs the user should have
 */
async function calculateUserRolesForServer(
	db: ReturnType<typeof createDb>,
	env: Env,
	userId: string,
	serverId: string
): Promise<string[]> {
	const hrStub = getStub<Hr>(env.HR, 'default')
	const isBlacklisted = await hrStub.isUserBlacklisted(userId)
	if (isBlacklisted) {
		return []
	}
	const discordStub = getDiscordStub(env)
	const discordStatus = await discordStub.getDiscordUserStatus(userId)
	if (discordStatus?.authRevoked) {
		return []
	}

	const roleIds = new Set<string>()

	// Get user's characters
	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
	})
	const characterIds = userChars.map((c) => c.characterId)

	if (characterIds.length === 0) {
		return []
	}

	// Get user's corporation IDs
	const userCorporationIds = await getUserCorporationIds(env, characterIds)
	const userAllianceMemberCorporationIds = await getUserAllianceMemberCorporationIds(
		db,
		userCorporationIds
	)
	const isAllianceMember = userAllianceMemberCorporationIds.size > 0

	// === CORPORATION ROLES ===
	const corpAttachments = await db.query.corporationDiscordServers.findMany({
		where: eq(corporationDiscordServers.discordServerId, serverId),
		columns: { corporationId: true, autoAssignRoles: true },
		with: {
			corporation: {
				columns: { isMemberCorporation: true },
			},
			roles: {
				with: {
					discordRole: true,
				},
			},
			scenarioRoles: {
				columns: { bucket: true, discordRoleId: true, autoApply: true },
			},
		},
	})

	const scenarioRoleDbIds = new Set<string>()
	for (const attachment of corpAttachments) {
		for (const roleDbId of getScenarioManagedRoleDbIds(attachment)) {
			scenarioRoleDbIds.add(roleDbId)
		}
	}

	let scenarioRoleIdByDbId = new Map<string, string>()
	if (scenarioRoleDbIds.size > 0) {
		const scenarioRoles = await db.query.discordRoles.findMany({
			where: and(
				inArray(discordRoles.id, Array.from(scenarioRoleDbIds)),
				eq(discordRoles.isActive, true)
			),
			columns: { id: true, roleId: true },
		})
		scenarioRoleIdByDbId = new Map(scenarioRoles.map((role) => [role.id, role.roleId]))
	}

	for (const attachment of corpAttachments) {
		const isCorpMember = userCorporationIds.has(attachment.corporationId)
		const { roleId: scenarioRoleId } = resolveScenarioRoleId(
			attachment,
			isCorpMember,
			isAllianceMember,
			attachment.corporation.isMemberCorporation,
			scenarioRoleIdByDbId
		)

		if (isCorpMember && attachment.autoAssignRoles) {
			for (const roleAssignment of attachment.roles) {
				if (roleAssignment.discordRole.isActive) {
					roleIds.add(roleAssignment.discordRole.roleId)
				}
			}
		}

		if (scenarioRoleId) {
			roleIds.add(scenarioRoleId)
		}
	}

	// === GROUP ROLES ===
	try {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')

		// Get groups attached to this server
		const groupsWithServer = await groupsStub.getGroupsByDiscordServer(serverId)

		for (const groupAttachment of groupsWithServer) {
			const membership = await getGroupMembershipFlags(groupsStub, groupAttachment.groupId, userId)

			if ((membership.isMember || membership.isOwnerAdmin) && groupAttachment.autoAssignRoles) {
				// Get roles for this group attachment
				try {
					const attachmentConfig = await groupsStub.getDiscordServerAttachmentConfig(
						groupAttachment.id
					)
					for (const roleId of membership.isMember
						? getGroupMemberRoleDbIds(attachmentConfig)
						: []) {
						roleIds.add(roleId)
					}
					for (const roleId of membership.isOwnerAdmin
						? getGroupOwnerAdminRoleDbIds(attachmentConfig)
						: []) {
						roleIds.add(roleId)
					}
				} catch (e) {
					// Attachment config not found, skip
					logger.debug('[Discord] Could not get group attachment config', {
						attachmentId: groupAttachment.id,
						error: String(e),
					})
				}
			}
		}
	} catch (error) {
		logger.error('[Discord] Error fetching group roles for server', {
			userId,
			serverId,
			error: String(error),
		})
	}

	// === AUTO-APPLY ROLES ===
	const autoApplyRoles = await db.query.discordRoles.findMany({
		where: and(
			eq(discordRoles.discordServerId, serverId),
			eq(discordRoles.autoApply, true),
			eq(discordRoles.isActive, true)
		),
	})

	for (const role of autoApplyRoles) {
		roleIds.add(role.roleId)
	}

	return Array.from(roleIds)
}

/**
 * Refresh all members for a specific Discord server
 * For each user: invite -> set nickname -> set roles
 * @param env - Worker environment
 * @param serverId - Discord server DB ID
 * @param userIds - Array of core user IDs to process
 * @returns Results for each user processed
 */
export async function refreshServerMembers(
	env: Env,
	serverId: string,
	userIds: string[]
): Promise<{
	results: Array<{
		userId: string
		userName: string
		success: boolean
		errorMessage?: string
	}>
	successCount: number
	failCount: number
}> {
	const db = createDb(env.DATABASE_URL)
	const discordStub = getDiscordStub(env)

	// Get server info
	const server = await db.query.discordServers.findFirst({
		where: eq(discordServers.id, serverId),
	})

	if (!server) {
		throw new Error('Discord server not found')
	}

	logger.info('[Discord] refreshServerMembers: Starting refresh', {
		serverId,
		guildId: server.guildId,
		guildName: server.guildName,
		userCount: userIds.length,
		manageNicknames: server.manageNicknames,
	})

	const results: Array<{
		userId: string
		userName: string
		success: boolean
		errorMessage?: string
	}> = []
	let successCount = 0
	let failCount = 0

	for (const userId of userIds) {
		try {
			// Get user's primary character for nickname
			const primaryChar = await db.query.userCharacters.findFirst({
				where: and(eq(userCharacters.userId, userId), eq(userCharacters.is_primary, true)),
			})
			const nickname = primaryChar?.characterName || 'Unknown'

			// Calculate roles for this user on this server
			const roleIds = await calculateUserRolesForServer(db, env, userId, serverId)

			logger.debug('[Discord] refreshServerMembers: Processing user', {
				userId,
				nickname,
				roleCount: roleIds.length,
				manageNicknames: server.manageNicknames,
			})

			// 1. INVITE to the specific server
			const joinResults = await discordStub.joinUserToServers(userId, [server.guildId])
			const joinResult = joinResults[0]

			if (!joinResult?.success) {
				failCount++
				results.push({
					userId,
					userName: nickname,
					success: false,
					errorMessage: joinResult?.errorMessage || 'Failed to invite',
				})
				continue
			}

			// 2. SET NICKNAME (before roles)
			if (server.manageNicknames && nickname && nickname !== 'Unknown') {
				logger.debug('[Discord] refreshServerMembers: Setting nickname', {
					userId,
					nickname,
					guildId: server.guildId,
				})
				await updateUserDiscordNickname(env, userId, [server.guildId])
			}

			// 3. SET ROLES (after nickname)
			if (roleIds.length > 0) {
				const managedRoleIds = await getAllManagedRolesForGuild(db, env, server.guildId)
				logger.debug('[Discord] refreshServerMembers: Setting roles', {
					userId,
					roleCount: roleIds.length,
					managedRoleCount: managedRoleIds.length,
				})
				await discordStub.updateUserRoles(userId, [
					{
						guildId: server.guildId,
						roleIds,
						managedRoleIds,
					},
				])
			}

			successCount++
			results.push({
				userId,
				userName: nickname,
				success: true,
			})

			logger.debug('[Discord] refreshServerMembers: User processed successfully', {
				userId,
				nickname,
			})
		} catch (error) {
			failCount++
			logger.error('[Discord] refreshServerMembers: Error processing user', {
				userId,
				error: String(error),
			})
			results.push({
				userId,
				userName: 'Unknown',
				success: false,
				errorMessage: error instanceof Error ? error.message : 'Unknown error',
			})
		}
	}

	logger.info('[Discord] refreshServerMembers: Completed', {
		serverId,
		guildName: server.guildName,
		successCount,
		failCount,
		totalProcessed: userIds.length,
	})

	return { results, successCount, failCount }
}
