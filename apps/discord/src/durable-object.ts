import { DurableObject } from 'cloudflare:workers'

import { eq } from '@repo/db-utils'
import {
	AuthorizationUrlResponse,
	CallbackResult,
	Discord,
	DISCORD_REQUIRED_SCOPES,
} from '@repo/discord'

import { createDb } from './db'
import { discordTokens, discordUsers } from './db/schema'

import type { DiscordTokenResponse } from '@repo/discord'
import type { Env } from './context'

/**
 * Discord user info response from /users/@me
 */
interface DiscordUserInfo {
	/** Discord user ID */
	id: string
	/** Discord username */
	username: string
	/** Discord discriminator (legacy, "0" for new usernames) */
	discriminator: string
	/** Global display name (if set) */
	global_name?: string | null
	/** User's avatar hash */
	avatar?: string | null
}

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
	 * Start OAuth flow for login
	 */
	async startLoginFlow(state?: string): Promise<AuthorizationUrlResponse> {
		return this.generateAuthUrl(state)
	}

	/**
	 * Handle OAuth callback - exchange code for tokens and store them
	 */
	async handleCallback(code: string, state?: string): Promise<CallbackResult> {
		try {
			// Exchange authorization code for tokens
			const tokenResponse = await this.exchangeCodeForToken(code)

			// Get user information from Discord
			const userInfo = await this.getUserInfo(tokenResponse.access_token)

			// Parse scopes
			const scopes = tokenResponse.scope ? tokenResponse.scope.split(' ') : []

			// Calculate token expiration
			const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000)

			// Store user and token in database
			await this.storeToken(
				userInfo.id,
				userInfo.username,
				userInfo.discriminator,
				scopes,
				tokenResponse.access_token,
				tokenResponse.refresh_token || null,
				expiresAt
			)

			return {
				success: true,
				userId: userInfo.id,
			}
		} catch (error) {
			console.error('Error handling OAuth callback:', error)
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			}
		}
	}

	/**
	 * Manually refresh a token
	 */
	async refreshToken(userId: string): Promise<boolean> {
		try {
			// Get user from database
			const user = await this.db.query.discordUsers.findFirst({
				where: eq(discordUsers.userId, userId),
				with: {
					tokens: true,
				},
			})

			if (!user) {
				console.error('User not found:', userId)
				return false
			}

			// Get token record
			const tokenRecord = await this.db.query.discordTokens.findFirst({
				where: eq(discordTokens.userId, user.id),
			})

			if (!tokenRecord || !tokenRecord.refreshToken) {
				console.error('Token or refresh token not found')
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
			console.error('Error refreshing token:', error)
			return false
		}
	}

	/**
	 * Revoke and delete a token
	 */
	async revokeToken(userId: string): Promise<boolean> {
		try {
			const user = await this.db.query.discordUsers.findFirst({
				where: eq(discordUsers.userId, userId),
			})

			if (!user) {
				return false
			}

			// Get token to revoke it with Discord
			const tokenRecord = await this.db.query.discordTokens.findFirst({
				where: eq(discordTokens.userId, user.id),
			})

			if (tokenRecord) {
				// Decrypt access token for revocation
				const accessToken = await this.decrypt(tokenRecord.accessToken)

				// Revoke token with Discord
				const credentials = btoa(
					`${this.env.DISCORD_CLIENT_ID}:${this.env.DISCORD_CLIENT_SECRET}`
				)

				await fetch(this.env.DISCORD_TOKEN_REVOKE_URL, {
					method: 'POST',
					headers: {
						Authorization: `Basic ${credentials}`,
						'Content-Type': 'application/x-www-form-urlencoded',
					},
					body: new URLSearchParams({
						token: accessToken,
					}),
				})
			}

			// Delete the user (cascade will delete tokens)
			await this.db.delete(discordUsers).where(eq(discordUsers.id, user.id))

			return true
		} catch (error) {
			console.error('Error revoking token:', error)
			return false
		}
	}

	/**
	 * Invite user to guild (not implemented yet)
	 */
	// async inviteUserToGuild(userId: string, guildId: string): Promise<boolean> {
	// 	// TODO: Implement guild invitation logic
	// 	throw new Error('Not implemented')
	// }

	/**
	 * Kick user from guild (not implemented yet)
	 */
	// async kickUserFromGuild(guildId: string, userId: string): Promise<boolean> {
	// 	// TODO: Implement guild kick logic
	// 	throw new Error('Not implemented')
	// }

	/**
	 * Generate authorization URL for Discord OAuth
	 */
	private generateAuthUrl(state?: string): AuthorizationUrlResponse {
		const generatedState = state ?? crypto.randomUUID()

		const params = new URLSearchParams({
			response_type: 'code',
			redirect_uri: this.env.DISCORD_CALLBACK_URL,
			client_id: this.env.DISCORD_CLIENT_ID,
			scope: DISCORD_REQUIRED_SCOPES.join(' '),
			state: generatedState,
		})

		return {
			url: `${this.env.DISCORD_AUTHORIZE_URL}?${params.toString()}`,
			state: generatedState,
		}
	}

	/**
	 * Exchange authorization code for access token
	 */
	private async exchangeCodeForToken(code: string): Promise<DiscordTokenResponse> {
		const response = await fetch(this.env.DISCORD_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: this.env.DISCORD_CALLBACK_URL,
				client_id: this.env.DISCORD_CLIENT_ID,
				client_secret: this.env.DISCORD_CLIENT_SECRET,
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Token exchange failed: ${error}`)
		}

		return response.json<DiscordTokenResponse>()
	}

	/**
	 * Refresh access token using refresh token
	 */
	private async refreshAccessToken(refreshToken: string): Promise<DiscordTokenResponse> {
		const response = await fetch(this.env.DISCORD_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
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
	 * Get user information from Discord
	 */
	private async getUserInfo(accessToken: string): Promise<DiscordUserInfo> {
		const response = await fetch(this.env.DISCORD_USER_INFO_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Failed to get user info: ${error}`)
		}

		return response.json<DiscordUserInfo>()
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
		expiresAt: Date
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
