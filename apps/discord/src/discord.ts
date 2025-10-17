import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import type { Env } from './context'

// ========== Internal Types (SQLite data structures - snake_case) ==========

export interface DiscordTokenData extends Record<string, number | string> {
	discord_user_id: string
	discord_username: string
	social_user_id: string
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
	socialUserId: string
	accessToken: string
	expiresAt: number
}

/**
 * Discord Durable Object Implementation
 *
 * Auth to Discord bridge
 */
export class Discord extends DurableObject<Env> {
	private schemaInitialized = false
	private readonly CURRENT_SCHEMA_VERSION = 2

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	private async getSchemaVersion(): Promise<number> {
		// Create schema_version table if it doesn't exist
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS schema_version (
				version INTEGER PRIMARY KEY,
				applied_at INTEGER NOT NULL
			)
		`)

		const rows = await this.ctx.storage.sql
			.exec<{ version: number }>('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
			.toArray()

		return rows.length > 0 ? rows[0].version : 0
	}

	private async setSchemaVersion(version: number): Promise<void> {
		const now = Date.now()
		await this.ctx.storage.sql.exec(
			'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)',
			version,
			now
		)
	}

	private async ensureSchema() {
		// Only run migrations once per DO instance
		if (this.schemaInitialized) {
			return
		}

		try {
			const currentVersion = await this.getSchemaVersion()

			logger.info('Running schema migrations', {
				currentVersion,
				targetVersion: this.CURRENT_SCHEMA_VERSION,
			})

			// Migration 1: Initial schema
			if (currentVersion < 1) {
				await this.runMigration1()
				await this.setSchemaVersion(1)
				logger.info('Applied migration 1: Initial schema')
			}

			// Migration 2: Discord tokens table
			if (currentVersion < 2) {
				await this.runMigration2()
				await this.setSchemaVersion(2)
				logger.info('Applied migration 2: Discord tokens table')
			}

			this.schemaInitialized = true
		} catch (error) {
			// If migration fails, don't mark as initialized so it retries
			logger.error('Schema migration failed', {
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	private async runMigration1(): Promise<void> {
		// Migration 1 is intentionally empty - placeholder for initial schema
		// Discord tokens table is created in migration 2
	}

	private async runMigration2(): Promise<void> {
		// Discord tokens table - stores OAuth tokens for Discord users
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS discord_tokens (
				discord_user_id TEXT PRIMARY KEY,
				discord_username TEXT NOT NULL,
				social_user_id TEXT NOT NULL,
				access_token TEXT NOT NULL,
				refresh_token TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_discord_tokens_social_user ON discord_tokens(social_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_discord_tokens_expires_at ON discord_tokens(expires_at)
		`)
	}

	// ========== Token Management ==========

	private async refreshDiscordTokens(discordUserId: string, refreshToken: string): Promise<{
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
		socialUserId: string,
		accessToken: string,
		refreshToken: string,
		expiresIn: number
	): Promise<{ discordUserId: string; discordUsername: string }> {
		await this.ensureSchema()

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
				SET discord_username = ?, social_user_id = ?, access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
				WHERE discord_user_id = ?`,
				discordUsername,
				socialUserId,
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
					socialUserId: socialUserId.substring(0, 8) + '...',
					expiresAt: new Date(expiresAt).toISOString(),
				})
		} else {
			// Insert new tokens
			await this.ctx.storage.sql.exec(
				`INSERT INTO discord_tokens (
					discord_user_id, discord_username, social_user_id, access_token, refresh_token, expires_at, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				discordUserId,
				discordUsername,
				socialUserId,
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
					socialUserId: socialUserId.substring(0, 8) + '...',
					expiresAt: new Date(expiresAt).toISOString(),
				})
		}

		return { discordUserId, discordUsername }
	}

	async getDiscordTokens(discordUserId: string): Promise<DiscordTokenInfo> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<DiscordTokenData>(
				'SELECT * FROM discord_tokens WHERE discord_user_id = ?',
				discordUserId
			)
			.toArray()

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
					discordUserId,
					tokenData.refresh_token
				)
				return {
					discordUserId: tokenData.discord_user_id,
					discordUsername: tokenData.discord_username,
					socialUserId: tokenData.social_user_id,
					accessToken: refreshed.accessToken,
					expiresAt: refreshed.expiresAt,
				}
			} catch (error) {
				// If refresh failed, return the existing token anyway and let it fail naturally
				logger.warn('Failed to refresh Discord token proactively', {
					error: String(error),
					discordUserId: discordUserId.substring(0, 8) + '...',
				})
			}
		}

		return {
			discordUserId: tokenData.discord_user_id,
			discordUsername: tokenData.discord_username,
			socialUserId: tokenData.social_user_id,
			accessToken: tokenData.access_token,
			expiresAt: tokenData.expires_at,
		}
	}
}
