import { DurableObject } from 'cloudflare:workers'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import * as z4 from 'zod/v4/core'

import { and, asc, eq, gt, inArray, isNull, lt, lte, or } from '@repo/db-utils'
import { getStub, withRpcResult } from '@repo/do-utils'
import { EsiRequestClient } from '@repo/esi'
import { buildEsiUserKey, buildPublicEsiUserKey, EsiRateLimitStore } from '@repo/esi-rate-limit'
import {
	EVE_SSO_SCOPES_ALL,
	EVE_SSO_SCOPES_PUBLIC_ONLY,
	getMissingScopes,
	hasAllScopes,
} from '@repo/eve-token-store'
import { logger, toErrorLogDetails } from '@repo/hono-helpers'
import { parseDateOrNull, parseJsonResponse } from '@repo/worker-utils'

import { createDb } from './db'
import { eveCharacters, eveTokens } from './db/schema'
import { computeCircuitOpenUntil } from './lib/auth-esi-breaker'
import {
	computeEffectiveAuthEsiBudgetLimits,
	isAuthEsiBudgetExceeded,
	normalizeAuthEsiRouteKey,
} from './lib/auth-esi-budget'
import { shouldOpenRouteCircuitForResponse } from './lib/auth-esi-circuit-policy'
import { computeRampRetryAfterSeconds } from './lib/auth-esi-ramp'
import {
	classifySsoError,
	isPermanentRefreshFailure,
	isPermanentTokenDecryptionFailure,
	isRefreshBackstopExpired,
	shouldForcePermanentByInvalidAge,
} from './lib/token-health'

import type { EsiCacheScopeContext, EsiResponse as SharedEsiResponse } from '@repo/esi'
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
	PublicDataVerifyResult,
	TokenInfo,
	TokenRefreshResult,
	TokenValidationResult,
} from '@repo/eve-token-store'
import type { EveCharacterId } from '@repo/eve-types'
import type { Env } from './context'

type EsiHelperStub = {
	fetchCharacterAffiliation(
		characterId: string,
		characterIds: string[],
		options?: { cacheMode?: 'default' | 'no-store'; maxRetries?: number; timeoutMs?: number }
	): Promise<EsiCharacterAffiliation[]>
	searchCharacter(characterId: string, characterName: string, strict?: boolean): Promise<string[]>
}

type EsiTypeResolverHelperStub = {
	resolveNames(names: string[]): Promise<Record<string, string>>
	resolveIds(ids: string[]): Promise<Record<string, string>>
}

/**
 * EVE SSO OAuth Endpoints
 */
const EVE_SSO_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize'
const EVE_SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token'
const EVE_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const EVE_SSO_JWKS_FALLBACK_URL = 'https://login.eveonline.com/oauth/jwks'
const METADATA_TTL_MS = 5 * 60 * 1000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const AUTH_ESI_ROUTE_BREAKER_OPEN_UNTIL_PREFIX = 'esi:auth:breaker:route:open-until-ms:'
const AUTH_ESI_ROUTE_BREAKER_LAST_OPEN_UNTIL_PREFIX = 'esi:auth:breaker:route:last-open-until-ms:'
const AUTH_ESI_DYNAMIC_BUDGET_ROUTE_PREFIX = 'esi:auth:budget:route:'
const AUTH_ESI_BREAKER_MIN_OPEN_MS = 5_000
const AUTH_ESI_BREAKER_MAX_OPEN_MS = 5 * 60 * 1000
const AUTH_ESI_RATE_WINDOW_MS = 60 * 1000
const AUTH_ESI_ROUTE_WINDOW_LIMIT = 60
const AUTH_ESI_RAMP_WINDOW_MS = 60 * 1000
const TOKEN_REFRESH_COOLDOWN_PREFIX = 'token:refresh:cooldown:'
const TOKEN_REFRESH_TRANSIENT_COOLDOWN_MS = 5 * 60 * 1000
const TOKEN_REFRESH_ALARM_BATCH_SIZE = 10
const TOKEN_REFRESH_ALARM_CONTINUE_DELAY_MS = 30 * 1000
const TOKEN_REFRESH_ALARM_INTERVAL_MS = 5 * 60 * 1000

type AccessTokenLookupResult =
	| {
			status: 'ok'
			accessToken: string
	  }
	| {
			status:
				| 'token_missing'
				| 'character_deleted'
				| 'invalid_token'
				| 'permanent_invalid'
				| 'transient_error'
			error: string
	  }

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
	private readonly esiRateLimits: EsiRateLimitStore
	private readonly esiRequestClient: EsiRequestClient
	private authEsiRouteBreakerOpenUntilMs = new Map<string, number>()
	private authEsiRouteBreakerLastOpenUntilMs = new Map<string, number>()
	private authEsiDynamicBudgetByRoute = new Map<
		string,
		{
			remain: number
			resetSeconds: number
			observedAtMs: number
		}
	>()

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

		// turning off to see if this is the cause of our duration issues
		// const useWebSocket = env.ENVIRONMENT !== 'development'
		const useWebSocket = false

		this.db = createDb(env, env.DATABASE_URL, useWebSocket)
		this.esiRateLimits = new EsiRateLimitStore(env.ESI_RATE_LIMITS)
		this.esiRequestClient = new EsiRequestClient({
			rateLimits: this.esiRateLimits,
			cache: this,
			baseUrl: 'https://esi.evetech.net',
			debugLogger: logger,
			compatibilityDate: '2026-05-19',
		})

		// Load cached metadata from DO storage once on startup.
		void state.blockConcurrencyWhile(async () => {
			this.metadata = (await state.storage.get<CachedEveMetadata>('eve:oauth:metadata')) ?? null

			if (this.metadata) {
				this.jwksUri = this.metadata.jwks_uri
				this.jwks = createRemoteJWKSet(new URL(this.metadata.jwks_uri))
			}

			// Initialize the SQLite-backed cache tables before the DO can serve requests.
			// This avoids cache clear/read paths racing a cold start and resetting the object.
			await this.initializeEsiCache()

			// Do not overwrite an existing alarm during a DO restart or relocation.
			// Keeping the existing alarm also preserves Cloudflare's automatic retry state.
			if ((await state.storage.getAlarm()) === null) {
				await this.scheduleRefreshAlarm(TOKEN_REFRESH_ALARM_INTERVAL_MS, 'constructor')
			}
		})
	}

	private async scheduleRefreshAlarm(delayMs: number, source: string): Promise<void> {
		try {
			await this.state.storage.setAlarm(Date.now() + delayMs)
		} catch (error) {
			// A relocation can make the current isolate's storage handle invalid. Re-throw
			// so Cloudflare retries the alarm on the object's new machine.
			logger
				.withTags({ operation: 'scheduleRefreshAlarm', source })
				.warn('Failed to schedule token refresh alarm; allowing platform retry', {
					delayMs,
					error: error instanceof Error ? error.message : String(error),
					errorDetails: toErrorLogDetails(error),
				})
			throw error
		}
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

			const json = await parseJsonResponse<EveMetadata>(res, {
				context: 'EVE SSO metadata response',
			})

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
		const storageKey = this.getTokenRefreshCooldownKey(characterId)
		try {
			const value = await this.state.storage.get<number>(storageKey)
			return typeof value === 'number' && Number.isFinite(value) ? value : 0
		} catch (error) {
			// The cooldown is advisory. A transient DO storage failure must not turn a
			// usable refresh token into a failed refresh attempt.
			logger
				.withTags({ operation: 'getTokenRefreshCooldownUntil', characterId })
				.warn('Failed to read token refresh cooldown; continuing without persisted cooldown', {
					storageKey,
					error: error instanceof Error ? error.message : String(error),
					errorDetails: toErrorLogDetails(error),
				})
			return 0
		}
	}

	private async setTokenRefreshCooldownUntil(
		characterId: string,
		cooldownUntilMs: number
	): Promise<void> {
		const storageKey = this.getTokenRefreshCooldownKey(characterId)
		try {
			await this.state.storage.put(storageKey, cooldownUntilMs)
		} catch (error) {
			logger
				.withTags({ operation: 'setTokenRefreshCooldownUntil', characterId })
				.warn('Failed to persist token refresh cooldown to Durable Object storage', {
					storageKey,
					cooldownUntil: new Date(cooldownUntilMs).toISOString(),
					error: error instanceof Error ? error.message : String(error),
					errorDetails: toErrorLogDetails(error),
				})
		}
	}

	private async clearTokenRefreshCooldown(characterId: string): Promise<void> {
		const storageKey = this.getTokenRefreshCooldownKey(characterId)
		try {
			await this.state.storage.delete(storageKey)
		} catch (error) {
			logger
				.withTags({ operation: 'clearTokenRefreshCooldown', characterId })
				.warn('Failed to clear token refresh cooldown from Durable Object storage', {
					storageKey,
					error: error instanceof Error ? error.message : String(error),
					errorDetails: toErrorLogDetails(error),
				})
		}
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
			const result = this.generateAuthUrl(EVE_SSO_SCOPES_ALL, state)
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
			const result = this.generateAuthUrl(EVE_SSO_SCOPES_ALL, state)
			return result
		} catch (error) {
			logger
				.withTags({ operation: 'startCharacterFlow', state })
				.error('Failed to start character flow', error)
			throw error
		}
	}

	/**
	 * Start a minimal identification-only OAuth flow (publicData scope only).
	 * Used by ephemeral flows (e.g. Mumble temp-op guests) — no token is stored.
	 */
	async startPublicDataFlow(state?: string): Promise<AuthorizationUrlResponse> {
		try {
			return this.generateAuthUrl(EVE_SSO_SCOPES_PUBLIC_ONLY, state)
		} catch (error) {
			logger
				.withTags({ operation: 'startPublicDataFlow', state })
				.error('Failed to start publicData flow', error)
			throw error
		}
	}

	/**
	 * Verify a publicData OAuth callback and return the character identity only.
	 * Exchanges the code and verifies the JWT signature/claims, but intentionally
	 * does NOT persist a token or create an eveCharacters row — the caller (e.g.
	 * the Mumble temp-op guest flow) only needs the verified id + name.
	 */
	async verifyPublicDataCallback(code: string): Promise<PublicDataVerifyResult> {
		try {
			const tokenResponse = await this.exchangeCodeForToken(code)
			const verified = await this.verifyToken(tokenResponse.access_token)
			return {
				characterId: verified.CharacterID,
				characterName: verified.CharacterName,
			}
		} catch (error) {
			logger
				.withTags({ operation: 'verifyPublicDataCallback' })
				.error('Failed to verify publicData callback', error)
			return { error: 'Failed to verify EVE login' }
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
			if (!hasAllScopes(scopes, EVE_SSO_SCOPES_ALL)) {
				const missingScopes = getMissingScopes(scopes, EVE_SSO_SCOPES_ALL)
				logger
					.withTags({ operation: 'handleCallback', state })
					.warn('Callback token missing scopes', {
						characterId: verifyResponse.CharacterID,
						missingScopes,
					})
				return {
					success: false,
					error: `Missing required scopes: ${missingScopes.join(', ')}`,
				}
			}

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
		const result = await this.refreshTokenWithResult(characterId)
		return result.success
	}

	/**
	 * Manually refresh a token with structured outcome metadata.
	 */
	async refreshTokenWithResult(characterId: string): Promise<TokenRefreshResult> {
		try {
			const cooldownUntilMs = await this.getTokenRefreshCooldownUntil(characterId)
			const nowMs = Date.now()
			if (cooldownUntilMs > nowMs) {
				logger
					.withTags({ operation: 'refreshToken', characterId })
					.info('Skipping refresh: token is in cooldown window', {
						cooldownUntil: new Date(cooldownUntilMs).toISOString(),
					})
				return {
					characterId,
					success: false,
					status: 'transient_error',
					error: `Token refresh cooldown active until ${new Date(cooldownUntilMs).toISOString()}`,
				}
			}

			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterId, String(characterId)),
			})

			if (!character) {
				logger.withTags({ operation: 'refreshToken', characterId }).error('Character not found')
				return {
					characterId,
					success: false,
					status: 'token_missing',
					error: 'Character not found',
				}
			}
			if (character.deletedAt) {
				logger
					.withTags({ operation: 'refreshToken', characterId })
					.error('Character is marked deleted')
				return {
					characterId,
					success: false,
					status: 'character_deleted',
					error: 'Character is marked deleted',
				}
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
				return {
					characterId,
					success: false,
					status: 'token_missing',
					error: 'Token or refresh token not found',
				}
			}
			if (tokenRecord.permanentInvalidAt) {
				logger
					.withTags({ operation: 'refreshToken', characterId })
					.warn('Skipping refresh: token is permanently invalid', {
						permanentInvalidAt: tokenRecord.permanentInvalidAt.toISOString(),
						reason: tokenRecord.permanentInvalidReason,
					})
				return {
					characterId,
					success: false,
					status: 'permanent_invalid',
					error: tokenRecord.permanentInvalidReason ?? 'Token is permanently invalid',
				}
			}
			if (tokenRecord.nextRetryAt && tokenRecord.nextRetryAt.getTime() > nowMs) {
				logger
					.withTags({ operation: 'refreshToken', characterId })
					.info('Skipping refresh: token retry cooldown is active', {
						nextRetryAt: tokenRecord.nextRetryAt.toISOString(),
					})
				return {
					characterId,
					success: false,
					status: 'transient_error',
					error: `Token refresh cooldown active until ${tokenRecord.nextRetryAt.toISOString()}`,
				}
			}
			if (shouldForcePermanentByInvalidAge(tokenRecord.invalidSince)) {
				await this.db
					.update(eveTokens)
					.set({
						permanentInvalidAt: new Date(),
						permanentInvalidReason:
							tokenRecord.permanentInvalidReason ?? 'Invalid state exceeded 7-day backstop',
						updatedAt: new Date(),
					})
					.where(eq(eveTokens.id, tokenRecord.id))
				return {
					characterId,
					success: false,
					status: 'permanent_invalid',
					error: 'Invalid state exceeded 7-day backstop',
				}
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
				return {
					characterId,
					success: false,
					status: permanentlyInvalid ? 'permanent_invalid' : 'invalid_token',
					error: 'Token is expired and has no refresh token',
				}
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
			await this.clearTokenRefreshCooldown(characterId).catch((error) => {
				// Cooldown cleanup is advisory; never fail a successful refresh because storage is transiently unhealthy.
				logger
					.withTags({ operation: 'refreshToken', characterId })
					.warn('Failed to clear token refresh cooldown', {
						error: error instanceof Error ? error.message : String(error),
						errorDetails: toErrorLogDetails(error),
					})
			})

			return {
				characterId,
				success: true,
				status: 'refreshed',
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (isPermanentTokenDecryptionFailure(message)) {
				const character = await this.db.query.eveCharacters.findFirst({
					where: eq(eveCharacters.characterId, String(characterId)),
				})
				if (character) {
					await this.db
						.update(eveTokens)
						.set({
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
					.warn('Permanent token decryption failure; disabled further refresh attempts', {
						error: message,
						errorDetails: toErrorLogDetails(error),
					})
				return {
					characterId,
					success: false,
					status: 'permanent_invalid',
					error: message,
				}
			}
			let tokenState: {
				expiresAt: string
				hasRefreshToken: boolean
				invalidSince: string | null
				lastValidationStatus: string | null
				nextRetryAt: string | null
				permanentInvalidAt: string | null
				permanentInvalidReason: string | null
			} | null = null
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
						errorDetails: toErrorLogDetails(error),
					})
				return {
					characterId,
					success: false,
					status: 'permanent_invalid',
					error: message,
				}
			}
			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterId, String(characterId)),
			})
			if (character) {
				const existingToken = await this.db.query.eveTokens.findFirst({
					where: eq(eveTokens.characterId, character.id),
				})
				tokenState = existingToken
					? {
							expiresAt: existingToken.expiresAt.toISOString(),
							hasRefreshToken: Boolean(existingToken.refreshToken),
							invalidSince: existingToken.invalidSince?.toISOString() ?? null,
							lastValidationStatus: existingToken.lastValidationStatus,
							nextRetryAt: existingToken.nextRetryAt?.toISOString() ?? null,
							permanentInvalidAt: existingToken.permanentInvalidAt?.toISOString() ?? null,
							permanentInvalidReason: existingToken.permanentInvalidReason ?? null,
						}
					: null
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
			).catch((error) => {
				// Cooldown persistence is advisory; never fail the refresh path if storage is temporarily unhealthy.
				logger
					.withTags({ operation: 'refreshToken', characterId })
					.warn('Failed to persist token refresh cooldown', {
						error: error instanceof Error ? error.message : String(error),
						errorDetails: toErrorLogDetails(error),
					})
			})
			logger.withTags({ operation: 'refreshToken', characterId }).error('Token refresh failed', {
				error: message,
				errorDetails: toErrorLogDetails(error),
				tokenState,
				transientCooldownUntil: new Date(
					Date.now() + TOKEN_REFRESH_TRANSIENT_COOLDOWN_MS
				).toISOString(),
			})
			return {
				characterId,
				success: false,
				status: 'transient_error',
				error: message,
			}
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
		requiredScopes: readonly string[] = EVE_SSO_SCOPES_ALL,
		options?: { force?: boolean }
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
		if (
			!options?.force &&
			tokenRecord.nextRetryAt &&
			tokenRecord.nextRetryAt.getTime() > Date.now()
		) {
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
			if (isPermanentTokenDecryptionFailure(errorMessage)) {
				await this.db
					.update(eveTokens)
					.set({
						invalidSince: tokenRecord.invalidSince ?? new Date(),
						lastValidationAt: new Date(),
						lastValidationStatus: 'permanent_invalid',
						nextRetryAt: null,
						permanentInvalidAt: new Date(),
						permanentInvalidReason: errorMessage,
						updatedAt: new Date(),
					})
					.where(eq(eveTokens.id, tokenRecord.id))
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
					.warn(
						'Permanent token refresh failure during validation; disabled further refresh attempts',
						{
							error: errorMessage,
						}
					)
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
			const missingScopes = getMissingScopes(scopes, requiredScopes)

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
	 * Returns null when no token can be produced.
	 */
	async getAccessToken(characterId: string): Promise<string | null> {
		const result = await this.getAccessTokenResult(characterId)
		return result.status === 'ok' ? result.accessToken : null
	}

	/**
	 * Internal access-token lookup that preserves retryable refresh failures so
	 * authenticated callers can distinguish transient outages from hard auth loss.
	 */
	private async getAccessTokenResult(characterId: string): Promise<AccessTokenLookupResult> {
		try {
			const character = await this.db.query.eveCharacters.findFirst({
				where: and(
					eq(eveCharacters.characterId, String(characterId)),
					isNull(eveCharacters.deletedAt)
				),
			})

			if (!character) {
				return {
					status: 'token_missing',
					error: 'Character not found',
				}
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
				return {
					status: 'token_missing',
					error: 'Token record not found',
				}
			}

			// Check if token is expired
			const now = new Date()
			const isExpired = tokenRecord.expiresAt < now

			if (isExpired) {
				if (!tokenRecord.refreshToken) {
					return {
						status: 'invalid_token',
						error: 'Token is expired and has no refresh token',
					}
				}
				// Try to refresh. Preserve retryable failures so callers can treat
				// them as transient instead of converting them into hard 401s.
				const refreshed = await this.refreshTokenWithResult(characterId)
				if (!refreshed.success) {
					return {
						status: refreshed.status === 'refreshed' ? 'transient_error' : refreshed.status,
						error: refreshed.error ?? 'Token refresh failed',
					}
				}

				// Fetch updated token
				const updatedToken = await this.db.query.eveTokens.findFirst({
					where: eq(eveTokens.characterId, character.id),
				})

				if (!updatedToken) {
					logger
						.withTags({ operation: 'getAccessToken', characterId })
						.error('Updated token not found after refresh')
					return {
						status: 'transient_error',
						error: 'Updated token not found after refresh',
					}
				}

				const decryptedToken = await this.decrypt(updatedToken.accessToken)
				return {
					status: 'ok',
					accessToken: decryptedToken,
				}
			}

			const decryptedToken = await this.decrypt(tokenRecord.accessToken)
			return {
				status: 'ok',
				accessToken: decryptedToken,
			}
		} catch (error) {
			logger
				.withTags({ operation: 'getAccessToken', characterId })
				.error('Failed to get access token', error)
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (isPermanentTokenDecryptionFailure(errorMessage)) {
				return {
					status: 'permanent_invalid',
					error: errorMessage,
				}
			}
			return {
				status: 'transient_error',
				error: errorMessage,
			}
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
	 * ESI cache adapter for the shared request client.
	 */
	async getCachedResponse<T>(
		scope: EsiCacheScopeContext,
		path: string,
		page?: number,
		includeExpired = false
	): Promise<SharedEsiResponse<T> | null> {
		const cacheKey = this.getEsiCacheKey(scope, path, page)
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
		if (cached.length === 0) {
			return null
		}

		const lastModified = cached[0].last_modified ? new Date(cached[0].last_modified) : null
		const isExpired = cached[0].expires_at <= Date.now()
		const cacheAge = lastModified ? Date.now() - lastModified.getTime() : Infinity
		if ((isExpired || cacheAge > EveTokenStoreDO.MAX_CACHE_TTL_MS) && !includeExpired) {
			await this.state.storage.sql.exec(`DELETE FROM esi_cache WHERE cache_key = ?`, cacheKey)
			return null
		}

		return {
			data: JSON.parse(cached[0].response_data) as T,
			expiresAt: new Date(cached[0].expires_at),
			etag: cached[0].etag,
			pages: cached[0].pages,
			page: cached[0].page,
			lastModified: lastModified ?? undefined,
			cached: true,
		}
	}

	/**
	 * Persist a shared ESI cache entry using the local SQL cache table.
	 */
	async setCachedResponse<T>(
		scope: EsiCacheScopeContext,
		path: string,
		response: SharedEsiResponse<T>,
		page?: number,
		_options?: { persistGlobal?: boolean }
	): Promise<void> {
		const cacheKey = this.getEsiCacheKey(scope, path, page)
		const lastModified = response.lastModified ?? new Date()

		await this.state.storage.sql.exec(
			`INSERT OR REPLACE INTO esi_cache (cache_key, response_data, expires_at, etag, pages, page, last_modified)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			cacheKey,
			JSON.stringify(response.data),
			response.expiresAt?.getTime() ?? null,
			response.etag,
			response.pages ?? null,
			response.page ?? null,
			lastModified.toISOString()
		)
	}

	private getEsiCacheKey(scope: EsiCacheScopeContext, path: string, page?: number): string {
		const baseKey = `esi:${scope.scope}:${scope.scopeId}:${path}`
		if (page !== undefined) {
			return `${baseKey}:page:${page}`
		}
		return baseKey
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
		const now = Date.now()
		const dynamicBudget = await this.getRouteDynamicBudget(routeKey)
		const limits = computeEffectiveAuthEsiBudgetLimits({
			baseRouteLimit: AUTH_ESI_ROUTE_WINDOW_LIMIT,
			nowMs: now,
			dynamicBudget,
		})

		// Only enforce budget throttling when we have live route budget telemetry
		// from ESI headers. Without that, static caps can preempt valid traffic.
		// Real upstream 429s still trigger the route breaker and seed dynamic budget.
		if (limits.source !== 'dynamic') {
			return
		}

		const route = await this.incrementAuthEsiWindowCounter(`route:${routeKey}`)

		if (
			!isAuthEsiBudgetExceeded({
				routeCount: route.count,
				routeLimit: limits.routeLimit,
			})
		) {
			return
		}

		const windowEndMs = route.windowStartMs + AUTH_ESI_RATE_WINDOW_MS
		const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - now) / 1000))
		const metadata = JSON.stringify({
			status: 429,
			path,
			retryAfterSeconds,
			circuitBreaker: 'budget_exhausted',
			routeKey,
			routeCount: route.count,
			routeLimit: limits.routeLimit,
			limitSource: limits.source,
			dynamicBudget,
		})
		throw new Error(
			`ESI request failed: 429 Too Many Requests - {"error":"Auth ESI route budget exhausted"} | metadata=${metadata}`
		)
	}

	private async getRouteDynamicBudget(
		routeKey: string
	): Promise<{ remain: number; resetSeconds: number; observedAtMs: number } | null> {
		const cached = this.authEsiDynamicBudgetByRoute.get(routeKey)
		if (cached) {
			return cached
		}
		const loaded =
			(await this.state.storage.get<{ remain: number; resetSeconds: number; observedAtMs: number }>(
				`${AUTH_ESI_DYNAMIC_BUDGET_ROUTE_PREFIX}${routeKey}`
			)) ?? null
		if (loaded) {
			this.authEsiDynamicBudgetByRoute.set(routeKey, loaded)
		}
		return loaded
	}

	private async updateAuthenticatedEsiDynamicBudgetFromHeaders(
		path: string,
		headers: Headers,
		status: number
	): Promise<void> {
		const routeKey = normalizeAuthEsiRouteKey(path)
		const remain = this.parseHeaderSeconds(headers, 'X-ESI-Error-Limit-Remain')
		const resetSeconds = this.parseHeaderSeconds(headers, 'X-ESI-Error-Limit-Reset')
		const retryAfterSeconds = this.parseHeaderSeconds(headers, 'Retry-After')
		const now = Date.now()

		if (remain !== undefined && resetSeconds !== undefined) {
			const budget = {
				remain,
				resetSeconds,
				observedAtMs: now,
			}
			this.authEsiDynamicBudgetByRoute.set(routeKey, budget)
			await this.state.storage.put(`${AUTH_ESI_DYNAMIC_BUDGET_ROUTE_PREFIX}${routeKey}`, budget)
			return
		}

		// 429 without explicit error-limit headers: still capture retry window as a
		// temporary exhausted budget signal.
		if (status === 429 && retryAfterSeconds !== undefined) {
			const budget = {
				remain: 0,
				resetSeconds: retryAfterSeconds,
				observedAtMs: now,
			}
			this.authEsiDynamicBudgetByRoute.set(routeKey, budget)
			await this.state.storage.put(`${AUTH_ESI_DYNAMIC_BUDGET_ROUTE_PREFIX}${routeKey}`, budget)
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
	}

	private async assertAuthenticatedEsiCircuitClosed(path: string): Promise<void> {
		const now = Date.now()
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

	private async openAuthenticatedEsiRouteCircuit(
		path: string,
		retryAfterSeconds: number | undefined,
		reason: string
	): Promise<void> {
		const routeKey = normalizeAuthEsiRouteKey(path)
		const now = Date.now()
		const currentOpenUntilMs =
			this.authEsiRouteBreakerOpenUntilMs.get(routeKey) ??
			(await this.state.storage.get<number>(
				`${AUTH_ESI_ROUTE_BREAKER_OPEN_UNTIL_PREFIX}${routeKey}`
			)) ??
			0
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
		logger
			.withTags({ operation: 'esi_auth_route_breaker_open' })
			.warn('Opened auth ESI route circuit breaker', {
				reason,
				routeKey,
				retryAfterSeconds,
				openForMs: nextOpenUntil - now,
				openUntil: new Date(nextOpenUntil).toISOString(),
			})
	}

	private normalizeCharacterIds(characterIds: string[]): number[] {
		return [
			...new Set(characterIds.map((id) => Number.parseInt(id, 10)).filter(Number.isFinite)),
		].sort((a, b) => a - b)
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
	async fetchEsi<T>(
		path: string,
		characterId: string,
		options?: { cacheMode?: 'default' | 'no-store'; maxRetries?: number; timeoutMs?: number }
	): Promise<EsiResponse<T>> {
		const cacheMode = options?.cacheMode ?? 'default'
		const scope = { scope: 'character', scopeId: characterId } as const
		const cached =
			cacheMode === 'no-store'
				? null
				: await this.getCachedResponse<T>(scope, path, undefined, true)
		if (cached) {
			const now = Date.now()
			const lastModified = cached.lastModified?.getTime()
			const cacheAge = lastModified ? now - lastModified : Infinity
			if (
				cached.expiresAt?.getTime() &&
				cached.expiresAt.getTime() > now &&
				cacheAge <= EveTokenStoreDO.MAX_CACHE_TTL_MS
			) {
				return {
					data: cached.data,
					cached: true,
					expiresAt: cached.expiresAt ?? new Date(),
					etag: cached.etag ?? undefined,
					pages: cached.pages ?? undefined,
					page: cached.page ?? undefined,
				}
			}
		}

		const character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterId, String(characterId)),
		})

		if (!character) {
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

		const accessTokenResult = await this.getAccessTokenResult(character.characterId)
		if (accessTokenResult.status !== 'ok') {
			const isTransient = accessTokenResult.status === 'transient_error'
			const metadata = JSON.stringify({
				status: isTransient ? 503 : 401,
				path,
				reasonCode: isTransient ? 'token_refresh_transient_failure' : 'no_token_provided',
			})
			const errorBody = isTransient
				? '{"error":"Service Unavailable - Token refresh failed transiently"}'
				: '{"error":"Unauthorized - No token provided"}'
			const errorText = isTransient
				? 'Service Unavailable - Token refresh failed transiently'
				: 'Unauthorized - No token provided'
			throw new Error(
				`ESI request failed: ${isTransient ? 503 : 401} ${errorText} - ${errorBody} | metadata=${metadata}`
			)
		}

		const response = await this.esiRequestClient.request<T>({
			path,
			userKey: buildEsiUserKey(this.env.EVE_SSO_CLIENT_ID, characterId),
			cacheScope: scope,
			cacheMode,
			cachedResponse: cached,
			accessToken: accessTokenResult.accessToken,
			timeoutMs: options?.timeoutMs,
			maxRetries: options?.maxRetries,
			maxLocalCacheTtl: EveTokenStoreDO.MAX_CACHE_TTL_SECONDS,
			onResponse: async ({ response: esiResponse }) => {
				await this.updateAuthenticatedEsiDynamicBudgetFromHeaders(
					path,
					esiResponse.headers,
					esiResponse.status
				)
				if (shouldOpenRouteCircuitForResponse(esiResponse.status)) {
					const retryAfterSeconds = this.parseHeaderSeconds(esiResponse.headers, 'Retry-After')
					await this.openAuthenticatedEsiRouteCircuit(path, retryAfterSeconds, `429 on ${path}`)
				}
			},
			parse: async (esiResponse) =>
				parseJsonResponse<T>(esiResponse, { context: `ESI auth response for ${path}` }),
			buildError: async ({ response: esiResponse, body }) =>
				this.buildEsiRequestError(path, esiResponse, body),
		})

		return {
			data: response.data,
			cached: response.cached ?? false,
			expiresAt: response.expiresAt ?? new Date(),
			etag: response.etag ?? undefined,
			pages: response.pages ?? undefined,
			page: response.page ?? undefined,
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
	async fetchPublicEsi<T>(
		path: string,
		options?: { cacheMode?: 'default' | 'no-store' }
	): Promise<EsiResponse<T>> {
		const scope = EveTokenStoreDO.PUBLIC_CACHE_SCOPE
		const cacheMode = options?.cacheMode ?? 'default'
		const cached =
			cacheMode === 'no-store'
				? null
				: await this.getCachedResponse<T>(scope, path, undefined, true)
		if (cached) {
			const now = Date.now()
			const lastModified = cached.lastModified?.getTime()
			const cacheAge = lastModified ? now - lastModified : Infinity
			if (
				cached.expiresAt?.getTime() &&
				cached.expiresAt.getTime() > now &&
				cacheAge <= EveTokenStoreDO.MAX_CACHE_TTL_MS
			) {
				return {
					data: cached.data,
					cached: true,
					expiresAt: cached.expiresAt ?? new Date(),
					etag: cached.etag ?? undefined,
					pages: cached.pages ?? undefined,
					page: cached.page ?? undefined,
				}
			}
		}

		await this.assertAuthenticatedEsiCircuitClosed(path)

		const response = await this.esiRequestClient.request<T>({
			path,
			userKey: buildPublicEsiUserKey(),
			cacheScope: scope,
			cacheMode,
			cachedResponse: cached,
			onResponse: async ({ response: esiResponse }) => {
				if (shouldOpenRouteCircuitForResponse(esiResponse.status)) {
					const retryAfterSeconds = this.parseHeaderSeconds(esiResponse.headers, 'Retry-After')
					await this.openAuthenticatedEsiRouteCircuit(path, retryAfterSeconds, `429 on ${path}`)
				}
			},
			parse: async (esiResponse) =>
				parseJsonResponse<T>(esiResponse, { context: `ESI public response for ${path}` }),
			buildError: async ({ response: esiResponse, body }) =>
				this.buildEsiRequestError(path, esiResponse, body),
		})

		return {
			data: response.data,
			cached: response.cached ?? false,
			expiresAt: response.expiresAt ?? new Date(),
			etag: response.etag ?? undefined,
			pages: response.pages ?? undefined,
			page: response.page ?? undefined,
		}
	}

	async fetchCharacterAffiliations(
		characterIds: string[],
		options?: { cacheMode?: 'default' | 'no-store'; maxRetries?: number; timeoutMs?: number }
	): Promise<EsiCharacterAffiliation[]> {
		const normalizedIds = this.normalizeCharacterIds(characterIds)
		if (normalizedIds.length === 0) {
			throw new Error('fetchCharacterAffiliations requires at least one valid character ID')
		}

		const esiStub = getStub<EsiHelperStub>(this.env.ESI, 'default')
		return await withRpcResult(
			esiStub.fetchCharacterAffiliation(String(normalizedIds[0]), normalizedIds.map(String), {
				cacheMode: options?.cacheMode ?? 'no-store',
				maxRetries: options?.maxRetries,
				timeoutMs: options?.timeoutMs,
			}),
			(affiliations) =>
				affiliations.map((affiliation) => ({
					character_id: Number.parseInt(String(affiliation.character_id), 10),
					corporation_id: Number.parseInt(String(affiliation.corporation_id), 10),
					alliance_id: affiliation.alliance_id
						? Number.parseInt(String(affiliation.alliance_id), 10)
						: undefined,
					faction_id: affiliation.faction_id
						? Number.parseInt(String(affiliation.faction_id), 10)
						: undefined,
				}))
		)
	}

	/**
	 * Clear ESI cache for a specific path
	 * Useful for forcing fresh data on next request or after errors
	 */
	async clearEsiCache(path: string, characterId?: string): Promise<number> {
		const scope: EsiCacheScopeContext = characterId
			? { scope: 'character', scopeId: characterId }
			: EveTokenStoreDO.PUBLIC_CACHE_SCOPE
		const cacheKey = this.getEsiCacheKey(scope, path)

		// Delete the base entry and page entries without LIKE/GLOB pattern matching.
		// SQLite can reject wildcard patterns as too complex even when the key itself is small.
		const baseKey = cacheKey.split('?')[0]
		const queryKeyPrefix = `${baseKey}?`
		const pageKeyPrefix = `${baseKey}:page:`
		const result = await this.state.storage.sql.exec(
			`DELETE FROM esi_cache
			 WHERE cache_key = ?
			    OR substr(cache_key, 1, length(?)) = ?
			    OR substr(cache_key, 1, length(?)) = ?`,
			cacheKey,
			queryKeyPrefix,
			queryKeyPrefix,
			pageKeyPrefix,
			pageKeyPrefix
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
		options?: { maxConcurrent?: number; cacheMode?: 'default' | 'no-store' }
	): Promise<{
		data: T[]
		pages: number
	}> {
		const maxConcurrent = options?.maxConcurrent ?? 5
		const cacheMode = options?.cacheMode ?? 'default'

		// Remove any existing page parameter from basePath
		const cleanPath = basePath.replace(/[?&]page=\d+/, '')
		const separator = cleanPath.includes('?') ? '&' : '?'

		// Fetch first page to get total page count
		const firstPagePath = `${cleanPath}${separator}page=1`
		const firstResponse = await this.fetchEsi<T[]>(firstPagePath, characterId, {
			cacheMode,
		})

		const totalPages = firstResponse.pages ?? 1
		// If there's only one page, return early
		if (totalPages === 1) {
			return {
				data: firstResponse.data,
				pages: totalPages,
			}
		}

		// Fetch remaining pages with concurrency limit
		const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
		const fetchPage = async (pageNum: number): Promise<EsiResponse<T[]>> => {
			const pagePath = `${cleanPath}${separator}page=${pageNum}`
			return this.fetchEsi<T[]>(pagePath, characterId, {
				cacheMode,
			})
		}

		// Fetch with concurrency control
		const remainingResponses: Array<EsiResponse<T[]>> = []
		for (let i = 0; i < remainingPages.length; i += maxConcurrent) {
			const batch = remainingPages.slice(i, i + maxConcurrent)
			const batchResponses = await Promise.all(batch.map(fetchPage))
			remainingResponses.push(...batchResponses)
		}

		// Combine all data from all pages
		const allData = [
			...firstResponse.data,
			...remainingResponses.flatMap((response) => response.data),
		]

		return {
			data: allData,
			pages: totalPages,
		}
	}

	async fetchEsiPagesUntilWatermark<T extends { id: string | number; date?: string | Date }>(
		basePath: string,
		characterId: string,
		watermark?: { maxId: string | null; maxDate: Date | string | null },
		options?: { cacheMode?: 'default' | 'no-store' }
	): Promise<{
		data: T[]
		pages: number
		pagesFetched: number
		stoppedAtWatermark: boolean
	}> {
		if (!watermark?.maxId) {
			const result = await this.fetchEsiAllPages<T>(basePath, characterId, options)
			return {
				...result,
				pagesFetched: result.pages,
				stoppedAtWatermark: false,
			}
		}

		const cleanPath = basePath.replace(/[?&]page=\d+/, '')
		const separator = cleanPath.includes('?') ? '&' : '?'
		const totalPagesResponse = await this.fetchEsi<T[]>(
			`${cleanPath}${separator}page=1`,
			characterId,
			options
		)
		const totalPages = totalPagesResponse.pages ?? 1
		const entries = [...totalPagesResponse.data]
		let pagesFetched = 1
		let stoppedAtWatermark = false
		let watermarkSeen = false
		const maxDate = parseDateOrNull(watermark.maxDate)

		const compareNumericIds = (left: string, right: string): number => {
			try {
				const leftValue = BigInt(left)
				const rightValue = BigInt(right)
				return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1
			} catch {
				return left.localeCompare(right, 'en')
			}
		}

		const hasRowsAtOrBeyondWatermark = (pageEntries: T[]): boolean =>
			pageEntries.some((entry) => {
				const entryId = String(entry.id)
				if (entryId === watermark.maxId) return false
				if (compareNumericIds(entryId, watermark.maxId!) > 0) return true
				const entryDate = parseDateOrNull(entry.date)
				return maxDate !== null && entryDate !== null && entryDate >= maxDate
			})

		const inspectPage = (pageEntries: T[]): boolean => {
			if (pageEntries.some((entry) => String(entry.id) === watermark.maxId)) {
				watermarkSeen = true
			}
			return watermarkSeen && !hasRowsAtOrBeyondWatermark(pageEntries)
		}

		if (inspectPage(totalPagesResponse.data)) {
			stoppedAtWatermark = true
		} else {
			for (let page = 2; page <= totalPages; page += 1) {
				const response = await this.fetchEsi<T[]>(
					`${cleanPath}${separator}page=${page}`,
					characterId,
					options
				)
				pagesFetched += 1
				entries.push(...response.data)

				if (inspectPage(response.data)) {
					stoppedAtWatermark = true
					break
				}
			}
		}

		return {
			data: entries,
			pages: totalPages,
			pagesFetched,
			stoppedAtWatermark,
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
	}> {
		const maxConcurrent = options?.maxConcurrent ?? 5

		// Remove any existing page parameter from basePath
		const cleanPath = basePath.replace(/[?&]page=\d+/, '')
		const separator = cleanPath.includes('?') ? '&' : '?'

		// Fetch first page to get total page count
		const firstPagePath = `${cleanPath}${separator}page=1`
		const firstResponse = await this.fetchPublicEsi<T[]>(firstPagePath)

		const totalPages = firstResponse.pages ?? 1
		// If there's only one page, return early
		if (totalPages === 1) {
			return {
				data: firstResponse.data,
				pages: totalPages,
			}
		}

		// Fetch remaining pages with concurrency limit
		const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
		const fetchPage = async (pageNum: number): Promise<EsiResponse<T[]>> => {
			const pagePath = `${cleanPath}${separator}page=${pageNum}`
			return this.fetchPublicEsi<T[]>(pagePath)
		}

		// Fetch with concurrency control
		const remainingResponses: Array<EsiResponse<T[]>> = []
		for (let i = 0; i < remainingPages.length; i += maxConcurrent) {
			const batch = remainingPages.slice(i, i + maxConcurrent)
			const batchResponses = await Promise.all(batch.map(fetchPage))
			remainingResponses.push(...batchResponses)
		}

		// Combine all data from all pages
		const allData = [
			...firstResponse.data,
			...remainingResponses.flatMap((response) => response.data),
		]

		return {
			data: allData,
			pages: totalPages,
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
		const maxConcurrent = options?.maxConcurrent ?? 1

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

			cancel(_reason) {
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
		const resolver = getStub<EsiTypeResolverHelperStub>(this.env.ESI_TYPE_RESOLVER, 'default')
		return await withRpcResult(resolver.resolveNames(names), (nameMap) => ({ ...nameMap }))
	}

	/**
	 * Resolve multiple entity IDs to names using ESI bulk endpoint
	 */
	async resolveIds(ids: string[]): Promise<Record<string, string>> {
		const resolver = getStub<EsiTypeResolverHelperStub>(this.env.ESI_TYPE_RESOLVER, 'default')
		return await withRpcResult(resolver.resolveIds(ids), (nameMap) => ({ ...nameMap }))
	}

	/**
	 * Search for a character by name using ESI search endpoint
	 */
	async searchCharacter(characterName: string, strict = true): Promise<string[]> {
		if (!characterName.trim()) {
			return []
		}

		const tokens = await this.db.query.eveTokens.findMany({
			limit: 1,
		})
		if (tokens.length === 0) {
			logger.warn('No character tokens available for ESI search')
			return []
		}

		const esiStub = getStub<EsiHelperStub>(this.env.ESI, 'default')
		return await withRpcResult(
			esiStub.searchCharacter(tokens[0].characterId, characterName, strict),
			(characterIds) => [...characterIds]
		)
	}

	/**
	 * Alarm handler - automatically refresh tokens that are expiring soon
	 */
	async alarm(): Promise<void> {
		let processedBatchSize = 0
		try {
			const now = new Date()
			const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000)

			// Process a bounded batch so one alarm cannot build an unbounded queue of
			// Durable Object storage operations when many tokens expire together.
			const expiringTokens = await this.db
				.select({ characterId: eveCharacters.characterId })
				.from(eveTokens)
				.innerJoin(eveCharacters, eq(eveTokens.characterId, eveCharacters.id))
				.where(
					and(
						gt(eveTokens.expiresAt, now),
						lte(eveTokens.expiresAt, fiveMinutesFromNow),
						isNull(eveCharacters.deletedAt),
						isNull(eveTokens.permanentInvalidAt),
						or(isNull(eveTokens.nextRetryAt), lte(eveTokens.nextRetryAt, now))
					)
				)
				.orderBy(asc(eveTokens.expiresAt))
				.limit(TOKEN_REFRESH_ALARM_BATCH_SIZE)

			processedBatchSize = expiringTokens.length

			// Refresh each token
			for (const { characterId } of expiringTokens) {
				await this.refreshToken(characterId)
			}
		} catch (error) {
			logger.error(error)
		}

		const nextAlarmDelayMs =
			processedBatchSize === TOKEN_REFRESH_ALARM_BATCH_SIZE
				? TOKEN_REFRESH_ALARM_CONTINUE_DELAY_MS
				: TOKEN_REFRESH_ALARM_INTERVAL_MS
		await this.scheduleRefreshAlarm(nextAlarmDelayMs, 'alarm')
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
			logger.withTags({ operation: 'verifyToken' }).error('Invalid "sub" claim value', { sub })
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
			const errorMessage = error instanceof Error ? error.message : String(error)
			const wrappedError = new Error(`Token decryption failed: ${errorMessage}`)
			logger.withTags({ operation: 'decrypt' }).error('Decryption failed', wrappedError)
			throw wrappedError
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
	private static readonly MAX_CACHE_TTL_SECONDS = 12 * 60 * 60
	private static readonly PUBLIC_CACHE_SCOPE: EsiCacheScopeContext = {
		scope: 'public',
		scopeId: 'public',
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
	 * Get the characters that should be included in the daily ESI data sync.
	 * The daily cron already provides the cadence, so this returns all active
	 * characters without filtering on prior sync timestamps.
	 */
	async getCharactersNeedingDataSync(limit?: number): Promise<string[]> {
		const whereClause = isNull(eveCharacters.deletedAt)

		const characters =
			typeof limit === 'number' && limit > 0
				? await this.db.query.eveCharacters.findMany({
						where: whereClause,
						orderBy: (table) => [asc(table.characterId)],
						limit,
					})
				: await this.db.query.eveCharacters.findMany({
						where: whereClause,
						orderBy: (table) => [asc(table.characterId)],
					})

		return characters.map((c) => c.characterId)
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
