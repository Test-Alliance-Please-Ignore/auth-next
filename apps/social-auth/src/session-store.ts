import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import type { Env } from './context'

export interface SocialUserData extends Record<string, number | string> {
	social_user_id: string
	provider: string
	provider_user_id: string
	email: string
	name: string
	is_admin: number
	created_at: number
	updated_at: number
}

export interface SocialUser {
	socialUserId: string
	provider: string
	providerUserId: string
	email: string
	name: string
	isAdmin: boolean
	createdAt: number
	updatedAt: number
}

export interface SessionData extends Record<string, number | string> {
	session_id: string
	social_user_id: string
	access_token: string
	refresh_token: string
	expires_at: number
	created_at: number
	updated_at: number
}

export interface SessionInfo {
	sessionId: string
	socialUserId: string
	provider: string
	providerUserId: string
	email: string
	name: string
	accessToken: string
	expiresAt: number
	createdAt?: number
	updatedAt?: number
}

export interface SessionListResult {
	total: number
	limit: number
	offset: number
	results: Array<{
		sessionId: string
		socialUserId: string
		provider: string
		providerUserId: string
		email: string
		name: string
		expiresAt: number
		createdAt: number
		updatedAt: number
	}>
}

export interface SessionStats {
	totalCount: number
	expiredCount: number
	activeCount: number
}

export interface AccountLinkData extends Record<string, number | string> {
	link_id: string
	social_user_id: string
	legacy_system: string
	legacy_user_id: string
	legacy_username: string
	superuser: number
	staff: number
	active: number
	primary_character: string
	primary_character_id: string
	groups: string
	linked_at: number
	updated_at: number
}

export interface AccountLink {
	linkId: string
	socialUserId: string
	legacySystem: string
	legacyUserId: string
	legacyUsername: string
	superuser: boolean
	staff: boolean
	active: boolean
	primaryCharacter: string
	primaryCharacterId: string
	groups: string[]
	linkedAt: number
	updatedAt: number
}

export interface OIDCStateData extends Record<string, number | string> {
	state: string
	session_id: string
	created_at: number
	expires_at: number
}

export interface CharacterLinkData extends Record<string, number | string> {
	link_id: string
	social_user_id: string
	character_id: number
	character_name: string
	is_primary: number
	linked_at: number
	updated_at: number
}

export interface CharacterLink {
	linkId: string
	socialUserId: string
	characterId: number
	characterName: string
	isPrimary: boolean
	linkedAt: number
	updatedAt: number
}

export interface ProviderLinkData extends Record<string, number | string> {
	link_id: string
	social_user_id: string
	provider: string
	provider_user_id: string
	provider_username: string
	linked_at: number
	updated_at: number
}

export interface ProviderLink {
	linkId: string
	socialUserId: string
	provider: string
	providerUserId: string
	providerUsername: string
	linkedAt: number
	updatedAt: number
}

export class SessionStore extends DurableObject<Env> {
	private schemaInitialized = false
	private readonly CURRENT_SCHEMA_VERSION = 5

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

			// Migration 2: Add character_links table
			if (currentVersion < 2) {
				await this.runMigration2()
				await this.setSchemaVersion(2)
				logger.info('Applied migration 2: Character links')
			}

			// Migration 3: Add provider_links table
			if (currentVersion < 3) {
				await this.runMigration3()
				await this.setSchemaVersion(3)
				logger.info('Applied migration 3: Provider links')
			}

			// Migration 4: Add is_primary column to character_links
			if (currentVersion < 4) {
				await this.runMigration4()
				await this.setSchemaVersion(4)
				logger.info('Applied migration 4: Character primary flag')
			}

			// Migration 5: Add is_admin column to social_users
			if (currentVersion < 5) {
				await this.runMigration5()
				await this.setSchemaVersion(5)
				logger.info('Applied migration 5: Admin flag on social users')
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
		// Check if tables exist with old schema and drop them if needed
		const tables = ['social_users', 'sessions', 'account_links', 'oidc_states']

		for (const tableName of tables) {
			try {
				// Check if table exists
				const tableCheck = await this.ctx.storage.sql
					.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, tableName)
					.toArray()

				if (tableCheck.length > 0) {
					// Table exists - verify it has the correct columns by trying to select key columns
					switch (tableName) {
						case 'social_users':
							await this.ctx.storage.sql
								.exec('SELECT social_user_id, provider, provider_user_id FROM social_users LIMIT 0')
								.toArray()
							break
						case 'sessions':
							await this.ctx.storage.sql
								.exec('SELECT session_id, social_user_id FROM sessions LIMIT 0')
								.toArray()
							break
						case 'account_links':
							await this.ctx.storage.sql
								.exec(
									'SELECT link_id, social_user_id, legacy_system, legacy_user_id FROM account_links LIMIT 0'
								)
								.toArray()
							break
						case 'oidc_states':
							await this.ctx.storage.sql
								.exec('SELECT state, session_id FROM oidc_states LIMIT 0')
								.toArray()
							break
					}
				}
			} catch (error) {
				// Column doesn't exist or schema is wrong - drop the table
				logger.warn(`Dropping table ${tableName} due to schema mismatch`, {
					error: error instanceof Error ? error.message : String(error),
				})
				await this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${tableName}`)
			}
		}

		// Social users table - permanent identity for social accounts
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS social_users (
				social_user_id TEXT PRIMARY KEY,
				provider TEXT NOT NULL,
				provider_user_id TEXT NOT NULL,
				email TEXT NOT NULL,
				name TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(provider, provider_user_id)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_social_users_provider_user ON social_users(provider, provider_user_id)
		`)

		// Sessions table - ephemeral tokens tied to social users
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				session_id TEXT PRIMARY KEY,
				social_user_id TEXT NOT NULL,
				access_token TEXT NOT NULL,
				refresh_token TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_sessions_social_user ON sessions(social_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)
		`)

		// Account links table - links social users to legacy accounts
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS account_links (
				link_id TEXT PRIMARY KEY,
				social_user_id TEXT NOT NULL,
				legacy_system TEXT NOT NULL,
				legacy_user_id TEXT NOT NULL,
				legacy_username TEXT NOT NULL,
				superuser INTEGER NOT NULL DEFAULT 0,
				staff INTEGER NOT NULL DEFAULT 0,
				active INTEGER NOT NULL DEFAULT 0,
				primary_character TEXT NOT NULL DEFAULT '',
				primary_character_id TEXT NOT NULL DEFAULT '',
				groups TEXT NOT NULL DEFAULT '[]',
				linked_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(social_user_id, legacy_system)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_account_links_social_user ON account_links(social_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_account_links_legacy_user ON account_links(legacy_system, legacy_user_id)
		`)

		// OIDC states table for CSRF protection
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS oidc_states (
				state TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_oidc_states_expires_at ON oidc_states(expires_at)
		`)
	}

	private async runMigration2(): Promise<void> {
		// Character links table - links social users to EVE characters
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS character_links (
				link_id TEXT PRIMARY KEY,
				social_user_id TEXT NOT NULL,
				character_id INTEGER NOT NULL,
				character_name TEXT NOT NULL,
				linked_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(character_id)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_character_links_social_user ON character_links(social_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_character_links_character ON character_links(character_id)
		`)
	}

	private async runMigration3(): Promise<void> {
		// Provider links table - links social users to secondary OAuth providers
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS provider_links (
				link_id TEXT PRIMARY KEY,
				social_user_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				provider_user_id TEXT NOT NULL,
				provider_username TEXT NOT NULL,
				linked_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(social_user_id, provider),
				UNIQUE(provider, provider_user_id)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_provider_links_social_user ON provider_links(social_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_links_provider_user ON provider_links(provider, provider_user_id)
		`)
	}

	private async runMigration4(): Promise<void> {
		// Add is_primary column to character_links table
		await this.ctx.storage.sql.exec(`
			ALTER TABLE character_links ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0
		`)

		// Add constraint to ensure only one primary character per user
		// Note: SQLite doesn't support CHECK constraints on ALTER TABLE, so we use a partial unique index
		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_character_links_primary ON character_links(social_user_id) WHERE is_primary = 1
		`)
	}

	private async runMigration5(): Promise<void> {
		// Add is_admin column to social_users table
		await this.ctx.storage.sql.exec(`
			ALTER TABLE social_users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0
		`)

		// Update is_admin flag for existing users based on account_links
		// Set is_admin = 1 if user has ANY account link with superuser = 1 OR staff = 1
		await this.ctx.storage.sql.exec(`
			UPDATE social_users
			SET is_admin = 1
			WHERE social_user_id IN (
				SELECT DISTINCT social_user_id
				FROM account_links
				WHERE superuser = 1 OR staff = 1
			)
		`)

		// Create index for faster admin queries
		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_social_users_admin ON social_users(is_admin) WHERE is_admin = 1
		`)
	}

	private generateSessionId(): string {
		// Generate a random 32-byte session token
		const array = new Uint8Array(32)
		crypto.getRandomValues(array)
		return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
	}

	private generateSocialUserId(): string {
		// Generate a cryptographically secure UUID for social user ID (unguessable identifier)
		return crypto.randomUUID()
	}

	// ========== Social User Management ==========

	async getOrCreateSocialUser(
		provider: string,
		providerUserId: string,
		email: string,
		name: string
	): Promise<SocialUser> {
		await this.ensureSchema()

		// Try to find existing social user
		const existing = await this.ctx.storage.sql
			.exec<SocialUserData>(
				'SELECT * FROM social_users WHERE provider = ? AND provider_user_id = ?',
				provider,
				providerUserId
			)
			.toArray()

		const now = Date.now()

		if (existing.length > 0) {
			const user = existing[0]

			// Update email and name if they've changed
			if (user.email !== email || user.name !== name) {
				await this.ctx.storage.sql.exec(
					`UPDATE social_users SET email = ?, name = ?, updated_at = ? WHERE social_user_id = ?`,
					email,
					name,
					now,
					user.social_user_id
				)

				logger
					.withTags({
						type: 'social_user_updated',
						provider,
					})
					.info('Updated social user info', {
						socialUserId: user.social_user_id.substring(0, 8) + '...',
						provider,
						email,
					})
			}

			return {
				socialUserId: user.social_user_id,
				provider: user.provider,
				providerUserId: user.provider_user_id,
				email,
				name,
				isAdmin: user.is_admin === 1,
				createdAt: user.created_at,
				updatedAt: now,
			}
		}

		// Create new social user
		const socialUserId = this.generateSocialUserId()

		await this.ctx.storage.sql.exec(
			`INSERT INTO social_users (social_user_id, provider, provider_user_id, email, name, is_admin, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			socialUserId,
			provider,
			providerUserId,
			email,
			name,
			0, // Default to not admin
			now,
			now
		)

		logger
			.withTags({
				type: 'social_user_created',
				provider,
			})
			.info('Created new social user', {
				socialUserId: socialUserId.substring(0, 8) + '...',
				provider,
				providerUserId: providerUserId.substring(0, 8) + '...',
				email,
			})

		return {
			socialUserId,
			provider,
			providerUserId,
			email,
			name,
			isAdmin: false,
			createdAt: now,
			updatedAt: now,
		}
	}

	async getSocialUser(socialUserId: string): Promise<SocialUser | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<SocialUserData>('SELECT * FROM social_users WHERE social_user_id = ?', socialUserId)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const user = rows[0]
		return {
			socialUserId: user.social_user_id,
			provider: user.provider,
			providerUserId: user.provider_user_id,
			email: user.email,
			name: user.name,
			isAdmin: user.is_admin === 1,
			createdAt: user.created_at,
			updatedAt: user.updated_at,
		}
	}

	async getSocialUserByProvider(
		provider: string,
		providerUserId: string
	): Promise<SocialUser | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<SocialUserData>(
				'SELECT * FROM social_users WHERE provider = ? AND provider_user_id = ?',
				provider,
				providerUserId
			)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const user = rows[0]
		return {
			socialUserId: user.social_user_id,
			provider: user.provider,
			providerUserId: user.provider_user_id,
			email: user.email,
			name: user.name,
			isAdmin: user.is_admin === 1,
			createdAt: user.created_at,
			updatedAt: user.updated_at,
		}
	}

	// ========== Session Management ==========

	async createSession(
		provider: string,
		providerUserId: string,
		email: string,
		name: string,
		accessToken: string,
		refreshToken: string,
		_expiresIn: number
	): Promise<SessionInfo> {
		await this.ensureSchema()

		const now = Date.now()
		// Session expires in 48 hours (independent of OAuth token expiration)
		// OAuth tokens will be automatically refreshed as needed
		const sessionExpiresAt = now + 48 * 60 * 60 * 1000 // 48 hours
		// Note: _expiresIn parameter represents OAuth token expiration but we ignore it
		// since we handle token refresh automatically

		// Get or create social user (permanent identity)
		const socialUser = await this.getOrCreateSocialUser(provider, providerUserId, email, name)

		// Check if a session already exists for this social user
		const existing = await this.ctx.storage.sql
			.exec<SessionData>(
				'SELECT session_id FROM sessions WHERE social_user_id = ?',
				socialUser.socialUserId
			)
			.toArray()

		if (existing.length > 0) {
			// Update existing session
			const existingSessionId = existing[0].session_id
			await this.ctx.storage.sql.exec(
				`UPDATE sessions
				SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
				WHERE session_id = ?`,
				accessToken,
				refreshToken,
				sessionExpiresAt,
				now,
				existingSessionId
			)

			logger
				.withTags({
					type: 'session_updated',
					provider,
				})
				.info('Updated existing session', {
					sessionId: existingSessionId.substring(0, 8) + '...',
					socialUserId: socialUser.socialUserId.substring(0, 8) + '...',
					provider,
					email,
					expiresAt: new Date(sessionExpiresAt).toISOString(),
				})

			return {
				sessionId: existingSessionId,
				socialUserId: socialUser.socialUserId,
				provider: socialUser.provider,
				providerUserId: socialUser.providerUserId,
				email: socialUser.email,
				name: socialUser.name,
				accessToken,
				expiresAt: sessionExpiresAt,
			}
		}

		// Create new session
		const sessionId = this.generateSessionId()

		await this.ctx.storage.sql.exec(
			`INSERT INTO sessions (
				session_id, social_user_id, access_token, refresh_token, expires_at, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			sessionId,
			socialUser.socialUserId,
			accessToken,
			refreshToken,
			sessionExpiresAt,
			now,
			now
		)

		logger
			.withTags({
				type: 'session_created',
				provider,
			})
			.info('Created new session', {
				sessionId: sessionId.substring(0, 8) + '...',
				socialUserId: socialUser.socialUserId.substring(0, 8) + '...',
				provider,
				email,
				expiresAt: new Date(sessionExpiresAt).toISOString(),
			})

		return {
			sessionId,
			socialUserId: socialUser.socialUserId,
			provider: socialUser.provider,
			providerUserId: socialUser.providerUserId,
			email: socialUser.email,
			name: socialUser.name,
			accessToken,
			expiresAt: sessionExpiresAt,
		}
	}

	async getSession(sessionId: string): Promise<SessionInfo> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<SessionData>(`SELECT * FROM sessions WHERE session_id = ?`, sessionId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Session not found')
		}

		const session = rows[0]

		// Get social user info
		const socialUser = await this.getSocialUser(session.social_user_id)
		if (!socialUser) {
			throw new Error('Social user not found for session')
		}

		const now = Date.now()

		// Check if session has expired
		if (session.expires_at < now) {
			throw new Error('Session expired')
		}

		// Proactively refresh OAuth token if it's been more than 50 minutes since last update
		// (OAuth tokens typically expire in 1 hour)
		const timeSinceUpdate = now - session.updated_at
		if (timeSinceUpdate > 50 * 60 * 1000) {
			// Try to refresh the OAuth token
			const refreshed = await this.refreshAccessToken(session, socialUser)
			if (refreshed.success && refreshed.data) {
				return {
					sessionId: session.session_id,
					socialUserId: socialUser.socialUserId,
					provider: socialUser.provider,
					providerUserId: socialUser.providerUserId,
					email: socialUser.email,
					name: socialUser.name,
					accessToken: refreshed.data.accessToken,
					expiresAt: session.expires_at, // Session expiration, not token expiration
				}
			}
			// If refresh failed, return the existing token anyway and let it fail naturally
		}

		return {
			sessionId: session.session_id,
			socialUserId: socialUser.socialUserId,
			provider: socialUser.provider,
			providerUserId: socialUser.providerUserId,
			email: socialUser.email,
			name: socialUser.name,
			accessToken: session.access_token,
			expiresAt: session.expires_at,
		}
	}

	private async refreshAccessToken(
		session: SessionData,
		socialUser: SocialUser
	): Promise<{ success: boolean; data?: { accessToken: string; expiresAt: number } }> {
		logger
			.withTags({
				type: 'token_refresh_attempt',
				provider: socialUser.provider,
			})
			.info('Attempting to refresh token', {
				sessionId: session.session_id.substring(0, 8) + '...',
				socialUserId: socialUser.socialUserId.substring(0, 8) + '...',
				provider: socialUser.provider,
			})

		try {
			let tokenEndpoint: string
			let clientId: string
			let clientSecret: string

			// Determine provider-specific endpoints and credentials
			if (socialUser.provider === 'google') {
				tokenEndpoint = 'https://oauth2.googleapis.com/token'
				clientId = this.env.GOOGLE_CLIENT_ID
				clientSecret = this.env.GOOGLE_CLIENT_SECRET
			} else {
				logger.warn('Token refresh not supported for provider', { provider: socialUser.provider })
				return { success: false }
			}

			const response = await fetch(tokenEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					client_id: clientId,
					client_secret: clientSecret,
					grant_type: 'refresh_token',
					refresh_token: session.refresh_token,
				}),
			})

			if (!response.ok) {
				const error = await response.text()
				logger
					.withTags({
						type: 'token_refresh_error',
						provider: socialUser.provider,
					})
					.error('Failed to refresh token', {
						sessionId: session.session_id.substring(0, 8) + '...',
						status: response.status,
						error,
					})
				return { success: false }
			}

			const data = (await response.json()) as {
				access_token: string
				expires_in: number
				refresh_token?: string
			}

			const now = Date.now()
			const expiresAt = now + data.expires_in * 1000

			// Update the token in storage
			// Google may or may not return a new refresh token
			// Note: We don't update expires_at here because it represents session expiration (48 hours),
			// not OAuth token expiration. The session remains valid as long as we can refresh tokens.
			const newRefreshToken = data.refresh_token || session.refresh_token

			await this.ctx.storage.sql.exec(
				`UPDATE sessions
				SET access_token = ?, refresh_token = ?, updated_at = ?
				WHERE session_id = ?`,
				data.access_token,
				newRefreshToken,
				now,
				session.session_id
			)

			logger
				.withTags({
					type: 'token_refreshed',
					provider: socialUser.provider,
				})
				.info('Token refreshed successfully', {
					sessionId: session.session_id.substring(0, 8) + '...',
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
					provider: socialUser.provider,
				})
				.error('Exception during token refresh', {
					error: String(error),
					sessionId: session.session_id.substring(0, 8) + '...',
				})
			return { success: false }
		}
	}

	async refreshSession(sessionId: string): Promise<SessionInfo> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<SessionData>(`SELECT * FROM sessions WHERE session_id = ?`, sessionId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Session not found')
		}

		const session = rows[0]

		// Get social user info
		const socialUser = await this.getSocialUser(session.social_user_id)
		if (!socialUser) {
			throw new Error('Social user not found for session')
		}

		const refreshed = await this.refreshAccessToken(session, socialUser)

		if (!refreshed.success || !refreshed.data) {
			throw new Error('Failed to refresh token')
		}

		return {
			sessionId: session.session_id,
			socialUserId: socialUser.socialUserId,
			provider: socialUser.provider,
			providerUserId: socialUser.providerUserId,
			email: socialUser.email,
			name: socialUser.name,
			accessToken: refreshed.data.accessToken,
			expiresAt: refreshed.data.expiresAt,
		}
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.ensureSchema()

		// Check if the session exists
		const rows = await this.ctx.storage.sql
			.exec<SessionData>(`SELECT social_user_id FROM sessions WHERE session_id = ?`, sessionId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Session not found')
		}

		const session = rows[0]

		// Get social user info for logging
		const socialUser = await this.getSocialUser(session.social_user_id)

		// Delete the session
		await this.ctx.storage.sql.exec(`DELETE FROM sessions WHERE session_id = ?`, sessionId)

		logger
			.withTags({
				type: 'session_deleted',
				provider: socialUser?.provider || 'unknown',
			})
			.info('Session deleted', {
				sessionId: sessionId.substring(0, 8) + '...',
				socialUserId: session.social_user_id.substring(0, 8) + '...',
				provider: socialUser?.provider || 'unknown',
			})
	}

	async listSessions(limit?: number, offset?: number): Promise<SessionListResult> {
		await this.ensureSchema()

		const parsedLimit = Math.min(limit || 50, 100)
		const parsedOffset = offset || 0

		// Get total count
		const countRows = await this.ctx.storage.sql
			.exec<{ count: number }>('SELECT COUNT(*) as count FROM sessions')
			.toArray()
		const total = countRows[0]?.count || 0

		// Get paginated results joined with social users (exclude sensitive tokens)
		const rows = await this.ctx.storage.sql
			.exec<SessionData & SocialUserData>(
				`SELECT
					s.session_id, s.social_user_id, s.expires_at, s.created_at, s.updated_at,
					u.provider, u.provider_user_id, u.email, u.name
				FROM sessions s
				JOIN social_users u ON s.social_user_id = u.social_user_id
				ORDER BY s.created_at DESC
				LIMIT ? OFFSET ?`,
				parsedLimit,
				parsedOffset
			)
			.toArray()

		return {
			total,
			limit: parsedLimit,
			offset: parsedOffset,
			results: rows.map((row) => ({
				sessionId: row.session_id,
				socialUserId: row.social_user_id,
				provider: row.provider,
				providerUserId: row.provider_user_id,
				email: row.email,
				name: row.name,
				expiresAt: row.expires_at,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
			})),
		}
	}

	async getStats(): Promise<SessionStats> {
		await this.ensureSchema()

		const now = Date.now()

		// Get total count
		const totalRows = await this.ctx.storage.sql
			.exec<{ count: number }>('SELECT COUNT(*) as count FROM sessions')
			.toArray()
		const totalCount = totalRows[0]?.count || 0

		// Get expired count
		const expiredRows = await this.ctx.storage.sql
			.exec<{ count: number }>('SELECT COUNT(*) as count FROM sessions WHERE expires_at < ?', now)
			.toArray()
		const expiredCount = expiredRows[0]?.count || 0

		const activeCount = totalCount - expiredCount

		return {
			totalCount,
			expiredCount,
			activeCount,
		}
	}

	// ========== OIDC State Management ==========

	private generateState(): string {
		// Generate a random 32-byte state token
		const array = new Uint8Array(32)
		crypto.getRandomValues(array)
		return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
	}

	async createOIDCState(sessionId: string): Promise<string> {
		await this.ensureSchema()

		const state = this.generateState()
		const now = Date.now()
		const expiresAt = now + 5 * 60 * 1000 // 5 minutes

		await this.ctx.storage.sql.exec(
			`INSERT INTO oidc_states (state, session_id, created_at, expires_at)
			VALUES (?, ?, ?, ?)`,
			state,
			sessionId,
			now,
			expiresAt
		)

		logger
			.withTags({
				type: 'oidc_state_created',
			})
			.info('Created OIDC state', {
				state: state.substring(0, 8) + '...',
				sessionId: sessionId.substring(0, 8) + '...',
			})

		return state
	}

	async validateOIDCState(state: string): Promise<string> {
		await this.ensureSchema()

		const now = Date.now()

		// Clean up expired states
		await this.ctx.storage.sql.exec('DELETE FROM oidc_states WHERE expires_at < ?', now)

		const rows = await this.ctx.storage.sql
			.exec<OIDCStateData>('SELECT * FROM oidc_states WHERE state = ?', state)
			.toArray()

		if (rows.length === 0) {
			logger
				.withTags({
					type: 'oidc_state_invalid',
				})
				.warn('OIDC state not found or expired', {
					state: state.substring(0, 8) + '...',
				})
			throw new Error('Invalid or expired state')
		}

		const stateData = rows[0]

		if (stateData.expires_at < now) {
			logger
				.withTags({
					type: 'oidc_state_expired',
				})
				.warn('OIDC state expired', {
					state: state.substring(0, 8) + '...',
				})
			throw new Error('State expired')
		}

		// Delete the state after validation (one-time use)
		await this.ctx.storage.sql.exec('DELETE FROM oidc_states WHERE state = ?', state)

		logger
			.withTags({
				type: 'oidc_state_validated',
			})
			.info('OIDC state validated and consumed', {
				state: state.substring(0, 8) + '...',
				sessionId: stateData.session_id.substring(0, 8) + '...',
			})

		return stateData.session_id
	}

	// ========== Account Link Management ==========

	private generateLinkId(): string {
		// Generate a random 16-byte link ID
		const array = new Uint8Array(16)
		crypto.getRandomValues(array)
		return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
	}

	async createAccountLink(
		socialUserId: string,
		legacySystem: string,
		legacyUserId: string,
		legacyUsername: string,
		superuser: boolean,
		staff: boolean,
		active: boolean,
		primaryCharacter: string,
		primaryCharacterId: string,
		groups: string[]
	): Promise<AccountLink> {
		await this.ensureSchema()

		// Check if this legacy account is already claimed
		const existingLegacy = await this.ctx.storage.sql
			.exec<AccountLinkData>(
				'SELECT * FROM account_links WHERE legacy_system = ? AND legacy_user_id = ?',
				legacySystem,
				legacyUserId
			)
			.toArray()

		if (existingLegacy.length > 0) {
			throw new Error('This legacy account is already claimed by another user')
		}

		// Check if this social user already has ANY link (1:1 constraint)
		const existingLink = await this.ctx.storage.sql
			.exec<AccountLinkData>('SELECT * FROM account_links WHERE social_user_id = ?', socialUserId)
			.toArray()

		if (existingLink.length > 0) {
			throw new Error(
				'You have already linked a legacy account. Each social account can only be linked to one legacy account permanently.'
			)
		}

		// Create new link
		const linkId = this.generateLinkId()
		const now = Date.now()

		await this.ctx.storage.sql.exec(
			`INSERT INTO account_links (
				link_id, social_user_id, legacy_system,
				legacy_user_id, legacy_username, superuser, staff, active,
				primary_character, primary_character_id, groups, linked_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			linkId,
			socialUserId,
			legacySystem,
			legacyUserId,
			legacyUsername,
			superuser ? 1 : 0,
			staff ? 1 : 0,
			active ? 1 : 0,
			primaryCharacter,
			primaryCharacterId,
			JSON.stringify(groups),
			now,
			now
		)

		// Update is_admin flag on social_users table if user is admin
		if (superuser || staff) {
			await this.ctx.storage.sql.exec(
				`UPDATE social_users SET is_admin = 1, updated_at = ? WHERE social_user_id = ?`,
				now,
				socialUserId
			)

			logger
				.withTags({
					type: 'social_user_admin_flag_set',
				})
				.info('Set admin flag on social user', {
					socialUserId: socialUserId.substring(0, 8) + '...',
					superuser,
					staff,
				})
		}

		logger
			.withTags({
				type: 'account_link_created',
			})
			.info('Created account link', {
				linkId,
				socialUserId: socialUserId.substring(0, 8) + '...',
				legacySystem,
				legacyUserId,
				legacyUsername,
			})

		return {
			linkId,
			socialUserId,
			legacySystem,
			legacyUserId,
			legacyUsername,
			superuser,
			staff,
			active,
			primaryCharacter,
			primaryCharacterId,
			groups,
			linkedAt: now,
			updatedAt: now,
		}
	}

	async getAccountLinksBySocialUser(socialUserId: string): Promise<AccountLink[]> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<AccountLinkData>('SELECT * FROM account_links WHERE social_user_id = ?', socialUserId)
			.toArray()

		return rows.map((row) => ({
			linkId: row.link_id,
			socialUserId: row.social_user_id,
			legacySystem: row.legacy_system,
			legacyUserId: row.legacy_user_id,
			legacyUsername: row.legacy_username,
			superuser: row.superuser === 1,
			staff: row.staff === 1,
			active: row.active === 1,
			primaryCharacter: row.primary_character,
			primaryCharacterId: row.primary_character_id,
			groups: JSON.parse(row.groups),
			linkedAt: row.linked_at,
			updatedAt: row.updated_at,
		}))
	}

	async getAccountLinkByLegacyId(
		legacySystem: string,
		legacyUserId: string
	): Promise<AccountLink | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<AccountLinkData>(
				'SELECT * FROM account_links WHERE legacy_system = ? AND legacy_user_id = ?',
				legacySystem,
				legacyUserId
			)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const row = rows[0]
		return {
			linkId: row.link_id,
			socialUserId: row.social_user_id,
			legacySystem: row.legacy_system,
			legacyUserId: row.legacy_user_id,
			legacyUsername: row.legacy_username,
			superuser: row.superuser === 1,
			staff: row.staff === 1,
			active: row.active === 1,
			primaryCharacter: row.primary_character,
			primaryCharacterId: row.primary_character_id,
			groups: JSON.parse(row.groups),
			linkedAt: row.linked_at,
			updatedAt: row.updated_at,
		}
	}

	async deleteAccountLink(linkId: string): Promise<void> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<AccountLinkData>('SELECT * FROM account_links WHERE link_id = ?', linkId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Account link not found')
		}

		const link = rows[0]

		await this.ctx.storage.sql.exec('DELETE FROM account_links WHERE link_id = ?', linkId)

		logger
			.withTags({
				type: 'account_link_deleted',
			})
			.info('Deleted account link', {
				linkId,
				socialUserId: link.social_user_id.substring(0, 8) + '...',
				legacySystem: link.legacy_system,
				legacyUserId: link.legacy_user_id,
			})
	}

	// ========== Character Link Management ==========

	async createCharacterLink(
		socialUserId: string,
		characterId: number,
		characterName: string
	): Promise<CharacterLink> {
		await this.ensureSchema()

		// Check if this character is already linked to any social user
		const existingCharacter = await this.ctx.storage.sql
			.exec<CharacterLinkData>('SELECT * FROM character_links WHERE character_id = ?', characterId)
			.toArray()

		if (existingCharacter.length > 0) {
			throw new Error('This character is already linked to another social account')
		}

		// Create new link
		const linkId = this.generateLinkId()
		const now = Date.now()

		await this.ctx.storage.sql.exec(
			`INSERT INTO character_links (
				link_id, social_user_id, character_id, character_name, is_primary, linked_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			linkId,
			socialUserId,
			characterId,
			characterName,
			0,
			now,
			now
		)

		logger
			.withTags({
				type: 'character_link_created',
			})
			.info('Created character link', {
				linkId,
				socialUserId: socialUserId.substring(0, 8) + '...',
				characterId,
				characterName,
			})

		return {
			linkId,
			socialUserId,
			characterId,
			characterName,
			isPrimary: false,
			linkedAt: now,
			updatedAt: now,
		}
	}

	async getCharacterLinksBySocialUser(socialUserId: string): Promise<CharacterLink[]> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<CharacterLinkData>(
				'SELECT * FROM character_links WHERE social_user_id = ? ORDER BY is_primary DESC, linked_at DESC',
				socialUserId
			)
			.toArray()

		return rows.map((row) => ({
			linkId: row.link_id,
			socialUserId: row.social_user_id,
			characterId: row.character_id,
			characterName: row.character_name,
			isPrimary: row.is_primary === 1,
			linkedAt: row.linked_at,
			updatedAt: row.updated_at,
		}))
	}

	async getCharacterLinkByCharacterId(characterId: number): Promise<CharacterLink | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<CharacterLinkData>('SELECT * FROM character_links WHERE character_id = ?', characterId)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const row = rows[0]
		return {
			linkId: row.link_id,
			socialUserId: row.social_user_id,
			characterId: row.character_id,
			characterName: row.character_name,
			isPrimary: row.is_primary === 1,
			linkedAt: row.linked_at,
			updatedAt: row.updated_at,
		}
	}

	async setPrimaryCharacter(socialUserId: string, characterId: number): Promise<void> {
		await this.ensureSchema()

		// Verify the character belongs to this user
		const rows = await this.ctx.storage.sql
			.exec<CharacterLinkData>(
				'SELECT * FROM character_links WHERE character_id = ? AND social_user_id = ?',
				characterId,
				socialUserId
			)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Character not found or does not belong to this user')
		}

		const now = Date.now()

		// Unset any existing primary character for this user
		await this.ctx.storage.sql.exec(
			'UPDATE character_links SET is_primary = 0, updated_at = ? WHERE social_user_id = ? AND is_primary = 1',
			now,
			socialUserId
		)

		// Set the new primary character
		await this.ctx.storage.sql.exec(
			'UPDATE character_links SET is_primary = 1, updated_at = ? WHERE character_id = ?',
			now,
			characterId
		)

		logger
			.withTags({
				type: 'character_primary_set',
			})
			.info('Set primary character', {
				socialUserId: socialUserId.substring(0, 8) + '...',
				characterId,
			})
	}

	async deleteCharacterLink(characterId: number): Promise<void> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<CharacterLinkData>('SELECT * FROM character_links WHERE character_id = ?', characterId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Character link not found')
		}

		const link = rows[0]

		await this.ctx.storage.sql.exec(
			'DELETE FROM character_links WHERE character_id = ?',
			characterId
		)

		logger
			.withTags({
				type: 'character_link_deleted',
			})
			.info('Deleted character link', {
				linkId: link.link_id,
				socialUserId: link.social_user_id.substring(0, 8) + '...',
				characterId: link.character_id,
				characterName: link.character_name,
			})
	}

	async searchCharactersByName(query: string): Promise<
		Array<{
			socialUserId: string
			characterId: number
			characterName: string
		}>
	> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<CharacterLinkData>(
				'SELECT * FROM character_links WHERE character_name LIKE ? ORDER BY character_name ASC LIMIT 50',
				`%${query}%`
			)
			.toArray()

		return rows.map((row) => ({
			socialUserId: row.social_user_id,
			characterId: row.character_id,
			characterName: row.character_name,
		}))
	}

	// ========== Provider Link Management ==========

	async createProviderLink(
		socialUserId: string,
		provider: string,
		providerUserId: string,
		providerUsername: string
	): Promise<ProviderLink> {
		await this.ensureSchema()

		// Check if this provider account is already linked to any social user
		const existingProvider = await this.ctx.storage.sql
			.exec<ProviderLinkData>(
				'SELECT * FROM provider_links WHERE provider = ? AND provider_user_id = ?',
				provider,
				providerUserId
			)
			.toArray()

		if (existingProvider.length > 0) {
			throw new Error('This Discord account is already linked to another user')
		}

		// Check if this social user already has this provider linked
		const existingLink = await this.ctx.storage.sql
			.exec<ProviderLinkData>(
				'SELECT * FROM provider_links WHERE social_user_id = ? AND provider = ?',
				socialUserId,
				provider
			)
			.toArray()

		if (existingLink.length > 0) {
			throw new Error('You have already linked a Discord account')
		}

		// Create new link
		const linkId = this.generateLinkId()
		const now = Date.now()

		await this.ctx.storage.sql.exec(
			`INSERT INTO provider_links (
				link_id, social_user_id, provider, provider_user_id, provider_username, linked_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			linkId,
			socialUserId,
			provider,
			providerUserId,
			providerUsername,
			now,
			now
		)

		logger
			.withTags({
				type: 'provider_link_created',
			})
			.info('Created provider link', {
				linkId,
				socialUserId: socialUserId.substring(0, 8) + '...',
				provider,
				providerUserId,
				providerUsername,
			})

		return {
			linkId,
			socialUserId,
			provider,
			providerUserId,
			providerUsername,
			linkedAt: now,
			updatedAt: now,
		}
	}

	async getProviderLinksBySocialUser(socialUserId: string): Promise<ProviderLink[]> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<ProviderLinkData>(
				'SELECT * FROM provider_links WHERE social_user_id = ? ORDER BY linked_at DESC',
				socialUserId
			)
			.toArray()

		return rows.map((row) => ({
			linkId: row.link_id,
			socialUserId: row.social_user_id,
			provider: row.provider,
			providerUserId: row.provider_user_id,
			providerUsername: row.provider_username,
			linkedAt: row.linked_at,
			updatedAt: row.updated_at,
		}))
	}

	async getProviderLinkByProvider(
		provider: string,
		providerUserId: string
	): Promise<ProviderLink | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<ProviderLinkData>(
				'SELECT * FROM provider_links WHERE provider = ? AND provider_user_id = ?',
				provider,
				providerUserId
			)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const row = rows[0]
		return {
			linkId: row.link_id,
			socialUserId: row.social_user_id,
			provider: row.provider,
			providerUserId: row.provider_user_id,
			providerUsername: row.provider_username,
			linkedAt: row.linked_at,
			updatedAt: row.updated_at,
		}
	}

	async deleteProviderLink(linkId: string): Promise<void> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<ProviderLinkData>('SELECT * FROM provider_links WHERE link_id = ?', linkId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Provider link not found')
		}

		const link = rows[0]

		await this.ctx.storage.sql.exec('DELETE FROM provider_links WHERE link_id = ?', linkId)

		logger
			.withTags({
				type: 'provider_link_deleted',
			})
			.info('Deleted provider link', {
				linkId,
				socialUserId: link.social_user_id.substring(0, 8) + '...',
				provider: link.provider,
				providerUserId: link.provider_user_id,
			})
	}
}
