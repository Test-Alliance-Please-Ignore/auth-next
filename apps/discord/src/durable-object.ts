import { DurableObject } from 'cloudflare:workers'

import { eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { discordTokens, discordUsers } from './db/schema'

import type { Discord, DiscordTokenResponse } from '@repo/discord'
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
		const { DiscordBotService } = await import('./services/discord-bot.service')

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
		joinRequests: Array<{ guildId: string; roleIds: string[] }>
	): Promise<
		Array<{
			guildId: string
			guildName?: string
			success: boolean
			errorMessage?: string
			alreadyMember?: boolean
		}>
	> {
		const { DiscordBotService } = await import('./services/discord-bot.service')

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
						req.roleIds
					)
					return {
						guildId: req.guildId,
						...result,
					}
				})
			)

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
					req.roleIds
				)
				return {
					guildId: req.guildId,
					...result,
				}
			})
		)

		return results
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
			// Update existing user
			await this.db
				.update(discordUsers)
				.set({
					username,
					discriminator,
					scopes: JSON.stringify(scopes),
					coreUserId: coreUserId ?? user.coreUserId,
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
			// Update existing token
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
			// Insert new token
			await this.db.insert(discordTokens).values({
				userId: user.id,
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
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
}
