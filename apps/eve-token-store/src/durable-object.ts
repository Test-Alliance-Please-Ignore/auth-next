import { DurableObject } from 'cloudflare:workers'
import { createRemoteJWKSet, jwtVerify } from 'jose'

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from '@repo/db-utils'
import {
	EVE_SSO_SCOPES_ALL,
	EVE_SSO_SCOPES_PUBLIC_ONLY,
	getMissingScopes,
	hasAllScopes,
} from '@repo/eve-token-store'
import { logger, toErrorLogDetails } from '@repo/hono-helpers'

import { createDb } from './db'
import { eveCharacters, eveTokens } from './db/schema'
import {
	ACCESS_TOKEN_CACHE_CLEANUP_INTERVAL_MS,
	getExpiredAccessTokenCutoff,
	isWarmAccessTokenUsable,
} from './lib/access-token-cache'
import { runSingleFlight } from './lib/async-single-flight'
import {
	classifySsoError,
	isPermanentRefreshFailure,
	isPermanentTokenDecryptionFailure,
	isRefreshBackstopExpired,
	shouldForcePermanentByInvalidAge,
} from './lib/token-health'

import type {
	AuthorizationUrlResponse,
	CachedEveMetadata,
	CallbackResult,
	DecryptedRefreshToken,
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

/**
 * EVE SSO OAuth Endpoints
 */
const EVE_SSO_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize'
const EVE_SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token'
const EVE_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const EVE_SSO_JWKS_FALLBACK_URL = 'https://login.eveonline.com/oauth/jwks'
const METADATA_TTL_MS = 5 * 60 * 1000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const TOKEN_REFRESH_COOLDOWN_PREFIX = 'token:refresh:cooldown:'
const TOKEN_REFRESH_TRANSIENT_COOLDOWN_MS = 5 * 60 * 1000

async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
	try {
		return (await response.json()) as T
	} catch (error) {
		throw new Error(`Failed to parse ${context}`, { cause: error })
	}
}

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
 * - Demand-driven access-token refresh with encrypted local warm-token cache
 * - RPC methods for remote calls
 */
export class EveTokenStoreDO extends DurableObject<Env> implements EveTokenStore {
	private db: ReturnType<typeof createDb>
	private jwks: ReturnType<typeof createRemoteJWKSet> | null = null
	private jwksUri: string | null = null
	private metadata: CachedEveMetadata | null = null
	private readonly refreshInFlight = new Map<string, Promise<TokenRefreshResult>>()
	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		// Token lifecycle work is short-lived. Neon HTTP avoids pinning the DO with
		// a websocket connection after requests complete.
		this.db = createDb(env, env.DATABASE_URL, false)
		// Load cached metadata from DO storage once on startup.
		void state.blockConcurrencyWhile(async () => {
			this.metadata = (await state.storage.get<CachedEveMetadata>('eve:oauth:metadata')) ?? null

			if (this.metadata) {
				this.jwksUri = this.metadata.jwks_uri
				this.jwks = createRemoteJWKSet(new URL(this.metadata.jwks_uri))
			}

			// The warm access-token cache avoids a Neon round trip after hibernation.
			await this.initializeAccessTokenCache()

			// The only recurring alarm performs bounded expiry cleanup. Access tokens refresh
			// on demand, so dormant characters no longer wake this singleton.
			if ((await state.storage.getAlarm()) === null) {
				await this.scheduleMaintenanceAlarm(ACCESS_TOKEN_CACHE_CLEANUP_INTERVAL_MS, 'constructor')
			}
		})
	}

	private async scheduleMaintenanceAlarm(delayMs: number, source: string): Promise<void> {
		try {
			await this.state.storage.setAlarm(Date.now() + delayMs)
		} catch (error) {
			// A relocation can make the current isolate's storage handle invalid. Re-throw
			// so Cloudflare retries the alarm on the object's new machine.
			logger
				.withTags({ operation: 'scheduleMaintenanceAlarm', source })
				.warn('Failed to schedule token-cache maintenance alarm; allowing platform retry', {
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

			const json = await parseJsonResponse<EveMetadata>(res, 'EVE SSO metadata response')

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

	private async persistRefreshFailureTokenUpdate(
		characterId: string,
		tokenId: string,
		updates: Partial<typeof eveTokens.$inferInsert>,
		originalError: string
	): Promise<void> {
		try {
			await this.db.update(eveTokens).set(updates).where(eq(eveTokens.id, tokenId))
		} catch (error) {
			logger
				.withTags({ operation: 'refreshToken', characterId })
				.warn('Failed to persist token state after refresh failure', {
					originalError,
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
	 * Initialize the encrypted, short-lived access-token cache.
	 */
	private async initializeAccessTokenCache(): Promise<void> {
		try {
			// Access tokens are encrypted before entering this cache. The cache is a
			// bounded warm layer over Neon, not an authority: expiry and refresh-token
			// rotation always remain in the primary database.
			await this.state.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS access_token_cache (
					character_id TEXT PRIMARY KEY,
					encrypted_access_token TEXT NOT NULL,
					expires_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				)
			`)
			await this.state.storage.sql.exec(`
				CREATE INDEX IF NOT EXISTS idx_access_token_cache_expires
				ON access_token_cache(expires_at)
			`)
		} catch (error) {
			logger
				.withTags({ operation: 'initializeAccessTokenCache' })
				.error('Failed to initialize access-token cache', error)
			throw error
		}
	}

	private async getWarmAccessToken(characterId: string): Promise<string | null> {
		try {
			const rows = [
				...this.state.storage.sql.exec<{
					encrypted_access_token: string
					expires_at: number
				}>(
					`SELECT encrypted_access_token, expires_at
					 FROM access_token_cache
					 WHERE character_id = ?`,
					characterId
				),
			]
			const cached = rows[0]
			if (!cached || !isWarmAccessTokenUsable(cached.expires_at)) {
				return null
			}

			return await this.decrypt(cached.encrypted_access_token)
		} catch (error) {
			logger
				.withTags({ operation: 'getWarmAccessToken', characterId })
				.warn('Failed to read warm access token; falling back to Neon', {
					error: error instanceof Error ? error.message : String(error),
					errorDetails: toErrorLogDetails(error),
				})
			return null
		}
	}

	private async cacheAccessToken(
		characterId: string,
		encryptedAccessToken: string,
		expiresAt: Date
	): Promise<void> {
		try {
			await this.state.storage.sql.exec(
				`INSERT OR REPLACE INTO access_token_cache
					(character_id, encrypted_access_token, expires_at, updated_at)
				 VALUES (?, ?, ?, ?)`,
				characterId,
				encryptedAccessToken,
				expiresAt.getTime(),
				Date.now()
			)
		} catch (error) {
			logger
				.withTags({ operation: 'cacheAccessToken', characterId })
				.warn('Failed to cache warm access token', {
					error: error instanceof Error ? error.message : String(error),
					errorDetails: toErrorLogDetails(error),
				})
		}
	}

	private async removeWarmAccessToken(characterId: string): Promise<void> {
		try {
			await this.state.storage.sql.exec(
				`DELETE FROM access_token_cache WHERE character_id = ?`,
				characterId
			)
		} catch (error) {
			logger
				.withTags({ operation: 'removeWarmAccessToken', characterId })
				.warn('Failed to remove warm access token', {
					error: error instanceof Error ? error.message : String(error),
					errorDetails: toErrorLogDetails(error),
				})
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
		return runSingleFlight(this.refreshInFlight, String(characterId), () =>
			this.performRefreshTokenWithResult(characterId)
		)
	}

	private async performRefreshTokenWithResult(characterId: string): Promise<TokenRefreshResult> {
		let tokenRecord: typeof eveTokens.$inferSelect | null = null
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
			tokenRecord =
				(await this.db.query.eveTokens.findFirst({
					where: eq(eveTokens.characterId, character.id),
				})) ?? null

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
			await this.cacheAccessToken(characterId, encryptedAccessToken, expiresAt)
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
				if (tokenRecord) {
					await this.persistRefreshFailureTokenUpdate(
						characterId,
						tokenRecord.id,
						{
							invalidSince: new Date(),
							lastValidationAt: new Date(),
							lastValidationStatus: 'permanent_invalid',
							nextRetryAt: null,
							permanentInvalidAt: new Date(),
							permanentInvalidReason: message,
							updatedAt: new Date(),
						},
						message
					)
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
				if (tokenRecord) {
					await this.persistRefreshFailureTokenUpdate(
						characterId,
						tokenRecord.id,
						{
							refreshToken: null,
							invalidSince: new Date(),
							lastValidationAt: new Date(),
							lastValidationStatus: 'permanent_invalid',
							nextRetryAt: null,
							permanentInvalidAt: new Date(),
							permanentInvalidReason: message,
							updatedAt: new Date(),
						},
						message
					)
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
			if (tokenRecord) {
				tokenState = {
					expiresAt: tokenRecord.expiresAt.toISOString(),
					hasRefreshToken: Boolean(tokenRecord.refreshToken),
					invalidSince: tokenRecord.invalidSince?.toISOString() ?? null,
					lastValidationStatus: tokenRecord.lastValidationStatus,
					nextRetryAt: tokenRecord.nextRetryAt?.toISOString() ?? null,
					permanentInvalidAt: tokenRecord.permanentInvalidAt?.toISOString() ?? null,
					permanentInvalidReason: tokenRecord.permanentInvalidReason ?? null,
				}
				await this.persistRefreshFailureTokenUpdate(
					characterId,
					tokenRecord.id,
					{
						invalidSince: tokenRecord.invalidSince ?? new Date(),
						lastValidationAt: new Date(),
						lastValidationStatus: 'transient_error',
						nextRetryAt: new Date(Date.now() + TOKEN_REFRESH_TRANSIENT_COOLDOWN_MS),
						updatedAt: new Date(),
					},
					message
				)
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
	 * Resolve a bounded batch of refresh tokens for a trusted internal
	 * integration. The database stores encrypted values; plaintext never leaves
	 * this method except through the explicitly authorized RPC caller.
	 */
	async getRefreshTokensForIntegration(characterIds: string[]): Promise<DecryptedRefreshToken[]> {
		const uniqueCharacterIds = [...new Set(characterIds.map((characterId) => String(characterId)))]
		if (uniqueCharacterIds.length === 0) return []
		if (uniqueCharacterIds.length > 100) {
			throw new Error('Refresh token lookup is limited to 100 characters per request')
		}

		const rows = await this.db
			.select({
				characterId: eveCharacters.characterId,
				refreshToken: eveTokens.refreshToken,
			})
			.from(eveCharacters)
			.innerJoin(eveTokens, eq(eveTokens.characterId, eveCharacters.id))
			.where(
				and(
					inArray(eveCharacters.characterId, uniqueCharacterIds),
					isNull(eveCharacters.deletedAt),
					isNotNull(eveTokens.refreshToken),
					isNull(eveTokens.invalidSince),
					isNull(eveTokens.permanentInvalidAt)
				)
			)
			.orderBy(desc(eveTokens.updatedAt), asc(eveTokens.id))

		const resolvedByCharacterId = new Map<string, DecryptedRefreshToken>()
		for (const row of rows) {
			if (!row.refreshToken || resolvedByCharacterId.has(row.characterId)) continue
			try {
				resolvedByCharacterId.set(row.characterId, {
					characterId: row.characterId,
					refreshToken: await this.decrypt(row.refreshToken),
				})
			} catch (error) {
				logger
					.withTags({ operation: 'getRefreshTokensForIntegration', characterId: row.characterId })
					.error('Failed to decrypt refresh token for internal integration', {
						error: error instanceof Error ? error.message : String(error),
					})
			}
		}

		return [...resolvedByCharacterId.values()]
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

	async hasUsableAccessToken(characterId: string): Promise<boolean> {
		return (await this.getAccessTokenResult(characterId)).status === 'ok'
	}

	/**
	 * Internal access-token lookup that preserves retryable refresh failures so
	 * authenticated callers can distinguish transient outages from hard auth loss.
	 */
	private async getAccessTokenResult(characterId: string): Promise<AccessTokenLookupResult> {
		try {
			const warmAccessToken = await this.getWarmAccessToken(characterId)
			if (warmAccessToken) {
				return {
					status: 'ok',
					accessToken: warmAccessToken,
				}
			}

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
			const requiresRefresh = !isWarmAccessTokenUsable(
				tokenRecord.expiresAt.getTime(),
				now.getTime()
			)

			if (requiresRefresh) {
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

			await this.cacheAccessToken(characterId, tokenRecord.accessToken, tokenRecord.expiresAt)
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
			await this.removeWarmAccessToken(characterId)

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
			await this.removeWarmAccessToken(characterId)

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

	async getCharacterSearchAccessCharacterId(): Promise<string | null> {
		const [candidate] = await this.db
			.select({ characterId: eveCharacters.characterId })
			.from(eveCharacters)
			.innerJoin(eveTokens, eq(eveTokens.characterId, eveCharacters.id))
			.where(
				and(
					isNull(eveCharacters.deletedAt),
					isNotNull(eveTokens.refreshToken),
					isNull(eveTokens.permanentInvalidAt)
				)
			)
			.orderBy(desc(eveTokens.updatedAt))
			.limit(1)

		return candidate?.characterId ?? null
	}

	/**
	 * Hourly bounded maintenance only. Access-token refresh is demand-driven so
	 * inactive characters do not keep the token-store DO awake.
	 */
	async alarm(): Promise<void> {
		try {
			await this.state.storage.sql.exec(
				`DELETE FROM access_token_cache WHERE expires_at <= ?`,
				getExpiredAccessTokenCutoff()
			)
		} catch (error) {
			logger.withTags({ operation: 'alarm' }).warn('Token-cache maintenance failed', {
				error: error instanceof Error ? error.message : String(error),
				errorDetails: toErrorLogDetails(error),
			})
		}

		await this.scheduleMaintenanceAlarm(ACCESS_TOKEN_CACHE_CLEANUP_INTERVAL_MS, 'alarm')
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

		await this.cacheAccessToken(characterId, encryptedAccessToken, expiresAt)
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
