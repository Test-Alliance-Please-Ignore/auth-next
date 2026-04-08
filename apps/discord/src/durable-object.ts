import { DurableObject } from 'cloudflare:workers'

import { and, eq, ilike, isNotNull, sql } from '@repo/db-utils'
import { DiscordAPIError, DiscordFetch, DiscordRoutes } from '@repo/discord'
import { generateShardKey } from '@repo/hazmat'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { discordTokens, discordUsers } from './db/schema'
import { DiscordBotService, fetchWithRetry } from './services/discord-bot.service'
import { calculateRoleChanges } from './utils/role-calculation'

import type {
	Discord,
	DiscordGuildMembershipDetail,
	DiscordRegisteredSlashCommand,
	DiscordSlashCommandDefinition,
	DiscordTokenResponse,
	MessageContent,
	SendMessageResult,
} from '@repo/discord'
import type { Env } from './context'

/**
 * Discord Durable Object
 *
 * This Durable Object handles:
 * - Discord OAuth flow
 * - Token storage and encryption
 * - Automatic token refresh
 * - RPC methods for remote calls
 */
export class DiscordDO extends DurableObject<Env> implements Discord {
	private db: ReturnType<typeof createDb>

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	// ==================== HELPER FUNCTIONS ====================

	/**
	 * Helper to get user by core user ID with standard error handling
	 */
	private async getUserByCoreUserId(coreUserId: string) {
		const user = await this.db.query.discordUsers.findFirst({
			where: eq(discordUsers.coreUserId, coreUserId),
		})

		if (!user) {
			logger.error('[DiscordDO] User not found by core user ID', { coreUserId })
		}

		return user
	}

	/**
	 * Build proxy URL for Discord API requests when proxy env vars are valid.
	 * Returns null when proxy config is missing/invalid so callers can fallback to direct requests.
	 */
	private getDiscordProxyUrl(): string | null {
		const host = this.env.DISCORD_PROXY_HOST?.trim()
		const username = this.env.DISCORD_PROXY_USERNAME?.trim()
		const password = this.env.DISCORD_PROXY_PASSWORD?.trim()
		const portStart = Number(this.env.DISCORD_PROXY_PORT_START)
		const portCount = Number(this.env.DISCORD_PROXY_PORT_COUNT)

		const hasValidPortRange =
			Number.isInteger(portStart) && Number.isInteger(portCount) && portCount > 0
		const hasCredentials = Boolean(host && username && password)

		if (!hasValidPortRange || !hasCredentials) {
			logger.warn('[DiscordDO] Proxy config invalid or incomplete, using direct Discord API', {
				hasHost: Boolean(host),
				hasUsername: Boolean(username),
				hasPassword: Boolean(password),
				portStartRaw: this.env.DISCORD_PROXY_PORT_START,
				portCountRaw: this.env.DISCORD_PROXY_PORT_COUNT,
			})
			return null
		}

		const portEnd = portStart + portCount - 1
		const port = generateShardKey(portStart, portEnd)
		return `https://${username}:${password}@${host}:${port}`
	}

	/**
	 * Build DiscordFetch proxy config when env vars are valid.
	 */
	private getDiscordFetchProxy():
		| {
				host: string
				port: number
				username: string
				password: string
		  }
		| undefined {
		const host = this.env.DISCORD_PROXY_HOST?.trim()
		const username = this.env.DISCORD_PROXY_USERNAME?.trim()
		const password = this.env.DISCORD_PROXY_PASSWORD?.trim()
		const portStart = Number(this.env.DISCORD_PROXY_PORT_START)
		const portCount = Number(this.env.DISCORD_PROXY_PORT_COUNT)

		const hasValidPortRange =
			Number.isInteger(portStart) && Number.isInteger(portCount) && portCount > 0
		const hasCredentials = Boolean(host && username && password)

		if (!hasValidPortRange || !hasCredentials) {
			return undefined
		}

		const portEnd = portStart + portCount - 1
		const port = generateShardKey(portStart, portEnd)
		return {
			host: host!,
			port,
			username: username!,
			password: password!,
		}
	}

	/**
	 * Helper to get a valid access token for a user, refreshing if necessary
	 * @returns Decrypted access token or null if unable to get valid token
	 */
	private async getValidAccessToken(userId: string, discordUserId: string): Promise<string | null> {
		// Get user's token
		const tokenRecord = await this.db.query.discordTokens.findFirst({
			where: eq(discordTokens.userId, userId),
		})

		if (!tokenRecord) {
			logger.error('[DiscordDO] Token not found for user', { discordUserId })
			return null
		}

		// Check if token is expired
		if (tokenRecord.expiresAt < new Date()) {
			logger.info('[DiscordDO] Token expired, attempting refresh', { discordUserId })

			// Try to refresh the token
			const refreshSuccess = await this.refreshToken(discordUserId)

			if (!refreshSuccess) {
				logger.error('[DiscordDO] Failed to refresh expired token', { discordUserId })
				return null
			}

			// Get the refreshed token
			const refreshedToken = await this.db.query.discordTokens.findFirst({
				where: eq(discordTokens.userId, userId),
			})

			if (!refreshedToken) {
				logger.error('[DiscordDO] Failed to retrieve refreshed token', { discordUserId })
				return null
			}

			return await this.decrypt(refreshedToken.accessToken)
		}

		// Token is valid, decrypt and return it
		return await this.decrypt(tokenRecord.accessToken)
	}

	/**
	 * Helper to handle authentication results and update user status
	 */
	private async handleAuthResults(
		results: Array<{ success?: boolean; authRevoked?: boolean }>,
		userId: string,
		coreUserId: string
	): Promise<void> {
		const hasRevokedAuth = results.some((result) => result.authRevoked === true)
		const hasSuccessfulAuth = results.some((result) => result.success === true)

		if (hasRevokedAuth) {
			// Mark user as having revoked authorization
			await this.db
				.update(discordUsers)
				.set({
					authRevoked: true,
					authRevokedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(discordUsers.id, userId))

			logger.warn('[DiscordDO] Marked user as having revoked Discord authorization', {
				userId,
				coreUserId,
			})
		} else if (hasSuccessfulAuth) {
			// Update last successful auth timestamp
			await this.db
				.update(discordUsers)
				.set({
					lastSuccessfulAuth: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(discordUsers.id, userId))
		}
	}

	// ==================== PUBLIC RPC METHODS ====================

	async searchCoreUsersByUsername(
		usernameQuery: string,
		limit = 50
	): Promise<Array<{ coreUserId: string; discordUserId: string; username: string }>> {
		const q = usernameQuery.trim()
		if (q.length === 0) {
			return []
		}

		const cappedLimit = Math.max(1, Math.min(200, Math.floor(limit)))
		const rows = await this.db
			.select({
				coreUserId: discordUsers.coreUserId,
				discordUserId: discordUsers.userId,
				username: discordUsers.username,
			})
			.from(discordUsers)
			.where(and(isNotNull(discordUsers.coreUserId), ilike(discordUsers.username, `%${q}%`)))
			.limit(cappedLimit)

		return rows.map((row) => ({
			coreUserId: row.coreUserId!,
			discordUserId: row.discordUserId,
			username: row.username,
		}))
	}

	/**
	 * Get Discord profile by core user ID
	 */
	async getProfileByCoreUserId(coreUserId: string): Promise<{
		userId: string
		username: string
		discriminator: string
		scopes: string[]
	} | null> {
		const user = await this.getUserByCoreUserId(coreUserId)
		if (!user) return null

		return {
			userId: user.userId,
			username: user.username,
			discriminator: user.discriminator,
			scopes: JSON.parse(user.scopes),
		}
	}

	/**
	 * Get Discord user status including auth revocation info
	 */
	async getDiscordUserStatus(coreUserId: string): Promise<{
		userId: string
		username: string
		discriminator: string
		coreUserId: string | null
		authRevoked: boolean
		authRevokedAt: Date | null
		lastSuccessfulAuth: Date | null
		lastRefreshed: Date | null
		createdAt: Date
		updatedAt: Date
	} | null> {
		const user = await this.getUserByCoreUserId(coreUserId)
		if (!user) return null

		return {
			userId: user.userId,
			username: user.username,
			discriminator: user.discriminator,
			coreUserId: user.coreUserId,
			authRevoked: user.authRevoked,
			authRevokedAt: user.authRevokedAt,
			lastSuccessfulAuth: user.lastSuccessfulAuth,
			lastRefreshed: user.lastRefreshed,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		}
	}

	/**
	 * Update the last refreshed timestamp for a Discord user
	 */
	async updateLastRefreshed(coreUserId: string): Promise<void> {
		const user = await this.getUserByCoreUserId(coreUserId)
		if (!user) {
			logger.error('[DiscordDO] User not found for updateLastRefreshed', { coreUserId })
			return
		}

		const now = new Date()
		await this.db
			.update(discordUsers)
			.set({
				lastRefreshed: now,
				updatedAt: now,
			})
			.where(eq(discordUsers.id, user.id))

		logger.debug('[DiscordDO] Updated lastRefreshed timestamp', {
			coreUserId,
			userId: user.userId,
			timestamp: now.toISOString(),
		})
	}

	/**
	 * Check if Discord access should be refreshed for a user
	 * @param coreUserId - Core user ID
	 * @param intervalMinutes - Minimum minutes between refreshes (default: 15)
	 * @returns Whether refresh is needed (true if never refreshed or last refresh was more than intervalMinutes ago)
	 */
	async shouldRefreshDiscordAccess(coreUserId: string, intervalMinutes = 15): Promise<boolean> {
		const user = await this.getUserByCoreUserId(coreUserId)
		if (!user) {
			logger.warn('[DiscordDO] User not found for shouldRefreshDiscordAccess', { coreUserId })
			return false
		}

		// If never refreshed, refresh is needed
		if (!user.lastRefreshed) {
			logger.debug('[DiscordDO] Refresh needed - never refreshed', { coreUserId })
			return true
		}

		// Calculate cutoff time
		const cutoffTime = new Date(Date.now() - intervalMinutes * 60 * 1000)

		// Refresh is needed if last refresh was before cutoff time
		const needsRefresh = user.lastRefreshed < cutoffTime

		if (needsRefresh) {
			logger.debug('[DiscordDO] Refresh needed - last refresh too old', {
				coreUserId,
				lastRefreshed: user.lastRefreshed.toISOString(),
				cutoffTime: cutoffTime.toISOString(),
				intervalMinutes,
			})
		} else {
			logger.debug('[DiscordDO] Refresh not needed - recently refreshed', {
				coreUserId,
				lastRefreshed: user.lastRefreshed.toISOString(),
				cutoffTime: cutoffTime.toISOString(),
				intervalMinutes,
			})
		}

		return needsRefresh
	}

	/**
	 * Get users that need Discord access refresh
	 * Queries Discord database for users where coreUserId is not null and
	 * (lastRefreshed is null OR lastRefreshed is older than intervalMinutes)
	 *
	 * @param limit - Maximum number of users to return (default: 50)
	 * @param intervalMinutes - Minimum minutes between refreshes (default: 15)
	 * @returns Array of users needing refresh with coreUserId and discordUserId
	 */
	async getUsersNeedingRefresh(
		limit = 50,
		intervalMinutes = 15
	): Promise<
		Array<{
			coreUserId: string
			discordUserId: string
			lastRefreshed: Date | null
		}>
	> {
		const cutoffTime = new Date(Date.now() - intervalMinutes * 60 * 1000)

		const usersNeedingRefresh = await this.db
			.select({
				coreUserId: discordUsers.coreUserId,
				discordUserId: discordUsers.userId,
				lastRefreshed: discordUsers.lastRefreshed,
			})
			.from(discordUsers)
			.where(
				and(
					isNotNull(discordUsers.coreUserId),
					eq(discordUsers.authRevoked, false),
					sql`(${discordUsers.lastRefreshed} IS NULL OR ${discordUsers.lastRefreshed} < ${cutoffTime})`
				)
			)
			.orderBy(sql`${discordUsers.lastRefreshed} ASC NULLS FIRST`)
			.limit(limit)

		const results = usersNeedingRefresh
			.filter((u) => u.coreUserId !== null) // Filter out any null coreUserIds (shouldn't happen but TypeScript safety)
			.map((u) => ({
				coreUserId: u.coreUserId!,
				discordUserId: u.discordUserId,
				lastRefreshed: u.lastRefreshed,
			}))

		logger.debug('[DiscordDO] Found users needing refresh', {
			count: results.length,
			intervalMinutes,
			cutoffTime: cutoffTime.toISOString(),
		})

		return results
	}

	/**
	 * Manually revoke Discord authorization for a user (admin action)
	 */
	async revokeAuthorization(coreUserId: string): Promise<boolean> {
		const user = await this.getUserByCoreUserId(coreUserId)
		if (!user) return false

		if (user.authRevoked) {
			logger.warn('[DiscordDO] Authorization already revoked', { coreUserId })
			return true // Already revoked, so technically successful
		}

		// Mark as revoked
		await this.db
			.update(discordUsers)
			.set({
				authRevoked: true,
				authRevokedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(discordUsers.id, user.id))

		logger.info('[DiscordDO] Manually revoked Discord authorization', {
			coreUserId,
			userId: user.userId,
		})

		return true
	}

	/**
	 * Completely unlink a Discord account from a core user (admin action)
	 * Breaks the link by clearing coreUserId, revokes authorization,
	 * deletes tokens, and removes user from all managed Discord servers
	 * @param coreUserId - Core user ID to unlink
	 * @param knownGuildIds - Array of guild IDs to check for membership and remove user from
	 */
	async unlinkCoreUser(coreUserId: string, knownGuildIds: string[]): Promise<boolean> {
		try {
			const user = await this.getUserByCoreUserId(coreUserId)
			if (!user) {
				logger.warn('[DiscordDO] User not found for unlinking', { coreUserId })
				return false
			}

			const discordUserId = user.userId
			const botService = new DiscordBotService(this.env)

			// Check which of the provided guilds the user is a member of
			let guildIds: string[] = []
			try {
				if (knownGuildIds.length > 0) {
					guildIds = await this.checkGuildMembershipWithBot(coreUserId, knownGuildIds)
					logger.info('[DiscordDO] Found guilds for user removal', {
						coreUserId,
						discordUserId,
						guildCount: guildIds.length,
					})
				}
			} catch (error) {
				logger.warn('[DiscordDO] Could not fetch user guilds for removal', {
					coreUserId,
					discordUserId,
					error: String(error),
				})
			}

			// Delete all tokens first
			await this.db.delete(discordTokens).where(eq(discordTokens.userId, user.id))

			logger.info('[DiscordDO] Deleted Discord tokens', {
				coreUserId,
				discordUserId,
			})

			// Break the link by clearing coreUserId and marking as revoked
			await this.db
				.update(discordUsers)
				.set({
					coreUserId: null,
					authRevoked: true,
					authRevokedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(discordUsers.id, user.id))

			logger.info('[DiscordDO] Unlinked Discord account from core user', {
				coreUserId,
				discordUserId,
			})

			// Remove user from all guilds they were a member of
			if (guildIds.length > 0) {
				await Promise.all(
					guildIds.map(async (guildId) => {
						try {
							await botService.removeGuildMember(guildId, discordUserId)
							logger.info('[DiscordDO] Removed user from guild', {
								coreUserId,
								discordUserId,
								guildId,
							})
						} catch (error) {
							logger.error('[DiscordDO] Failed to remove user from guild', {
								coreUserId,
								discordUserId,
								guildId,
								error: String(error),
							})
						}
					})
				)
			}

			return true
		} catch (error) {
			logger.error('[DiscordDO] Error unlinking Discord account', {
				coreUserId,
				error: String(error),
			})
			return false
		}
	}

	/**
	 * Refresh token by core user ID
	 */
	async refreshTokenByCoreUserId(coreUserId: string): Promise<boolean> {
		const user = await this.getUserByCoreUserId(coreUserId)
		if (!user) return false

		return this.refreshToken(user.userId)
	}

	/**
	 * Store tokens directly (for PKCE flow)
	 */
	async storeTokensDirect(
		userId: string,
		username: string,
		discriminator: string,
		scopes: string[],
		accessToken: string,
		refreshToken: string,
		expiresAt: Date,
		coreUserId: string
	): Promise<boolean> {
		try {
			await this.storeToken(
				userId,
				username,
				discriminator,
				scopes,
				accessToken,
				refreshToken,
				expiresAt,
				coreUserId
			)
			return true
		} catch (error) {
			logger.error('Error storing tokens:', error)
			return false
		}
	}

	/**
	 * Link a Discord account using OAuth tokens
	 * Fetches user info from Discord and stores tokens
	 */
	async linkAccountWithTokens(
		accessToken: string,
		refreshToken: string,
		expiresIn: number,
		scopes: string,
		coreUserId: string
	): Promise<{
		success: boolean
		error?: string
		discordUserId?: string
		username?: string
	}> {
		try {
			const proxyUrl = this.getDiscordProxyUrl()

			// Fetch user info from Discord
			const userInfoResponse = await fetchWithRetry(this.env.DISCORD_USER_INFO_URL, {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'User-Agent': 'DiscordBot (https://pleaseignore.app, 1.0.0)',
				},
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			if (!userInfoResponse.ok) {
				const errorText = await userInfoResponse.text()
				logger.error('[DiscordDO] Failed to get user info from Discord', {
					status: userInfoResponse.status,
					error: errorText,
				})
				return {
					success: false,
					error: `Failed to get user info: ${errorText}`,
				}
			}

			const userInfo = (await userInfoResponse.json()) as {
				id: string
				username: string
				discriminator: string
			}

			logger.info('[DiscordDO] Got Discord user info', {
				discordUserId: userInfo.id,
				username: userInfo.username,
			})

			// Store the tokens
			const scopeArray = scopes ? scopes.split(' ') : []
			const expiresAt = new Date(Date.now() + expiresIn * 1000)

			await this.storeToken(
				userInfo.id,
				userInfo.username,
				userInfo.discriminator,
				scopeArray,
				accessToken,
				refreshToken,
				expiresAt,
				coreUserId
			)

			return {
				success: true,
				discordUserId: userInfo.id,
				username: userInfo.username,
			}
		} catch (error) {
			logger.error('[DiscordDO] Error linking account with tokens', {
				error: String(error),
			})
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Join a user to one or more Discord servers
	 */
	async joinUserToServers(
		coreUserId: string,
		guildIds: string[]
	): Promise<
		Array<{
			guildId: string
			guildName?: string
			success: boolean
			errorMessage?: string
			alreadyMember?: boolean
		}>
	> {
		// Get user from database
		const user = await this.getUserByCoreUserId(coreUserId)
		if (!user) {
			return guildIds.map((guildId) => ({
				guildId,
				success: false,
				errorMessage: 'Discord account not linked',
			}))
		}

		// Get valid access token
		const accessToken = await this.getValidAccessToken(user.id, user.userId)
		if (!accessToken) {
			return guildIds.map((guildId) => ({
				guildId,
				success: false,
				errorMessage:
					'Discord token expired and refresh failed. Please re-link your Discord account.',
			}))
		}

		// Process each guild
		const botService = new DiscordBotService(this.env)
		const results = await Promise.all(
			guildIds.map(async (guildId) => {
				const result = await botService.addGuildMember(guildId, user.userId, accessToken)
				return {
					guildId,
					...result,
				}
			})
		)

		// Track auth status
		await this.handleAuthResults(results, user.id, coreUserId)

		return results
	}

	/**
	 * Check which guilds a user is a member of using bot token
	 * @param coreUserId - Core user ID
	 * @param guildIds - Array of guild IDs to check
	 * @returns Array of guild IDs the user is a member of
	 */
	async checkGuildMembershipWithBot(coreUserId: string, guildIds: string[]): Promise<string[]> {
		try {
			// Get user from database
			const user = await this.getUserByCoreUserId(coreUserId)
			if (!user) {
				logger.error('[DiscordDO] User not found for checkGuildMembershipWithBot', {
					coreUserId,
				})
				return []
			}

			const discordUserId = user.userId
			const memberGuilds: string[] = []
			const botService = new DiscordBotService(this.env)

			// Check each guild using bot token (via proxy)
			await Promise.all(
				guildIds.map(async (guildId) => {
					try {
						const member = await botService.getGuildMember(guildId, discordUserId)
						if (member) {
							memberGuilds.push(guildId)
						}
						// null means user is not a member (404)
					} catch (error) {
						logger.error('[DiscordDO] Error checking guild membership', {
							coreUserId,
							guildId,
							error: String(error),
						})
					}
				})
			)

			logger.info('[DiscordDO] Checked guild membership with bot token', {
				coreUserId,
				discordUserId,
				totalChecked: guildIds.length,
				memberCount: memberGuilds.length,
			})

			return memberGuilds
		} catch (error) {
			logger.error('[DiscordDO] Error in checkGuildMembershipWithBot', {
				coreUserId,
				error: String(error),
			})
			return []
		}
	}

	/**
	 * Get detailed membership and role state for a user across guilds using bot token.
	 */
	async getUserGuildMembershipDetails(
		coreUserId: string,
		guildIds: string[]
	): Promise<DiscordGuildMembershipDetail[]> {
		try {
			const user = await this.getUserByCoreUserId(coreUserId)
			if (!user) {
				return guildIds.map((guildId) => ({
					guildId,
					isMember: false,
					currentRoleIds: [],
					currentRoles: [],
					errorMessage: 'Discord account not linked',
				}))
			}

			const discordUserId = user.userId
			const botService = new DiscordBotService(this.env)

			const membershipDetails = await Promise.all(
				guildIds.map(async (guildId) => {
					try {
						const member = await botService.getGuildMember(guildId, discordUserId)

						if (!member) {
							return {
								guildId,
								isMember: false,
								currentRoleIds: [],
								currentRoles: [],
							}
						}

						const currentRoleIds = member.roles || []
						const currentRoles = currentRoleIds.map((roleId) => ({
							roleId,
							roleName: null as string | null,
						}))

						if (currentRoleIds.length > 0) {
							try {
								const guildRoles = await botService.getGuildRoles(guildId)
								const roleNameById = new Map(guildRoles.map((role) => [role.id, role.name]))
								for (const role of currentRoles) {
									role.roleName = roleNameById.get(role.roleId) || null
								}
							} catch (error) {
								logger.warn('[DiscordDO] Failed to resolve guild role names', {
									coreUserId,
									guildId,
									error: String(error),
								})
							}
						}

						return {
							guildId,
							isMember: true,
							currentRoleIds,
							currentRoles,
						}
					} catch (error) {
						logger.error('[DiscordDO] Error getting guild membership details', {
							coreUserId,
							guildId,
							error: String(error),
						})
						return {
							guildId,
							isMember: false,
							currentRoleIds: [],
							currentRoles: [],
							errorMessage: error instanceof Error ? error.message : 'Unknown error',
						}
					}
				})
			)

			return membershipDetails
		} catch (error) {
			logger.error('[DiscordDO] Error in getUserGuildMembershipDetails', {
				coreUserId,
				error: String(error),
			})
			return guildIds.map((guildId) => ({
				guildId,
				isMember: false,
				currentRoleIds: [],
				currentRoles: [],
				errorMessage: error instanceof Error ? error.message : 'Unknown error',
			}))
		}
	}

	/**
	 * Update Discord roles for a user who is already a member of servers
	 */
	async updateUserRoles(
		coreUserId: string,
		updateRequests: Array<{ guildId: string; roleIds: string[]; managedRoleIds?: string[] }>,
		allowRemoval?: boolean
	): Promise<
		Array<{
			guildId: string
			success: boolean
			errorMessage?: string
			rolesAdded?: string[]
			rolesRemoved?: string[]
		}>
	> {
		try {
			// Check if add-only mode is enabled (default: true).
			// allowRemoval overrides the env var when explicitly set to true.
			const isAddOnlyMode = allowRemoval ? false : this.env.DISCORD_ROLE_ADD_ONLY_MODE !== 'false'

			// Get user from database
			const user = await this.getUserByCoreUserId(coreUserId)
			if (!user) {
				return updateRequests.map((req) => ({
					guildId: req.guildId,
					success: false,
					errorMessage: 'Discord account not linked',
				}))
			}

			// Get valid access token
			const accessToken = await this.getValidAccessToken(user.id, user.userId)
			if (!accessToken) {
				return updateRequests.map((req) => ({
					guildId: req.guildId,
					success: false,
					errorMessage: 'Discord token expired and refresh failed',
				}))
			}

			// Process each update request
			const botService = new DiscordBotService(this.env)
			const results = await Promise.all(
				updateRequests.map(async (req) => {
					try {
						// First, get current member data to see existing roles
						const currentMember = await botService.getGuildMember(req.guildId, user.userId)

						if (!currentMember) {
							logger.warn('[DiscordDO] User not a member of guild for role update', {
								guildId: req.guildId,
								userId: user.userId,
							})
							return {
								guildId: req.guildId,
								success: false,
								errorMessage: 'User is not a member of this server',
							}
						}

						const currentRoleIds = currentMember.roles || []
						const managedRoleIds = req.managedRoleIds || []

						// Calculate role changes using testable helper function
						const { newRoleIds, rolesAdded, rolesRemoved } = calculateRoleChanges({
							currentRoleIds,
							requestedRoleIds: req.roleIds,
							managedRoleIds,
							isAddOnlyMode,
						})

						// Only update if there are changes
						if (rolesAdded.length === 0 && rolesRemoved.length === 0) {
							return {
								guildId: req.guildId,
								success: true,
								rolesAdded: [],
								rolesRemoved: [],
							}
						}

						// Update the roles
						const updateResult = await botService.updateGuildMemberRoles(
							req.guildId,
							user.userId,
							newRoleIds
						)

						if (!updateResult.success) {
							logger.error('[DiscordDO] Failed to update roles', {
								guildId: req.guildId,
								userId: user.userId,
								error: updateResult.errorMessage,
							})
							return {
								guildId: req.guildId,
								success: false,
								errorMessage: updateResult.errorMessage,
							}
						}

						return {
							guildId: req.guildId,
							success: true,
							rolesAdded,
							rolesRemoved,
						}
					} catch (error) {
						logger.error('[DiscordDO] Error updating roles for guild', {
							guildId: req.guildId,
							error: String(error),
						})
						return {
							guildId: req.guildId,
							success: false,
							errorMessage: error instanceof Error ? error.message : 'Unknown error',
						}
					}
				})
			)

			// Track auth status
			await this.handleAuthResults(results, user.id, coreUserId)

			return results
		} catch (error) {
			logger.error('[DiscordDO] Error in updateUserRoles', {
				coreUserId,
				error: String(error),
			})
			return updateRequests.map((req) => ({
				guildId: req.guildId,
				success: false,
				errorMessage: error instanceof Error ? error.message : 'Unknown error occurred',
			}))
		}
	}

	/**
	 * Update user's nickname on specified Discord servers
	 */
	async updateUserNickname(
		coreUserId: string,
		guildIds: string[],
		nickname: string
	): Promise<void> {
		logger.info('[DiscordDO] updateUserNickname called', {
			coreUserId,
			guildIds,
			nickname,
		})

		try {
			// Get user from database
			const user = await this.getUserByCoreUserId(coreUserId)
			if (!user) {
				logger.warn('[DiscordDO] User not found for nickname update', { coreUserId })
				return
			}

			// Get valid access token (needed for member verification)
			const accessToken = await this.getValidAccessToken(user.id, user.userId)
			if (!accessToken) {
				logger.warn('[DiscordDO] No valid token for nickname update', { coreUserId })
				return
			}

			const botService = new DiscordBotService(this.env)

			// Update nickname on each guild
			await Promise.all(
				guildIds.map(async (guildId) => {
					try {
						// Get current member to retrieve current roles
						const currentMember = await botService.getGuildMember(guildId, user.userId)

						if (!currentMember) {
							logger.warn('[DiscordDO] User not a member of guild for nickname update', {
								guildId,
								userId: user.userId,
							})
							return
						}

						const currentRoleIds = currentMember.roles || []

						// Update roles (keeping them the same) and set nickname
						const result = await botService.updateGuildMemberRoles(
							guildId,
							user.userId,
							currentRoleIds,
							nickname
						)

						if (result.success) {
							logger.info('[DiscordDO] Successfully updated nickname', {
								guildId,
								userId: user.userId,
								nickname,
							})
						} else {
							logger.error('[DiscordDO] Failed to update nickname', {
								guildId,
								userId: user.userId,
								nickname,
								error: result.errorMessage,
							})
						}
					} catch (error) {
						logger.error('[DiscordDO] Error updating nickname for guild', {
							guildId,
							userId: user.userId,
							error: String(error),
						})
					}
				})
			)
		} catch (error) {
			logger.error('[DiscordDO] Error in updateUserNickname', {
				coreUserId,
				error: String(error),
			})
		}
	}

	/**
	 * Send a message to a Discord channel using the bot token
	 */
	async sendMessage(
		guildId: string,
		channelId: string,
		message: MessageContent
	): Promise<SendMessageResult> {
		try {
			const proxyUrl = this.getDiscordProxyUrl()

			// Build the message payload
			const payload: any = {
				content: message.content,
			}

			// Add embeds if provided
			if (message.embeds && message.embeds.length > 0) {
				payload.embeds = message.embeds
			}

			// Handle mention permissions
			if (message.allowEveryone === false) {
				payload.allowed_mentions = {
					parse: [], // Don't parse any mentions
				}
			} else if (message.allowEveryone === true) {
				payload.allowed_mentions = {
					parse: ['everyone', 'roles', 'users'],
				}
			} else {
				// Default: allow user and role mentions but not @everyone/@here
				payload.allowed_mentions = {
					parse: ['roles', 'users'],
				}
			}

			// Send message via Discord API (with retry on rate limit)
			const url = `https://discord.com/api/v10/channels/${channelId}/messages`
			const response = await fetchWithRetry(url, {
				method: 'POST',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(payload),
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			if (!response.ok) {
				const errorData = (await response.json().catch(() => ({ message: 'Unknown error' }))) as {
					message?: string
				}

				// Check for rate limit
				if (response.status === 429) {
					const retryAfter = response.headers.get('X-RateLimit-Reset-After')
					return {
						success: false,
						error: 'Rate limited',
						retryAfter: retryAfter ? Number.parseInt(retryAfter, 10) : undefined,
					}
				}

				// Check for permission errors
				if (response.status === 403) {
					return {
						success: false,
						error: 'Missing permissions to send message in this channel',
					}
				}

				// Check for not found
				if (response.status === 404) {
					return {
						success: false,
						error: 'Channel not found',
					}
				}

				return {
					success: false,
					error: errorData.message || `Discord API error: ${response.status}`,
				}
			}

			const result = (await response.json()) as { id: string }

			logger.info('[DiscordDO] Successfully sent message', {
				guildId,
				channelId,
				messageId: result.id,
			})

			return {
				success: true,
				messageId: result.id,
			}
		} catch (error) {
			logger.error('[DiscordDO] Error sending message', {
				guildId,
				channelId,
				error: String(error),
			})

			return {
				success: false,
				error: error instanceof Error ? error.message : 'Failed to send message',
			}
		}
	}

	async editMessage(
		channelId: string,
		messageId: string,
		content: string
	): Promise<SendMessageResult> {
		try {
			const proxyUrl = this.getDiscordProxyUrl()
			const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`
			const response = await fetchWithRetry(url, {
				method: 'PATCH',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ content }),
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			if (!response.ok) {
				const errorData = (await response.json().catch(() => ({ message: 'Unknown error' }))) as {
					message?: string
				}
				return {
					success: false,
					error: errorData.message || `Discord API error: ${response.status}`,
				}
			}

			const result = (await response.json()) as { id: string }
			return { success: true, messageId: result.id }
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Failed to edit message',
			}
		}
	}

	async deleteMessage(
		channelId: string,
		messageId: string
	): Promise<{ success: boolean; error?: string }> {
		try {
			const proxyUrl = this.getDiscordProxyUrl()
			const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`
			const response = await fetchWithRetry(url, {
				method: 'DELETE',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
				},
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			// 204 No Content is success for DELETE
			if (!response.ok && response.status !== 204) {
				const errorData = (await response.json().catch(() => ({ message: 'Unknown error' }))) as {
					message?: string
				}
				return {
					success: false,
					error: errorData.message || `Discord API error: ${response.status}`,
				}
			}

			return { success: true }
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Failed to delete message',
			}
		}
	}

	/**
	 * Send a direct message to a user by their core user ID
	 * Creates or gets a DM channel and sends the message
	 */
	async sendDirectMessage(coreUserId: string, message: MessageContent): Promise<SendMessageResult> {
		try {
			// Get Discord profile by core user ID
			const profile = await this.getProfileByCoreUserId(coreUserId)

			if (!profile) {
				return {
					success: false,
					error: 'Discord account not linked for this user',
				}
			}

			// Create Discord fetch client with proxy support
			const client = this.createDiscordClient()

			// Create or get DM channel
			const channel = await client.post<{ id: string }>(DiscordRoutes.userChannels(), {
				recipient_id: profile.userId,
			})

			// Build the message payload
			const payload: Record<string, unknown> = {
				content: message.content,
			}

			// Add embeds if provided
			if (message.embeds && message.embeds.length > 0) {
				payload.embeds = message.embeds
			}

			// Handle mention permissions
			if (message.allowEveryone === false) {
				payload.allowed_mentions = {
					parse: [], // Don't parse any mentions
				}
			} else if (message.allowEveryone === true) {
				payload.allowed_mentions = {
					parse: ['everyone', 'roles', 'users'],
				}
			} else {
				// Default: allow user and role mentions but not @everyone/@here
				payload.allowed_mentions = {
					parse: ['roles', 'users'],
				}
			}

			// Send message
			const result = await client.post<{ id: string }>(
				DiscordRoutes.channelMessages(channel.id),
				payload
			)

			logger.info('[DiscordDO] Successfully sent direct message', {
				coreUserId,
				discordUserId: profile.userId,
				messageId: result.id,
			})

			return {
				success: true,
				messageId: result.id,
			}
		} catch (error: unknown) {
			// Handle Discord API errors
			if (error instanceof DiscordAPIError) {
				// Handle permission errors
				if (error.status === 403) {
					return {
						success: false,
						error: 'Missing permissions to send DM to this user',
					}
				}

				// Handle not found
				if (error.status === 404) {
					return {
						success: false,
						error: 'DM channel not found',
					}
				}

				logger.error('[DiscordDO] Discord API error sending direct message', {
					coreUserId,
					status: error.status,
					body: error.body,
				})

				return {
					success: false,
					error: `Discord API error: ${error.status}`,
				}
			}

			logger.error('[DiscordDO] Error sending direct message', {
				coreUserId,
				error: String(error),
			})

			return {
				success: false,
				error: error instanceof Error ? error.message : 'Failed to send direct message',
			}
		}
	}

	/**
	 * Create or update a guild slash command by name.
	 */
	async upsertGuildSlashCommand(
		guildId: string,
		command: DiscordSlashCommandDefinition
	): Promise<DiscordRegisteredSlashCommand> {
		const normalizedName = command.name.trim().toLowerCase()
		if (!/^[a-z0-9_-]{1,32}$/.test(normalizedName)) {
			throw new Error('Invalid command name; expected ^[a-z0-9_-]{1,32}$')
		}

		const description = command.description.trim()
		if (!description || description.length > 100) {
			throw new Error('Invalid command description; expected 1-100 characters')
		}

		const applicationId = this.env.DISCORD_CLIENT_ID?.trim()
		if (!applicationId) {
			throw new Error('DISCORD_CLIENT_ID is not configured')
		}

		const client = this.createDiscordClient()
		const baseRoute = `/applications/${applicationId}/guilds/${guildId}/commands`
		const payload = {
			name: normalizedName,
			description,
			type: 1, // CHAT_INPUT
			...(command.options && command.options.length > 0 ? { options: command.options } : {}),
		}

		const existing = await client.get<Array<{ id: string; name: string; description: string }>>(
			baseRoute
		)
		const existingByName = existing.find((entry) => entry.name === normalizedName)

		const registered = existingByName
			? await client.patch<{ id: string; name: string; description: string }>(
					`${baseRoute}/${existingByName.id}`,
					payload
				)
			: await client.post<{ id: string; name: string; description: string }>(baseRoute, payload)

		return {
			id: registered.id,
			name: registered.name,
			description: registered.description,
		}
	}

	/**
	 * Delete a guild slash command by ID or name.
	 */
	async deleteGuildSlashCommand(
		guildId: string,
		opts: { commandId?: string; commandName?: string }
	): Promise<{ success: boolean; deletedCommandId?: string; error?: string }> {
		const applicationId = this.env.DISCORD_CLIENT_ID?.trim()
		if (!applicationId) {
			return { success: false, error: 'DISCORD_CLIENT_ID is not configured' }
		}

		const client = this.createDiscordClient()
		const baseRoute = `/applications/${applicationId}/guilds/${guildId}/commands`
		let commandId = opts.commandId?.trim()

		if (!commandId && opts.commandName) {
			const commandName = opts.commandName.trim().toLowerCase()
			const commands = await client.get<Array<{ id: string; name: string }>>(baseRoute)
			commandId = commands.find((entry) => entry.name === commandName)?.id
			if (!commandId) {
				return { success: false, error: 'Command not found for guild' }
			}
		}

		if (!commandId) {
			return { success: false, error: 'Either commandId or commandName is required' }
		}

		try {
			await client.delete<unknown>(`${baseRoute}/${commandId}`)
			return { success: true, deletedCommandId: commandId }
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				return { success: false, error: 'Command not found for guild' }
			}
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Failed to delete slash command',
			}
		}
	}

	// ==================== PRIVATE HELPER METHODS ====================

	/**
	 * Create a Discord fetch client with proxy support and rate limiting
	 * @returns Configured DiscordFetch client instance
	 */
	private createDiscordClient(): DiscordFetch {
		const proxy = this.getDiscordFetchProxy()

		return new DiscordFetch({
			token: this.env.DISCORD_BOT_TOKEN,
			tokenType: 'Bot',
			...(proxy ? { proxy } : {}),
			maxRetries: 3,
		})
	}

	/**
	 * Manually refresh a token
	 */
	private async refreshToken(userId: string): Promise<boolean> {
		try {
			// Get user from database
			const user = await this.db.query.discordUsers.findFirst({
				where: eq(discordUsers.userId, userId),
				with: {
					tokens: true,
				},
			})

			if (!user || user.tokens.length === 0) {
				logger.error('[DiscordDO] User or tokens not found for refresh', { userId })
				return false
			}

			const token = user.tokens[0]

			if (!token.refreshToken) {
				logger.error('[DiscordDO] No refresh token available', { userId })
				return false
			}

			const decryptedRefreshToken = await this.decrypt(token.refreshToken)

			const proxyUrl = this.getDiscordProxyUrl()

			// Prepare the token refresh request
			const params = new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: decryptedRefreshToken,
			})

			const response = await fetchWithRetry(this.env.DISCORD_TOKEN_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Basic ${btoa(`${this.env.DISCORD_CLIENT_ID}:${this.env.DISCORD_CLIENT_SECRET}`)}`,
				},
				body: params.toString(),
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				logger.error('[DiscordDO] Failed to refresh token', {
					userId,
					status: response.status,
					error: errorText,
				})
				return false
			}

			const data = (await response.json()) as DiscordTokenResponse
			const newExpiresAt = new Date(Date.now() + data.expires_in * 1000)

			// Encrypt the new tokens
			const encryptedAccessToken = await this.encrypt(data.access_token)
			const encryptedRefreshToken = await this.encrypt(data.refresh_token || decryptedRefreshToken)

			// Update the tokens in the database
			await this.db
				.update(discordTokens)
				.set({
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt: newExpiresAt,
					updatedAt: new Date(),
				})
				.where(eq(discordTokens.id, token.id))

			logger.info('[DiscordDO] Successfully refreshed token', {
				userId,
				newExpiresAt,
			})

			return true
		} catch (error) {
			logger.error('[DiscordDO] Error refreshing token', {
				userId,
				error,
			})
			return false
		}
	}

	/**
	 * Store Discord tokens (private - for internal use)
	 */
	private async storeToken(
		userId: string,
		username: string,
		discriminator: string,
		scopes: string[],
		accessToken: string,
		refreshToken: string,
		expiresAt: Date,
		coreUserId: string
	): Promise<void> {
		// Encrypt tokens
		const encryptedAccessToken = await this.encrypt(accessToken)
		const encryptedRefreshToken = await this.encrypt(refreshToken)

		// Check if user already exists
		let user = await this.db.query.discordUsers.findFirst({
			where: eq(discordUsers.userId, userId),
		})

		if (user) {
			// Update existing user
			await this.db
				.update(discordUsers)
				.set({
					username,
					discriminator,
					scopes: JSON.stringify(scopes),
					coreUserId,
					authRevoked: false, // Clear revoked status when re-linking
					authRevokedAt: null,
					lastSuccessfulAuth: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(discordUsers.id, user.id))

			// Update or create token
			const existingToken = await this.db.query.discordTokens.findFirst({
				where: eq(discordTokens.userId, user.id),
			})

			if (existingToken) {
				await this.db
					.update(discordTokens)
					.set({
						accessToken: encryptedAccessToken,
						refreshToken: encryptedRefreshToken,
						expiresAt,
						updatedAt: new Date(),
					})
					.where(eq(discordTokens.id, existingToken.id))
			} else {
				await this.db.insert(discordTokens).values({
					userId: user.id,
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
				})
			}
		} else {
			// Create new user
			const [newUser] = await this.db
				.insert(discordUsers)
				.values({
					userId,
					username,
					discriminator,
					scopes: JSON.stringify(scopes),
					coreUserId,
					authRevoked: false,
					lastSuccessfulAuth: new Date(),
				})
				.returning({ id: discordUsers.id })

			// Create token
			await this.db.insert(discordTokens).values({
				userId: newUser.id,
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
			})
		}

		logger.info('[DiscordDO] Stored tokens successfully', {
			userId,
			username,
			coreUserId,
		})
	}

	/**
	 * Get encryption key from environment
	 */
	private async getEncryptionKey(): Promise<CryptoKey> {
		// Convert hex string to bytes
		const keyData = new Uint8Array(
			this.env.ENCRYPTION_KEY.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
		)

		return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, [
			'encrypt',
			'decrypt',
		])
	}

	/**
	 * Encrypt data using Web Crypto API
	 */
	private async encrypt(data: string): Promise<string> {
		const key = await this.getEncryptionKey()
		const iv = crypto.getRandomValues(new Uint8Array(12))
		const encodedData = new TextEncoder().encode(data)

		const encryptedData = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedData)

		// Combine IV and encrypted data
		const combined = new Uint8Array(iv.length + encryptedData.byteLength)
		combined.set(iv)
		combined.set(new Uint8Array(encryptedData), iv.length)
		// Return as base64
		return btoa(String.fromCharCode(...combined))
	}

	/**
	 * Decrypt data using Web Crypto API
	 */
	private async decrypt(encryptedData: string): Promise<string> {
		const key = await this.getEncryptionKey()

		// Decode from base64
		const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0))

		// Extract IV and data
		const iv = combined.slice(0, 12)
		const data = combined.slice(12)

		const decryptedData = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)

		return new TextDecoder().decode(decryptedData)
	}
}
