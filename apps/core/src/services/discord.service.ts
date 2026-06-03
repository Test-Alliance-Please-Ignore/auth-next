import { and, eq, inArray } from '@repo/db-utils'
import { getDiscordStub } from '@repo/discord'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import {
	corporationDiscordServers,
	discordRoles,
	discordServers,
	oauthStates,
	userCharacters,
	users,
} from '../db/schema'

import type { Discord, DiscordProfile, JoinServerResult } from '@repo/discord'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Groups } from '@repo/groups'
import type { Hr } from '@repo/hr'
import type { Env } from '../context'

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

	// Query 2: Corporation-managed roles
	// Uses: corp_discord_servers_server_auto_assign_idx (new index)
	const corpAttachments = await db.query.corporationDiscordServers.findMany({
		where: and(
			eq(corporationDiscordServers.discordServerId, discordServerId),
			eq(corporationDiscordServers.autoAssignRoles, true)
		),
		columns: { id: true },
		with: {
			roles: {
				with: {
					discordRole: {
						columns: { roleId: true, isActive: true },
					},
				},
			},
		},
	})

	for (const attachment of corpAttachments) {
		for (const roleAssignment of attachment.roles) {
			// Only include active roles
			if (roleAssignment.discordRole.isActive) {
				managedRoleIds.add(roleAssignment.discordRole.roleId)
			}
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
				groupDiscordRoleIds.push(...config.roleIds)
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

	const knownServerDbIds = knownServers.map((server) => server.id)
	const serverByDbId = new Map(knownServers.map((server) => [server.id, server]))

	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
		columns: { characterId: true },
	})
	const characterIds = userChars.map((char) => char.characterId)
	const userCorporationIds = await getUserCorporationIds(env, characterIds)

	const corpAttachments =
		userCorporationIds.size > 0 && knownServerDbIds.length > 0
			? await db.query.corporationDiscordServers.findMany({
					where: and(
						inArray(corporationDiscordServers.corporationId, Array.from(userCorporationIds)),
						inArray(corporationDiscordServers.discordServerId, knownServerDbIds)
					),
					with: {
						discordServer: true,
						roles: {
							with: {
								discordRole: true,
							},
						},
					},
				})
			: []

	const userEntitledGuildIds = new Set<string>()
	for (const attachment of corpAttachments) {
		if (!attachment.discordServer.isActive) continue

		const guildId = attachment.discordServer.guildId
		userEntitledGuildIds.add(guildId)

		if (!attachment.autoAssignRoles) continue

		const expectedSet = ensureExpectedSet(guildId)
		for (const roleAssignment of attachment.roles) {
			if (roleAssignment.discordRole.isActive) {
				expectedSet.add(roleAssignment.discordRole.roleId)
			}
		}
	}

	const corpGatedGuildIds = new Set<string>()
	if (knownServerDbIds.length > 0) {
		const corpGatedRecords = await db.query.corporationDiscordServers.findMany({
			where: inArray(corporationDiscordServers.discordServerId, knownServerDbIds),
			columns: { discordServerId: true },
		})
		for (const record of corpGatedRecords) {
			const server = serverByDbId.get(record.discordServerId)
			if (server) {
				corpGatedGuildIds.add(server.guildId)
			}
		}
	}

	try {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')
		const groupsWithDiscord = await groupsStub.getGroupsWithDiscordAutoInvite()

		const pendingGroupRoleLookups: Array<{ guildId: string; roleDbIds: string[] }> = []
		const groupRoleDbIds = new Set<string>()

		for (const group of groupsWithDiscord) {
			const memberUserIds = await groupsStub.getGroupMemberUserIds(group.groupId)
			const isMember = memberUserIds.includes(userId)
			if (!isMember) continue

			for (const attachment of group.discordServers) {
				if (!attachment.autoAssignRoles) continue

				const server = serverByDbId.get(attachment.discordServerId)
				if (!server) continue

				const isCorpGatedWithoutEntitlement =
					corpGatedGuildIds.has(server.guildId) && !userEntitledGuildIds.has(server.guildId)
				if (isCorpGatedWithoutEntitlement) continue

				const roleDbIds = attachment.roleIds ?? []
				pendingGroupRoleLookups.push({
					guildId: server.guildId,
					roleDbIds,
				})
				for (const roleDbId of roleDbIds) {
					groupRoleDbIds.add(roleDbId)
				}
			}
		}

		let roleIdByDbId = new Map<string, string>()
		const uniqueGroupRoleDbIds = Array.from(groupRoleDbIds)
		if (uniqueGroupRoleDbIds.length > 0) {
			const roleRows = await db.query.discordRoles.findMany({
				where: and(
					inArray(discordRoles.id, uniqueGroupRoleDbIds),
					eq(discordRoles.isActive, true)
				),
				columns: { id: true, roleId: true },
			})
			roleIdByDbId = new Map(roleRows.map((row) => [row.id, row.roleId]))
		}

		for (const lookup of pendingGroupRoleLookups) {
			const expectedSet = ensureExpectedSet(lookup.guildId)
			for (const roleDbId of lookup.roleDbIds) {
				const resolvedRoleId = roleIdByDbId.get(roleDbId)
				if (resolvedRoleId) {
					expectedSet.add(resolvedRoleId)
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

	// === CHECK CORPORATIONS (ONLY autoInvite=true) ===
	// Only fetch attachments for corporations the user is actually in
	const corpAttachments =
		userCorporationIds.size > 0
			? await db.query.corporationDiscordServers.findMany({
					where: and(
						eq(corporationDiscordServers.autoInvite, true), // ONLY auto-invite servers
						inArray(corporationDiscordServers.corporationId, Array.from(userCorporationIds))
					),
					with: {
						corporation: true,
						discordServer: true,
						roles: {
							with: {
								discordRole: true,
							},
						},
					},
				})
			: []

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

	// Add corporation attachments - no need to check membership, we already filtered by corporation ID
	for (const attachment of activeCorpAttachments) {
		// User is definitely a member since we filtered attachments by their corporation IDs
		// Collect role IDs if auto-assign is enabled
		const roleIds = attachment.autoAssignRoles
			? attachment.roles
					.filter((r) => r.discordRole.isActive) // SECURITY: Only active roles
					.map((r) => r.discordRole.roleId)
			: []

		logger.debug('[Discord] inviteUserToDiscordServers: Adding corporation guild to join', {
			userId,
			guildId: attachment.discordServer.guildId,
			guildName: attachment.discordServer.guildName,
			corporationId: attachment.corporationId,
			corporationName: attachment.corporation.name,
			roleIds,
			roleCount: roleIds.length,
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
				const memberUserIds = await groupsStub.getGroupMemberUserIds(group.groupId)
				const isMember = memberUserIds.includes(userId)

				logger.debug('[Discord] inviteUserToDiscordServers: Checking group membership', {
					userId,
					groupId: group.groupId,
					groupName: group.groupName,
					isMember,
					memberCount: memberUserIds.length,
				})

				if (isMember) {
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
							let actualRoleIds: string[] = []

							if (
								discordServer.roleIds &&
								discordServer.roleIds.length > 0 &&
								discordServer.autoAssignRoles
							) {
								const roleRecords = await db.query.discordRoles.findMany({
									where: and(
										inArray(discordRoles.id, discordServer.roleIds),
										eq(discordRoles.isActive, true)
									),
								})
								actualRoleIds = roleRecords.map((r) => r.roleId)
							}

							logger.debug('[Discord] inviteUserToDiscordServers: Adding group guild to join', {
								userId,
								guildId: serverInfo.guildId,
								guildName: serverInfo.guildName,
								groupId: group.groupId,
								groupName: group.groupName,
								roleIds: actualRoleIds,
								roleCount: actualRoleIds.length,
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

	if (guildsForNicknameUpdate.length > 0 && primaryCharacterName) {
		logger.info('[Discord] inviteUserToDiscordServers: Updating nicknames', {
			userId,
			guilds: guildsForNicknameUpdate,
			nickname: primaryCharacterName,
		})
		await discordStub.updateUserNickname(userId, guildsForNicknameUpdate, primaryCharacterName)
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
			sources: Array<{ type: 'corporation' | 'group' | 'auto-apply'; name: string }>
		}
	>()

	// Initialize map with empty role sets
	for (const guildId of serversToUpdate) {
		rolesByGuild.set(guildId, {
			guildId,
			guildName: guildId, // Will be updated if we find the name
			expectedRoleIds: [],
			sources: [],
		})
	}

	if (!isAuthorizationRevoked) {
		// Get all user's characters
		const userChars = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		const characterIds = userChars.map((char) => char.characterId)

		if (characterIds.length === 0) {
			return {
				results: [],
				totalUpdated: 0,
				totalFailed: 0,
			}
		}

		// === CHECK CORPORATION ROLES (all attachments, not just auto-invite) ===
		// Get user's corporation IDs first to filter efficiently
		const userCorporationIds = await getUserCorporationIds(env, characterIds)

		// Only fetch attachments for corporations the user is actually in
		const corpAttachments =
			userCorporationIds.size > 0
				? await db.query.corporationDiscordServers.findMany({
						where: inArray(corporationDiscordServers.corporationId, Array.from(userCorporationIds)),
						with: {
							corporation: true,
							discordServer: true,
							roles: {
								with: {
									discordRole: true,
								},
							},
						},
					})
				: []

		// Filter to only active Discord servers in the servers we're updating
		const relevantCorpAttachments = corpAttachments.filter(
			(attachment) =>
				attachment.discordServer.isActive &&
				serversToUpdate.includes(attachment.discordServer.guildId)
		)

		for (const attachment of relevantCorpAttachments) {
			// User is definitely a member since we filtered attachments by their corporation IDs
			if (attachment.autoAssignRoles) {
				const roleIds = attachment.roles
					.filter((r) => r.discordRole.isActive) // SECURITY: Only active roles
					.map((r) => r.discordRole.roleId)

				const guildData = rolesByGuild.get(attachment.discordServer.guildId)
				if (guildData) {
					guildData.expectedRoleIds.push(...roleIds)
					guildData.sources.push({
						type: 'corporation',
						name: attachment.corporation.name,
					})
					guildData.guildName = attachment.discordServer.guildName
				}
			}
		}

		// Track guilds where this user has valid corp/alliance entitlement
		const userEntitledGuildIds = new Set<string>(
			relevantCorpAttachments.map((a) => a.discordServer.guildId)
		)

		// Determine which of the target guilds are corp-gated (have ANY corp attachment, not just the user's).
		// Group roles are not granted on corp-gated guilds where the user has no corp/alliance entitlement —
		// losing corp access should also remove group roles on that guild.
		const targetServerRecords = await db.query.discordServers.findMany({
			where: and(inArray(discordServers.guildId, serversToUpdate), eq(discordServers.isActive, true)),
			columns: { id: true, guildId: true },
		})
		const dbIdToGuildId = new Map(targetServerRecords.map((s) => [s.id, s.guildId]))
		const targetServerDbIds = targetServerRecords.map((s) => s.id)

		const corpGatedGuildIds = new Set<string>()
		if (targetServerDbIds.length > 0) {
			const corpGatedRecords = await db.query.corporationDiscordServers.findMany({
				where: inArray(corporationDiscordServers.discordServerId, targetServerDbIds),
				columns: { discordServerId: true },
			})
			for (const record of corpGatedRecords) {
				const guildId = dbIdToGuildId.get(record.discordServerId)
				if (guildId) corpGatedGuildIds.add(guildId)
			}
		}

		// === CHECK GROUP ROLES (all attachments, not just auto-invite) ===

		try {
			const groupsStub = getStub<Groups>(env.GROUPS, 'default')
			const groupsWithDiscord = await groupsStub.getGroupsWithDiscordAutoInvite()

			for (const group of groupsWithDiscord) {
				try {
					const memberUserIds = await groupsStub.getGroupMemberUserIds(group.groupId)
					const isMember = memberUserIds.includes(userId)

					if (isMember) {
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

								if (discordServer.roleIds && discordServer.roleIds.length > 0) {
									const roleRecords = await db.query.discordRoles.findMany({
										where: and(
											inArray(discordRoles.id, discordServer.roleIds),
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
			if (role.discordServer.isActive && serversToUpdate.includes(role.discordServer.guildId)) {
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

	// === DEDUPLICATE ROLES PER GUILD ===

	for (const [guildId, guildData] of rolesByGuild.entries()) {
		guildData.expectedRoleIds = [...new Set(guildData.expectedRoleIds)]
	}

	// === BUILD ROLE UPDATE REQUESTS ===
	let updateRequests: Array<{
		guildId: string
		roleIds: string[]
		managedRoleIds: string[]
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
					const managedRoleIds = await getAllManagedRolesForGuild(db, env, guild.guildId)

					return {
						guildId: guild.guildId,
						roleIds: guild.expectedRoleIds,
						managedRoleIds,
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
	const knownServerDbIds = knownServers.map((server) => server.id)
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

	const inspectGuildIds = new Set<string>()
	for (const guildId of knownGuildIds) {
		const member = membershipByGuild.get(guildId)
		const expectedRoleCount = expectedRoleIdsByGuild.get(guildId)?.size ?? 0
		if (member?.isMember || expectedRoleCount > 0) {
			inspectGuildIds.add(guildId)
		}
	}

	const managedRoleCache = new Map<string, string[]>()
	const managedRoleIdsByGuild = new Map<string, Set<string>>()
	for (const guildId of inspectGuildIds) {
		const managedRoleIds = await getAllManagedRolesForGuild(db, env, guildId, managedRoleCache)
		managedRoleIdsByGuild.set(guildId, new Set(managedRoleIds))
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
		const expectedRoleIds = Array.from(expectedRoleIdsByGuild.get(guildId) ?? [])
		const currentRoleIds = membership?.currentRoleIds ?? []
		const managedRoleIds = managedRoleIdsByGuild.get(guildId) ?? new Set<string>()

		const currentRoleSet = new Set(currentRoleIds)
		const expectedRoleSet = new Set(expectedRoleIds)

		const currentManagedRoleIds = currentRoleIds.filter((roleId) => managedRoleIds.has(roleId))
		const currentUnmanagedRoleIds = currentRoleIds.filter((roleId) => !managedRoleIds.has(roleId))
		const missingExpectedRoleIds = expectedRoleIds.filter((roleId) => !currentRoleSet.has(roleId))
		const unexpectedManagedRoleIds = currentManagedRoleIds.filter(
			(roleId) => !expectedRoleSet.has(roleId)
		)

		guilds.push({
			guildId,
			guildName: server.guildName,
			isMember: membership?.isMember ?? false,
			membershipError: membership?.errorMessage,
			expectedManagedRoles: toRoleItems(guildId, expectedRoleIds),
			currentManagedRoles: toRoleItems(guildId, currentManagedRoleIds),
			currentUnmanagedRoles: toRoleItems(guildId, currentUnmanagedRoleIds),
			missingExpectedManagedRoles: toRoleItems(guildId, missingExpectedRoleIds),
			unexpectedManagedRoles: toRoleItems(guildId, unexpectedManagedRoleIds),
		})
	}
	guilds.sort((a, b) => a.guildName.localeCompare(b.guildName))

	const memberGuilds = guilds.filter((guild) => guild.isMember).length
	const guildsWithDrift = guilds.filter(
		(guild) =>
			guild.missingExpectedManagedRoles.length > 0 || guild.unexpectedManagedRoles.length > 0
	).length
	const totalMissingExpectedManagedRoles = guilds.reduce(
		(total, guild) => total + guild.missingExpectedManagedRoles.length,
		0
	)
	const totalUnexpectedManagedRoles = guilds.reduce(
		(total, guild) => total + guild.unexpectedManagedRoles.length,
		0
	)
	const totalUnmanagedCurrentRoles = guilds.reduce(
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
export async function updateUserDiscordNickname(env: Env, userId: string): Promise<void> {
	const db = createDb(env.DATABASE_URL)

	// Get user
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
	})

	if (!user || !user.discordUserId) {
		return // User doesn't have Discord linked
	}

	// Get primary character
	const primaryChar = await db.query.userCharacters.findFirst({
		where: and(eq(userCharacters.userId, userId), eq(userCharacters.is_primary, true)),
	})

	if (!primaryChar) {
		return // No primary character set
	}

	const nickname = primaryChar.characterName

	// Get all servers with nickname management enabled
	const serverSettings = await db.query.discordServers.findMany({
		where: and(eq(discordServers.manageNicknames, true), eq(discordServers.isActive, true)),
		columns: { guildId: true },
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

	// Update nickname on each server
	await discordStub.updateUserNickname(userId, userGuildIds, nickname)

	logger.info('[Discord] Updated user nickname', {
		userId,
		discordUserId: user.discordUserId,
		nickname,
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

	// === CORPORATION ROLES ===
	if (userCorporationIds.size > 0) {
		const corpAttachments = await db.query.corporationDiscordServers.findMany({
			where: and(
				eq(corporationDiscordServers.discordServerId, serverId),
				eq(corporationDiscordServers.autoAssignRoles, true),
				inArray(corporationDiscordServers.corporationId, Array.from(userCorporationIds))
			),
			with: {
				roles: {
					with: {
						discordRole: true,
					},
				},
			},
		})

		for (const attachment of corpAttachments) {
			for (const roleAssignment of attachment.roles) {
				if (roleAssignment.discordRole.isActive) {
					roleIds.add(roleAssignment.discordRole.roleId)
				}
			}
		}
	}

	// === GROUP ROLES ===
	try {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')

		// Get groups attached to this server
		const groupsWithServer = await groupsStub.getGroupsByDiscordServer(serverId)

		for (const groupAttachment of groupsWithServer) {
			// Check if user is a member of this group
			const memberUserIds = await groupsStub.getGroupMemberUserIds(groupAttachment.groupId)
			const isMember = memberUserIds.includes(userId)

			if (isMember && groupAttachment.autoAssignRoles) {
				// Get roles for this group attachment
				try {
					const attachmentConfig = await groupsStub.getDiscordServerAttachmentConfig(
						groupAttachment.id
					)
					for (const roleId of attachmentConfig.roleIds) {
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
				await discordStub.updateUserNickname(userId, [server.guildId], nickname)
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
