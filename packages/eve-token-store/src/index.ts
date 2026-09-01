/**
 * @repo/eve-token-store
 *
 * Shared types and interfaces for the EveTokenStore Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { createRemoteJWKSet } from 'jose'
import type { EveCharacterId } from '@repo/eve-types'

/**
 * Canonical full EVE SSO scope set used for character attachment and token
 * health validation.
 *
 * Callers that only need a narrower permission set should pass an explicit
 * subset to `validateToken(...)`.
 */
export const EVE_SSO_SCOPES_ALL = [
	'publicData',
	'esi-access.read_lists.v1',
	// 'esi-activities.read_character.v1',
	'esi-calendar.respond_calendar_events.v1',
	'esi-calendar.read_calendar_events.v1',
	'esi-location.read_location.v1',
	'esi-location.read_ship_type.v1',
	'esi-mail.read_mail.v1',
	'esi-skills.read_skills.v1',
	'esi-skills.read_skillqueue.v1',
	'esi-wallet.read_character_wallet.v1',
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
	'esi-characters.read_medals.v1',
	'esi-characters.read_standings.v1',
	'esi-characters.read_agents_research.v1',
	// 'esi-characters.read_freelance_jobs.v1',
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
	// 'esi-corporations.read_freelance_jobs.v1',
	'esi-industry.read_character_mining.v1',
	'esi-industry.read_corporation_mining.v1',
	// 'esi-mail.organize_mail.v1',
	// 'esi-mail.send_mail.v1',
	'esi-planets.read_customs_offices.v1',
	'esi-corporations.read_facilities.v1',
	'esi-corporations.read_medals.v1',
	'esi-characters.read_titles.v1',
	'esi-alliances.read_contacts.v1',
	'esi-characters.read_fw_stats.v1',
	'esi-corporations.read_fw_stats.v1',
	'esi-structures.read_character.v1',
	'esi-structures.read_corporation.v1',
	'esi-corporations.read_projects.v1',
] as const

/**
 * Minimal scope set for identification-only flows (e.g. Mumble temp-op guests).
 * Yields character id + name with no ESI data access.
 */
export const EVE_SSO_SCOPES_PUBLIC_ONLY = ['publicData'] as const

/**
 * Compute the scopes missing from a granted scope set.
 */
export function getMissingScopes(
	grantedScopes: readonly string[],
	requiredScopes: readonly string[] = EVE_SSO_SCOPES_ALL
): string[] {
	return requiredScopes.filter((scope) => !grantedScopes.includes(scope))
}

/**
 * Check whether a granted scope set covers the required scope set.
 */
export function hasAllScopes(
	grantedScopes: readonly string[],
	requiredScopes: readonly string[] = EVE_SSO_SCOPES_ALL
): boolean {
	return getMissingScopes(grantedScopes, requiredScopes).length === 0
}

/**
 * EVE Online SSO OAuth Types
 */

/**
 * Response from EVE SSO verify endpoint
 * https://login.eveonline.com/oauth/verify
 */
export interface EveVerifyResponse {
	/** EVE character ID */
	CharacterID: string
	/** EVE character name */
	CharacterName: string
	/** Token expiration time (ISO 8601) */
	ExpiresOn: string
	/** Array of granted scopes */
	Scopes: string
	/** Token type (usually "Character") */
	TokenType: string
	/** Unique hash for character + owner combination. Changes if character transfers to new account */
	CharacterOwnerHash: string
	/** Intellectual property notice */
	IntellectualProperty: string
}

/**
 * Response from EVE SSO token endpoint
 * https://login.eveonline.com/v2/oauth/token
 */
export interface EveTokenResponse {
	/** OAuth access token */
	access_token: string
	/** Seconds until token expires */
	expires_in: number
	/** OAuth token type (Bearer) */
	token_type: string
	/** OAuth refresh token (if available) */
	refresh_token?: string
}

/**
 * Response from the EVE OAuth metadata well-known endpoint
 */
export type EveMetadata = {
	issuer: string
	jwks_uri: string
}

/**
 * EVE OAuth Metadata Cache
 */
export type CachedEveMetadata = EveMetadata & {
	fetchedAt: number
	expiresAt: number
}

/**
 * EVE OAuth JWKS config
 */
export type EveJwksResult = {
	metadata: CachedEveMetadata
	jwks: ReturnType<typeof createRemoteJWKSet>
}

/**
 * Authorization URL response for starting OAuth flow
 */
export interface AuthorizationUrlResponse {
	/** Full authorization URL to redirect user to */
	url: string
	/** State parameter for CSRF protection */
	state: string
}

/**
 * Result of verifying a minimal publicData OAuth callback.
 * Returns the verified character identity, or an error message — no token is
 * persisted and no eveCharacters row is created (fully ephemeral).
 */
export type PublicDataVerifyResult =
	| { characterId: string; characterName: string }
	| { error: string }

/**
 * Stored token data with character information
 */
export interface StoredToken {
	/** Database ID */
	id: string
	/** EVE character ID */
	characterId: string
	/** EVE character name */
	characterName: string
	/** Character owner hash (unique per character+account) */
	characterOwnerHash: string
	/** Encrypted access token */
	accessToken: string
	/** Encrypted refresh token */
	refreshToken: string | null
	/** Token expiration timestamp */
	expiresAt: Date
	/** Granted scopes as array */
	scopes: string[]
	/** When the record was created */
	createdAt: Date
	/** When the record was last updated */
	updatedAt: Date
}

/**
 * Token data suitable for external use (without sensitive fields)
 */
export interface TokenInfo {
	/** EVE character ID */
	characterId: string
	/** EVE character name */
	characterName: string
	/** Character owner hash */
	characterOwnerHash: string
	/** Token expiration timestamp */
	expiresAt: Date
	/** Granted scopes */
	scopes: string[]
	/** Whether token is expired */
	isExpired: boolean
	/** Whether a refresh token is available for recovery */
	hasRefreshToken: boolean
}

/**
 * A decrypted access token for a character selected by a trusted internal
 * integration. This capability must not be exposed to browser-facing routes.
 */
export interface DecryptedAccessToken {
	characterId: string
	accessToken: string
	expiresAt: string
}

/**
 * Token validation outcome for refresh and auth-sensitive workflows.
 *
 * This is intentionally aligned to SSO/token state rather than success of a
 * particular ESI gameplay endpoint.
 */
export type TokenValidationStatus =
	| 'valid'
	| 'token_missing'
	| 'character_deleted'
	| 'missing_scopes'
	| 'invalid_token'
	| 'permanent_invalid'
	| 'transient_error'

/**
 * Token refresh outcome for consumers that need to distinguish retryable
 * refresh failures from hard token invalidation.
 */
export type TokenRefreshStatus =
	| 'refreshed'
	| 'token_missing'
	| 'character_deleted'
	| 'invalid_token'
	| 'permanent_invalid'
	| 'transient_error'

/**
 * Structured refresh result.
 */
export interface TokenRefreshResult {
	/** Character ID being refreshed */
	characterId: string
	/** Whether the refresh completed successfully */
	success: boolean
	/** High-level refresh outcome */
	status: TokenRefreshStatus
	/** Optional diagnostic message */
	error?: string
}

/**
 * Structured token validation result.
 */
export interface TokenValidationResult {
	/** High-level validation outcome */
	status: TokenValidationStatus
	/** True when the character token is currently suitable for the requested scopes */
	isValid: boolean
	/** Character ID being validated */
	characterId: string
	/** Required scopes that were missing, if any */
	missingScopes: string[]
	/** Scopes currently associated with the token */
	scopes: string[]
	/** Whether token refresh was attempted */
	refreshAttempted: boolean
	/** Whether token refresh succeeded */
	refreshSucceeded: boolean
	/** Optional diagnostic message */
	error?: string
}

/**
 * Result of handling OAuth callback
 */
export interface CallbackResult {
	/** Whether the callback was successful */
	success: boolean
	/** Character ID if successful */
	characterId?: string
	/** Character info if successful */
	characterInfo?: {
		characterId: string
		characterName: string
		characterOwnerHash: string
		scopes: string[]
	}
	/** Error message if failed */
	error?: string
}

/**
 * Public RPC interface for EveTokenStore Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import { getStub } from '@repo/do-utils'
 * import type { EveTokenStore } from '@repo/eve-token-store'
 *
 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
 *
 * // Start login flow
 * const authUrl = await stub.startLoginFlow()
 * // Redirect user to authUrl.url
 * ```
 */
export interface EveTokenStore {
	/**
	 * Start OAuth flow for login (publicData scope only)
	 * @param state - Optional state parameter for CSRF protection
	 * @returns Authorization URL and state
	 */
	startLoginFlow(state?: string): Promise<AuthorizationUrlResponse>

	/**
	 * Start OAuth flow for character attachment (all scopes)
	 * @param state - Optional state parameter for CSRF protection
	 * @returns Authorization URL and state
	 */
	startCharacterFlow(state?: string): Promise<AuthorizationUrlResponse>

	/**
	 * Start a minimal identification-only OAuth flow (publicData scope).
	 * Used by ephemeral flows such as Mumble temp-op guests where we only need
	 * the character's id + name for display, never ESI data or a stored token.
	 * @param state - Optional state parameter for CSRF protection
	 * @returns Authorization URL and state
	 */
	startPublicDataFlow(state?: string): Promise<AuthorizationUrlResponse>

	/**
	 * Verify a publicData OAuth callback without persisting anything.
	 * Exchanges the code, verifies the JWT, and returns the character identity.
	 * Does NOT store a token or create an eveCharacters row.
	 * @param code - Authorization code from EVE SSO
	 * @returns Verified character identity, or an error
	 */
	verifyPublicDataCallback(code: string): Promise<PublicDataVerifyResult>

	/**
	 * Handle OAuth callback - exchange code for tokens and store them
	 * @param code - Authorization code from EVE SSO
	 * @param state - State parameter for CSRF validation
	 * @returns Result with character information or error
	 */
	handleCallback(code: string, state?: string): Promise<CallbackResult>

	/**
	 * Manually refresh a token
	 * @param characterId - EVE character ID
	 * @returns Whether refresh was successful
	 */
	refreshToken(characterId: string): Promise<boolean>

	/**
	 * Refresh a token and return a structured outcome.
	 * @param characterId - EVE character ID
	 * @returns Refresh outcome with retryability information
	 */
	refreshTokenWithResult(characterId: string): Promise<TokenRefreshResult>

	/**
	 * Get token information (without actual token values)
	 * @param characterId - EVE character ID
	 * @returns Token info or null if not found
	 */
	getTokenInfo(characterId: string): Promise<TokenInfo | null>

	/**
	 * Resolve currently usable access tokens for a trusted internal integration.
	 * Token-store owns warm-cache lookup, safety-margin refresh, and decryption;
	 * callers must authenticate the downstream request before returning values.
	 */
	getAccessTokensForIntegration(characterIds: string[]): Promise<DecryptedAccessToken[]>

	/**
	 * Validate that a character token is present, refreshable/verifiable, and
	 * carries the required scopes for a downstream workflow.
	 * @param characterId - EVE character ID
	 * @param requiredScopes - Scopes required by the caller
	 * @returns Structured token validity result
	 */
	validateToken(
		characterId: string,
		requiredScopes?: readonly string[],
		options?: { force?: boolean }
	): Promise<TokenValidationResult>

	/**
	 * Get access token for use (decrypted)
	 * @param characterId - EVE character ID
	 * @returns Access token or null if not found/expired
	 */
	getAccessToken(characterId: string): Promise<string | null>

	/**
	 * Determine whether an access token can be issued without exposing token
	 * material to the caller. This may refresh a token inside the safety margin.
	 */
	hasUsableAccessToken(characterId: string): Promise<boolean>

	/**
	 * Revoke and delete a token
	 * @param characterId - EVE character ID
	 * @returns Whether revocation was successful
	 */
	revokeToken(characterId: string): Promise<boolean>

	/**
	 * Mark a character as deleted (soft delete)
	 * Called when ESI returns "Character has been deleted!" (biomassed or removed by CCP).
	 * Unlike revokeToken, this preserves the record for audit purposes.
	 *
	 * @param characterId - EVE character ID
	 * @returns true if character was marked as deleted, false if not found
	 */
	markCharacterDeleted(characterId: string): Promise<boolean>

	/**
	 * List all tokens stored in the system
	 * @returns Array of token information
	 */
	listTokens(): Promise<TokenInfo[]>

	/**
	 * Select a non-deleted, refreshable character that can authorize an ESI
	 * character-search request. This exposes token lifecycle state only; callers
	 * perform the ESI request through the shared ESI service.
	 */
	getCharacterSearchAccessCharacterId(): Promise<string | null>

	/**
	 * Get a batch of characters to refresh
	 * @param batchSize - The number of characters to refresh
	 * @returns An array of character IDs
	 */
	getRefreshCharacterBatch(batchSize?: number): Promise<EveCharacterId[]>

	/**
	 * Get a batch of characters whose ESI data needs a full sync.
	 * Returns characters not synced in the last 20 hours, skipping any
	 * with a sync attempt within the last hour.
	 */
	getCharactersNeedingDataSync(limit?: number): Promise<string[]>

	/**
	 * Mark a character's ESI data sync as successfully completed.
	 */
	markCharacterDataSyncComplete(characterId: string): Promise<void>
}
