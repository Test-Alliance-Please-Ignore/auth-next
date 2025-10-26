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
 * Join user to corporation and group Discord servers
 * @param env - Worker environment
 * @param userId - Core user ID
 * @returns Join results with statistics
 */
export async function joinUserToCorporationServers(
	env: Env,
	userId: string
): Promise<{
	results: Array<{
		guildId: string
		guildName: string
		corporationName: string
		success: boolean
		errorMessage?: string
		alreadyMember?: boolean
		type?: 'corporation' | 'group'
		groupName?: string
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

	const discordUserId = user.discordUserId

	// Get all user's characters
	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
	})

	const characterIds = userChars.map((char) => char.characterId)

	if (characterIds.length === 0) {
		return {
			results: [],
			totalInvited: 0,
			totalFailed: 0,
		}
	}

	logger.info('[Discord] Checking corporations and groups for user', {
		userId,
		characterCount: characterIds.length,
		characterIds,
	})

	// === CHECK CORPORATIONS ===

	// Get all corporation Discord server attachments with auto-invite enabled
	const corpAttachments = await db.query.corporationDiscordServers.findMany({
		where: eq(corporationDiscordServers.autoInvite, true),
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

	logger.info('[Discord] Found corporation Discord attachments with auto-invite', {
		attachmentCount: corpAttachments.length,
	})

	// Check which corporations the user's characters are members of
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

	for (const attachment of corpAttachments) {
		try {
			// Get corporation members via RPC
			const corpStub = getStub<EveCorporationData>(
				env.EVE_CORPORATION_DATA,
				attachment.corporationId
			)
			const members = await corpStub.getMembers(attachment.corporationId)
			const memberCharacterIds = members.map((m: CorporationMemberData) => m.characterId)

			logger.info('[Discord] Corporation member check', {
				corporationId: attachment.corporationId,
				corporationName: attachment.corporation.name,
				memberCount: members.length,
			})

			// Check if any of the user's characters are in this corp
			const isMember = characterIds.some((charId) => memberCharacterIds.includes(charId))

			if (isMember) {
				// Collect role IDs if auto-assign is enabled
				const roleIds = attachment.autoAssignRoles
					? attachment.roles.map((r) => r.discordRole.roleId)
					: []

				guildsToJoin.push({
					type: 'corporation',
					guildId: attachment.discordServer.guildId,
					guildName: attachment.discordServer.guildName,
					corporationId: attachment.corporationId,
					corporationName: attachment.corporation.name,
					discordServerId: attachment.id,
					roleIds,
				})
				logger.info('[Discord] User is member of corporation with Discord', {
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

	// === CHECK GROUPS ===

	try {
		// Get all groups with Discord auto-invite enabled via Groups DO RPC
		const groupsStub = getStub<import('@repo/groups').Groups>(env.GROUPS, 'default')
		const groupsWithDiscord = await groupsStub.getGroupsWithDiscordAutoInvite()

		logger.info('[Discord] Found groups with Discord auto-invite', {
			groupCount: groupsWithDiscord.length,
		})

		// Check which groups the user is a member of
		for (const group of groupsWithDiscord) {
			try {
				// Get group member user IDs via RPC
				const memberUserIds = await groupsStub.getGroupMemberUserIds(group.groupId)

				// Check if the user is a member of this group
				const isMember = memberUserIds.includes(userId)

				if (isMember) {
					// Add all Discord servers for this group
					// Need to look up Discord server info from registry
					for (const discordServer of group.discordServers) {
						// Fetch Discord server details from Core registry
						const serverInfo = await db.query.discordServers.findFirst({
							where: eq(discordServers.id, discordServer.discordServerId),
						})

						if (serverInfo) {
							// Fetch actual Discord role IDs from Core registry
							// discordServer.roleIds contains UUIDs that reference core.discord_roles.id
							// We need to fetch the actual Discord snowflake IDs
							let actualRoleIds: string[] = []
							if (discordServer.roleIds && discordServer.roleIds.length > 0) {
								logger.info('[Discord] Fetching group role details', {
									groupId: group.groupId,
									discordServerId: discordServer.id,
									roleUUIDs: discordServer.roleIds,
								})

								const roleRecords = await db.query.discordRoles.findMany({
									where: and(
										inArray(discordRoles.id, discordServer.roleIds),
										eq(discordRoles.isActive, true)
									),
								})
								actualRoleIds = roleRecords.map((r) => r.roleId)

								logger.info('[Discord] Resolved group Discord role IDs', {
									groupId: group.groupId,
									uuidCount: discordServer.roleIds.length,
									resolvedCount: actualRoleIds.length,
									roleIds: actualRoleIds,
								})

								if (discordServer.roleIds.length > 0 && actualRoleIds.length === 0) {
									logger.warn('[Discord] No active roles found for group Discord server', {
										groupId: group.groupId,
										discordServerId: discordServer.id,
										expectedCount: discordServer.roleIds.length,
									})
								}
							}

							guildsToJoin.push({
								type: 'group',
								guildId: serverInfo.guildId,
								guildName: serverInfo.guildName,
								groupId: group.groupId,
								groupName: group.groupName,
								discordServerId: discordServer.id,
								roleIds: actualRoleIds,
							})
							logger.info('[Discord] User is member of group with Discord', {
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
		logger.info('[Discord] User is not a member of any corporations or groups with Discord')
		return {
			results: [],
			totalInvited: 0,
			totalFailed: 0,
		}
	}

	// === FETCH AUTO-APPLY ROLES ===

	// Query all auto-apply roles from the database
	// These roles will be automatically assigned to all users regardless of corp/group
	const autoApplyRoles = await db.query.discordRoles.findMany({
		where: and(eq(discordRoles.autoApply, true), eq(discordRoles.isActive, true)),
		with: {
			discordServer: true,
		},
	})

	logger.info('[Discord] Found auto-apply roles', {
		autoApplyRoleCount: autoApplyRoles.length,
	})

	// Build a map of guildId -> auto-apply role IDs
	const autoApplyRolesByGuild = new Map<string, string[]>()
	for (const role of autoApplyRoles) {
		const guildId = role.discordServer.guildId
		const existing = autoApplyRolesByGuild.get(guildId)
		if (existing) {
			existing.push(role.roleId)
		} else {
			autoApplyRolesByGuild.set(guildId, [role.roleId])
		}
	}

	logger.info('[Discord] Joining user to Discord servers', {
		userId,
		discordUserId,
		guildCount: guildsToJoin.length,
	})

	// Deduplicate guild IDs (same server might be attached to multiple corps/groups)
	// Keep track of all role IDs that should be assigned
	const guildMap = new Map<
		string,
		{
			guildId: string
			roleIds: string[]
		}
	>()

	for (const guild of guildsToJoin) {
		const existing = guildMap.get(guild.guildId)
		if (existing) {
			// Merge role IDs from multiple corporations/groups
			const combinedRoles = [...new Set([...existing.roleIds, ...(guild.roleIds || [])])]
			guildMap.set(guild.guildId, {
				guildId: guild.guildId,
				roleIds: combinedRoles,
			})
		} else {
			guildMap.set(guild.guildId, {
				guildId: guild.guildId,
				roleIds: guild.roleIds || [],
			})
		}
	}

	// Merge auto-apply roles into each guild
	for (const [guildId, guildData] of guildMap.entries()) {
		const autoRoles = autoApplyRolesByGuild.get(guildId)
		if (autoRoles && autoRoles.length > 0) {
			const mergedRoles = [...new Set([...guildData.roleIds, ...autoRoles])]
			guildMap.set(guildId, {
				guildId,
				roleIds: mergedRoles,
			})
			logger.info('[Discord] Merged auto-apply roles for guild', {
				guildId,
				autoApplyRoleCount: autoRoles.length,
				totalRoleCount: mergedRoles.length,
			})
		}
	}

	const joinRequests = Array.from(guildMap.values())

	logger.info('[Discord] Deduplicated guild join requests', {
		originalCount: guildsToJoin.length,
		deduplicatedCount: joinRequests.length,
	})

	// Call Discord DO via RPC to join the servers with role assignments
	const discordStub = getStub<Discord>(env.DISCORD, 'default')
	const joinResults = await discordStub.joinUserToServersWithRoles(userId, joinRequests)

	// Merge results with corporation and group info
	const results = joinResults.map((result: JoinServerResult) => {
		const guild = guildsToJoin.find((g) => g.guildId === result.guildId)
		return {
			guildId: result.guildId,
			guildName: guild?.guildName ?? result.guildName ?? result.guildId,
			corporationName:
				guild?.corporationName ??
				(guild?.type === 'group' ? (guild.groupName ?? 'Unknown') : 'Unknown'),
			success: result.success,
			errorMessage: result.errorMessage,
			alreadyMember: result.alreadyMember,
			type: guild?.type,
			groupName: guild?.groupName,
		}
	})

	// Log results in audit tables (separate tables for corporations and groups)
	// Note: Same guild might be attached to multiple corps/groups, so we create
	// audit records for ALL attachments even though we only made one API call
	const corporationAuditRecords = []
	const groupAuditRecords = []

	for (const result of results) {
		// Find ALL guilds (corps/groups) that have this Discord server attached
		const matchingGuilds = guildsToJoin.filter((g) => g.guildId === result.guildId)

		for (const guild of matchingGuilds) {
			// Determine which roles were actually assigned (from the merged set)
			const assignedRoleIds = result.success && guild.roleIds ? guild.roleIds : null

			if (guild.type === 'corporation' && guild.corporationId && guild.discordServerId) {
				corporationAuditRecords.push({
					corporationId: guild.corporationId,
					corporationDiscordServerId: guild.discordServerId,
					userId,
					discordUserId,
					success: result.success,
					errorMessage: result.errorMessage,
					assignedRoleIds,
				})
			} else if (guild.type === 'group' && guild.groupId && guild.discordServerId) {
				groupAuditRecords.push({
					groupId: guild.groupId,
					groupDiscordServerId: guild.discordServerId,
					userId,
					discordUserId,
					success: result.success,
					errorMessage: result.errorMessage,
					assignedRoleIds,
				})
			}
		}
	}

	// Insert corporation audit records
	if (corporationAuditRecords.length > 0) {
		try {
			await db.insert(corporationDiscordInvites).values(corporationAuditRecords)
		} catch (error) {
			logger.error('[Discord] Failed to log corporation audit records', {
				error: String(error),
			})
		}
	}

	// Insert group audit records via Groups DO RPC
	if (groupAuditRecords.length > 0) {
		try {
			const groupsStub = getStub<import('@repo/groups').Groups>(env.GROUPS, 'default')
			await groupsStub.insertDiscordInviteAuditRecords(groupAuditRecords)
			logger.info('[Discord] Inserted group audit records', {
				recordCount: groupAuditRecords.length,
			})
		} catch (error) {
			logger.error('[Discord] Failed to log group audit records', {
				error: String(error),
			})
		}
	}

	// Calculate statistics
	const totalInvited = results.filter((r: { success: boolean }) => r.success).length
	const totalFailed = results.filter((r: { success: boolean }) => !r.success).length

	logger.info('[Discord] Join servers complete', {
		totalInvited,
		totalFailed,
	})

	return {
		results,
		totalInvited,
		totalFailed,
	}
}
