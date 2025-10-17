import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import type { Env } from './context'

// ========== Internal Types (SQLite data structures - snake_case) ==========

export interface DiscordTokenData extends Record<string, number | string> {
	discord_user_id: string
	discord_username: string
	root_user_id: string
	access_token: string
	refresh_token: string
	expires_at: number
	created_at: number
	updated_at: number
}

// ========== Public Types (External API - camelCase) ==========

export interface DiscordTokenInfo {
	discordUserId: string
	discordUsername: string
	rootUserId: string
	accessToken: string
	expiresAt: number
}

export interface DiscordOAuthTokens {
	accessToken: string
	refreshToken: string
	expiresIn: number
}

/**
 * Discord Durable Object Implementation
 *
 * Auth to Discord bridge
 */
export class Discord extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	private async initializeSchema() {
		// await this.createSchema()
	}

	private async createSchema(): Promise<void> {
		// Drop table if exists to ensure clean state
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS discord_tokens')

		// Discord tokens table - stores OAuth tokens for Discord users
		await this.ctx.storage.sql.exec(`
			CREATE TABLE discord_tokens (
				discord_user_id TEXT PRIMARY KEY,
				discord_username TEXT NOT NULL,
				root_user_id TEXT NOT NULL,
				access_token TEXT NOT NULL,
				refresh_token TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_discord_tokens_root_user ON discord_tokens(root_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_discord_tokens_expires_at ON discord_tokens(expires_at)
		`)
	}

	// ========== Token Management ==========

	private async refreshDiscordTokens(
		discordUserId: string,
		refreshToken: string
	): Promise<{
		accessToken: string
		refreshToken: string
		expiresAt: number
	}> {
		logger
			.withTags({
				type: 'discord_token_refresh_attempt',
			})
			.info('Attempting to refresh Discord token', {
				discordUserId: discordUserId.substring(0, 8) + '...',
			})

		try {
			const response = await fetch('https://discord.com/api/oauth2/token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					client_id: this.env.DISCORD_CLIENT_ID,
					client_secret: this.env.DISCORD_CLIENT_SECRET,
					grant_type: 'refresh_token',
					refresh_token: refreshToken,
				}),
			})

			if (!response.ok) {
				const error = await response.text()
				logger
					.withTags({
						type: 'discord_token_refresh_error',
					})
					.error('Failed to refresh Discord token', {
						discordUserId: discordUserId.substring(0, 8) + '...',
						status: response.status,
						error,
					})
				throw new Error(`Failed to refresh Discord token: ${error}`)
			}

			const data = (await response.json()) as {
				access_token: string
				refresh_token: string
				expires_in: number
			}

			const now = Date.now()
			const expiresAt = now + data.expires_in * 1000

			// Update the token in storage
			await this.ctx.storage.sql.exec(
				`UPDATE discord_tokens
				SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
				WHERE discord_user_id = ?`,
				data.access_token,
				data.refresh_token,
				expiresAt,
				now,
				discordUserId
			)

			logger
				.withTags({
					type: 'discord_token_refreshed',
				})
				.info('Discord token refreshed successfully', {
					discordUserId: discordUserId.substring(0, 8) + '...',
					expiresAt: new Date(expiresAt).toISOString(),
				})

			return {
				accessToken: data.access_token,
				refreshToken: data.refresh_token,
				expiresAt,
			}
		} catch (error) {
			logger
				.withTags({
					type: 'discord_token_refresh_exception',
				})
				.error('Exception during Discord token refresh', {
					error: String(error),
					discordUserId: discordUserId.substring(0, 8) + '...',
				})
			throw error
		}
	}

	// ========== Public Methods ==========

	async storeDiscordTokens(
		rootUserId: string,
		tokens: DiscordOAuthTokens
	): Promise<{ discordUserId: string; discordUsername: string }> {
		await this.initializeSchema()

		const { accessToken, refreshToken, expiresIn } = tokens

		// Fetch Discord user info using the access token
		const userInfoResponse = await fetch('https://discord.com/api/users/@me', {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!userInfoResponse.ok) {
			const error = await userInfoResponse.text()
			logger.error('Failed to get Discord user info', {
				status: userInfoResponse.status,
				error,
			})
			throw new Error('Failed to get Discord user info')
		}

		const userInfo = (await userInfoResponse.json()) as {
			id: string
			username: string
			discriminator?: string
		}

		// Construct username from Discord username
		const discordUsername =
			userInfo.discriminator && userInfo.discriminator !== '0'
				? `${userInfo.username}#${userInfo.discriminator}`
				: userInfo.username

		const discordUserId = userInfo.id
		const now = Date.now()
		const expiresAt = now + expiresIn * 1000

		// Check if token already exists
		const existing = await this.ctx.storage.sql
			.exec<DiscordTokenData>(
				'SELECT discord_user_id FROM discord_tokens WHERE discord_user_id = ?',
				discordUserId
			)
			.toArray()

		if (existing.length > 0) {
			// Update existing tokens
			await this.ctx.storage.sql.exec(
				`UPDATE discord_tokens
				SET discord_username = ?, root_user_id = ?, access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
				WHERE discord_user_id = ?`,
				discordUsername,
				rootUserId,
				accessToken,
				refreshToken,
				expiresAt,
				now,
				discordUserId
			)

			logger
				.withTags({
					type: 'discord_tokens_updated',
				})
				.info('Updated Discord tokens', {
					discordUserId: discordUserId.substring(0, 8) + '...',
					discordUsername,
					rootUserId: rootUserId.substring(0, 8) + '...',
					expiresAt: new Date(expiresAt).toISOString(),
				})
		} else {
			// Insert new tokens
			await this.ctx.storage.sql.exec(
				`INSERT INTO discord_tokens (
					discord_user_id, discord_username, root_user_id, access_token, refresh_token, expires_at, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				discordUserId,
				discordUsername,
				rootUserId,
				accessToken,
				refreshToken,
				expiresAt,
				now,
				now
			)

			logger
				.withTags({
					type: 'discord_tokens_stored',
				})
				.info('Stored new Discord tokens', {
					discordUserId: discordUserId.substring(0, 8) + '...',
					discordUsername,
					rootUserId: rootUserId.substring(0, 8) + '...',
					expiresAt: new Date(expiresAt).toISOString(),
				})
		}

		return { discordUserId, discordUsername }
	}

	async getDiscordTokens(params: {
		discordUserId?: string
		rootUserId?: string
	}): Promise<DiscordTokenInfo> {
		await this.initializeSchema()

		const { discordUserId, rootUserId } = params

		// Enforce mutual exclusivity
		if (!discordUserId && !rootUserId) {
			throw new Error('Either discordUserId or rootUserId must be provided')
		}
		if (discordUserId && rootUserId) {
			throw new Error('Cannot provide both discordUserId and rootUserId')
		}

		let rows: DiscordTokenData[]
		if (discordUserId) {
			rows = await this.ctx.storage.sql
				.exec<DiscordTokenData>(
					'SELECT * FROM discord_tokens WHERE discord_user_id = ?',
					discordUserId
				)
				.toArray()
		} else {
			rows = await this.ctx.storage.sql
				.exec<DiscordTokenData>('SELECT * FROM discord_tokens WHERE root_user_id = ?', rootUserId)
				.toArray()
		}

		if (rows.length === 0) {
			throw new Error('Discord tokens not found')
		}

		const tokenData = rows[0]
		const now = Date.now()

		// Proactively refresh token if it's been more than 6 days (tokens expire in 7 days)
		const timeSinceUpdate = now - tokenData.updated_at
		if (timeSinceUpdate > 6 * 24 * 60 * 60 * 1000) {
			try {
				const refreshed = await this.refreshDiscordTokens(
					tokenData.discord_user_id,
					tokenData.refresh_token
				)
				return {
					discordUserId: tokenData.discord_user_id,
					discordUsername: tokenData.discord_username,
					rootUserId: tokenData.root_user_id,
					accessToken: refreshed.accessToken,
					expiresAt: refreshed.expiresAt,
				}
			} catch (error) {
				// If refresh failed, return the existing token anyway and let it fail naturally
				logger.warn('Failed to refresh Discord token proactively', {
					error: String(error),
					discordUserId: tokenData.discord_user_id.substring(0, 8) + '...',
				})
			}
		}

		return {
			discordUserId: tokenData.discord_user_id,
			discordUsername: tokenData.discord_username,
			rootUserId: tokenData.root_user_id,
			accessToken: tokenData.access_token,
			expiresAt: tokenData.expires_at,
		}
	}
}
