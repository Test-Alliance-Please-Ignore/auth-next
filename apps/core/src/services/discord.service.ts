import { and, eq, inArray, isNotNull } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import {
	corporationDiscordInvites,
	corporationDiscordServers,
	discordRoles,
	discordServers,
	managedCorporations,
	oauthStates,
	userCharacters,
	users,
} from '../db/schema'

import type { Discord, DiscordProfile, JoinServerResult } from '@repo/discord'
import type { CorporationMemberData, EveCorporationData } from '@repo/eve-corporation-data'
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
		// Get user info from Discord using the access token
		const userInfoResponse = await fetch('https://discord.com/api/users/@me', {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'User-Agent': 'DiscordBot (https://pleaseignore.app, 1.0.0)',
			},
		})

		if (!userInfoResponse.ok) {
			throw new Error(`Failed to get user info: ${await userInfoResponse.text()}`)
		}

		const userInfo = await userInfoResponse.json<{
			id: string
			username: string
			discriminator: string
		}>()

		logger.info('Got Discord user info', {
			discordUserId: userInfo.id,
			username: userInfo.username,
		})

		// Call Discord DO to store tokens via RPC
		const scopes = scope ? scope.split(' ') : []
		const expiresAt = new Date(Date.now() + expiresIn * 1000)

		const discordStub = getStub<Discord>(env.DISCORD, 'default')
		const success = await discordStub.storeTokensDirect(
			userInfo.id,
			userInfo.username,
			userInfo.discriminator,
			scopes,
			accessToken,
			refreshToken,
			expiresAt,
			coreUserId
		)

		if (!success) {
			return {
				success: false,
				error: 'Failed to store tokens',
			}
		}

		// Update user record with Discord user ID
		logger.info('Updating user with Discord ID', { coreUserId, discordUserId: userInfo.id })

		const updateResult = await db
			.update(users)
			.set({
				discordUserId: userInfo.id,
				updatedAt: new Date(),
			})
			.where(eq(users.id, coreUserId))
			.returning()

		logger.info('User update complete', {
			updated: updateResult.length > 0,
			discordUserId: updateResult[0]?.discordUserId,
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
	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	return discordStub.getProfileByCoreUserId(userId)
}

/**
 * Get Discord user status including authorization revocation info
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Discord user status or null if not found
 */
export async function getUserStatus(env: Env, userId: string) {
	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	return discordStub.getDiscordUserStatus(userId)
}

/**
 * Refresh Discord OAuth token for a user
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Success status
 */
export async function refreshToken(env: Env, userId: string): Promise<boolean> {
	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	return discordStub.refreshTokenByCoreUserId(userId)
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

	const discordUserId = user.discordUserId

	// Get all user's characters
	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
	})

	const characterIds = userChars.map((char) => char.characterId)

	// Get primary character name for nickname management
	const primaryCharacter = userChars.find((char) => char.is_primary)
	const primaryCharacterName = primaryCharacter?.characterName

	if (characterIds.length === 0) {
		return {
			results: [],
			totalInvited: 0,
			totalFailed: 0,
		}
	}

	logger.info('[Discord] Starting invite-only process for user', {
		userId,
		discordUserId,
		characterCount: characterIds.length,
	})

	// === CHECK CORPORATIONS (ONLY autoInvite=true) ===

	const corpAttachments = await db.query.corporationDiscordServers.findMany({
		where: eq(corporationDiscordServers.autoInvite, true), // ONLY auto-invite servers
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

	// Filter out inactive Discord servers
	const activeCorpAttachments = corpAttachments.filter(attachment =>
		attachment.discordServer.isActive
	)

	logger.info('[Discord] Found active corporation Discord servers with auto-invite', {
		totalAttachments: corpAttachments.length,
		activeAttachments: activeCorpAttachments.length,
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

	// Check corporation memberships
	for (const attachment of activeCorpAttachments) {
		try {
			const corpStub = getStub<EveCorporationData>(
				env.EVE_CORPORATION_DATA,
				attachment.corporationId
			)
			const members = await corpStub.getMembers(attachment.corporationId)
			const memberCharacterIds = members.map((m: CorporationMemberData) => m.characterId)

			const matchingCharacters = characterIds.filter((charId) => memberCharacterIds.includes(charId))
			const isMember = matchingCharacters.length > 0

			if (isMember) {
				// Collect role IDs if auto-assign is enabled
				const roleIds = attachment.autoAssignRoles
					? attachment.roles
						.filter(r => r.discordRole.isActive) // SECURITY: Only active roles
						.map((r) => r.discordRole.roleId)
					: []

				guildsToJoin.push({
					type: 'corporation',
					guildId: attachment.discordServer.guildId,
					guildName: attachment.discordServer.guildName,
					corporationId: attachment.corporationId,
					corporationName: attachment.corporation.name,
					discordServerId: attachment.discordServerId,
					roleIds,
				})

				logger.info('[Discord] User eligible for corporation Discord auto-invite', {
					userId,
					corporationId: attachment.corporationId,
					corporationName: attachment.corporation.name,
					guildId: attachment.discordServer.guildId,
					roleCount: roleIds.length,
				})
			}
		} catch (error) {
			logger.error('[Discord] Error checking corporation members', {
				corporationId: attachment.corporationId,
				error: String(error),
			})
		}
	}

	// === CHECK GROUPS (ONLY autoInvite=true) ===

	try {
		const groupsStub = getStub<Groups>(env.GROUPS, 'default')
		const groupsWithDiscord = await groupsStub.getGroupsWithDiscordAutoInvite()

		logger.info('[Discord] Found groups with Discord servers', {
			groupCount: groupsWithDiscord.length,
		})

		for (const group of groupsWithDiscord) {
			try {
				const memberUserIds = await groupsStub.getGroupMemberUserIds(group.groupId)
				const isMember = memberUserIds.includes(userId)

				if (isMember) {
					for (const discordServer of group.discordServers) {
						// ONLY process servers with autoInvite=true
						if (!discordServer.autoInvite) {
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

							if (discordServer.roleIds && discordServer.roleIds.length > 0 && discordServer.autoAssignRoles) {
								const roleRecords = await db.query.discordRoles.findMany({
									where: and(
										inArray(discordRoles.id, discordServer.roleIds),
										eq(discordRoles.isActive, true)
									),
								})
								actualRoleIds = roleRecords.map((r) => r.roleId)
							}

							guildsToJoin.push({
								type: 'group',
								guildId: serverInfo.guildId,
								guildName: serverInfo.guildName,
								groupId: group.groupId,
								groupName: group.groupName,
								discordServerId: serverInfo.id,
								roleIds: actualRoleIds,
							})

							logger.info('[Discord] User eligible for group Discord auto-invite', {
								userId,
								groupId: group.groupId,
								groupName: group.groupName,
								guildId: serverInfo.guildId,
								roleCount: actualRoleIds.length,
							})
						}
					}
				}
			} catch (error) {
				logger.error('[Discord] Error checking group members', {
					groupId: group.groupId,
					error: String(error),
				})
			}
		}
	} catch (error) {
		logger.error('[Discord] Error fetching groups with Discord', {
			error: String(error),
		})
	}

	if (guildsToJoin.length === 0) {
		logger.info('[Discord] User not eligible for any auto-invites')
		return {
			results: [],
			totalInvited: 0,
			totalFailed: 0,
		}
	}

	// === FETCH AUTO-APPLY ROLES (for initial invite) ===

	const autoApplyRoles = await db.query.discordRoles.findMany({
		where: and(
			eq(discordRoles.autoApply, true),
			eq(discordRoles.isActive, true)
		),
		with: {
			discordServer: true,
		},
	})

	// Filter to only include roles from active servers
	const activeAutoApplyRoles = autoApplyRoles.filter(role =>
		role.discordServer.isActive
	)

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

	const guildMap = new Map<string, {
		guildId: string
		guildName: string
		roleIds: string[]
		discordServerDbIds: string[]
		sources: Array<{ type: 'corporation' | 'group', name: string }>
	}>()

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
				name: guild.type === 'corporation' ? guild.corporationName! : guild.groupName!
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
				sources: [{
					type: guild.type,
					name: guild.type === 'corporation' ? guild.corporationName! : guild.groupName!
				}]
			})
		}
	}

	// Merge auto-apply roles
	for (const [guildId, guildData] of guildMap.entries()) {
		const autoRoles = autoApplyRolesByGuild.get(guildId)
		if (autoRoles && autoRoles.length > 0) {
			const mergedRoles = [...new Set([...guildData.roleIds, ...autoRoles])]
			guildData.roleIds = mergedRoles
		}
	}

	// === FETCH NICKNAME SETTINGS ===

	const uniqueDbIds = [...new Set(
		Array.from(guildMap.values())
			.flatMap((g) => g.discordServerDbIds)
			.filter((id): id is string => id !== undefined && id !== '')
	)]

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

	logger.info('[Discord] Sending invite requests to Discord DO', {
		userId,
		guildCount: guildIds.length,
	})

	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	const inviteResults = await discordStub.joinUserToServers(userId, guildIds)

	// === UPDATE ROLES ===

	const roleUpdateRequests = await Promise.all(
		Array.from(guildMap.values())
			.filter((guild) => guild.roleIds.length > 0)
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
		logger.info('[Discord] Updating roles for guilds', {
			userId,
			updateCount: roleUpdateRequests.length,
		})

		await discordStub.updateUserRoles(userId, roleUpdateRequests)
	}

	// === UPDATE NICKNAMES ===

	const guildsForNicknameUpdate = Array.from(guildMap.values())
		.filter((guild) => {
			const manageNicknames = manageNicknamesByGuildId.get(guild.guildId)
			return manageNicknames && primaryCharacterName
		})
		.map((guild) => guild.guildId)

	if (guildsForNicknameUpdate.length > 0 && primaryCharacterName) {
		logger.info('[Discord] Updating nicknames for guilds', {
			userId,
			updateCount: guildsForNicknameUpdate.length,
			nickname: primaryCharacterName,
		})

		await discordStub.updateUserNickname(userId, guildsForNicknameUpdate, primaryCharacterName)
	}

	// Build final results
	const results = inviteResults.map((result: JoinServerResult) => {
		const guildData = guildMap.get(result.guildId)
		return {
			guildId: result.guildId,
			guildName: guildData?.guildName ?? result.guildName ?? result.guildId,
			corporationName: guildData?.sources.find(s => s.type === 'corporation')?.name,
			groupName: guildData?.sources.find(s => s.type === 'group')?.name,
			success: result.success,
			errorMessage: result.errorMessage,
			alreadyMember: result.alreadyMember,
			type: guildData?.sources[0]?.type,
		}
	})

	// Count only actual invites (not already members)
	const totalInvited = results.filter(r => r.success && !r.alreadyMember).length
	const totalFailed = results.filter(r => !r.success).length

	logger.info('[Discord] Invite process completed', {
		userId,
		totalInvited,
		totalFailed,
		alreadyMembers: results.filter(r => r.alreadyMember).length,
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
	guildIds?: string[]
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

	const discordUserId = user.discordUserId

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

	logger.info('[Discord] Starting role update process for user', {
		userId,
		discordUserId,
		characterCount: characterIds.length,
		specificGuilds: guildIds,
	})

	// === DETERMINE WHICH SERVERS TO UPDATE ===

	let serversToUpdate: string[]

	if (guildIds && guildIds.length > 0) {
		// Use provided guild IDs
		serversToUpdate = guildIds
	} else {
		// Get all servers user is currently a member of from Discord
		const discordStub = getStub<Discord>(env.DISCORD, 'default')
		const currentGuilds = await discordStub.getUserGuilds(userId)
		serversToUpdate = currentGuilds.map(g => g.id)

		// FALLBACK: If getUserGuilds returns empty (user missing 'guilds' OAuth scope),
		// check known active guilds using bot token
		if (serversToUpdate.length === 0) {
			logger.info('[Discord] getUserGuilds returned empty, falling back to bot token check', {
				userId,
			})

			// Get all active Discord servers from our database
			const knownServers = await db.query.discordServers.findMany({
				where: eq(discordServers.isActive, true),
				columns: { guildId: true },
			})

			const knownGuildIds = knownServers.map(s => s.guildId)

			if (knownGuildIds.length > 0) {
				// Use bot token to check which guilds the user is a member of
				const memberGuildIds = await discordStub.checkGuildMembershipWithBot(
					userId,
					knownGuildIds
				)
				serversToUpdate = memberGuildIds

				logger.info('[Discord] Bot token fallback completed', {
					userId,
					knownServers: knownGuildIds.length,
					memberServers: memberGuildIds.length,
				})
			}
		}
	}

	if (serversToUpdate.length === 0) {
		logger.info('[Discord] User is not a member of any Discord servers')
		return {
			results: [],
			totalUpdated: 0,
			totalFailed: 0,
		}
	}

	logger.info('[Discord] Servers to update roles for', {
		userId,
		serverCount: serversToUpdate.length,
		serverIds: serversToUpdate,
	})

	// === CALCULATE WHAT ROLES USER SHOULD HAVE ===

	const rolesByGuild = new Map<string, {
		guildId: string
		guildName: string
		expectedRoleIds: string[]
		sources: Array<{ type: 'corporation' | 'group' | 'auto-apply', name: string }>
	}>()

	// Initialize map with empty role sets
	for (const guildId of serversToUpdate) {
		rolesByGuild.set(guildId, {
			guildId,
			guildName: guildId, // Will be updated if we find the name
			expectedRoleIds: [],
			sources: []
		})
	}

	// === CHECK CORPORATION ROLES (all attachments, not just auto-invite) ===

	const allCorpAttachments = await db.query.corporationDiscordServers.findMany({
		// No autoInvite filter - we want ALL attachments for role updates
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

	// Filter to only active Discord servers
	const corpAttachments = allCorpAttachments.filter(attachment =>
		attachment.discordServer.isActive &&
		serversToUpdate.includes(attachment.discordServer.guildId)
	)

	for (const attachment of corpAttachments) {
		try {
			const corpStub = getStub<EveCorporationData>(
				env.EVE_CORPORATION_DATA,
				attachment.corporationId
			)
			const members = await corpStub.getMembers(attachment.corporationId)
			const memberCharacterIds = members.map((m: CorporationMemberData) => m.characterId)

			const isMember = characterIds.some((charId) => memberCharacterIds.includes(charId))

			if (isMember && attachment.autoAssignRoles) {
				const roleIds = attachment.roles
					.filter(r => r.discordRole.isActive) // SECURITY: Only active roles
					.map((r) => r.discordRole.roleId)

				const guildData = rolesByGuild.get(attachment.discordServer.guildId)
				if (guildData) {
					guildData.expectedRoleIds.push(...roleIds)
					guildData.sources.push({
						type: 'corporation',
						name: attachment.corporation.name
					})
					guildData.guildName = attachment.discordServer.guildName
				}

				logger.info('[Discord] User should have corporation roles', {
					userId,
					corporationName: attachment.corporation.name,
					guildId: attachment.discordServer.guildId,
					roleCount: roleIds.length,
				})
			}
		} catch (error) {
			logger.error('[Discord] Error checking corporation members for role update', {
				corporationId: attachment.corporationId,
				error: String(error),
			})
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

						if (serverInfo && serversToUpdate.includes(serverInfo.guildId) && discordServer.autoAssignRoles) {
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
									name: group.groupName
								})
								guildData.guildName = serverInfo.guildName
							}

							logger.info('[Discord] User should have group roles', {
								userId,
								groupName: group.groupName,
								guildId: serverInfo.guildId,
								roleCount: actualRoleIds.length,
							})
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
		where: and(
			eq(discordRoles.autoApply, true),
			eq(discordRoles.isActive, true)
		),
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
					name: role.roleName
				})
			}
		}
	}

	// === DEDUPLICATE ROLES PER GUILD ===

	for (const [guildId, guildData] of rolesByGuild.entries()) {
		guildData.expectedRoleIds = [...new Set(guildData.expectedRoleIds)]
	}

	// === BUILD ROLE UPDATE REQUESTS ===

	const updateRequests = await Promise.all(
		Array.from(rolesByGuild.values())
			.filter(guild => guild.expectedRoleIds.length > 0) // Only update if there are roles to set
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

	if (updateRequests.length === 0) {
		logger.info('[Discord] No role updates needed')
		return {
			results: [],
			totalUpdated: 0,
			totalFailed: 0,
		}
	}

	logger.info('[Discord] Sending role update requests to Discord DO', {
		userId,
		requestCount: updateRequests.length,
		requests: updateRequests.map(r => ({
			guildId: r.guildId,
			roleCount: r.roleIds.length,
		})),
	})

	// === CALL DISCORD DO - UPDATE ROLES ONLY ===

	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	const updateResults = await discordStub.updateUserRoles(userId, updateRequests)

	// Build final results
	const results = updateResults.map((result: any) => {
		const guildData = rolesByGuild.get(result.guildId)
		return {
			guildId: result.guildId,
			guildName: guildData?.guildName ?? result.guildId,
			rolesAdded: result.rolesAdded || [],
			rolesRemoved: result.rolesRemoved || [],
			success: result.success,
			errorMessage: result.errorMessage,
		}
	})

	const totalUpdated = results.filter(r => r.success).length
	const totalFailed = results.filter(r => !r.success).length

	logger.info('[Discord] Role update process completed', {
		userId,
		totalUpdated,
		totalFailed,
	})

	return {
		results,
		totalUpdated,
		totalFailed,
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
		operation?: 'invite' | 'update'
	}>
	totalInvited: number
	totalUpdated: number
	totalFailed: number
}> {
	// Check if user is blacklisted early for efficiency
	const hrStub = getStub<Hr>(env.HR, 'default')
	const isBlacklisted = await hrStub.isUserBlacklisted(userId)

	if (isBlacklisted) {
		logger.warn('[Discord] Blocked Discord sync for blacklisted user', {
			userId,
		})
		return {
			results: [],
			totalInvited: 0,
			totalUpdated: 0,
			totalFailed: 0,
		}
	}

	// First invite to new servers
	const inviteResult = await inviteUserToDiscordServers(env, userId)

	// Then update roles on all servers
	const updateResult = await updateUserDiscordRoles(env, userId)

	// Combine results from both operations
	const combinedResults = [
		...inviteResult.results.map(r => ({ ...r, operation: 'invite' as const })),
		...updateResult.results.map(r => ({ ...r, operation: 'update' as const }))
	]

	return {
		results: combinedResults,
		totalInvited: inviteResult.totalInvited,
		totalUpdated: updateResult.totalUpdated,
		totalFailed: inviteResult.totalFailed + updateResult.totalFailed,
	}
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
		where: and(
			eq(userCharacters.userId, userId),
			eq(userCharacters.is_primary, true)
		),
	})

	if (!primaryChar) {
		return // No primary character set
	}

	const nickname = primaryChar.characterName

	// Get all Discord servers the user is a member of
	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	const userGuilds = await discordStub.getUserGuilds(userId)

	if (userGuilds.length === 0) {
		return // User is not in any Discord servers
	}

	// Get server settings to find which servers have manageNicknames enabled
	const serverSettings = await db.query.discordServers.findMany({
		where: and(
			inArray(discordServers.guildId, userGuilds.map(g => g.id)),
			eq(discordServers.manageNicknames, true),
			eq(discordServers.isActive, true)
		),
	})

	if (serverSettings.length === 0) {
		return // No servers have nickname management enabled
	}

	// Update nickname on each server
	await discordStub.updateUserNickname(
		userId,
		serverSettings.map(s => s.guildId),
		nickname
	)

	logger.info('[Discord] Updated user nickname', {
		userId,
		discordUserId: user.discordUserId,
		nickname,
		serverCount: serverSettings.length,
	})
}
