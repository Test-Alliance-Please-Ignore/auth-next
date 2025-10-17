import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import type { Env } from './context'

// ========== Internal Types (SQLite data structures - snake_case) ==========

export interface TokenData extends Record<string, number | string> {
	character_id: number
	character_name: string
	access_token: string
	refresh_token: string
	expires_at: number
	scopes: string
	proxy_token: string
	created_at: number
	updated_at: number
}

export interface ESIOAuthStateData extends Record<string, number | string> {
	state: string
	session_id: string
	created_at: number
	expires_at: number
}

// ========== Public Types (External API - camelCase) ==========

export interface TokenInfo {
	proxyToken: string
	characterId: number
	characterName: string
	scopes: string
	expiresAt: number
	createdAt?: number
	updatedAt?: number
}

export interface AccessTokenInfo {
	accessToken: string
	characterId: number
	characterName: string
	scopes: string
	expiresAt: number
}

/**
 * EveSSO Durable Object Implementation
 *
 * Handles EVE SSO OAuth tokens, proxy tokens, and OAuth state management
 */
export class EveSSO extends DurableObject<Env> {
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

			// Migration 1: Initial schema with tokens table
			if (currentVersion < 1) {
				await this.runMigration1()
				await this.setSchemaVersion(1)
				logger.info('Applied migration 1: Initial tokens schema')
			}

			// Migration 2: Add ESI OAuth states table
			if (currentVersion < 2) {
				await this.runMigration2()
				await this.setSchemaVersion(2)
				logger.info('Applied migration 2: ESI OAuth states')
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
		// Check if table exists with old schema and drop it if needed
		try {
			// Try to select key columns to verify schema
			await this.ctx.storage.sql
				.exec('SELECT character_id, proxy_token FROM tokens LIMIT 0')
				.toArray()
		} catch (error) {
			// Column doesn't exist or schema is wrong - drop the table
			logger.warn('Dropping tokens table due to schema mismatch', {
				error: error instanceof Error ? error.message : String(error),
			})
			await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS tokens')
		}

		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS tokens (
				character_id INTEGER PRIMARY KEY,
				character_name TEXT NOT NULL,
				access_token TEXT NOT NULL,
				refresh_token TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				scopes TEXT NOT NULL,
				proxy_token TEXT UNIQUE NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_proxy_token ON tokens(proxy_token)
		`)
	}

	private async runMigration2(): Promise<void> {
		// ESI OAuth states table for CSRF protection
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS esi_oauth_states (
				state TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_esi_oauth_states_expires_at ON esi_oauth_states(expires_at)
		`)
	}

	private generateProxyToken(): string {
		// Generate a random 32-byte token
		const array = new Uint8Array(32)
		crypto.getRandomValues(array)
		return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
	}

	// ========== Public Methods ==========

	async storeTokens(
		characterId: number,
		characterName: string,
		accessToken: string,
		refreshToken: string,
		expiresIn: number,
		scopes: string
	): Promise<TokenInfo> {
		await this.ensureSchema()

		const now = Date.now()
		const expiresAt = now + expiresIn * 1000

		// Check if tokens already exist for this character
		const existing = await this.ctx.storage.sql
			.exec<{
				proxy_token: string
			}>('SELECT proxy_token FROM tokens WHERE character_id = ?', characterId)
			.toArray()

		let proxyToken: string

		if (existing.length > 0) {
			// Update existing tokens
			proxyToken = existing[0].proxy_token
			await this.ctx.storage.sql.exec(
				`UPDATE tokens
				SET access_token = ?, refresh_token = ?, expires_at = ?,
					scopes = ?, character_name = ?, updated_at = ?
				WHERE character_id = ?`,
				accessToken,
				refreshToken,
				expiresAt,
				scopes,
				characterName,
				now,
				characterId
			)
		} else {
			// Insert new tokens
			proxyToken = this.generateProxyToken()
			await this.ctx.storage.sql.exec(
				`INSERT INTO tokens (
					character_id, character_name, access_token, refresh_token,
					expires_at, scopes, proxy_token, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				characterId,
				characterName,
				accessToken,
				refreshToken,
				expiresAt,
				scopes,
				proxyToken,
				now,
				now
			)
		}

		logger
			.withTags({
				type: 'token_stored',
				character_id: characterId,
			})
			.info('Stored tokens for character', {
				characterId,
				characterName,
				expiresAt: new Date(expiresAt).toISOString(),
			})

		return {
			proxyToken,
			characterId,
			characterName,
			scopes,
			expiresAt,
		}
	}

	async getAccessToken(characterId: number): Promise<AccessTokenInfo> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<TokenData>(`SELECT * FROM tokens WHERE character_id = ?`, characterId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Token not found')
		}

		const token = rows[0]

		// Check if token is expired (with 5 minute buffer)
		if (token.expires_at - Date.now() < 5 * 60 * 1000) {
			// Token is expired or about to expire, refresh it
			const refreshed = await this.refreshAccessToken(token)
			if (refreshed.success && refreshed.data) {
				return {
					accessToken: refreshed.data.accessToken,
					characterId: token.character_id,
					characterName: token.character_name,
					scopes: token.scopes,
					expiresAt: refreshed.data.expiresAt,
				}
			}
			// If refresh failed, return the existing token anyway
		}

		return {
			accessToken: token.access_token,
			characterId: token.character_id,
			characterName: token.character_name,
			scopes: token.scopes,
			expiresAt: token.expires_at,
		}
	}

	async findByProxyToken(proxyToken: string): Promise<AccessTokenInfo> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<TokenData>(`SELECT * FROM tokens WHERE proxy_token = ?`, proxyToken)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Token not found')
		}

		const token = rows[0]

		// Check if token is expired (with 5 minute buffer)
		if (token.expires_at - Date.now() < 5 * 60 * 1000) {
			// Token is expired or about to expire, refresh it
			const refreshed = await this.refreshAccessToken(token)
			if (refreshed.success && refreshed.data) {
				return {
					accessToken: refreshed.data.accessToken,
					characterId: token.character_id,
					characterName: token.character_name,
					scopes: token.scopes,
					expiresAt: refreshed.data.expiresAt,
				}
			}
		}

		return {
			accessToken: token.access_token,
			characterId: token.character_id,
			characterName: token.character_name,
			scopes: token.scopes,
			expiresAt: token.expires_at,
		}
	}

	private async refreshAccessToken(
		token: TokenData
	): Promise<{ success: boolean; data?: { accessToken: string; expiresAt: number } }> {
		logger
			.withTags({
				type: 'token_refresh_attempt',
				character_id: token.character_id,
			})
			.info('Attempting to refresh token', {
				characterId: token.character_id,
			})

		try {
			const auth = btoa(`${this.env.ESI_SSO_CLIENT_ID}:${this.env.ESI_SSO_CLIENT_SECRET}`)

			const response = await fetch('https://login.eveonline.com/v2/oauth/token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Basic ${auth}`,
				},
				body: new URLSearchParams({
					grant_type: 'refresh_token',
					refresh_token: token.refresh_token,
				}),
			})

			if (!response.ok) {
				const error = await response.text()
				logger
					.withTags({
						type: 'token_refresh_error',
						character_id: token.character_id,
					})
					.error('Failed to refresh token', {
						characterId: token.character_id,
						status: response.status,
						error,
					})
				return { success: false }
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
				`UPDATE tokens
				SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
				WHERE character_id = ?`,
				data.access_token,
				data.refresh_token,
				expiresAt,
				now,
				token.character_id
			)

			logger
				.withTags({
					type: 'token_refreshed',
					character_id: token.character_id,
				})
				.info('Token refreshed successfully', {
					characterId: token.character_id,
					expiresAt: new Date(expiresAt).toISOString(),
				})

			return {
				success: true,
				data: {
					accessToken: data.access_token,
					expiresAt,
				},
			}
		} catch (error) {
			logger
				.withTags({
					type: 'token_refresh_exception',
					character_id: token.character_id,
				})
				.error('Exception during token refresh', {
					error: String(error),
					characterId: token.character_id,
				})
			return { success: false }
		}
	}

	async revokeToken(characterId: number): Promise<void> {
		await this.ensureSchema()

		await this.ctx.storage.sql.exec(`DELETE FROM tokens WHERE character_id = ?`, characterId)

		logger
			.withTags({
				type: 'token_revoked',
				character_id: characterId,
			})
			.info('Token revoked', { characterId })
	}

	async getProxyToken(characterId: number): Promise<TokenInfo> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<TokenData>(
				`SELECT character_id, character_name, scopes, expires_at, proxy_token, created_at, updated_at
				FROM tokens WHERE character_id = ?`,
				characterId
			)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Token not found')
		}

		const token = rows[0]

		return {
			characterId: token.character_id,
			characterName: token.character_name,
			proxyToken: token.proxy_token,
			scopes: token.scopes,
			expiresAt: token.expires_at,
			createdAt: token.created_at,
			updatedAt: token.updated_at,
		}
	}

	async deleteByProxyToken(proxyToken: string): Promise<void> {
		await this.ensureSchema()

		// First check if the token exists
		const rows = await this.ctx.storage.sql
			.exec<TokenData>(`SELECT character_id FROM tokens WHERE proxy_token = ?`, proxyToken)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Token not found')
		}

		const characterId = rows[0].character_id

		// Delete the entire token set
		await this.ctx.storage.sql.exec(`DELETE FROM tokens WHERE proxy_token = ?`, proxyToken)

		logger
			.withTags({
				type: 'token_deleted_by_proxy',
				character_id: characterId,
			})
			.info('Token deleted by proxy token', { characterId, proxyToken: proxyToken.substring(0, 8) })
	}

	// ========== ESI OAuth State Management ==========

	private generateState(): string {
		// Generate a random 32-byte state token
		const array = new Uint8Array(32)
		crypto.getRandomValues(array)
		return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
	}

	async createESIOAuthState(sessionId: string): Promise<string> {
		await this.ensureSchema()

		const state = this.generateState()
		const now = Date.now()
		const expiresAt = now + 5 * 60 * 1000 // 5 minutes

		await this.ctx.storage.sql.exec(
			`INSERT INTO esi_oauth_states (state, session_id, created_at, expires_at)
			VALUES (?, ?, ?, ?)`,
			state,
			sessionId,
			now,
			expiresAt
		)

		logger
			.withTags({
				type: 'esi_oauth_state_created',
			})
			.info('Created ESI OAuth state', {
				state: state.substring(0, 8) + '...',
				sessionId: sessionId.substring(0, 8) + '...',
			})

		return state
	}

	async validateESIOAuthState(state: string): Promise<string> {
		await this.ensureSchema()

		const now = Date.now()

		// Clean up expired states
		await this.ctx.storage.sql.exec('DELETE FROM esi_oauth_states WHERE expires_at < ?', now)

		const rows = await this.ctx.storage.sql
			.exec<ESIOAuthStateData>('SELECT * FROM esi_oauth_states WHERE state = ?', state)
			.toArray()

		if (rows.length === 0) {
			logger
				.withTags({
					type: 'esi_oauth_state_invalid',
				})
				.warn('ESI OAuth state not found or expired', {
					state: state.substring(0, 8) + '...',
				})
			throw new Error('Invalid or expired state')
		}

		const stateData = rows[0]

		if (stateData.expires_at < now) {
			logger
				.withTags({
					type: 'esi_oauth_state_expired',
				})
				.warn('ESI OAuth state expired', {
					state: state.substring(0, 8) + '...',
				})
			throw new Error('State expired')
		}

		// Delete the state after validation (one-time use)
		await this.ctx.storage.sql.exec('DELETE FROM esi_oauth_states WHERE state = ?', state)

		logger
			.withTags({
				type: 'esi_oauth_state_validated',
			})
			.info('ESI OAuth state validated and consumed', {
				state: state.substring(0, 8) + '...',
				sessionId: stateData.session_id.substring(0, 8) + '...',
			})

		return stateData.session_id
	}
}
