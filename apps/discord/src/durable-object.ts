import { DurableObject } from 'cloudflare:workers'

import { eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { discordTokens, discordUsers } from './db/schema'
import { DiscordBotService } from './services/discord-bot.service'

import type { Discord, DiscordTokenResponse, MessageContent, SendMessageResult } from '@repo/discord'
import type { Env } from './context'
import { generateShardKey } from '@repo/hazmat'

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

	/**
	 * Get Discord profile by core user ID
	 * @param coreUserId - Core user ID to look up
	 * @returns Discord user info or null if not found
	 */
	async getProfileByCoreUserId(coreUserId: string): Promise<{
		userId: string
		username: string
		discriminator: string
		scopes: string[]
	} | null> {
		const user = await this.db.query.discordUsers.findFirst({
			where: eq(discordUsers.coreUserId, coreUserId),
		})

		if (!user) {
			return null
		}

		return {
			userId: user.userId,
			username: user.username,
			discriminator: user.discriminator,
			scopes: JSON.parse(user.scopes),
		}
	}

	/**
	 * Get Discord user status including auth revocation info
	 * @param coreUserId - Core user ID
	 * @returns Discord user status or null if not found
	 */
	async getDiscordUserStatus(coreUserId: string): Promise<{
		userId: string
		username: string
		discriminator: string
		coreUserId: string | null
		authRevoked: boolean
		authRevokedAt: Date | null
		lastSuccessfulAuth: Date | null
		createdAt: Date
		updatedAt: Date
	} | null> {
		const user = await this.db.query.discordUsers.findFirst({
			where: eq(discordUsers.coreUserId, coreUserId),
		})

		if (!user) {
			return null
		}

		return {
			userId: user.userId,
			username: user.username,
			discriminator: user.discriminator,
			coreUserId: user.coreUserId,
			authRevoked: user.authRevoked,
			authRevokedAt: user.authRevokedAt,
			lastSuccessfulAuth: user.lastSuccessfulAuth,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		}
	}

	/**
	 * Manually revoke Discord authorization for a user (admin action)
	 * @param coreUserId - Core user ID
	 * @returns Success status
	 */
	async revokeAuthorization(coreUserId: string): Promise<boolean> {
		const user = await this.db.query.discordUsers.findFirst({
			where: eq(discordUsers.coreUserId, coreUserId),
		})

		if (!user) {
			logger.error('[DiscordDO] User not found for manual revocation', { coreUserId })
			return false
		}

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
	 * Refresh token by core user ID
	 * @param coreUserId - Core user ID
	 * @returns Success status
	 */
	async refreshTokenByCoreUserId(coreUserId: string): Promise<boolean> {
		const user = await this.db.query.discordUsers.findFirst({
			where: eq(discordUsers.coreUserId, coreUserId),
		})

		if (!user) {
			return false
		}

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
	 * Join a user to one or more Discord servers
	 * Uses the user's OAuth token and bot token to add them directly to servers
	 *
	 * @param coreUserId - Core user ID
	 * @param guildIds - Array of Discord guild/server IDs to join
	 * @returns Array of results for each guild
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
		const user = await this.db.query.discordUsers.findFirst({
			where: eq(discordUsers.coreUserId, coreUserId),
		})

		if (!user) {
			logger.error('[DiscordDO] User not found by core user ID', { coreUserId })
			// Return failure for all guilds
			return guildIds.map((guildId) => ({
				guildId,
				success: false,
				errorMessage: 'Discord account not linked',
			}))
		}

		// Get user's token
		const tokenRecord = await this.db.query.discordTokens.findFirst({
			where: eq(discordTokens.userId, user.id),
		})

		if (!tokenRecord) {
			logger.error('[DiscordDO] Token not found for user', { userId: user.userId })
			return guildIds.map((guildId) => ({
				guildId,
				success: false,
				errorMessage: 'Discord token not found',
			}))
		}

		// Check if token is expired
		if (tokenRecord.expiresAt < new Date()) {
			logger.info('[DiscordDO] Token expired, attempting refresh', { userId: user.userId })

			// Try to refresh the token
			const refreshSuccess = await this.refreshToken(user.userId)

			if (!refreshSuccess) {
				logger.error('[DiscordDO] Failed to refresh expired token', { userId: user.userId })
				return guildIds.map((guildId) => ({
					guildId,
					success: false,
					errorMessage:
						'Discord token expired and refresh failed. Please re-link your Discord account.',
				}))
			}

			// Get the refreshed token
			const refreshedToken = await this.db.query.discordTokens.findFirst({
				where: eq(discordTokens.userId, user.id),
			})

			if (!refreshedToken) {
				return guildIds.map((guildId) => ({
					guildId,
					success: false,
					errorMessage: 'Failed to retrieve refreshed token',
				}))
			}

			// Use refreshed token
			const decryptedAccessToken = await this.decrypt(refreshedToken.accessToken)
			const botService = new DiscordBotService(this.env)

			// Process each guild
			const results = await Promise.all(
				guildIds.map(async (guildId) => {
					const result = await botService.addGuildMember(guildId, user.userId, decryptedAccessToken)
					return {
						guildId,
						...result,
					}
				})
			)

			return results
		}

		// Token is valid, decrypt and use it
		const decryptedAccessToken = await this.decrypt(tokenRecord.accessToken)
		const botService = new DiscordBotService(this.env)

		// Process each guild
		const results = await Promise.all(
			guildIds.map(async (guildId) => {
				const result = await botService.addGuildMember(guildId, user.userId, decryptedAccessToken)
				return {
					guildId,
					...result,
				}
			})
		)

		return results
	}

	/**
	 * Join a user to multiple Discord servers with role assignments
	 *
	 * @param coreUserId - Core user ID
	 * @param joinRequests - Array of guild join requests with role IDs
	 * @returns Results for each guild join attempt
	 */
	async joinUserToServersWithRoles(
		coreUserId: string,
		joinRequests: Array<{ guildId: string; roleIds: string[]; nickname?: string }>
	): Promise<
		Array<{
			guildId: string
			guildName?: string
			success: boolean
			errorMessage?: string
			alreadyMember?: boolean
		}>
	> {
		try {
			// Get user from database
			const user = await this.db.query.discordUsers.findFirst({
				where: eq(discordUsers.coreUserId, coreUserId),
			})

			if (!user) {
				logger.error('[DiscordDO] User not found by core user ID', { coreUserId })
				// Return failure for all guilds
				return joinRequests.map((req) => ({
					guildId: req.guildId,
					success: false,
					errorMessage: 'Discord account not linked',
				}))
			}

			// Get user's token
			const tokenRecord = await this.db.query.discordTokens.findFirst({
				where: eq(discordTokens.userId, user.id),
			})

			if (!tokenRecord) {
				logger.error('[DiscordDO] Token not found for user', { userId: user.userId })
				return joinRequests.map((req) => ({
					guildId: req.guildId,
					success: false,
					errorMessage: 'Discord token not found',
				}))
			}

			// Check if token is expired
			if (tokenRecord.expiresAt < new Date()) {
				logger.info('[DiscordDO] Token expired, attempting refresh', { userId: user.userId })

				// Try to refresh the token
				const refreshSuccess = await this.refreshToken(user.userId)

				if (!refreshSuccess) {
					logger.error('[DiscordDO] Failed to refresh expired token', { userId: user.userId })
					return joinRequests.map((req) => ({
						guildId: req.guildId,
						success: false,
						errorMessage:
							'Discord token expired and refresh failed. Please re-link your Discord account.',
					}))
				}

				// Get the refreshed token
				const refreshedToken = await this.db.query.discordTokens.findFirst({
					where: eq(discordTokens.userId, user.id),
				})

				if (!refreshedToken) {
					return joinRequests.map((req) => ({
						guildId: req.guildId,
						success: false,
						errorMessage: 'Failed to retrieve refreshed token',
					}))
				}

				// Use refreshed token
				const decryptedAccessToken = await this.decrypt(refreshedToken.accessToken)
				const botService = new DiscordBotService(this.env)

				// Process each guild with role assignments
				const results = await Promise.all(
					joinRequests.map(async (req) => {
						const result = await botService.addGuildMember(
							req.guildId,
							user.userId,
							decryptedAccessToken,
							req.roleIds,
							req.nickname
						)
						return {
							guildId: req.guildId,
							...result,
						}
					})
				)

				// Check if any result indicates revoked authorization
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
						.where(eq(discordUsers.id, user.id))

					logger.warn('[DiscordDO] Marked user as having revoked Discord authorization', {
						userId: user.userId,
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
						.where(eq(discordUsers.id, user.id))
				}

				return results
			}

			// Token is valid, decrypt and use it
			const decryptedAccessToken = await this.decrypt(tokenRecord.accessToken)
			const botService = new DiscordBotService(this.env)

			// Process each guild with role assignments
			const results = await Promise.all(
				joinRequests.map(async (req) => {
					const result = await botService.addGuildMember(
						req.guildId,
						user.userId,
						decryptedAccessToken,
						req.roleIds,
						req.nickname
					)
					return {
						guildId: req.guildId,
						...result,
					}
				})
			)

			// Check if any result indicates revoked authorization
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
					.where(eq(discordUsers.id, user.id))

				logger.warn('[DiscordDO] Marked user as having revoked Discord authorization', {
					userId: user.userId,
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
					.where(eq(discordUsers.id, user.id))
			}

			return results
		} catch (error) {
			logger.error('[DiscordDO] Error in joinUserToServersWithRoles', {
				error: String(error),
				errorMessage: error instanceof Error ? error.message : 'Unknown error',
				coreUserId,
			})
			// Return failure for all guilds
			return joinRequests.map((req) => ({
				guildId: req.guildId,
				success: false,
				errorMessage: error instanceof Error ? error.message : 'Unknown error occurred',
			}))
		}
	}

	/**
	 * Manually refresh a token (private - used internally)
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

			if (!user) {
				logger.error('User not found:', userId)
				return false
			}

			// Get token record
			const tokenRecord = await this.db.query.discordTokens.findFirst({
				where: eq(discordTokens.userId, user.id),
			})

			if (!tokenRecord || !tokenRecord.refreshToken) {
				logger.error('Token or refresh token not found')
				return false
			}

			// Decrypt refresh token
			const refreshToken = await this.decrypt(tokenRecord.refreshToken)

			// Refresh the token
			const newTokenResponse = await this.refreshAccessToken(refreshToken)

			// Calculate new expiration
			const expiresAt = new Date(Date.now() + newTokenResponse.expires_in * 1000)

			// Encrypt new tokens
			const encryptedAccessToken = await this.encrypt(newTokenResponse.access_token)
			const encryptedRefreshToken = newTokenResponse.refresh_token
				? await this.encrypt(newTokenResponse.refresh_token)
				: tokenRecord.refreshToken

			// Update token in database
			await this.db
				.update(discordTokens)
				.set({
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
					updatedAt: new Date(),
				})
				.where(eq(discordTokens.id, tokenRecord.id))

			return true
		} catch (error) {
			logger.error('Error refreshing token:', error)
			return false
		}
	}

	/**
	 * Get access token for a user (decrypted and auto-refreshed if needed)
	 * @param userId - Discord user ID
	 * @returns Access token or null if not found
	 */
	private async getAccessToken(userId: string): Promise<string | null> {
		const user = await this.db.query.discordUsers.findFirst({
			where: eq(discordUsers.userId, userId),
		})

		if (!user) {
			return null
		}

		const tokenRecord = await this.db.query.discordTokens.findFirst({
			where: eq(discordTokens.userId, user.id),
		})

		if (!tokenRecord) {
			return null
		}

		// Check if token is expired
		if (tokenRecord.expiresAt < new Date()) {
			// Try to refresh
			const refreshed = await this.refreshToken(userId)
			if (!refreshed) {
				return null
			}

			// Fetch updated token
			const updatedToken = await this.db.query.discordTokens.findFirst({
				where: eq(discordTokens.userId, user.id),
			})

			if (!updatedToken) {
				return null
			}

			return this.decrypt(updatedToken.accessToken)
		}

		return this.decrypt(tokenRecord.accessToken)
	}

	/**
	 * Make an authenticated Discord API request
	 * @param userId - Discord user ID for authentication
	 * @param path - Discord API path (e.g., '/users/@me/guilds')
	 * @param options - Optional fetch options (method, body, headers, etc.)
	 * @returns Response from Discord API
	 * @throws Error if user has no valid token or API request fails
	 *
	 * @example
	 * ```ts
	 * // Get user's guilds
	 * const guilds = await this.fetchDiscordApi<Guild[]>(userId, '/users/@me/guilds')
	 *
	 * // Add user to guild
	 * await this.fetchDiscordApi(userId, `/guilds/${guildId}/members/${userId}`, {
	 *   method: 'PUT',
	 *   body: JSON.stringify({ access_token: token })
	 * })
	 * ```
	 */
	private async fetchDiscordApi<T = unknown>(
		userId: string,
		path: string,
		options?: RequestInit
	): Promise<T> {
		// Get access token for the user
		const accessToken = await this.getAccessToken(userId)

		if (!accessToken) {
			throw new Error(`No valid access token for user ${userId}`)
		}

		// Build full URL
		const url = `https://discord.com/api/v10${path}`

		// Merge headers with authorization
		const headers = new Headers(options?.headers)
		headers.set('Authorization', `Bearer ${accessToken}`)
		headers.set('Content-Type', 'application/json')

		// Make the request
		const response = await fetch(url, {
			...options,
			headers,
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(
				`Discord API request failed: ${response.status} ${response.statusText} - ${errorText}`
			)
		}

		// Handle 204 No Content responses
		if (response.status === 204) {
			return undefined as T
		}

		return response.json<T>()
	}

	/**
	 * Refresh access token using refresh token
	 */
	private async refreshAccessToken(refreshToken: string): Promise<DiscordTokenResponse> {
		const response = await fetch(this.env.DISCORD_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'User-Agent': 'DiscordBot (https://pleaseignore.app, 1.0.0)',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: this.env.DISCORD_CLIENT_ID,
				client_secret: this.env.DISCORD_CLIENT_SECRET,
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Token refresh failed: ${error}`)
		}

		return response.json<DiscordTokenResponse>()
	}

	/**
	 * Store token in database (upsert)
	 */
	private async storeToken(
		userId: string,
		username: string,
		discriminator: string,
		scopes: string[],
		accessToken: string,
		refreshToken: string | null,
		expiresAt: Date,
		coreUserId?: string
	): Promise<void> {
		// Encrypt tokens
		const encryptedAccessToken = await this.encrypt(accessToken)
		const encryptedRefreshToken = refreshToken ? await this.encrypt(refreshToken) : null

		// Check if user exists
		let user = await this.db.query.discordUsers.findFirst({
			where: eq(discordUsers.userId, userId),
		})

		if (user) {
			// Update existing user (clear authRevoked and set lastSuccessfulAuth when re-linking)
			await this.db
				.update(discordUsers)
				.set({
					username,
					discriminator,
					scopes: JSON.stringify(scopes),
					coreUserId: coreUserId ?? user.coreUserId,
					authRevoked: false,
					authRevokedAt: null,
					lastSuccessfulAuth: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(discordUsers.id, user.id))
		} else {
			// Insert new user
			const [newUser] = await this.db
				.insert(discordUsers)
				.values({
					userId,
					username,
					discriminator,
					scopes: JSON.stringify(scopes),
					coreUserId,
				})
				.returning()

			user = newUser
		}

		if (!user) {
			throw new Error('Failed to create or update user')
		}

		// Check if token exists
		const existingToken = await this.db.query.discordTokens.findFirst({
			where: eq(discordTokens.userId, user.id),
		})

		if (existingToken) {
			// Update existing token (set lastSuccessfulAuth when re-linking)
			await this.db
				.update(discordTokens)
				.set({
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
					lastSuccessfulAuth: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(discordTokens.id, existingToken.id))
		} else {
			// Insert new token
			await this.db.insert(discordTokens).values({
				userId: user.id,
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
				lastSuccessfulAuth: new Date(),
			})
		}
	}

	/**
	 * Encrypt data using AES-GCM
	 */
	private async encrypt(data: string): Promise<string> {
		const key = await this.getEncryptionKey()
		const iv = crypto.getRandomValues(new Uint8Array(12))
		const encodedData = new TextEncoder().encode(data)

		const encryptedData = await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv,
			},
			key,
			encodedData
		)

		// Combine IV and encrypted data
		const combined = new Uint8Array(iv.length + encryptedData.byteLength)
		combined.set(iv)
		combined.set(new Uint8Array(encryptedData), iv.length)

		// Return as base64
		return btoa(String.fromCharCode(...combined))
	}

	/**
	 * Decrypt data using AES-GCM
	 */
	private async decrypt(encryptedData: string): Promise<string> {
		const key = await this.getEncryptionKey()

		// Decode from base64
		const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0))

		// Extract IV and data
		const iv = combined.slice(0, 12)
		const data = combined.slice(12)

		const decryptedData = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv,
			},
			key,
			data
		)

		return new TextDecoder().decode(decryptedData)
	}

	/**
	 * Get or create encryption key from environment
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
	 * Send a message to a Discord channel using the bot token
	 * @param guildId - Discord guild/server ID (used for logging)
	 * @param channelId - Discord channel ID
	 * @param message - Message content to send
	 * @returns Result indicating success or failure
	 */
	async sendMessage(
		guildId: string,
		channelId: string,
		message: MessageContent
	): Promise<SendMessageResult> {
		try {
			// Generate dynamic proxy URL for rate limit handling
			const proxyUrl = this.getDiscordProxyUrl()

			// Build allowed_mentions based on allowEveryone flag
			const allowedMentions: any = {
				parse: message.allowEveryone ? ['everyone', 'roles', 'users'] : ['users', 'roles'],
			}

			// Build request body
			const body: any = {
				content: message.content,
				allowed_mentions: allowedMentions,
			}

			// Add embeds if provided
			if (message.embeds && message.embeds.length > 0) {
				body.embeds = message.embeds
			}

			// Make API call to send message
			const url = `https://discord.com/api/v10/channels/${channelId}/messages`
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				// @ts-expect-error - Cloudflare Workers supports proxy in fetch
				proxy: proxyUrl,
			})

			// Handle success
			if (response.ok) {
				const result = await response.json<{ id: string }>()
				logger.info('[DiscordDO] Successfully sent message', {
					guildId,
					channelId,
					messageId: result.id,
				})

				return {
					success: true,
					messageId: result.id,
				}
			}

			// Handle rate limiting (429)
			if (response.status === 429) {
				const rateLimitData = await response.json<{ retry_after: number }>()
				logger.warn('[DiscordDO] Rate limited sending message', {
					guildId,
					channelId,
					retryAfter: rateLimitData.retry_after,
				})

				return {
					success: false,
					error: 'Rate limited',
					retryAfter: rateLimitData.retry_after,
				}
			}

			// Handle permission errors (403)
			if (response.status === 403) {
				const errorData = await response.json().catch(() => ({}))
				logger.error('[DiscordDO] Permission denied sending message', {
					guildId,
					channelId,
					error: errorData,
				})

				return {
					success: false,
					error: 'Bot lacks permission to send messages in this channel',
				}
			}

			// Handle invalid channel (404)
			if (response.status === 404) {
				logger.error('[DiscordDO] Channel not found', {
					guildId,
					channelId,
				})

				return {
					success: false,
					error: 'Channel not found',
				}
			}

			// Handle other errors
			const errorData = await response.json().catch(() => ({}))
			logger.error('[DiscordDO] Discord API error sending message', {
				guildId,
				channelId,
				status: response.status,
				error: errorData,
			})

			return {
				success: false,
				error: `Discord API error: ${response.status} ${response.statusText}`,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error('[DiscordDO] Unexpected error sending message', {
				guildId,
				channelId,
				error: errorMessage,
			})

			return {
				success: false,
				error: `Failed to send message: ${errorMessage}`,
			}
		}
	}

	/**
	 * Generate a dynamic HTTPS proxy URL using rotating ports
	 * Uses generateShardKey for cryptographically secure random port selection
	 */
	private getDiscordProxyUrl(): string {
		const portStart = Number(this.env.DISCORD_PROXY_PORT_START)
		const portCount = Number(this.env.DISCORD_PROXY_PORT_COUNT)
		const portEnd = portStart + portCount - 1
		const port = generateShardKey(portStart, portEnd)

		return `https://${this.env.DISCORD_PROXY_USERNAME}:${this.env.DISCORD_PROXY_PASSWORD}@${this.env.DISCORD_PROXY_HOST}:${port}`
	}
}
