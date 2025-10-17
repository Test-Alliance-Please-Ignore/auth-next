import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import type { Env } from './context'

export interface RootUserData extends Record<string, number | string | null> {
	root_user_id: string
	provider: string
	provider_user_id: string
	email: string
	name: string
	owner_hash: string | null
	is_admin: number
	created_at: number
	updated_at: number
}

export interface RootUser {
	rootUserId: string
	provider: string
	providerUserId: string
	email: string
	name: string
	ownerHash: string | null
	isAdmin: boolean
	createdAt: number
	updatedAt: number
}

export interface SessionData extends Record<string, number | string> {
	session_id: string
	root_user_id: string
	access_token: string
	refresh_token: string
	expires_at: number
	created_at: number
	updated_at: number
}

export interface SessionInfo {
	sessionId: string
	rootUserId: string
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
		rootUserId: string
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
	root_user_id: string
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
	rootUserId: string
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
	root_user_id: string
	character_id: number
	character_name: string
	is_primary: number
	linked_at: number
	updated_at: number
}

export interface CharacterLink {
	linkId: string
	rootUserId: string
	characterId: number
	characterName: string
	isPrimary: boolean
	linkedAt: number
	updatedAt: number
}

export interface ProviderLinkData extends Record<string, number | string> {
	link_id: string
	root_user_id: string
	provider: string
	provider_user_id: string
	provider_username: string
	linked_at: number
	updated_at: number
}

export interface ProviderLink {
	linkId: string
	rootUserId: string
	provider: string
	providerUserId: string
	providerUsername: string
	linkedAt: number
	updatedAt: number
}

export class SessionStore extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	private async initializeSchema() {
		// await this.createSchema()
	}

	private async createSchema(): Promise<void> {
		// Drop all tables if they exist
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS root_users')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS sessions')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS account_links')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS character_links')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS provider_links')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS oidc_states')

		// Complete schema with root_users (EVE SSO only system)
		// Root users table - permanent identity for EVE SSO accounts
		await this.ctx.storage.sql.exec(`
			CREATE TABLE root_users (
				root_user_id TEXT PRIMARY KEY,
				provider TEXT NOT NULL,
				provider_user_id TEXT NOT NULL,
				email TEXT NOT NULL,
				name TEXT NOT NULL,
				owner_hash TEXT NULL,
				is_admin INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(provider, provider_user_id)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX idx_root_users_provider_user ON root_users(provider, provider_user_id)
		`)
		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_root_users_owner_hash ON root_users(owner_hash) WHERE owner_hash IS NOT NULL
		`)
		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_root_users_admin ON root_users(is_admin) WHERE is_admin = 1
		`)

		// Sessions table - ephemeral tokens tied to root users
		await this.ctx.storage.sql.exec(`
			CREATE TABLE sessions (
				session_id TEXT PRIMARY KEY,
				root_user_id TEXT NOT NULL,
				access_token TEXT NOT NULL,
				refresh_token TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_sessions_root_user ON sessions(root_user_id)
		`)
		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_sessions_expires_at ON sessions(expires_at)
		`)

		// Account links table - links root users to legacy accounts
		await this.ctx.storage.sql.exec(`
			CREATE TABLE account_links (
				link_id TEXT PRIMARY KEY,
				root_user_id TEXT NOT NULL,
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
				UNIQUE(root_user_id, legacy_system)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_account_links_root_user ON account_links(root_user_id)
		`)
		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX idx_account_links_legacy_user ON account_links(legacy_system, legacy_user_id)
		`)

		// Character links table - links root users to EVE characters
		await this.ctx.storage.sql.exec(`
			CREATE TABLE character_links (
				link_id TEXT PRIMARY KEY,
				root_user_id TEXT NOT NULL,
				character_id INTEGER NOT NULL,
				character_name TEXT NOT NULL,
				is_primary INTEGER NOT NULL DEFAULT 0,
				linked_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(character_id)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_character_links_root_user ON character_links(root_user_id)
		`)
		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX idx_character_links_character ON character_links(character_id)
		`)
		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX idx_character_links_primary ON character_links(root_user_id) WHERE is_primary = 1
		`)

		// Provider links table - links root users to secondary OAuth providers
		await this.ctx.storage.sql.exec(`
			CREATE TABLE provider_links (
				link_id TEXT PRIMARY KEY,
				root_user_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				provider_user_id TEXT NOT NULL,
				provider_username TEXT NOT NULL,
				linked_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				UNIQUE(root_user_id, provider),
				UNIQUE(provider, provider_user_id)
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_provider_links_root_user ON provider_links(root_user_id)
		`)
		await this.ctx.storage.sql.exec(`
			CREATE UNIQUE INDEX idx_provider_links_provider_user ON provider_links(provider, provider_user_id)
		`)

		// OIDC states table for CSRF protection
		await this.ctx.storage.sql.exec(`
			CREATE TABLE oidc_states (
				state TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_oidc_states_expires_at ON oidc_states(expires_at)
		`)
	}

	private generateSessionId(): string {
		// Generate a random 32-byte session token
		const array = new Uint8Array(32)
		crypto.getRandomValues(array)
		return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
	}

	private generateRootUserId(): string {
		// Generate a cryptographically secure UUID for root user ID (unguessable identifier)
		return crypto.randomUUID()
	}

	// ========== Root User Management ==========

	async getOrCreateRootUser(
		provider: string,
		providerUserId: string,
		email: string,
		name: string,
		ownerHash?: string | null
	): Promise<RootUser> {
		await this.initializeSchema()

		// Try to find existing root user
		const existing = await this.ctx.storage.sql
			.exec<RootUserData>(
				'SELECT * FROM root_users WHERE provider = ? AND provider_user_id = ?',
				provider,
				providerUserId
			)
			.toArray()

		const now = Date.now()

		if (existing.length > 0) {
			const user = existing[0]

			// Check for owner hash changes (character ownership transfer detection)
			if (ownerHash && user.owner_hash && user.owner_hash !== ownerHash) {
				logger
					.withTags({
						type: 'owner_hash_changed',
						provider,
					})
					.warn('Character owner hash changed - possible ownership transfer', {
						rootUserId: user.root_user_id.substring(0, 8) + '...',
						provider,
						characterId: providerUserId,
						oldOwnerHash: user.owner_hash.substring(0, 8) + '...',
						newOwnerHash: ownerHash.substring(0, 8) + '...',
					})
				// Note: Currently just logging - in production you may want to reject login or unlink character
			}

			// Update email, name, and owner hash if they've changed
			const needsUpdate =
				user.email !== email || user.name !== name || (ownerHash && user.owner_hash !== ownerHash)

			if (needsUpdate) {
				await this.ctx.storage.sql.exec(
					`UPDATE root_users SET email = ?, name = ?, owner_hash = ?, updated_at = ? WHERE root_user_id = ?`,
					email,
					name,
					ownerHash || user.owner_hash,
					now,
					user.root_user_id
				)

				logger
					.withTags({
						type: 'root_user_updated',
						provider,
					})
					.info('Updated root user info', {
						rootUserId: user.root_user_id.substring(0, 8) + '...',
						provider,
						email,
						ownerHashUpdated: ownerHash && user.owner_hash !== ownerHash,
					})
			}

			return {
				rootUserId: user.root_user_id,
				provider: user.provider,
				providerUserId: user.provider_user_id,
				email,
				name,
				ownerHash: ownerHash || user.owner_hash,
				isAdmin: user.is_admin === 1,
				createdAt: user.created_at,
				updatedAt: now,
			}
		}

		// Create new root user
		const rootUserId = this.generateRootUserId()

		await this.ctx.storage.sql.exec(
			`INSERT INTO root_users (root_user_id, provider, provider_user_id, email, name, owner_hash, is_admin, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			rootUserId,
			provider,
			providerUserId,
			email,
			name,
			ownerHash || null,
			0, // Default to not admin
			now,
			now
		)

		logger
			.withTags({
				type: 'root_user_created',
				provider,
			})
			.info('Created new root user', {
				rootUserId: rootUserId.substring(0, 8) + '...',
				provider,
				providerUserId: providerUserId.substring(0, 8) + '...',
				email,
				hasOwnerHash: !!ownerHash,
			})

		return {
			rootUserId,
			provider,
			providerUserId,
			email,
			name,
			ownerHash: ownerHash || null,
			isAdmin: false,
			createdAt: now,
			updatedAt: now,
		}
	}

	async getRootUser(rootUserId: string): Promise<RootUser | null> {
		await this.initializeSchema()

		const rows = await this.ctx.storage.sql
			.exec<RootUserData>('SELECT * FROM root_users WHERE root_user_id = ?', rootUserId)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const user = rows[0]
		return {
			rootUserId: user.root_user_id,
			provider: user.provider,
			providerUserId: user.provider_user_id,
			email: user.email,
			name: user.name,
			ownerHash: user.owner_hash,
			isAdmin: user.is_admin === 1,
			createdAt: user.created_at,
			updatedAt: user.updated_at,
		}
	}

	async getRootUserByProvider(provider: string, providerUserId: string): Promise<RootUser | null> {
		await this.initializeSchema()

		const rows = await this.ctx.storage.sql
			.exec<RootUserData>(
				'SELECT * FROM root_users WHERE provider = ? AND provider_user_id = ?',
				provider,
				providerUserId
			)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const user = rows[0]
		return {
			rootUserId: user.root_user_id,
			provider: user.provider,
			providerUserId: user.provider_user_id,
			email: user.email,
			name: user.name,
			ownerHash: user.owner_hash,
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
		await this.initializeSchema()

		const now = Date.now()
		// Session expires in 48 hours (independent of OAuth token expiration)
		// OAuth tokens will be automatically refreshed as needed
		const sessionExpiresAt = now + 48 * 60 * 60 * 1000 // 48 hours
		// Note: _expiresIn parameter represents OAuth token expiration but we ignore it
		// since we handle token refresh automatically

		// Get or create root user (permanent identity)
		const rootUser = await this.getOrCreateRootUser(provider, providerUserId, email, name)

		// Check if a session already exists for this root user
		const existing = await this.ctx.storage.sql
			.exec<SessionData>(
				'SELECT session_id FROM sessions WHERE root_user_id = ?',
				rootUser.rootUserId
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
					rootUserId: rootUser.rootUserId.substring(0, 8) + '...',
					provider,
					email,
					expiresAt: new Date(sessionExpiresAt).toISOString(),
				})

			return {
				sessionId: existingSessionId,
				rootUserId: rootUser.rootUserId,
				provider: rootUser.provider,
				providerUserId: rootUser.providerUserId,
				email: rootUser.email,
				name: rootUser.name,
				accessToken,
				expiresAt: sessionExpiresAt,
			}
		}

		// Create new session
		const sessionId = this.generateSessionId()

		await this.ctx.storage.sql.exec(
			`INSERT INTO sessions (
				session_id, root_user_id, access_token, refresh_token, expires_at, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			sessionId,
			rootUser.rootUserId,
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
				rootUserId: rootUser.rootUserId.substring(0, 8) + '...',
				provider,
				email,
				expiresAt: new Date(sessionExpiresAt).toISOString(),
			})

		return {
			sessionId,
			rootUserId: rootUser.rootUserId,
			provider: rootUser.provider,
			providerUserId: rootUser.providerUserId,
			email: rootUser.email,
			name: rootUser.name,
			accessToken,
			expiresAt: sessionExpiresAt,
		}
	}

	async getSession(sessionId: string): Promise<SessionInfo> {
		await this.initializeSchema()

		const rows = await this.ctx.storage.sql
			.exec<SessionData>(`SELECT * FROM sessions WHERE session_id = ?`, sessionId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Session not found')
		}

		const session = rows[0]

		// Get root user info
		const rootUser = await this.getRootUser(session.root_user_id)
		if (!rootUser) {
			throw new Error('Root user not found for session')
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
			const refreshed = await this.refreshAccessToken(session, rootUser)
			if (refreshed.success && refreshed.data) {
				return {
					sessionId: session.session_id,
					rootUserId: rootUser.rootUserId,
					provider: rootUser.provider,
					providerUserId: rootUser.providerUserId,
					email: rootUser.email,
					name: rootUser.name,
					accessToken: refreshed.data.accessToken,
					expiresAt: session.expires_at, // Session expiration, not token expiration
				}
			}
			// If refresh failed, return the existing token anyway and let it fail naturally
		}

		return {
			sessionId: session.session_id,
			rootUserId: rootUser.rootUserId,
			provider: rootUser.provider,
			providerUserId: rootUser.providerUserId,
			email: rootUser.email,
			name: rootUser.name,
			accessToken: session.access_token,
			expiresAt: session.expires_at,
		}
	}

	private async refreshAccessToken(
		_session: SessionData,
		rootUser: RootUser
	): Promise<{ success: boolean; data?: { accessToken: string; expiresAt: number } }> {
		// EVE SSO token refresh is handled by the UserTokenStore DO
		// This SessionStore only manages session validity (48 hour expiration)
		// Not provider-specific OAuth token refresh
		logger
			.withTags({
				type: 'token_refresh_not_supported',
				provider: rootUser.provider,
			})
			.info('Token refresh not implemented - EVE SSO tokens managed separately')
		return { success: false }
	}

	async refreshSession(sessionId: string): Promise<SessionInfo> {
		await this.initializeSchema()

		const rows = await this.ctx.storage.sql
			.exec<SessionData>(`SELECT * FROM sessions WHERE session_id = ?`, sessionId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Session not found')
		}

		const session = rows[0]

		// Get root user info
		const rootUser = await this.getRootUser(session.root_user_id)
		if (!rootUser) {
			throw new Error('Root user not found for session')
		}

		const refreshed = await this.refreshAccessToken(session, rootUser)

		if (!refreshed.success || !refreshed.data) {
			throw new Error('Failed to refresh token')
		}

		return {
			sessionId: session.session_id,
			rootUserId: rootUser.rootUserId,
			provider: rootUser.provider,
			providerUserId: rootUser.providerUserId,
			email: rootUser.email,
			name: rootUser.name,
			accessToken: refreshed.data.accessToken,
			expiresAt: refreshed.data.expiresAt,
		}
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.initializeSchema()

		// Check if the session exists
		const rows = await this.ctx.storage.sql
			.exec<SessionData>(`SELECT root_user_id FROM sessions WHERE session_id = ?`, sessionId)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Session not found')
		}

		const session = rows[0]

		// Get root user info for logging
		const rootUser = await this.getRootUser(session.root_user_id)

		// Delete the session
		await this.ctx.storage.sql.exec(`DELETE FROM sessions WHERE session_id = ?`, sessionId)

		logger
			.withTags({
				type: 'session_deleted',
				provider: rootUser?.provider || 'unknown',
			})
			.info('Session deleted', {
				sessionId: sessionId.substring(0, 8) + '...',
				rootUserId: session.root_user_id.substring(0, 8) + '...',
				provider: rootUser?.provider || 'unknown',
			})
	}

	async listSessions(limit?: number, offset?: number): Promise<SessionListResult> {
		await this.initializeSchema()

		const parsedLimit = Math.min(limit || 50, 100)
		const parsedOffset = offset || 0

		// Get total count
		const countRows = await this.ctx.storage.sql
			.exec<{ count: number }>('SELECT COUNT(*) as count FROM sessions')
			.toArray()
		const total = countRows[0]?.count || 0

		// Get paginated results joined with root users (exclude sensitive tokens)
		const rows = await this.ctx.storage.sql
			.exec<SessionData & RootUserData>(
				`SELECT
					s.session_id, s.root_user_id, s.expires_at, s.created_at, s.updated_at,
					u.provider, u.provider_user_id, u.email, u.name
				FROM sessions s
				JOIN root_users u ON s.root_user_id = u.root_user_id
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
				rootUserId: row.root_user_id,
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
		await this.initializeSchema()

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
		await this.initializeSchema()

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
		await this.initializeSchema()

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
		rootUserId: string,
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
		await this.initializeSchema()

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

		// Check if this root user already has ANY link (1:1 constraint)
		const existingLink = await this.ctx.storage.sql
			.exec<AccountLinkData>('SELECT * FROM account_links WHERE root_user_id = ?', rootUserId)
			.toArray()

		if (existingLink.length > 0) {
			throw new Error(
				'You have already linked a legacy account. Each root account can only be linked to one legacy account permanently.'
			)
		}

		// Create new link
		const linkId = this.generateLinkId()
		const now = Date.now()

		await this.ctx.storage.sql.exec(
			`INSERT INTO account_links (
				link_id, root_user_id, legacy_system,
				legacy_user_id, legacy_username, superuser, staff, active,
				primary_character, primary_character_id, groups, linked_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			linkId,
			rootUserId,
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

		// Update is_admin flag on root_users table if user is admin
		if (superuser || staff) {
			await this.ctx.storage.sql.exec(
				`UPDATE root_users SET is_admin = 1, updated_at = ? WHERE root_user_id = ?`,
				now,
				rootUserId
			)

			logger
				.withTags({
					type: 'root_user_admin_flag_set',
				})
				.info('Set admin flag on root user', {
					rootUserId: rootUserId.substring(0, 8) + '...',
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
				rootUserId: rootUserId.substring(0, 8) + '...',
				legacySystem,
				legacyUserId,
				legacyUsername,
			})

		return {
			linkId,
			rootUserId,
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

	async getAccountLinksByRootUser(rootUserId: string): Promise<AccountLink[]> {
		await this.initializeSchema()

		const rows = await this.ctx.storage.sql
			.exec<AccountLinkData>('SELECT * FROM account_links WHERE root_user_id = ?', rootUserId)
			.toArray()

		return rows.map((row) => ({
			linkId: row.link_id,
			rootUserId: row.root_user_id,
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
		await this.initializeSchema()

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
			rootUserId: row.root_user_id,
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
		await this.initializeSchema()

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
				rootUserId: link.root_user_id.substring(0, 8) + '...',
				legacySystem: link.legacy_system,
				legacyUserId: link.legacy_user_id,
			})
	}

	// ========== Character Link Management ==========

	async createCharacterLink(
		rootUserId: string,
		characterId: number,
		characterName: string
	): Promise<CharacterLink> {
		await this.initializeSchema()

		// Check if this character is already linked to any root user
		const existingCharacter = await this.ctx.storage.sql
			.exec<CharacterLinkData>('SELECT * FROM character_links WHERE character_id = ?', characterId)
			.toArray()

		if (existingCharacter.length > 0) {
			throw new Error('This character is already linked to another root account')
		}

		// Create new link
		const linkId = this.generateLinkId()
		const now = Date.now()

		await this.ctx.storage.sql.exec(
			`INSERT INTO character_links (
				link_id, root_user_id, character_id, character_name, is_primary, linked_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			linkId,
			rootUserId,
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
				rootUserId: rootUserId.substring(0, 8) + '...',
				characterId,
				characterName,
			})

		return {
			linkId,
			rootUserId,
			characterId,
			characterName,
			isPrimary: false,
			linkedAt: now,
			updatedAt: now,
		}
	}

	async getCharacterLinksByRootUser(rootUserId: string): Promise<CharacterLink[]> {
		await this.initializeSchema()

		const rows = await this.ctx.storage.sql
			.exec<CharacterLinkData>(
				'SELECT * FROM character_links WHERE root_user_id = ? ORDER BY is_primary DESC, linked_at DESC',
				rootUserId
			)
			.toArray()

		return rows.map((row) => ({
			linkId: row.link_id,
			rootUserId: row.root_user_id,
			characterId: row.character_id,
			characterName: row.character_name,
			isPrimary: row.is_primary === 1,
			linkedAt: row.linked_at,
			updatedAt: row.updated_at,
		}))
	}

	async getCharacterLinkByCharacterId(characterId: number): Promise<CharacterLink | null> {
		await this.initializeSchema()

		const rows = await this.ctx.storage.sql
			.exec<CharacterLinkData>('SELECT * FROM character_links WHERE character_id = ?', characterId)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const row = rows[0]
		return {
			linkId: row.link_id,
			rootUserId: row.root_user_id,
			characterId: row.character_id,
			characterName: row.character_name,
			isPrimary: row.is_primary === 1,
			linkedAt: row.linked_at,
			updatedAt: row.updated_at,
		}
	}

	async setPrimaryCharacter(rootUserId: string, characterId: number): Promise<void> {
		await this.initializeSchema()

		// Verify the character belongs to this user
		const rows = await this.ctx.storage.sql
			.exec<CharacterLinkData>(
				'SELECT * FROM character_links WHERE character_id = ? AND root_user_id = ?',
				characterId,
				rootUserId
			)
			.toArray()

		if (rows.length === 0) {
			throw new Error('Character not found or does not belong to this user')
		}

		const now = Date.now()

		// Unset any existing primary character for this user
		await this.ctx.storage.sql.exec(
			'UPDATE character_links SET is_primary = 0, updated_at = ? WHERE root_user_id = ? AND is_primary = 1',
			now,
			rootUserId
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
				rootUserId: rootUserId.substring(0, 8) + '...',
				characterId,
			})
	}

	async deleteCharacterLink(characterId: number): Promise<void> {
		await this.initializeSchema()

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
				rootUserId: link.root_user_id.substring(0, 8) + '...',
				characterId: link.character_id,
				characterName: link.character_name,
			})
	}

	async searchCharactersByName(query: string): Promise<
		Array<{
			rootUserId: string
			characterId: number
			characterName: string
		}>
	> {
		await this.initializeSchema()

		const rows = await this.ctx.storage.sql
			.exec<CharacterLinkData>(
				'SELECT * FROM character_links WHERE character_name LIKE ? ORDER BY character_name ASC LIMIT 50',
				`%${query}%`
			)
			.toArray()

		return rows.map((row) => ({
			rootUserId: row.root_user_id,
			characterId: row.character_id,
			characterName: row.character_name,
		}))
	}

	// ========== Provider Link Management ==========

	async createProviderLink(
		rootUserId: string,
		provider: string,
		providerUserId: string,
		providerUsername: string
	): Promise<ProviderLink> {
		await this.initializeSchema()

		// Check if this provider account is already linked to any root user
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

		// Check if this root user already has this provider linked
		const existingLink = await this.ctx.storage.sql
			.exec<ProviderLinkData>(
				'SELECT * FROM provider_links WHERE root_user_id = ? AND provider = ?',
				rootUserId,
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
				link_id, root_user_id, provider, provider_user_id, provider_username, linked_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			linkId,
			rootUserId,
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
				rootUserId: rootUserId.substring(0, 8) + '...',
				provider,
				providerUserId,
				providerUsername,
			})

		return {
			linkId,
			rootUserId,
			provider,
			providerUserId,
			providerUsername,
			linkedAt: now,
			updatedAt: now,
		}
	}

	async getProviderLinksByRootUser(rootUserId: string): Promise<ProviderLink[]> {
		await this.initializeSchema()

		const rows = await this.ctx.storage.sql
			.exec<ProviderLinkData>(
				'SELECT * FROM provider_links WHERE root_user_id = ? ORDER BY linked_at DESC',
				rootUserId
			)
			.toArray()

		return rows.map((row) => ({
			linkId: row.link_id,
			rootUserId: row.root_user_id,
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
		await this.initializeSchema()

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
			rootUserId: row.root_user_id,
			provider: row.provider,
			providerUserId: row.provider_user_id,
			providerUsername: row.provider_username,
			linkedAt: row.linked_at,
			updatedAt: row.updated_at,
		}
	}

	async deleteProviderLink(linkId: string): Promise<void> {
		await this.initializeSchema()

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
				rootUserId: link.root_user_id.substring(0, 8) + '...',
				provider: link.provider,
				providerUserId: link.provider_user_id,
			})
	}
}
