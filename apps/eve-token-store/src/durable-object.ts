import { DurableObject } from 'cloudflare:workers'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import * as z4 from 'zod/v4/core'

import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { eveCharacters, eveTokens } from './db/schema'
import {
	classifyAuthEsiPriority,
	computeEffectiveAuthEsiBudgetLimits,
	isAuthEsiBudgetExceeded,
	normalizeAuthEsiRouteKey,
} from './lib/auth-esi-budget'
import { computeCircuitOpenUntil } from './lib/auth-esi-breaker'
import {
	shouldOpenGlobalEmergencyCircuit,
	shouldOpenRouteCircuitForResponse,
} from './lib/auth-esi-circuit-policy'
import { computeRampRetryAfterSeconds } from './lib/auth-esi-ramp'
import {
	classifySsoError,
	isPermanentRefreshFailure,
	isRefreshBackstopExpired,
	shouldForcePermanentByInvalidAge,
} from './lib/token-health'

import type {
	AuthorizationUrlResponse,
	CachedEveMetadata,
	CallbackResult,
	EsiAlliance,
	EsiCharacterAffiliation,
	EsiCorporation,
	EsiResponse,
	EveMetadata,
	EveTokenResponse,
	EveTokenStore,
	EveVerifyResponse,
	TokenInfo,
	TokenValidationResult,
} from '@repo/eve-token-store'
import type { EveCharacterId } from '@repo/eve-types'
import type { Env } from './context'

/**
 * EVE SSO OAuth Endpoints
 */
const EVE_SSO_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize'
const EVE_SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token'
const EVE_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const EVE_SSO_JWKS_FALLBACK_URL = 'https://login.eveonline.com/oauth/jwks'
const METADATA_TTL_MS = 5 * 60 * 1000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const AUTH_ESI_BREAKER_STORAGE_KEY = 'esi:auth:breaker:open-until-ms'
const AUTH_ESI_BREAKER_LAST_OPEN_UNTIL_STORAGE_KEY = 'esi:auth:breaker:last-open-until-ms'
const AUTH_ESI_ROUTE_BREAKER_OPEN_UNTIL_PREFIX = 'esi:auth:breaker:route:open-until-ms:'
const AUTH_ESI_ROUTE_BREAKER_LAST_OPEN_UNTIL_PREFIX = 'esi:auth:breaker:route:last-open-until-ms:'
const AUTH_ESI_DYNAMIC_BUDGET_STORAGE_KEY = 'esi:auth:budget:dynamic'
const AUTH_ESI_BREAKER_MIN_OPEN_MS = 5_000
const AUTH_ESI_BREAKER_MAX_OPEN_MS = 5 * 60 * 1000
const AUTH_ESI_RATE_WINDOW_MS = 60 * 1000
const AUTH_ESI_GLOBAL_WINDOW_LIMIT = 180
const AUTH_ESI_ROUTE_WINDOW_LIMIT = 60
const AUTH_ESI_BACKGROUND_WINDOW_LIMIT = 130
const AUTH_ESI_RAMP_WINDOW_MS = 60 * 1000
const TOKEN_REFRESH_COOLDOWN_PREFIX = 'token:refresh:cooldown:'
const TOKEN_REFRESH_TRANSIENT_COOLDOWN_MS = 5 * 60 * 1000

/**
 * EVE SSO Scopes
 */
const EVE_SCOPES_ALL = [
	'publicData',
	'esi-calendar.respond_calendar_events.v1',
	'esi-calendar.read_calendar_events.v1',
	'esi-location.read_location.v1',
	'esi-location.read_ship_type.v1',
	'esi-mail.read_mail.v1',
	'esi-skills.read_skills.v1',
	'esi-skills.read_skillqueue.v1',
	'esi-wallet.read_character_wallet.v1',
	'esi-wallet.read_corporation_wallet.v1',
	'esi-search.search_structures.v1',
	'esi-clones.read_clones.v1',
	'esi-characters.read_contacts.v1',
	'esi-universe.read_structures.v1',
	'esi-killmails.read_killmails.v1',
	'esi-corporations.read_corporation_membership.v1',
	'esi-assets.read_assets.v1',
	'esi-planets.manage_planets.v1',
	'esi-fleets.read_fleet.v1',
	'esi-fleets.write_fleet.v1',
	'esi-ui.open_window.v1',
	'esi-ui.write_waypoint.v1',
	'esi-characters.write_contacts.v1',
	'esi-fittings.read_fittings.v1',
	'esi-fittings.write_fittings.v1',
	'esi-markets.structure_markets.v1',
	'esi-corporations.read_structures.v1',
	'esi-characters.read_loyalty.v1',
	'esi-characters.read_chat_channels.v1',
	'esi-characters.read_medals.v1',
	'esi-characters.read_standings.v1',
	'esi-characters.read_agents_research.v1',
	'esi-industry.read_character_jobs.v1',
	'esi-markets.read_character_orders.v1',
	'esi-characters.read_blueprints.v1',
	'esi-characters.read_corporation_roles.v1',
	'esi-location.read_online.v1',
	'esi-contracts.read_character_contracts.v1',
	'esi-clones.read_implants.v1',
	'esi-characters.read_fatigue.v1',
	'esi-killmails.read_corporation_killmails.v1',
	'esi-corporations.track_members.v1',
	'esi-wallet.read_corporation_wallets.v1',
	'esi-characters.read_notifications.v1',
	'esi-corporations.read_divisions.v1',
	'esi-corporations.read_contacts.v1',
	'esi-assets.read_corporation_assets.v1',
	'esi-corporations.read_titles.v1',
	'esi-corporations.read_blueprints.v1',
	'esi-contracts.read_corporation_contracts.v1',
	'esi-corporations.read_standings.v1',
	'esi-corporations.read_starbases.v1',
	'esi-industry.read_corporation_jobs.v1',
	'esi-markets.read_corporation_orders.v1',
	'esi-corporations.read_container_logs.v1',
	'esi-industry.read_character_mining.v1',
	'esi-industry.read_corporation_mining.v1',
	'esi-planets.read_customs_offices.v1',
	'esi-corporations.read_facilities.v1',
	'esi-corporations.read_medals.v1',
	'esi-characters.read_titles.v1',
	'esi-alliances.read_contacts.v1',
	'esi-characters.read_fw_stats.v1',
	'esi-corporations.read_fw_stats.v1',
	'esi-corporations.read_projects.v1',
] as const

/**
 * EveTokenStore Durable Object
 *
 * This Durable Object handles:
 * - EVE Online SSO OAuth flow
 * - Token storage and encryption
 * - Automatic token refresh via alarms
 * - RPC methods for remote calls
 */
export class EveTokenStoreDO extends DurableObject<Env> implements EveTokenStore {
	private db: ReturnType<typeof createDb>
	private jwks: ReturnType<typeof createRemoteJWKSet> | null = null
	private jwksUri: string | null = null
	private metadata: CachedEveMetadata | null = null
	private authEsiBreakerOpenUntilMs = 0
	private authEsiBreakerLastOpenUntilMs = 0
	private authEsiRouteBreakerOpenUntilMs = new Map<string, number>()
	private authEsiRouteBreakerLastOpenUntilMs = new Map<string, number>()
	private authEsiDynamicBudget:
		| {
				remain: number
				resetSeconds: number
				observedAtMs: number
		  }
		| null = null

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		// Local Vite dev is the only environment exhibiting the CONNECT failure
		// on this path, so use Neon HTTP there and keep WebSockets elsewhere.
		const useWebSocket = env.ENVIRONMENT !== 'development'
		this.db = createDb(env.DATABASE_URL, useWebSocket)

		// Load cached metadata from DO storage once on startup.
		state.blockConcurrencyWhile(async () => {
			this.metadata = (await state.storage.get<CachedEveMetadata>('eve:oauth:metadata')) ?? null
			this.authEsiBreakerOpenUntilMs =
				(await state.storage.get<number>(AUTH_ESI_BREAKER_STORAGE_KEY)) ?? 0
			this.authEsiBreakerLastOpenUntilMs =
				(await state.storage.get<number>(AUTH_ESI_BREAKER_LAST_OPEN_UNTIL_STORAGE_KEY)) ?? 0
			this.authEsiDynamicBudget =
				(await state.storage.get<{
					remain: number
					resetSeconds: number
					observedAtMs: number
				}>(AUTH_ESI_DYNAMIC_BUDGET_STORAGE_KEY)) ?? null

			if (this.metadata) {
				this.jwksUri = this.metadata.jwks_uri
				this.jwks = createRemoteJWKSet(new URL(this.metadata.jwks_uri))
			}
		})

		// Initialize SQLite cache table for ESI responses
		void this.initializeEsiCache()

		// Schedule alarm for token refresh (check every 5 minutes)
		void this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000)
	}

	/**
	 * Returns EVE OAuth authorization server metadata, using a two-layer cache.
	 *
	 * Resolution order:
	 * 1. Reuse the warm in-memory cache on the current Durable Object instance.
	 * 2. Reuse the cached value persisted in Durable Object storage.
	 * 3. Fetch fresh metadata from EVE's OAuth metadata endpoint.
	 * 4. Fall back to hardcoded metadata if discovery fails.
	 *
	 * When cached metadata is loaded from storage and its `jwks_uri` differs from the
	 * currently initialized JWKS resolver, this method rebuilds the remote JWK set so
	 * future token verification uses the discovered key endpoint.
	 *
	 * @returns {Promise<CachedMetadata>} Cached or freshly fetched EVE OAuth metadata.
	 */
	private async getEveMetadata(): Promise<CachedEveMetadata> {
		const now = Date.now()

		// Fast path: warm in-memory cache
		if (this.metadata && now < this.metadata.expiresAt) {
			return this.metadata
		}

		// Second chance: durable cache from storage
		const stored = await this.state.storage.get<CachedEveMetadata>('eve:oauth:metadata')
		if (stored && now < stored.expiresAt) {
			this.metadata = stored

			if (this.jwksUri !== stored.jwks_uri) {
				this.jwksUri = stored.jwks_uri
				this.jwks = createRemoteJWKSet(new URL(stored.jwks_uri))
			}

			return stored
		}

		// Refresh from EVE
		try {
			const res = await fetch(EVE_METADATA_URL, {
				headers: { accept: 'application/json' },
			})

			if (!res.ok) {
				throw new Error(`metadata fetch failed: ${res.status}`)
			}

			const json = (await res.json()) as EveMetadata

			if (!json.issuer || !json.jwks_uri) {
				throw new Error('metadata missing issuer or jwks_uri')
			}

			const fresh: CachedEveMetadata = {
				issuer: json.issuer,
				jwks_uri: json.jwks_uri,
				fetchedAt: now,
				expiresAt: now + METADATA_TTL_MS,
			}

			await this.state.storage.put('eve:oauth:metadata', fresh)
			this.metadata = fresh
			if (this.jwksUri !== fresh.jwks_uri) {
				this.jwksUri = fresh.jwks_uri
				this.jwks = createRemoteJWKSet(new URL(fresh.jwks_uri))
			}
			return fresh
		} catch (error) {
			logger
				.withTags({ operation: 'getEveMetadta' })
				.error('Failed to fetch EVE OAuth metadata, falling back to hardcoded url', error)

			// fallback path
			const fallback: CachedEveMetadata = {
				issuer: 'https://login.eveonline.com',
				jwks_uri: EVE_SSO_JWKS_FALLBACK_URL,
				fetchedAt: now,
				expiresAt: now + METADATA_TTL_MS,
			}

			this.metadata = fallback
			if (this.jwksUri !== fallback.jwks_uri) {
				this.jwksUri = fallback.jwks_uri
				this.jwks = createRemoteJWKSet(new URL(fallback.jwks_uri))
			}
			return fallback
		}
	}

	private getTokenRefreshCooldownKey(characterId: string): string {
		return `${TOKEN_REFRESH_COOLDOWN_PREFIX}${characterId}`
	}

	private async getTokenRefreshCooldownUntil(characterId: string): Promise<number> {
		return (
			(await this.state.storage.get<number>(this.getTokenRefreshCooldownKey(characterId))) ?? 0
		)
	}

	private async setTokenRefreshCooldownUntil(
		characterId: string,
		cooldownUntilMs: number
	): Promise<void> {
		await this.state.storage.put(this.getTokenRefreshCooldownKey(characterId), cooldownUntilMs)
	}

	private async clearTokenRefreshCooldown(characterId: string): Promise<void> {
		await this.state.storage.delete(this.getTokenRefreshCooldownKey(characterId))
	}

	/**
	 * Returns the current EVE OAuth metadata together with a remote JWKS resolver.
	 *
	 * This method ensures metadata has been loaded first, then lazily initializes the
	 * `jose` remote JWK set resolver from the discovered `jwks_uri` if one has not
	 * already been created for the current Durable Object instance.
	 *
	 * @returns An object containing the resolved OAuth metadata and the initialized
	 * remote JWKS set used for JWT verification.
	 */
	private async getJwks() {
		const metadata = await this.getEveMetadata()

		if (!this.jwks) {
			this.jwksUri = metadata.jwks_uri
			this.jwks = createRemoteJWKSet(new URL(metadata.jwks_uri))
		}

		return { metadata, jwks: this.jwks }
	}

	/**
	 * Initialize SQLite cache tables for ESI responses and entity data
	 */
	private async initializeEsiCache(): Promise<void> {
		try {
			// ESI response cache (for raw API responses)
			await this.state.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS esi_cache (
					cache_key TEXT PRIMARY KEY,
					response_data TEXT NOT NULL,
					expires_at INTEGER NOT NULL,
					etag TEXT,
					last_modified TEXT,
					pages INTEGER,
					page INTEGER
				)
			`)

			// Migrate existing tables to add pagination fields if they don't exist
			// SQLite doesn't support "IF NOT EXISTS" for ALTER TABLE, so we check first
			const columns = [...this.state.storage.sql.exec(`PRAGMA table_info(esi_cache)`)]
			const hasPages = columns.some((col: any) => col.name === 'pages')
			const hasPage = columns.some((col: any) => col.name === 'page')

			if (!hasPages) {
				await this.state.storage.sql.exec(`ALTER TABLE esi_cache ADD COLUMN pages INTEGER`)
			}
			if (!hasPage) {
				await this.state.storage.sql.exec(`ALTER TABLE esi_cache ADD COLUMN page INTEGER`)
			}

			// Entity cache (for corporations, alliances, etc.)
			await this.state.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS entity_cache (
					entity_type TEXT NOT NULL,
					entity_id TEXT NOT NULL,
					entity_name TEXT NOT NULL,
					entity_data TEXT NOT NULL,
					expires_at INTEGER NOT NULL,
					PRIMARY KEY (entity_type, entity_id)
				)
			`)

			// Index for name lookups
			await this.state.storage.sql.exec(`
				CREATE INDEX IF NOT EXISTS idx_entity_name
				ON entity_cache(entity_type, entity_name)
			`)
		} catch (error) {
			logger
				.withTags({ operation: 'initializeEsiCache' })
				.error('Failed to initialize ESI cache tables', error)
			throw error
		}
	}

	/**
	 * Start OAuth flow for login (all scopes)
	 */
	async startLoginFlow(state?: string): Promise<AuthorizationUrlResponse> {
		try {
			const result = this.generateAuthUrl(EVE_SCOPES_ALL, state)
			return result
		} catch (error) {
			logger
				.withTags({ operation: 'startLoginFlow', state })
				.error('Failed to start login flow', error)
			throw error
		}
	}

	/**
	 * Start OAuth flow for character attachment (all scopes)
	 */
	async startCharacterFlow(state?: string): Promise<AuthorizationUrlResponse> {
		try {
			const result = this.generateAuthUrl(EVE_SCOPES_ALL, state)
			return result
		} catch (error) {
			logger
				.withTags({ operation: 'startCharacterFlow', state })
				.error('Failed to start character flow', error)
			throw error
		}
	}

	/**
	 * Handle OAuth callback - exchange code for tokens and store them
	 */
	async handleCallback(code: string, state?: string): Promise<CallbackResult> {
		try {
			// Exchange authorization code for tokens
			const tokenResponse = await this.exchangeCodeForToken(code)

			// Verify the token and get character information
			const verifyResponse = await this.verifyToken(tokenResponse.access_token)

			// Parse scopes
			const scopes = verifyResponse.Scopes ? verifyResponse.Scopes.split(' ') : []

			// Calculate token expiration
			const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000)

			// Store character and token in database
			await this.storeToken(
				verifyResponse.CharacterID,
				verifyResponse.CharacterName,
				verifyResponse.CharacterOwnerHash,
				scopes,
				tokenResponse.access_token,
				tokenResponse.refresh_token || null,
				expiresAt
			)

			const result = {
				success: true,
				characterId: verifyResponse.CharacterID,
				characterInfo: {
					characterId: verifyResponse.CharacterID,
					characterName: verifyResponse.CharacterName,
					characterOwnerHash: verifyResponse.CharacterOwnerHash,
					scopes,
				},
			}
			return result
		} catch (error) {
			logger
				.withTags({ operation: 'handleCallback', state })
				.error('Callback handling failed', error)
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			}
		}
	}

	/**
	 * Manually refresh a token
	 */
	async refreshToken(characterId: string): Promise<boolean> {
		try {
			const cooldownUntilMs = await this.getTokenRefreshCooldownUntil(characterId)
			const nowMs = Date.now()
			if (cooldownUntilMs > nowMs) {
				logger.withTags({ operation: 'refreshToken', characterId }).warn(
					'Skipping refresh: token is in cooldown window',
					{
						cooldownUntil: new Date(cooldownUntilMs).toISOString(),
					}
				)
				return false
			}

			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterId, String(characterId)),
			})

			if (!character) {
				logger.withTags({ operation: 'refreshToken', characterId }).error('Character not found')
				return false
			}

			// Get token record
			const tokenRecord = await this.db.query.eveTokens.findFirst({
				where: eq(eveTokens.characterId, character.id),
			})

			if (!tokenRecord) {
				logger
					.withTags({ operation: 'refreshToken', characterId })
					.error('Token or refresh token not found', {
						hasTokenRecord: false,
						hasRefreshToken: false,
					})
				return false
			}
			if (tokenRecord.permanentInvalidAt) {
				logger.withTags({ operation: 'refreshToken', characterId }).warn(
					'Skipping refresh: token is permanently invalid',
					{
						permanentInvalidAt: tokenRecord.permanentInvalidAt.toISOString(),
						reason: tokenRecord.permanentInvalidReason,
					}
				)
				return false
			}
			if (shouldForcePermanentByInvalidAge(tokenRecord.invalidSince)) {
				await this.db
					.update(eveTokens)
					.set({
						permanentInvalidAt: new Date(),
						permanentInvalidReason:
							tokenRecord.permanentInvalidReason ??
							'Invalid state exceeded 7-day backstop',
						updatedAt: new Date(),
					})
					.where(eq(eveTokens.id, tokenRecord.id))
				return false
			}
			if (!tokenRecord.refreshToken) {
				const permanentlyInvalid = isRefreshBackstopExpired(tokenRecord.expiresAt)
				await this.db
					.update(eveTokens)
					.set({
						invalidSince: tokenRecord.invalidSince ?? new Date(),
						lastValidationAt: new Date(),
						lastValidationStatus: permanentlyInvalid ? 'permanent_invalid' : 'invalid_token',
						permanentInvalidAt: permanentlyInvalid ? new Date() : tokenRecord.permanentInvalidAt,
						permanentInvalidReason: permanentlyInvalid
							? 'Token expired more than 24h ago without refresh token'
							: tokenRecord.permanentInvalidReason,
						updatedAt: new Date(),
					})
					.where(eq(eveTokens.id, tokenRecord.id))
				logger
					.withTags({ operation: 'refreshToken', characterId })
					.error('Token or refresh token not found', {
						hasTokenRecord: true,
						hasRefreshToken: false,
						permanentlyInvalid,
					})
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

			let encryptedRefreshToken: string | null
			if (newTokenResponse.refresh_token) {
				encryptedRefreshToken = await this.encrypt(newTokenResponse.refresh_token)
			} else {
				encryptedRefreshToken = tokenRecord.refreshToken
			}

			// Update token in database
			await this.db
				.update(eveTokens)
				.set({
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
					invalidSince: null,
					lastValidationAt: new Date(),
					lastValidationStatus: 'valid',
					nextRetryAt: null,
					permanentInvalidAt: null,
					permanentInvalidReason: null,
					updatedAt: new Date(),
				})
				.where(eq(eveTokens.id, tokenRecord.id))

			// Update lastRefreshAt on the character record
			await this.db
				.update(eveCharacters)
				.set({ lastRefreshAt: new Date() })
				.where(eq(eveCharacters.characterId, String(characterId)))
			await this.clearTokenRefreshCooldown(characterId)

			return true
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (isPermanentRefreshFailure(message)) {
				const character = await this.db.query.eveCharacters.findFirst({
					where: eq(eveCharacters.characterId, String(characterId)),
				})
				if (character) {
					await this.db
						.update(eveTokens)
						.set({
							refreshToken: null,
							invalidSince: new Date(),
							lastValidationAt: new Date(),
							lastValidationStatus: 'permanent_invalid',
							nextRetryAt: null,
							permanentInvalidAt: new Date(),
							permanentInvalidReason: message,
							updatedAt: new Date(),
						})
						.where(eq(eveTokens.characterId, character.id))
				}
				logger
					.withTags({ operation: 'refreshToken', characterId })
					.warn('Permanent token refresh failure; disabled further refresh attempts', {
						error: message,
					})
				return false
			}
			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterId, String(characterId)),
			})
			if (character) {
				const existingToken = await this.db.query.eveTokens.findFirst({
					where: eq(eveTokens.characterId, character.id),
				})
				await this.db
					.update(eveTokens)
					.set({
						invalidSince: existingToken?.invalidSince ?? new Date(),
						lastValidationAt: new Date(),
						lastValidationStatus: 'transient_error',
						nextRetryAt: new Date(Date.now() + TOKEN_REFRESH_TRANSIENT_COOLDOWN_MS),
						updatedAt: new Date(),
					})
					.where(eq(eveTokens.characterId, character.id))
			}
			await this.setTokenRefreshCooldownUntil(
				characterId,
				Date.now() + TOKEN_REFRESH_TRANSIENT_COOLDOWN_MS
			)
			logger
				.withTags({ operation: 'refreshToken', characterId })
				.error('Token refresh failed', error)
			return false
		}
	}

	/**
	 * Get token information (without actual token values)
	 */
	async getTokenInfo(characterId: string): Promise<TokenInfo | null> {
		const character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterId, String(characterId)),
		})

		if (!character) {
			return null
		}

		const tokenRecord = await this.db.query.eveTokens.findFirst({
			where: eq(eveTokens.characterId, character.id),
		})

		if (!tokenRecord) {
			return null
		}

		const scopes = JSON.parse(character.scopes) as string[]
		const isExpired = tokenRecord.expiresAt < new Date()

		return {
			characterId: character.characterId,
			characterName: character.characterName,
			characterOwnerHash: character.characterOwnerHash,
			expiresAt: tokenRecord.expiresAt,
			scopes,
			isExpired,
			hasRefreshToken: Boolean(tokenRecord.refreshToken),
		}
	}

	/**
	 * Validate token state for a downstream workflow using SSO token state rather
	 * than an arbitrary authenticated ESI gameplay endpoint.
	 */
	async validateToken(
		characterId: string,
		requiredScopes: readonly string[] = EVE_SCOPES_ALL
	): Promise<TokenValidationResult> {
		const character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterId, String(characterId)),
		})

		if (!character) {
			return {
				characterId,
				error: 'Character not found in token store',
				isValid: false,
				missingScopes: [],
				refreshAttempted: false,
				refreshSucceeded: false,
				scopes: [],
				status: 'token_missing',
			}
		}

		if (character.deletedAt) {
			return {
				characterId,
				error: 'Character is marked deleted',
				isValid: false,
				missingScopes: [],
				refreshAttempted: false,
				refreshSucceeded: false,
				scopes: [],
				status: 'character_deleted',
			}
		}

		const tokenRecord = await this.db.query.eveTokens.findFirst({
			where: eq(eveTokens.characterId, character.id),
		})

		if (!tokenRecord) {
			return {
				characterId,
				error: 'Token record not found',
				isValid: false,
				missingScopes: [],
				refreshAttempted: false,
				refreshSucceeded: false,
				scopes: [],
				status: 'token_missing',
			}
		}
		if (tokenRecord.permanentInvalidAt) {
			return {
				characterId,
				error: tokenRecord.permanentInvalidReason ?? 'Token is permanently invalid',
				isValid: false,
				missingScopes: [],
				refreshAttempted: false,
				refreshSucceeded: false,
				scopes: [],
				status: 'permanent_invalid',
			}
		}
		if (shouldForcePermanentByInvalidAge(tokenRecord.invalidSince)) {
			await this.db
				.update(eveTokens)
				.set({
					permanentInvalidAt: new Date(),
					permanentInvalidReason:
						tokenRecord.permanentInvalidReason ?? 'Invalid state exceeded 7-day backstop',
					lastValidationAt: new Date(),
					lastValidationStatus: 'permanent_invalid',
					nextRetryAt: null,
					updatedAt: new Date(),
				})
				.where(eq(eveTokens.id, tokenRecord.id))
			return {
				characterId,
				error: 'Token invalid state exceeded 7-day backstop',
				isValid: false,
				missingScopes: [],
				refreshAttempted: false,
				refreshSucceeded: false,
				scopes: [],
				status: 'permanent_invalid',
			}
		}
		if (tokenRecord.nextRetryAt && tokenRecord.nextRetryAt.getTime() > Date.now()) {
			return {
				characterId,
				error: `Token refresh cooldown active until ${tokenRecord.nextRetryAt.toISOString()}`,
				isValid: false,
				missingScopes: [],
				refreshAttempted: false,
				refreshSucceeded: false,
				scopes: JSON.parse(character.scopes) as string[],
				status: 'transient_error',
			}
		}

		let accessToken: string
		let refreshAttempted = false
		let refreshSucceeded = false

		try {
			const isExpired = tokenRecord.expiresAt < new Date()

			if (isExpired) {
				refreshAttempted = true
				if (!tokenRecord.refreshToken) {
					const permanentlyInvalid = isRefreshBackstopExpired(tokenRecord.expiresAt)
					await this.db
						.update(eveTokens)
						.set({
							invalidSince: tokenRecord.invalidSince ?? new Date(),
							lastValidationAt: new Date(),
							lastValidationStatus: permanentlyInvalid ? 'permanent_invalid' : 'invalid_token',
							permanentInvalidAt: permanentlyInvalid ? new Date() : tokenRecord.permanentInvalidAt,
							permanentInvalidReason: permanentlyInvalid
								? 'Token expired more than 24h ago without refresh token'
								: tokenRecord.permanentInvalidReason,
							updatedAt: new Date(),
						})
						.where(eq(eveTokens.id, tokenRecord.id))
					return {
						characterId,
						error: 'Token is expired and has no refresh token',
						isValid: false,
						missingScopes: [],
						refreshAttempted,
						refreshSucceeded: false,
						scopes: [],
						status: permanentlyInvalid ? 'permanent_invalid' : 'invalid_token',
					}
				}

				const refreshToken = await this.decrypt(tokenRecord.refreshToken)
				const refreshedToken = await this.refreshAccessToken(refreshToken)
				refreshSucceeded = true

				const expiresAt = new Date(Date.now() + refreshedToken.expires_in * 1000)
				const encryptedAccessToken = await this.encrypt(refreshedToken.access_token)
				const encryptedRefreshToken = refreshedToken.refresh_token
					? await this.encrypt(refreshedToken.refresh_token)
					: tokenRecord.refreshToken

				await this.db
					.update(eveTokens)
					.set({
						accessToken: encryptedAccessToken,
						expiresAt,
						refreshToken: encryptedRefreshToken,
						invalidSince: null,
						lastValidationAt: new Date(),
						lastValidationStatus: 'valid',
						nextRetryAt: null,
						permanentInvalidAt: null,
						permanentInvalidReason: null,
						updatedAt: new Date(),
					})
					.where(eq(eveTokens.id, tokenRecord.id))

				accessToken = refreshedToken.access_token
			} else {
				accessToken = await this.decrypt(tokenRecord.accessToken)
			}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				const status = classifySsoError(errorMessage)
				if (refreshAttempted && isPermanentRefreshFailure(errorMessage)) {
				await this.db
					.update(eveTokens)
					.set({
						refreshToken: null,
						invalidSince: tokenRecord.invalidSince ?? new Date(),
						lastValidationAt: new Date(),
						lastValidationStatus: 'permanent_invalid',
						nextRetryAt: null,
						permanentInvalidAt: new Date(),
						permanentInvalidReason: errorMessage,
						updatedAt: new Date(),
					})
					.where(eq(eveTokens.id, tokenRecord.id))
					logger
						.withTags({ operation: 'validateToken', characterId })
						.warn('Permanent token refresh failure during validation; disabled further refresh attempts', {
							error: errorMessage,
						})
					return {
						characterId,
						error: errorMessage,
						isValid: false,
						missingScopes: [],
						refreshAttempted,
						refreshSucceeded: false,
						scopes: [],
						status: 'permanent_invalid',
					}
				}

				if (refreshAttempted) {
				await this.db
					.update(eveTokens)
					.set({
						invalidSince: tokenRecord.invalidSince ?? new Date(),
						lastValidationAt: new Date(),
						lastValidationStatus: 'transient_error',
						nextRetryAt: new Date(Date.now() + TOKEN_REFRESH_TRANSIENT_COOLDOWN_MS),
						updatedAt: new Date(),
					})
					.where(eq(eveTokens.id, tokenRecord.id))
			}
			return {
				characterId,
				error: errorMessage,
				isValid: false,
				missingScopes: [],
				refreshAttempted,
				refreshSucceeded: false,
				scopes: [],
				status,
			}
		}

		try {
			const verification = await this.verifyToken(accessToken)
			const scopes = verification.Scopes ? verification.Scopes.split(' ') : []
			const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope))

			await this.db
				.update(eveCharacters)
				.set({
					characterName: verification.CharacterName,
					characterOwnerHash: verification.CharacterOwnerHash,
					scopes: JSON.stringify(scopes),
					updatedAt: new Date(),
				})
				.where(eq(eveCharacters.id, character.id))
			await this.db
				.update(eveTokens)
				.set({
					invalidSince: null,
					lastValidationAt: new Date(),
					lastValidationStatus: missingScopes.length > 0 ? 'missing_scopes' : 'valid',
					nextRetryAt: null,
					permanentInvalidAt: null,
					permanentInvalidReason: null,
					updatedAt: new Date(),
				})
				.where(eq(eveTokens.id, tokenRecord.id))

			if (missingScopes.length > 0) {
				return {
					characterId,
					error: `Missing required scopes: ${missingScopes.join(', ')}`,
					isValid: false,
					missingScopes,
					refreshAttempted,
					refreshSucceeded,
					scopes,
					status: 'missing_scopes',
				}
			}

			return {
				characterId,
				isValid: true,
				missingScopes: [],
				refreshAttempted,
				refreshSucceeded,
				scopes,
				status: 'valid',
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const status = classifySsoError(errorMessage)
			const scopes = JSON.parse(character.scopes) as string[]

			await this.db
				.update(eveTokens)
				.set({
					invalidSince: tokenRecord.invalidSince ?? new Date(),
					lastValidationAt: new Date(),
					lastValidationStatus: status,
					updatedAt: new Date(),
				})
				.where(eq(eveTokens.id, tokenRecord.id))
			return {
				characterId,
				error: errorMessage,
				isValid: false,
				missingScopes: [],
				refreshAttempted,
				refreshSucceeded,
				scopes,
				status,
			}
		}
	}

	/**
	 * Get access token for use (decrypted)
	 * Returns null if character is not found or has been marked as deleted
	 */
	async getAccessToken(characterId: string): Promise<string | null> {
		try {
			const character = await this.db.query.eveCharacters.findFirst({
				where: and(
					eq(eveCharacters.characterId, String(characterId)),
					isNull(eveCharacters.deletedAt)
				),
			})

			if (!character) {
				return null
			}

			// Select only fields required by this path to remain resilient while
			// schema migrations roll out between services.
			const tokenRecord = await this.db.query.eveTokens.findFirst({
				where: eq(eveTokens.characterId, character.id),
				columns: {
					id: true,
					accessToken: true,
					refreshToken: true,
					expiresAt: true,
				},
			})

			if (!tokenRecord) {
				return null
			}

				// Check if token is expired
				const now = new Date()
				const isExpired = tokenRecord.expiresAt < now

				if (isExpired) {
					if (!tokenRecord.refreshToken) {
						return null
					}
					// Try to refresh
					const refreshed = await this.refreshToken(characterId)
					if (!refreshed) {
					return null
				}

				// Fetch updated token
				const updatedToken = await this.db.query.eveTokens.findFirst({
					where: eq(eveTokens.characterId, character.id),
				})

				if (!updatedToken) {
					logger
						.withTags({ operation: 'getAccessToken', characterId })
						.error('Updated token not found after refresh')
					return null
				}

				const decryptedToken = await this.decrypt(updatedToken.accessToken)
				return decryptedToken
			}

			const decryptedToken = await this.decrypt(tokenRecord.accessToken)
			return decryptedToken
		} catch (error) {
			logger
				.withTags({ operation: 'getAccessToken', characterId })
				.error('Failed to get access token', error)
			return null
		}
	}

	/**
	 * Revoke and delete a token
	 */
	async revokeToken(characterId: string): Promise<boolean> {
		try {
			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterId, String(characterId)),
			})

			if (!character) {
				return false
			}

			// Delete the character (cascade will delete tokens)
			await this.db.delete(eveCharacters).where(eq(eveCharacters.id, character.id))

			return true
		} catch (error) {
			logger.error(error)
			return false
		}
	}

	/**
	 * Mark a character as deleted (soft delete).
	 * Called when ESI returns "Character has been deleted!" (biomassed or removed by CCP).
	 * Unlike revokeToken, this preserves the character record for audit purposes.
	 * Token rows are removed so deleted characters can no longer be treated as having valid auth.
	 * @param characterId - EVE character ID
	 * @returns true if character was marked, false if not found
	 */
	async markCharacterDeleted(characterId: string): Promise<boolean> {
		try {
			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterId, String(characterId)),
			})

			if (!character) {
				logger
					.withTags({ operation: 'markCharacterDeleted', characterId })
					.warn('Character not found')
				return false
			}

			// Ensure no token remains for deleted characters.
			await this.db.delete(eveTokens).where(eq(eveTokens.characterId, character.id))

			// Always enforce deleted marker (handles first mark and legacy rows where deletedAt
			// may already be set but token rows still exist from prior behavior).
			await this.db
				.update(eveCharacters)
				.set({ deletedAt: character.deletedAt ?? new Date(), updatedAt: new Date() })
				.where(eq(eveCharacters.id, character.id))

			logger
				.withTags({ operation: 'markCharacterDeleted', characterId })
				.info('Character marked as deleted and token invalidated')
			return true
		} catch (error) {
			logger
				.withTags({ operation: 'markCharacterDeleted', characterId })
				.error('Failed to mark character as deleted', error)
			return false
		}
	}

	/**
	 * List all tokens stored in the system
	 */
	async listTokens(): Promise<TokenInfo[]> {
		const characters = await this.db.query.eveCharacters.findMany()

		const tokens: TokenInfo[] = []

		for (const character of characters) {
			const tokenRecord = await this.db.query.eveTokens.findFirst({
				where: eq(eveTokens.characterId, character.id),
			})

			if (tokenRecord) {
				const scopes = JSON.parse(character.scopes) as string[]
				const isExpired = tokenRecord.expiresAt < new Date()

					tokens.push({
						characterId: character.characterId,
						characterName: character.characterName,
						characterOwnerHash: character.characterOwnerHash,
						expiresAt: tokenRecord.expiresAt,
						scopes,
						isExpired,
						hasRefreshToken: Boolean(tokenRecord.refreshToken),
					})
				}
			}

		return tokens
	}

	/**
	 * Extract page number from URL path
	 */
	private extractPageFromPath(path: string): number | undefined {
		const pageMatch = path.match(/[?&]page=(\d+)/)
		return pageMatch ? parseInt(pageMatch[1], 10) : undefined
	}

	/**
	 * Parse X-Pages header from ESI response
	 */
	private parseXPages(headers: Headers): number | undefined {
		const xPages = headers.get('X-Pages')
		return xPages ? parseInt(xPages, 10) : undefined
	}

	private parseHeaderSeconds(headers: Headers, headerName: string): number | undefined {
		const raw = headers.get(headerName)
		if (!raw) {
			return undefined
		}

		const parsed = Number.parseInt(raw, 10)
		if (!Number.isFinite(parsed) || parsed < 0) {
			return undefined
		}

		return parsed
	}

	private async incrementAuthEsiWindowCounter(
		counterKey: string
	): Promise<{ count: number; windowStartMs: number }> {
		const windowStartMs = Math.floor(Date.now() / AUTH_ESI_RATE_WINDOW_MS) * AUTH_ESI_RATE_WINDOW_MS
		const storageKey = `esi:auth:budget:${counterKey}:${windowStartMs}`
		const current = (await this.state.storage.get<number>(storageKey)) ?? 0
		const next = current + 1
		await this.state.storage.put(storageKey, next)
		return { count: next, windowStartMs }
	}

	private async assertAuthenticatedEsiBudget(path: string): Promise<void> {
		const routeKey = normalizeAuthEsiRouteKey(path)
		const priority = classifyAuthEsiPriority(path)
		const now = Date.now()
		const limits = computeEffectiveAuthEsiBudgetLimits({
			baseGlobalLimit: AUTH_ESI_GLOBAL_WINDOW_LIMIT,
			baseRouteLimit: AUTH_ESI_ROUTE_WINDOW_LIMIT,
			baseBackgroundLimit: AUTH_ESI_BACKGROUND_WINDOW_LIMIT,
			nowMs: now,
			dynamicBudget: this.authEsiDynamicBudget,
		})
		const global = await this.incrementAuthEsiWindowCounter('global')
		const route = await this.incrementAuthEsiWindowCounter(`route:${routeKey}`)
		const priorityCounter = await this.incrementAuthEsiWindowCounter(`priority:${priority}`)

		if (
			!isAuthEsiBudgetExceeded({
				globalCount: global.count,
				routeCount: route.count,
				priorityCount: priorityCounter.count,
				priority,
				globalLimit: limits.globalLimit,
				routeLimit: limits.routeLimit,
				backgroundLimit: limits.backgroundLimit,
			})
		) {
			return
		}

		const windowEndMs = global.windowStartMs + AUTH_ESI_RATE_WINDOW_MS
		const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - now) / 1000))
		const metadata = JSON.stringify({
			status: 429,
			path,
			retryAfterSeconds,
			circuitBreaker: 'budget_exhausted',
			globalCount: global.count,
			globalLimit: limits.globalLimit,
			routeKey,
			routeCount: route.count,
			routeLimit: limits.routeLimit,
			priority,
			priorityCount: priorityCounter.count,
			priorityLimit: priority === 'background' ? limits.backgroundLimit : limits.globalLimit,
			limitSource: limits.source,
			dynamicBudget: this.authEsiDynamicBudget,
		})
		throw new Error(
			`ESI request failed: 429 Too Many Requests - {"error":"Global auth ESI budget exhausted"} | metadata=${metadata}`
		)
	}

	private async updateAuthenticatedEsiDynamicBudgetFromHeaders(
		headers: Headers,
		status: number
	): Promise<void> {
		const remain = this.parseHeaderSeconds(headers, 'X-ESI-Error-Limit-Remain')
		const resetSeconds = this.parseHeaderSeconds(headers, 'X-ESI-Error-Limit-Reset')
		const retryAfterSeconds = this.parseHeaderSeconds(headers, 'Retry-After')
		const now = Date.now()

		if (remain !== undefined && resetSeconds !== undefined) {
			this.authEsiDynamicBudget = {
				remain,
				resetSeconds,
				observedAtMs: now,
			}
			await this.state.storage.put(AUTH_ESI_DYNAMIC_BUDGET_STORAGE_KEY, this.authEsiDynamicBudget)
			return
		}

		// 429 without explicit error-limit headers: still capture retry window as a
		// temporary exhausted budget signal.
		if (status === 429 && retryAfterSeconds !== undefined) {
			this.authEsiDynamicBudget = {
				remain: 0,
				resetSeconds: retryAfterSeconds,
				observedAtMs: now,
			}
			await this.state.storage.put(AUTH_ESI_DYNAMIC_BUDGET_STORAGE_KEY, this.authEsiDynamicBudget)
		}
	}

	private async assertAuthenticatedEsiRampPermit(path: string): Promise<void> {
		const routeKey = normalizeAuthEsiRouteKey(path)
		let routeLastOpenUntilMs = this.authEsiRouteBreakerLastOpenUntilMs.get(routeKey)
		if (routeLastOpenUntilMs === undefined) {
			routeLastOpenUntilMs =
				(await this.state.storage.get<number>(
					`${AUTH_ESI_ROUTE_BREAKER_LAST_OPEN_UNTIL_PREFIX}${routeKey}`
				)) ?? 0
			this.authEsiRouteBreakerLastOpenUntilMs.set(routeKey, routeLastOpenUntilMs)
		}
		if (routeLastOpenUntilMs > 0) {
			const now = Date.now()
			const routeRampEndsAt = routeLastOpenUntilMs + AUTH_ESI_RAMP_WINDOW_MS
			if (now < routeRampEndsAt) {
				const elapsed = Math.max(0, now - routeLastOpenUntilMs)
				const progress = Math.min(1, elapsed / AUTH_ESI_RAMP_WINDOW_MS)
				const allowProbability = 0.2 + progress * 0.8
				if (Math.random() > allowProbability) {
					const remainingRampMs = Math.max(0, routeRampEndsAt - now)
					const retryAfterSeconds = computeRampRetryAfterSeconds(remainingRampMs)
					const metadata = JSON.stringify({
						status: 429,
						path,
						retryAfterSeconds,
						circuitBreaker: 'route_ramp_gate',
						routeKey,
						rampProgress: progress,
					})
					throw new Error(
						`ESI request failed: 429 Too Many Requests - {"error":"Auth ESI route ramp gate throttling"} | metadata=${metadata}`
					)
				}
			}
		}

		// Global ramp is only used as emergency backpressure after global breaker opens.
		const now = Date.now()
		const rampEndsAt = this.authEsiBreakerLastOpenUntilMs + AUTH_ESI_RAMP_WINDOW_MS
		if (this.authEsiBreakerLastOpenUntilMs <= 0 || now >= rampEndsAt) {
			return
		}

		const elapsed = Math.max(0, now - this.authEsiBreakerLastOpenUntilMs)
		const progress = Math.min(1, elapsed / AUTH_ESI_RAMP_WINDOW_MS)
		const allowProbability = 0.2 + progress * 0.8
		if (Math.random() <= allowProbability) {
			return
		}

		const remainingRampMs = Math.max(0, rampEndsAt - now)
		// Derive retry delay from remaining ramp window and sample across the full
		// bounded retry range to decorrelate post-ramp bursts.
		const retryAfterSeconds = computeRampRetryAfterSeconds(remainingRampMs)
		const metadata = JSON.stringify({
			status: 429,
			path,
			retryAfterSeconds,
			circuitBreaker: 'ramp_gate',
			rampProgress: progress,
		})
		throw new Error(
			`ESI request failed: 429 Too Many Requests - {"error":"Auth ESI ramp gate throttling"} | metadata=${metadata}`
		)
	}

	private async assertAuthenticatedEsiCircuitClosed(path: string): Promise<void> {
		const now = Date.now()
		if (this.authEsiBreakerOpenUntilMs <= now) {
			// no-op
		} else {
			const retryAfterSeconds = Math.max(
				1,
				Math.ceil((this.authEsiBreakerOpenUntilMs - now) / 1000)
			)
			const metadata = JSON.stringify({
				status: 429,
				path,
				retryAfterSeconds,
				circuitBreaker: 'open',
			})
			throw new Error(
				`ESI request failed: 429 Too Many Requests - {"error":"Global auth ESI circuit breaker is open"} | metadata=${metadata}`
			)
		}

		const routeKey = normalizeAuthEsiRouteKey(path)
		let routeOpenUntilMs = this.authEsiRouteBreakerOpenUntilMs.get(routeKey)
		if (routeOpenUntilMs === undefined) {
			routeOpenUntilMs =
				(await this.state.storage.get<number>(
					`${AUTH_ESI_ROUTE_BREAKER_OPEN_UNTIL_PREFIX}${routeKey}`
				)) ?? 0
			this.authEsiRouteBreakerOpenUntilMs.set(routeKey, routeOpenUntilMs)
		}
		if (!routeOpenUntilMs || routeOpenUntilMs <= now) {
			return
		}
		const retryAfterSeconds = Math.max(1, Math.ceil((routeOpenUntilMs - now) / 1000))
		const metadata = JSON.stringify({
			status: 429,
			path,
			retryAfterSeconds,
			circuitBreaker: 'route_open',
			routeKey,
		})
		throw new Error(
			`ESI request failed: 429 Too Many Requests - {"error":"Auth ESI route circuit breaker is open"} | metadata=${metadata}`
		)
	}

	private async openAuthenticatedEsiCircuit(
		retryAfterSeconds: number | undefined,
		reason: string
	): Promise<void> {
		const now = Date.now()
		const nextOpenUntil = computeCircuitOpenUntil({
			nowMs: now,
			retryAfterSeconds,
			minOpenMs: AUTH_ESI_BREAKER_MIN_OPEN_MS,
			maxOpenMs: AUTH_ESI_BREAKER_MAX_OPEN_MS,
		})
		if (nextOpenUntil <= this.authEsiBreakerOpenUntilMs) {
			return
		}
		this.authEsiBreakerOpenUntilMs = nextOpenUntil
		this.authEsiBreakerLastOpenUntilMs = nextOpenUntil
		await this.state.storage.put(AUTH_ESI_BREAKER_STORAGE_KEY, this.authEsiBreakerOpenUntilMs)
		await this.state.storage.put(
			AUTH_ESI_BREAKER_LAST_OPEN_UNTIL_STORAGE_KEY,
			this.authEsiBreakerLastOpenUntilMs
		)
		logger.withTags({ operation: 'esi_auth_breaker_open' }).warn('Opened auth ESI circuit breaker', {
			reason,
			retryAfterSeconds,
			openForMs: nextOpenUntil - now,
			openUntil: new Date(this.authEsiBreakerOpenUntilMs).toISOString(),
		})
	}

	private async openAuthenticatedEsiRouteCircuit(
		path: string,
		retryAfterSeconds: number | undefined,
		reason: string
	): Promise<void> {
		const routeKey = normalizeAuthEsiRouteKey(path)
		const now = Date.now()
		const currentOpenUntilMs =
			this.authEsiRouteBreakerOpenUntilMs.get(routeKey) ??
			((await this.state.storage.get<number>(
				`${AUTH_ESI_ROUTE_BREAKER_OPEN_UNTIL_PREFIX}${routeKey}`
			)) ?? 0)
		const nextOpenUntil = computeCircuitOpenUntil({
			nowMs: now,
			retryAfterSeconds,
			minOpenMs: AUTH_ESI_BREAKER_MIN_OPEN_MS,
			maxOpenMs: AUTH_ESI_BREAKER_MAX_OPEN_MS,
		})
		if (nextOpenUntil <= currentOpenUntilMs) {
			return
		}
		this.authEsiRouteBreakerOpenUntilMs.set(routeKey, nextOpenUntil)
		this.authEsiRouteBreakerLastOpenUntilMs.set(routeKey, nextOpenUntil)
		await this.state.storage.put(
			`${AUTH_ESI_ROUTE_BREAKER_OPEN_UNTIL_PREFIX}${routeKey}`,
			nextOpenUntil
		)
		await this.state.storage.put(
			`${AUTH_ESI_ROUTE_BREAKER_LAST_OPEN_UNTIL_PREFIX}${routeKey}`,
			nextOpenUntil
		)
		logger.withTags({ operation: 'esi_auth_route_breaker_open' }).warn(
			'Opened auth ESI route circuit breaker',
			{
				reason,
				routeKey,
				retryAfterSeconds,
				openForMs: nextOpenUntil - now,
				openUntil: new Date(nextOpenUntil).toISOString(),
			}
		)
	}

	private normalizeCharacterIds(characterIds: string[]): number[] {
		return [...new Set(characterIds.map((id) => Number.parseInt(id, 10)).filter(Number.isFinite))].sort(
			(a, b) => a - b
		)
	}

	private buildEsiRequestError(path: string, response: Response, errorText: string): Error {
		// For 429, Retry-After is the canonical ESI retry window. Some routes may still expose
		// legacy error-limit windows via X-ESI-Error-Limit-Reset.
		const retryAfterSeconds = this.parseHeaderSeconds(response.headers, 'Retry-After')
		const errorLimitResetSeconds = this.parseHeaderSeconds(
			response.headers,
			'X-ESI-Error-Limit-Reset'
		)
		const errorLimitRemain = this.parseHeaderSeconds(response.headers, 'X-ESI-Error-Limit-Remain')
		const rateLimitRemaining = this.parseHeaderSeconds(response.headers, 'X-Ratelimit-Remaining')

		const metadata = JSON.stringify({
			status: response.status,
			path,
			retryAfterSeconds,
			errorLimitResetSeconds,
			errorLimitRemain,
			rateLimitRemaining,
		})

		return new Error(
			`ESI request failed: ${response.status} ${response.statusText} - ${errorText} | metadata=${metadata}`
		)
	}

	/**
	 * Fetch data from ESI (ESI Gateway)
	 * Automatically handles authentication if token is available for the character
	 * Caches responses according to ESI cache headers
	 */
	async fetchEsi<T>(path: string, characterId: string): Promise<EsiResponse<T>> {
		const cacheKey = `${characterId}:${path}`

		// 1. Check SQLite cache
		const cachedCursor = await this.state.storage.sql.exec<{
			response_data: string
			expires_at: number
			etag: string | null
			pages: number | null
			page: number | null
			last_modified: string | null
		}>(
			`SELECT response_data, expires_at, etag, pages, page, last_modified FROM esi_cache WHERE cache_key = ?`,
			cacheKey
		)

		const cached = [...cachedCursor]

		if (cached.length > 0) {
			const now = Date.now()
			const lastModified = cached[0].last_modified
				? new Date(cached[0].last_modified).getTime()
				: null
			const cacheAge = lastModified ? now - lastModified : Infinity

			// Check both expiry AND 12-hour max age (retroactive enforcement)
			if (cached[0].expires_at > now && cacheAge <= EveTokenStoreDO.MAX_CACHE_TTL_MS) {
				// Cache hit
				return {
					data: JSON.parse(cached[0].response_data) as T,
					cached: true,
					expiresAt: new Date(cached[0].expires_at),
					etag: cached[0].etag || undefined,
					pages: cached[0].pages ?? undefined,
					page: cached[0].page ?? undefined,
				}
			}
		}
			// 2. Cache miss - fetch from ESI
			// Resolve token before breaker/budget checks so missing-token cases fail
			// fast without consuming auth ESI budget.
			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterId, String(characterId)),
			})

			let token: string | undefined
		if (character) {
				const accessToken = await this.getAccessToken(character.characterId)
				token = accessToken || undefined
			}
			if (!token) {
				const metadata = JSON.stringify({
					status: 401,
					path,
					reasonCode: 'no_token_provided',
				})
				throw new Error(
					`ESI request failed: 401 Unauthorized - {"error":"Unauthorized - No token provided"} | metadata=${metadata}`
				)
			}

			await this.assertAuthenticatedEsiCircuitClosed(path)
			await this.assertAuthenticatedEsiRampPermit(path)
			await this.assertAuthenticatedEsiBudget(path)

			// 3. Make ESI request
			const headers: Record<string, string> = {
				'X-Compatibility-Date': '2025-09-30',
				Accept: 'application/json',
			}
			headers['Authorization'] = `Bearer ${token}`
		if (cached.length > 0 && cached[0].etag) {
			headers['If-None-Match'] = cached[0].etag
		}

		let response: Response
		try {
			response = await fetch(`https://esi.evetech.net${path}`, { headers })
		} catch (error) {
			logger
				.withTags({ characterId, path, operation: 'esi_fetch' })
				.error('ESI fetch failed', error)
			throw new Error(
				`ESI fetch failed for ${path}: ${error instanceof Error ? error.message : String(error)}`
			)
		}

		// Handle 304 Not Modified
		if (response.status === 304 && cached.length > 0) {
			await this.updateAuthenticatedEsiDynamicBudgetFromHeaders(response.headers, response.status)
			const newExpiresAt = this.parseEsiCacheExpiry(response.headers)
			// Update both expires_at and last_modified to reset the 12-hour window
			await this.state.storage.sql.exec(
				`UPDATE esi_cache SET expires_at = ?, last_modified = ? WHERE cache_key = ?`,
				newExpiresAt.getTime(),
				new Date().toISOString(),
				cacheKey
			)
			return {
				data: JSON.parse(cached[0].response_data) as T,
				cached: true,
				expiresAt: newExpiresAt,
				etag: cached[0].etag || undefined,
				pages: cached[0].pages ?? undefined,
				page: cached[0].page ?? undefined,
			}
		}

		if (!response.ok) {
			await this.updateAuthenticatedEsiDynamicBudgetFromHeaders(response.headers, response.status)
			const errorText = await response.text()
			if (shouldOpenRouteCircuitForResponse(response.status)) {
				const retryAfterSeconds = this.parseHeaderSeconds(response.headers, 'Retry-After')
				await this.openAuthenticatedEsiRouteCircuit(path, retryAfterSeconds, `429 on ${path}`)
			}

			const retryAfterSeconds = this.parseHeaderSeconds(response.headers, 'Retry-After')
			const errorLimitRemain = this.parseHeaderSeconds(
				response.headers,
				'X-ESI-Error-Limit-Remain'
			)
			const errorLimitResetSeconds = this.parseHeaderSeconds(
				response.headers,
				'X-ESI-Error-Limit-Reset'
			)
			if (
				shouldOpenGlobalEmergencyCircuit({
					status: response.status,
					errorLimitRemain,
					errorLimitResetSeconds,
				})
			) {
				await this.openAuthenticatedEsiCircuit(
					retryAfterSeconds ?? errorLimitResetSeconds,
					`${response.status} on ${path}`
				)
			}
			throw this.buildEsiRequestError(path, response, errorText)
		}

		// 4. Parse and cache response
		await this.updateAuthenticatedEsiDynamicBudgetFromHeaders(response.headers, response.status)
		const data = (await response.json()) as T
		const expiresAt = this.parseEsiCacheExpiry(response.headers)
		const etag = response.headers.get('ETag')
		const pages = this.parseXPages(response.headers)
		const page = this.extractPageFromPath(path)

		await this.state.storage.sql.exec(
			`INSERT OR REPLACE INTO esi_cache (cache_key, response_data, expires_at, etag, pages, page, last_modified)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			cacheKey,
			JSON.stringify(data),
			expiresAt.getTime(),
			etag,
			pages ?? null,
			page ?? null,
			new Date().toISOString()
		)

		return {
			data,
			cached: false,
			expiresAt,
			etag: etag || undefined,
			pages,
			page,
		}
	}

	async fetchEsiWithSchema<S extends z4.$ZodType>(
		path: string,
		characterId: string,
		schema: S
	): Promise<EsiResponse<z4.output<S>>> {
		const response = await this.fetchEsi<z4.output<S>>(path, characterId)
		return { ...response, data: z4.parse(schema, response.data) }
	}

	async fetchPublicEsiWithSchema<S extends z4.$ZodType>(
		path: string,
		schema: S
	): Promise<EsiResponse<z4.output<S>>> {
		const response = await this.fetchPublicEsi<z4.output<S>>(path)
		return { ...response, data: z4.parse(schema, response.data) }
	}
	/**
	 * Fetch public data from ESI (unauthenticated ESI Gateway)
	 * For public endpoints that don't require authentication
	 * Caches responses according to ESI cache headers
	 */
	async fetchPublicEsi<T>(path: string): Promise<EsiResponse<T>> {
		const cacheKey = `public:${path}`

		// 1. Check SQLite cache
		const cachedCursor = await this.state.storage.sql.exec<{
			response_data: string
			expires_at: number
			etag: string | null
			pages: number | null
			page: number | null
			last_modified: string | null
		}>(
			`SELECT response_data, expires_at, etag, pages, page, last_modified FROM esi_cache WHERE cache_key = ?`,
			cacheKey
		)

		const cached = [...cachedCursor]

		if (cached.length > 0) {
			const now = Date.now()
			const lastModified = cached[0].last_modified
				? new Date(cached[0].last_modified).getTime()
				: null
			const cacheAge = lastModified ? now - lastModified : Infinity

			// Check both expiry AND 12-hour max age (retroactive enforcement)
			if (cached[0].expires_at > now && cacheAge <= EveTokenStoreDO.MAX_CACHE_TTL_MS) {
				// Cache hit
				return {
					data: JSON.parse(cached[0].response_data) as T,
					cached: true,
					expiresAt: new Date(cached[0].expires_at),
					etag: cached[0].etag || undefined,
					pages: cached[0].pages ?? undefined,
					page: cached[0].page ?? undefined,
				}
			}
		}

		// 2. Cache miss - fetch from ESI (no authentication)
		const headers: Record<string, string> = {
			'X-Compatibility-Date': '2025-09-30',
			Accept: 'application/json',
		}
		if (cached.length > 0 && cached[0].etag) {
			headers['If-None-Match'] = cached[0].etag
		}

		const response = await fetch(`https://esi.evetech.net${path}`, { headers })

		// Handle 304 Not Modified
		if (response.status === 304 && cached.length > 0) {
			const newExpiresAt = this.parseEsiCacheExpiry(response.headers)
			// Update both expires_at and last_modified to reset the 12-hour window
			await this.state.storage.sql.exec(
				`UPDATE esi_cache SET expires_at = ?, last_modified = ? WHERE cache_key = ?`,
				newExpiresAt.getTime(),
				new Date().toISOString(),
				cacheKey
			)
			return {
				data: JSON.parse(cached[0].response_data) as T,
				cached: true,
				expiresAt: newExpiresAt,
				etag: cached[0].etag || undefined,
				pages: cached[0].pages ?? undefined,
				page: cached[0].page ?? undefined,
			}
		}

		if (!response.ok) {
			const errorText = await response.text()
			throw this.buildEsiRequestError(path, response, errorText)
		}

		// 3. Parse and cache response
		const data = (await response.json()) as T
		const expiresAt = this.parseEsiCacheExpiry(response.headers)
		const etag = response.headers.get('ETag')
		const pages = this.parseXPages(response.headers)
		const page = this.extractPageFromPath(path)

		await this.state.storage.sql.exec(
			`INSERT OR REPLACE INTO esi_cache (cache_key, response_data, expires_at, etag, pages, page, last_modified)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			cacheKey,
			JSON.stringify(data),
			expiresAt.getTime(),
			etag,
			pages ?? null,
			page ?? null,
			new Date().toISOString()
		)

		return {
			data,
			cached: false,
			expiresAt,
			etag: etag || undefined,
			pages,
			page,
		}
	}

	async fetchCharacterAffiliations(
		characterIds: string[]
	): Promise<EsiResponse<EsiCharacterAffiliation[]>> {
		const normalizedIds = this.normalizeCharacterIds(characterIds)
		if (normalizedIds.length === 0) {
			throw new Error('fetchCharacterAffiliations requires at least one valid character ID')
		}

		const cacheSuffix = normalizedIds.join(',')
		const cacheKey = `public:/characters/affiliation:${cacheSuffix}`
		const cachedCursor = await this.state.storage.sql.exec<{
			response_data: string
			expires_at: number
			etag: string | null
			last_modified: string | null
		}>(
			`SELECT response_data, expires_at, etag, last_modified FROM esi_cache WHERE cache_key = ?`,
			cacheKey
		)

		const cached = [...cachedCursor]
		if (cached.length > 0) {
			const now = Date.now()
			const lastModified = cached[0].last_modified
				? new Date(cached[0].last_modified).getTime()
				: null
			const cacheAge = lastModified ? now - lastModified : Infinity

			if (cached[0].expires_at > now && cacheAge <= EveTokenStoreDO.MAX_CACHE_TTL_MS) {
				return {
					data: JSON.parse(cached[0].response_data) as EsiCharacterAffiliation[],
					cached: true,
					expiresAt: new Date(cached[0].expires_at),
					etag: cached[0].etag || undefined,
				}
			}
		}

		const headers: Record<string, string> = {
			'X-Compatibility-Date': '2025-09-30',
			Accept: 'application/json',
			'Content-Type': 'application/json',
		}
		if (cached.length > 0 && cached[0].etag) {
			headers['If-None-Match'] = cached[0].etag
		}

		const response = await fetch('https://esi.evetech.net/latest/characters/affiliation/', {
			method: 'POST',
			headers,
			body: JSON.stringify(normalizedIds),
		})

		if (response.status === 304 && cached.length > 0) {
			const newExpiresAt = this.parseEsiCacheExpiry(response.headers)
			await this.state.storage.sql.exec(
				`UPDATE esi_cache SET expires_at = ?, last_modified = ? WHERE cache_key = ?`,
				newExpiresAt.getTime(),
				new Date().toISOString(),
				cacheKey
			)
			return {
				data: JSON.parse(cached[0].response_data) as EsiCharacterAffiliation[],
				cached: true,
				expiresAt: newExpiresAt,
				etag: cached[0].etag || undefined,
			}
		}

		if (!response.ok) {
			const errorText = await response.text()
			throw this.buildEsiRequestError('/characters/affiliation', response, errorText)
		}

		const data = (await response.json()) as EsiCharacterAffiliation[]
		const expiresAt = this.parseEsiCacheExpiry(response.headers)
		const etag = response.headers.get('ETag')

		await this.state.storage.sql.exec(
			`INSERT OR REPLACE INTO esi_cache (cache_key, response_data, expires_at, etag, pages, page, last_modified)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			cacheKey,
			JSON.stringify(data),
			expiresAt.getTime(),
			etag,
			null,
			null,
			new Date().toISOString()
		)

		return {
			data,
			cached: false,
			expiresAt,
			etag: etag || undefined,
		}
	}

	/**
	 * Clear ESI cache for a specific path
	 * Useful for forcing fresh data on next request or after errors
	 */
	async clearEsiCache(path: string, characterId?: string): Promise<number> {
		// Build cache key based on whether it's authenticated or public
		const cacheKey = characterId ? `${characterId}:${path}` : `public:${path}`

		// Delete all cache entries matching this key (including all pages if paginated)
		// Use LIKE to match all pages: /path?page=1, /path?page=2, etc.
		const baseKey = cacheKey.split('?')[0]
		const result = await this.state.storage.sql.exec(
			`DELETE FROM esi_cache WHERE cache_key LIKE ? OR cache_key = ?`,
			`${baseKey}%`,
			cacheKey
		)

		const deletedCount = result.rowsWritten || 0

		return deletedCount
	}

	/**
	 * Fetch all pages from a paginated ESI endpoint (authenticated)
	 * Automatically fetches all pages in parallel and returns combined results
	 */
	async fetchEsiAllPages<T>(
		basePath: string,
		characterId: string,
		options?: { maxConcurrent?: number }
	): Promise<{
		data: T[]
		pages: number
		responses: EsiResponse<T[]>[]
	}> {
		const maxConcurrent = options?.maxConcurrent ?? 5

		// Remove any existing page parameter from basePath
		const cleanPath = basePath.replace(/[?&]page=\d+/, '')
		const separator = cleanPath.includes('?') ? '&' : '?'

		// Fetch first page to get total page count
		const firstPagePath = `${cleanPath}${separator}page=1`
		const firstResponse = await this.fetchEsi<T[]>(firstPagePath, characterId)

		const totalPages = firstResponse.pages ?? 1
		const responses: EsiResponse<T[]>[] = [firstResponse]

		// If there's only one page, return early
		if (totalPages === 1) {
			return {
				data: firstResponse.data,
				pages: totalPages,
				responses,
			}
		}

		// Fetch remaining pages with concurrency limit
		const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
		const fetchPage = async (pageNum: number): Promise<EsiResponse<T[]>> => {
			const pagePath = `${cleanPath}${separator}page=${pageNum}`
			return this.fetchEsi<T[]>(pagePath, characterId)
		}

		// Fetch with concurrency control
		const remainingResponses: EsiResponse<T[]>[] = []
		for (let i = 0; i < remainingPages.length; i += maxConcurrent) {
			const batch = remainingPages.slice(i, i + maxConcurrent)
			const batchResponses = await Promise.all(batch.map(fetchPage))
			remainingResponses.push(...batchResponses)
		}

		responses.push(...remainingResponses)

		// Combine all data from all pages
		const allData: T[] = []
		for (const response of responses) {
			allData.push(...response.data)
		}

		return {
			data: allData,
			pages: totalPages,
			responses,
		}
	}

	/**
	 * Fetch all pages from a paginated public ESI endpoint (unauthenticated)
	 * Automatically fetches all pages in parallel and returns combined results
	 */
	async fetchPublicEsiAllPages<T>(
		basePath: string,
		options?: { maxConcurrent?: number }
	): Promise<{
		data: T[]
		pages: number
		responses: EsiResponse<T[]>[]
	}> {
		const maxConcurrent = options?.maxConcurrent ?? 5

		// Remove any existing page parameter from basePath
		const cleanPath = basePath.replace(/[?&]page=\d+/, '')
		const separator = cleanPath.includes('?') ? '&' : '?'

		// Fetch first page to get total page count
		const firstPagePath = `${cleanPath}${separator}page=1`
		const firstResponse = await this.fetchPublicEsi<T[]>(firstPagePath)

		const totalPages = firstResponse.pages ?? 1
		const responses: EsiResponse<T[]>[] = [firstResponse]

		// If there's only one page, return early
		if (totalPages === 1) {
			return {
				data: firstResponse.data,
				pages: totalPages,
				responses,
			}
		}

		// Fetch remaining pages with concurrency limit
		const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
		const fetchPage = async (pageNum: number): Promise<EsiResponse<T[]>> => {
			const pagePath = `${cleanPath}${separator}page=${pageNum}`
			return this.fetchPublicEsi<T[]>(pagePath)
		}

		// Fetch with concurrency control
		const remainingResponses: EsiResponse<T[]>[] = []
		for (let i = 0; i < remainingPages.length; i += maxConcurrent) {
			const batch = remainingPages.slice(i, i + maxConcurrent)
			const batchResponses = await Promise.all(batch.map(fetchPage))
			remainingResponses.push(...batchResponses)
		}

		responses.push(...remainingResponses)

		// Combine all data from all pages
		const allData: T[] = []
		for (const response of responses) {
			allData.push(...response.data)
		}

		return {
			data: allData,
			pages: totalPages,
			responses,
		}
	}

	/**
	 * Fetch all pages from a paginated public ESI endpoint as a stream (unauthenticated)
	 * Returns a ReadableStream that yields newline-delimited JSON for each item
	 * Use this for large datasets (>32MiB) to bypass RPC size limits
	 */
	async fetchPublicEsiAllPagesStream(
		basePath: string,
		options?: { maxConcurrent?: number }
	): Promise<ReadableStream<Uint8Array>> {
		const maxConcurrent = options?.maxConcurrent ?? 5

		// Remove any existing page parameter from basePath
		const cleanPath = basePath.replace(/[?&]page=\d+/, '')
		const separator = cleanPath.includes('?') ? '&' : '?'

		const encoder = new TextEncoder()

		return new ReadableStream({
			start: async (controller) => {
				try {
					// Fetch first page to get total page count
					const firstPagePath = `${cleanPath}${separator}page=1`
					const firstResponse = await this.fetchPublicEsi<any[]>(firstPagePath)

					const totalPages = firstResponse.pages ?? 1

					// Stream first page items immediately
					for (const item of firstResponse.data) {
						const line = JSON.stringify(item) + '\n'
						controller.enqueue(encoder.encode(line))
					}

					// If there's only one page, we're done
					if (totalPages === 1) {
						controller.close()
						return
					}

					// Fetch and stream remaining pages with concurrency control
					const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
					let totalItems = firstResponse.data.length

					for (let i = 0; i < remainingPages.length; i += maxConcurrent) {
						const batch = remainingPages.slice(i, i + maxConcurrent)

						// Fetch batch of pages in parallel
						const fetchPage = async (pageNum: number) => {
							const pagePath = `${cleanPath}${separator}page=${pageNum}`
							return this.fetchPublicEsi<any[]>(pagePath)
						}

						const batchResponses = await Promise.all(batch.map(fetchPage))

						// Stream each page's items immediately
						for (const response of batchResponses) {
							for (const item of response.data) {
								const line = JSON.stringify(item) + '\n'
								controller.enqueue(encoder.encode(line))
								totalItems++
							}
						}
					}

					controller.close()
				} catch (error) {
					logger
						.withTags({ basePath: cleanPath, operation: 'esi_fetch_all_pages_stream' })
						.error('Error in fetchPublicEsiAllPagesStream', {
							error: error instanceof Error ? error.message : String(error),
						})
					controller.error(error)
				}
			},

			cancel(reason) {
				// Stream cancelled
			},
		})
	}

	/**
	 * Get corporation information by ID
	 * Checks entity cache first, then fetches from ESI if needed
	 */
	async getCorporationById(corporationId: string): Promise<EsiCorporation | null> {
		const cacheKey = 'corporation'
		const now = Date.now()

		// 1. Check entity cache (non-critical, failures should be treated as cache miss)
		try {
			const cachedCursor = await this.state.storage.sql.exec<{
				entity_data: string
				expires_at: number
			}>(
				`SELECT entity_data, expires_at FROM entity_cache WHERE entity_type = ? AND entity_id = ?`,
				cacheKey,
				corporationId
			)

			const cached = [...cachedCursor]

			if (cached.length > 0 && cached[0].expires_at > now) {
				// Parse cached data
				const cachedData = JSON.parse(cached[0].entity_data) as EsiCorporation

				// Validate that cached data has required fields (ticker)
				// If ticker is missing, it's likely incomplete data from name resolver
				if (cachedData.ticker) {
					// Cache hit with valid data
					return cachedData
				}
				// If ticker is missing, treat as cache miss and fetch from ESI
				logger
					.withTags({ corporationId, operation: 'cache_read' })
					.info('Cached corporation data missing ticker, fetching from ESI')
			}
		} catch (error) {
			// Cache read failure - log and continue (treat as cache miss)
			logger
				.withTags({ corporationId, operation: 'cache_read' })
				.warn('Entity cache read failed', error)
		}

		// 2. Fetch from ESI
		try {
			// ESI returns numbers for IDs, but we need strings
			const response = await this.fetchPublicEsi<{
				corporation_id: number
				name: string
				ticker: string
				ceo_id: number
				alliance_id?: number
				description?: string
				member_count: number
				tax_rate: number
				date_founded?: string
				creator_id: number
				home_station_id?: number
				shares?: number
				url?: string
				war_eligible?: boolean
			}>(`/latest/corporations/${corporationId}/`)

			// Convert all numeric IDs to strings
			const corp: EsiCorporation = {
				...response.data,
				corporation_id: String(response.data.corporation_id),
				name: response.data.name,
				ticker: response.data.ticker,
				ceo_id: String(response.data.ceo_id),
				alliance_id: response.data.alliance_id ? String(response.data.alliance_id) : undefined,
				creator_id: String(response.data.creator_id),
				home_station_id: response.data.home_station_id
					? String(response.data.home_station_id)
					: undefined,
			}

			// 3. Store in entity cache (non-critical, failures should not prevent returning data)
			try {
				const expiresAt = Date.now() + 60 * 60 * 1000
				await this.state.storage.sql.exec(
					`INSERT OR REPLACE INTO entity_cache (entity_type, entity_id, entity_name, entity_data, expires_at)
					 VALUES (?, ?, ?, ?, ?)`,
					cacheKey,
					corp.corporation_id,
					corp.name,
					JSON.stringify(corp),
					expiresAt
				)
			} catch (error) {
				// Cache write failure - log but don't fail the request
				logger
					.withTags({ corporationId, operation: 'cache_write' })
					.warn('Entity cache write failed', error)
			}

			return corp
		} catch (error) {
			logger.withTags({ corporationId }).error(error)
			return null
		}
	}

	/**
	 * Get alliance information by ID
	 * Checks entity cache first, then fetches from ESI if needed
	 */
	async getAllianceById(allianceId: string): Promise<EsiAlliance | null> {
		const cacheKey = 'alliance'
		const now = Date.now()

		// 1. Check entity cache (non-critical, failures should be treated as cache miss)
		try {
			const cachedCursor = await this.state.storage.sql.exec<{
				entity_data: string
				expires_at: number
			}>(
				`SELECT entity_data, expires_at FROM entity_cache WHERE entity_type = ? AND entity_id = ?`,
				cacheKey,
				allianceId
			)

			const cached = [...cachedCursor]

			if (cached.length > 0 && cached[0].expires_at > now) {
				// Parse cached data
				const cachedData = JSON.parse(cached[0].entity_data) as EsiAlliance

				// Validate that cached data has required fields (ticker)
				// If ticker is missing, it's likely incomplete data from name resolver
				if (cachedData.ticker) {
					// Cache hit with valid data
					return cachedData
				}
				// If ticker is missing, treat as cache miss and fetch from ESI
				logger
					.withTags({ allianceId, operation: 'cache_read' })
					.info('Cached alliance data missing ticker, fetching from ESI')
			}
		} catch (error) {
			// Cache read failure - log and continue (treat as cache miss)
			logger
				.withTags({ allianceId, operation: 'cache_read' })
				.warn('Entity cache read failed', error)
		}

		// 2. Fetch from ESI
		try {
			// ESI returns numbers for IDs, but we need strings
			const response = await this.fetchPublicEsi<{
				alliance_id: number
				name: string
				ticker: string
				executor_corporation_id: number
				creator_corporation_id: number
				creator_id: number
				date_founded: string
				faction_id?: number
			}>(`/latest/alliances/${allianceId}/`)

			// Convert all numeric IDs to strings
			const alliance: EsiAlliance = {
				...response.data,
				alliance_id: String(response.data.alliance_id),
				executor_corporation_id: String(response.data.executor_corporation_id),
				creator_corporation_id: String(response.data.creator_corporation_id),
				creator_id: String(response.data.creator_id),
				faction_id: response.data.faction_id ? String(response.data.faction_id) : undefined,
			}

			// 3. Store in entity cache (non-critical, failures should not prevent returning data)
			try {
				const expiresAt = Date.now() + 60 * 60 * 1000
				await this.state.storage.sql.exec(
					`INSERT OR REPLACE INTO entity_cache (entity_type, entity_id, entity_name, entity_data, expires_at)
					 VALUES (?, ?, ?, ?, ?)`,
					cacheKey,
					alliance.alliance_id,
					alliance.name,
					JSON.stringify(alliance),
					expiresAt
				)
			} catch (error) {
				// Cache write failure - log but don't fail the request
				logger
					.withTags({ allianceId, operation: 'cache_write' })
					.warn('Entity cache write failed', error)
			}

			return alliance
		} catch (error) {
			logger.withTags({ allianceId }).error(error)
			return null
		}
	}

	/**
	 * Get corporation information by name
	 * Uses name resolution and then fetches by ID
	 */
	async getCorporationByName(name: string): Promise<EsiCorporation | null> {
		// First check entity cache by name for ID resolution (non-critical, failures treated as cache miss)
		const now = Date.now()
		let corporationId: string | null = null

		try {
			const cachedCursor = await this.state.storage.sql.exec<{
				entity_id: string
				expires_at: number
			}>(
				`SELECT entity_id, expires_at FROM entity_cache WHERE entity_type = ? AND entity_name = ?`,
				'corporation',
				name
			)

			const cached = [...cachedCursor]

			if (cached.length > 0 && cached[0].expires_at > now) {
				// Cache hit - we have the ID
				corporationId = cached[0].entity_id
			}
		} catch (error) {
			// Cache read failure - treat as cache miss
			logger.withTags({ name, operation: 'cache_read' }).warn('Entity cache read failed', error)
		}

		// If not cached, resolve name to ID
		if (!corporationId) {
			const nameMap = await this.resolveNames([name])
			corporationId = nameMap[name] ?? null

			if (!corporationId) {
				return null
			}
		}

		// Fetch full corporation data by ID (which will cache it)
		return this.getCorporationById(corporationId)
	}

	/**
	 * Get alliance information by name
	 * Uses name resolution and then fetches by ID
	 */
	async getAllianceByName(name: string): Promise<EsiAlliance | null> {
		// First check entity cache by name for ID resolution (non-critical, failures treated as cache miss)
		const now = Date.now()
		let allianceId: string | null = null

		try {
			const cachedCursor = await this.state.storage.sql.exec<{
				entity_id: string
				expires_at: number
			}>(
				`SELECT entity_id, expires_at FROM entity_cache WHERE entity_type = ? AND entity_name = ?`,
				'alliance',
				name
			)

			const cached = [...cachedCursor]

			if (cached.length > 0 && cached[0].expires_at > now) {
				// Cache hit - we have the ID
				allianceId = cached[0].entity_id
			}
		} catch (error) {
			// Cache read failure - treat as cache miss
			logger.withTags({ name, operation: 'cache_read' }).warn('Entity cache read failed', error)
		}

		// If not cached, resolve name to ID
		if (!allianceId) {
			const nameMap = await this.resolveNames([name])
			allianceId = nameMap[name] ?? null

			if (!allianceId) {
				return null
			}
		}

		// Fetch full alliance data by ID (which will cache it)
		return this.getAllianceById(allianceId)
	}

	/**
	 * Resolve multiple entity names to IDs using ESI bulk endpoint
	 */
	async resolveNames(names: string[]): Promise<Record<string, string>> {
		if (names.length === 0) {
			return {}
		}

		const result: Record<string, string> = {}
		const namesToResolve: string[] = []

		// Check cache for each name (non-critical, failures treated as cache miss)
		for (const name of names) {
			try {
				const cachedCursor = await this.state.storage.sql.exec<{
					entity_id: string
				}>(
					`SELECT entity_id FROM entity_cache WHERE entity_name = ? AND expires_at > ?`,
					name,
					Date.now()
				)

				const cached = [...cachedCursor]

				if (cached.length > 0) {
					result[name] = cached[0].entity_id
				} else {
					namesToResolve.push(name)
				}
			} catch (error) {
				// Cache read failure - treat as cache miss
				logger.withTags({ name, operation: 'cache_read' }).warn('Entity cache read failed', error)
				namesToResolve.push(name)
			}
		}

		// If all names are cached, return early
		if (namesToResolve.length === 0) {
			return result
		}

		// Fetch from ESI for uncached names
		try {
			const response = await fetch('https://esi.evetech.net/latest/universe/ids/', {
				method: 'POST',
				headers: {
					'X-Compatibility-Date': '2025-09-30',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(namesToResolve),
			})

			if (!response.ok) {
				const errorText = await response.text()
				logger.withTags({ status: response.status, errorText }).error('ESI name resolution failed')
				return result
			}

			// ESI returns numbers for IDs, but we need strings
			const data = await response.json<{
				alliances?: Array<{ id: number; name: string }>
				characters?: Array<{ id: number; name: string }>
				corporations?: Array<{ id: number; name: string }>
				systems?: Array<{ id: number; name: string }>
				[key: string]: Array<{ id: number; name: string }> | undefined
			}>()

			// Process all entity types and cache them
			// Character/corp/alliance names are essentially permanent - cache for 1 year
			const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000

			for (const [entityType, entities] of Object.entries(data)) {
				if (!entities) continue

				for (const entity of entities) {
					const entityId = String(entity.id)
					result[entity.name] = entityId

					// Cache the name→id mapping (non-critical, failures should not prevent returning data)
					try {
						await this.state.storage.sql.exec(
							`INSERT OR REPLACE INTO entity_cache (entity_type, entity_id, entity_name, entity_data, expires_at)
							 VALUES (?, ?, ?, ?, ?)`,
							entityType === 'systems' ? 'solar_system' : entityType.slice(0, -1), // 'alliances' → 'alliance'
							entityId,
							entity.name,
							JSON.stringify({ id: entityId, name: entity.name }), // Minimal data for name lookups
							expiresAt
						)
					} catch (error) {
						// Cache write failure - log but don't fail the request
						logger
							.withTags({ entityName: entity.name, entityId, operation: 'cache_write' })
							.warn('Entity cache write failed', error)
					}
				}
			}

			return result
		} catch (error) {
			logger.error(error)
			return result
		}
	}

	/**
	 * Resolve multiple entity IDs to names using ESI bulk endpoint
	 */
	async resolveIds(ids: string[]): Promise<Record<string, string>> {
		if (ids.length === 0) {
			return {}
		}

		const result: Record<string, string> = {}
		const idsToResolve: string[] = []

		// Check cache for each ID (non-critical, failures treated as cache miss)
		for (const id of ids) {
			try {
				const cachedCursor = await this.state.storage.sql.exec<{
					entity_name: string
				}>(
					`SELECT entity_name FROM entity_cache WHERE entity_id = ? AND expires_at > ?`,
					id,
					Date.now()
				)

				const cached = [...cachedCursor]

				if (cached.length > 0) {
					result[id] = cached[0].entity_name
				} else {
					idsToResolve.push(id)
				}
			} catch (error) {
				// Cache read failure - treat as cache miss
				logger.withTags({ id, operation: 'cache_read' }).warn('Entity cache read failed', error)
				idsToResolve.push(id)
			}
		}

		// If all IDs are cached, return early
		if (idsToResolve.length === 0) {
			return result
		}

		// Fetch from ESI for uncached IDs
		// ESI /universe/names/ has a limit of 1000 IDs per request
		try {
			// Convert string IDs to integers for ESI API
			const integerIds = idsToResolve.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))

			// If no valid IDs after conversion, return early
			if (integerIds.length === 0) {
				return result
			}

			// Batch size limit for ESI /universe/names/ endpoint
			const BATCH_SIZE = 1000

			// Split into batches if we have more than the limit
			const batches: number[][] = []
			for (let i = 0; i < integerIds.length; i += BATCH_SIZE) {
				batches.push(integerIds.slice(i, i + BATCH_SIZE))
			}

			logger
				.withTags({
					totalIds: integerIds.length,
					batchCount: batches.length,
					batchSize: BATCH_SIZE,
				})
				.info('Resolving IDs from ESI in batches')

			// Process batches in parallel for better performance
			const batchResults = await Promise.all(
				batches.map(async (batch) => {
					const response = await fetch('https://esi.evetech.net/latest/universe/names/', {
						method: 'POST',
						headers: {
							'X-Compatibility-Date': '2025-09-30',
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(batch),
					})

					if (!response.ok) {
						const errorText = await response.text()
						logger
							.withTags({ status: response.status, errorText, batchSize: batch.length })
							.error('ESI ID resolution batch failed')
						return []
					}

					// ESI returns numbers for IDs, but we need strings
					return response.json<Array<{ id: number; name: string; category: string }>>()
				})
			)

			// Flatten all batch results
			const data = batchResults.flat()

			logger
				.withTags({
					resolvedCount: data.length,
					requestedCount: integerIds.length,
				})
				.info('ID resolution completed')

			// Cache the results - character/corp/alliance IDs to names are essentially permanent
			// Cache for 1 year (effectively forever - names very rarely change)
			const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000

			for (const entity of data) {
				const entityId = String(entity.id)
				result[entityId] = entity.name

				// Cache the id→name mapping (non-critical, failures should not prevent returning data)
				try {
					await this.state.storage.sql.exec(
						`INSERT OR REPLACE INTO entity_cache (entity_type, entity_id, entity_name, entity_data, expires_at)
						 VALUES (?, ?, ?, ?, ?)`,
						entity.category,
						entityId,
						entity.name,
						JSON.stringify({ id: entityId, name: entity.name, category: entity.category }), // Minimal data for ID lookups
						expiresAt
					)
				} catch (error) {
					// Cache write failure - log but don't fail the request
					logger
						.withTags({ entityName: entity.name, entityId, operation: 'cache_write' })
						.warn('Entity cache write failed', error)
				}
			}

			return result
		} catch (error) {
			logger.error(error)
			return result
		}
	}

	/**
	 * Search for a character by name using ESI search endpoint
	 */
	async searchCharacter(characterName: string, strict = true): Promise<string[]> {
		if (!characterName.trim()) {
			return []
		}

		try {
			// Get any character token for authentication (ESI search requires auth)
			const tokens = await this.db.query.eveTokens.findMany({
				limit: 1,
			})

			if (tokens.length === 0) {
				logger.warn('No character tokens available for ESI search')
				return []
			}

			// Get access token
			const accessToken = await this.getAccessToken(tokens[0].characterId)

			// Call ESI search endpoint
			// GET /search/?categories=character&search={name}&strict={strict}
			const url = new URL('https://esi.evetech.net/latest/search/')
			url.searchParams.set('categories', 'character')
			url.searchParams.set('search', characterName)
			url.searchParams.set('strict', String(strict))

			const response = await fetch(url.toString(), {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'X-Compatibility-Date': '2025-09-30',
				},
			})

			if (!response.ok) {
				if (response.status === 404) {
					// No results found
					return []
				}
				const errorText = await response.text()
				logger
					.withTags({ status: response.status, errorText, characterName, strict })
					.error('ESI character search failed')
				return []
			}

			const data = await response.json<{ character?: number[] }>()

			// Convert number IDs to strings
			return (data.character || []).map((id) => String(id))
		} catch (error) {
			logger.withTags({ characterName, strict }).error('Character search error', error)
			return []
		}
	}

	/**
	 * Alarm handler - automatically refresh tokens that are expiring soon
	 */
	async alarm(): Promise<void> {
		try {
			const now = new Date()
			const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000)

			// Find tokens expiring within the next 5 minutes
			const expiringTokens = await this.db.query.eveTokens.findMany({
				where: and(
					gt(eveTokens.expiresAt, now), // Not already expired
					lte(eveTokens.expiresAt, fiveMinutesFromNow) // Expires within 5 minutes
				),
			})

			// Refresh each token
			for (const token of expiringTokens) {
				const character = await this.db.query.eveCharacters.findFirst({
					where: eq(eveCharacters.id, token.characterId),
				})

				if (character) {
					await this.refreshToken(character.characterId)
				}
			}
		} catch (error) {
			logger.error(error)
		}

		// Schedule next alarm (5 minutes)
		await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000)
	}

	/**
	 * Generate authorization URL for EVE SSO
	 */
	private generateAuthUrl(scopes: readonly string[], state?: string): AuthorizationUrlResponse {
		const generatedState = state || crypto.randomUUID()

		const params = new URLSearchParams({
			response_type: 'code',
			redirect_uri: this.env.EVE_SSO_CALLBACK_URL,
			client_id: this.env.EVE_SSO_CLIENT_ID,
			scope: scopes.join(' '),
			state: generatedState,
		})

		return {
			url: `${EVE_SSO_AUTHORIZE_URL}?${params.toString()}`,
			state: generatedState,
		}
	}

	/**
	 * Exchange authorization code for access token
	 */
	private async exchangeCodeForToken(code: string): Promise<EveTokenResponse> {
		const credentials = btoa(`${this.env.EVE_SSO_CLIENT_ID}:${this.env.EVE_SSO_CLIENT_SECRET}`)

		const response = await fetch(EVE_SSO_TOKEN_URL, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${credentials}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				Host: 'login.eveonline.com',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Token exchange failed: ${error}`)
		}

		return response.json<EveTokenResponse>()
	}

	/**
	 * Refresh access token using refresh token
	 */
	private async refreshAccessToken(refreshToken: string): Promise<EveTokenResponse> {
		try {
			const credentials = btoa(`${this.env.EVE_SSO_CLIENT_ID}:${this.env.EVE_SSO_CLIENT_SECRET}`)

			const response = await fetch(EVE_SSO_TOKEN_URL, {
				method: 'POST',
				headers: {
					Authorization: `Basic ${credentials}`,
					'Content-Type': 'application/x-www-form-urlencoded',
					Host: 'login.eveonline.com',
				},
				body: new URLSearchParams({
					grant_type: 'refresh_token',
					refresh_token: refreshToken,
				}),
			})

			if (!response.ok) {
				const error = await response.text()
				logger
					.withTags({ operation: 'refreshAccessToken' })
					.error('Token refresh request failed', { status: response.status, error })
				throw new Error(`Token refresh failed (status: ${response.status}): ${error}`)
			}

			const tokenResponse = await response.json<EveTokenResponse>()
			return tokenResponse
		} catch (error) {
			logger
				.withTags({ operation: 'refreshAccessToken' })
				.error('Failed to refresh access token', error)
			throw error
		}
	}

	/**
	 * Verify access token locally using CCP's JWKS public keys.
	 * Validates iss, aud (our client ID), and cryptographic signature.
	 */
	private async verifyToken(accessToken: string): Promise<EveVerifyResponse> {
		const { metadata, jwks } = await this.getJwks()

		const clientId = this.env.EVE_SSO_CLIENT_ID
		const acceptedIssuers = Array.from(
			new Set([metadata.issuer, `${metadata.issuer}/`, 'login.eveonline.com'])
		)

		const { payload } = await jwtVerify(accessToken, jwks, {
			issuer: acceptedIssuers,
			audience: clientId,
		})

		// sub must be "CHARACTER:EVE:<characterId>"
		const sub = payload.sub ?? ''
		const subMatch = /^CHARACTER:EVE:(\d+)$/.exec(sub)
		if (!subMatch) {
			logger
				.withTags({ operation: 'verifyToken' })
				.error('Invalid "sub" claim value', { sub })
			throw new Error('Invalid claim value')
		}
		const characterId = subMatch[1]

		// scp may be a single string (one scope) or an array (multiple scopes)
		const scp = payload['scp']
		const scopes = Array.isArray(scp) ? scp.join(' ') : ((scp as string) ?? '')

		const exp = payload.exp ?? 0
		const expiresOn = new Date(exp * 1000).toISOString()

		const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
		const hasExpectedAudience =
			aud.length === 2 && aud.includes(clientId) && aud.includes('EVE Online')

		if (!hasExpectedAudience) {
			logger
				.withTags({ operation: 'verifyToken' })
				.error('Invalid "aud" claim value', { aud, expectedClientId: clientId })
			throw new Error('Invalid claim value')
		}

		return {
			CharacterID: characterId,
			CharacterName: (payload['name'] as string) ?? '',
			CharacterOwnerHash: (payload['owner'] as string) ?? '',
			Scopes: scopes,
			ExpiresOn: expiresOn,
			TokenType: 'Character',
			IntellectualProperty: 'EVE',
		}
	}

	/**
	 * Store token in database (upsert)
	 */
	private async storeToken(
		characterId: string,
		characterName: string,
		characterOwnerHash: string,
		scopes: string[],
		accessToken: string,
		refreshToken: string | null,
		expiresAt: Date
	): Promise<void> {
		// Encrypt tokens
		const encryptedAccessToken = await this.encrypt(accessToken)
		const encryptedRefreshToken = refreshToken ? await this.encrypt(refreshToken) : null

		// Check if character exists
		let character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterId, String(characterId)),
		})

		if (character) {
			// Update existing character (including hash for transfer detection)
			await this.db
				.update(eveCharacters)
				.set({
					characterName,
					characterOwnerHash,
					scopes: JSON.stringify(scopes),
					updatedAt: new Date(),
				})
				.where(eq(eveCharacters.id, character.id))
		} else {
			// Insert new character
			const [newCharacter] = await this.db
				.insert(eveCharacters)
				.values({
					characterId,
					characterName,
					characterOwnerHash,
					scopes: JSON.stringify(scopes),
				})
				.returning()

			character = newCharacter
		}

		if (!character) {
			throw new Error('Failed to create or update character')
		}

		// Check if token exists
		const existingToken = await this.db.query.eveTokens.findFirst({
			where: eq(eveTokens.characterId, character.id),
		})

		if (existingToken) {
			// Update existing token
			await this.db
				.update(eveTokens)
				.set({
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
					invalidSince: null,
					lastValidationAt: new Date(),
					lastValidationStatus: 'valid',
					nextRetryAt: null,
					permanentInvalidAt: null,
					permanentInvalidReason: null,
					updatedAt: new Date(),
				})
				.where(eq(eveTokens.id, existingToken.id))
		} else {
			// Insert new token
			await this.db.insert(eveTokens).values({
				characterId: character.id,
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
				lastValidationStatus: 'valid',
			})
		}
	}

	/**
	 * Encrypt data using AES-GCM
	 */
	private async encrypt(data: string): Promise<string> {
		try {
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
			const result = btoa(String.fromCharCode(...combined))
			return result
		} catch (error) {
			logger.withTags({ operation: 'encrypt' }).error('Encryption failed', error)
			throw error
		}
	}

	/**
	 * Decrypt data using AES-GCM
	 */
	private async decrypt(encryptedData: string): Promise<string> {
		try {
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

			const result = new TextDecoder().decode(decryptedData)
			return result
		} catch (error) {
			logger.withTags({ operation: 'decrypt' }).error('Decryption failed', error)
			throw error
		}
	}

	/**
	 * Get or create encryption key from environment
	 */
	private async getEncryptionKey(): Promise<CryptoKey> {
		try {
			// Convert hex string to bytes
			const keyMatch = this.env.ENCRYPTION_KEY.match(/.{1,2}/g)
			if (!keyMatch) {
				logger.withTags({ operation: 'getEncryptionKey' }).error('ENCRYPTION_KEY format invalid')
				throw new Error('ENCRYPTION_KEY format invalid')
			}

			const keyData = new Uint8Array(keyMatch.map((byte) => parseInt(byte, 16)))

			const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, [
				'encrypt',
				'decrypt',
			])
			return key
		} catch (error) {
			logger
				.withTags({ operation: 'getEncryptionKey' })
				.error('Failed to get encryption key', error)
			throw error
		}
	}

	/** Maximum cache TTL: 12 hours (in milliseconds) */
	private static readonly MAX_CACHE_TTL_MS = 12 * 60 * 60 * 1000

	/**
	 * Parse ESI cache expiry from response headers
	 * IMPORTANT: Caps all cache TTLs to 12 hours maximum regardless of ESI headers
	 */
	private parseEsiCacheExpiry(headers: Headers): Date {
		const now = Date.now()
		const maxExpiry = now + EveTokenStoreDO.MAX_CACHE_TTL_MS
		let expiresAt: Date

		// Check Expires header first
		const expires = headers.get('Expires')
		if (expires) {
			expiresAt = new Date(expires)
		} else {
			// Check Cache-Control header
			const cacheControl = headers.get('Cache-Control')
			if (cacheControl) {
				const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
				if (maxAgeMatch) {
					expiresAt = new Date(now + parseInt(maxAgeMatch[1], 10) * 1000)
				} else {
					// Default: 5 minutes
					expiresAt = new Date(now + 5 * 60 * 1000)
				}
			} else {
				// Default: 5 minutes
				expiresAt = new Date(now + 5 * 60 * 1000)
			}
		}

		// Cap at 12 hours maximum
		if (expiresAt.getTime() > maxExpiry) {
			return new Date(maxExpiry)
		}

		return expiresAt
	}

	/**
	 * Get a batch of characters to refresh
	 * @param batchSize - The number of characters to refresh
	 * @returns An array of character IDs
	 */
	async getRefreshCharacterBatch(batchSize = 50): Promise<EveCharacterId[]> {
		// Get characters that are not deleted and have not been refreshed in the last 24 hours
		const characters = await this.db.query.eveCharacters.findMany({
			where: and(
				isNull(eveCharacters.deletedAt),
				or(
					isNull(eveCharacters.lastRefreshAt),
					lt(eveCharacters.lastRefreshAt, new Date(Date.now() - TWENTY_FOUR_HOURS_MS))
				)
			),
			orderBy: (table) => [asc(table.lastRefreshAt), asc(table.characterId)],
			limit: batchSize,
		})

		/** Update the last attempted refresh timestamp for the characters */
		const characterIds = characters.map((character) => character.characterId as EveCharacterId)
		await this.db
			.update(eveCharacters)
			.set({ lastAttemptedRefreshAt: new Date() })
			.where(inArray(eveCharacters.characterId, characterIds))

		return characterIds
	}

	/**
	 * Get a batch of characters whose ESI data needs a full sync.
	 * Returns characters not synced in the last 20 hours, skipping any that
	 * had a sync attempted within the last hour (deduplication guard).
	 */
	async getCharactersNeedingDataSync(limit?: number): Promise<string[]> {
		const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000
		const ONE_HOUR_MS = 60 * 60 * 1000
		const whereClause = and(
			isNull(eveCharacters.deletedAt),
			or(
				isNull(eveCharacters.lastDataSyncAt),
				lt(eveCharacters.lastDataSyncAt, new Date(Date.now() - TWENTY_HOURS_MS))
			),
			or(
				isNull(eveCharacters.lastDataSyncAttemptAt),
				lt(eveCharacters.lastDataSyncAttemptAt, new Date(Date.now() - ONE_HOUR_MS))
			)
		)

		const characters =
			typeof limit === 'number' && limit > 0
				? await this.db.query.eveCharacters.findMany({
						where: whereClause,
						orderBy: (table) => [asc(table.lastDataSyncAt), asc(table.characterId)],
						limit,
					})
				: await this.db.query.eveCharacters.findMany({
						where: whereClause,
						orderBy: (table) => [asc(table.lastDataSyncAt), asc(table.characterId)],
					})

		const characterIds = characters.map((c) => c.characterId)

		if (characterIds.length > 0) {
			await this.db
				.update(eveCharacters)
				.set({ lastDataSyncAttemptAt: new Date() })
				.where(inArray(eveCharacters.characterId, characterIds))
		}

		return characterIds
	}

	/**
	 * Mark a character's ESI data sync as successfully completed.
	 */
	async markCharacterDataSyncComplete(characterId: string): Promise<void> {
		await this.db
			.update(eveCharacters)
			.set({ lastDataSyncAt: new Date() })
			.where(eq(eveCharacters.characterId, String(characterId)))
	}
}
