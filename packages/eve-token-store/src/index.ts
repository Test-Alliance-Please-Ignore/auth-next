/**
 * @repo/eve-token-store
 *
 * Shared types and interfaces for the EveTokenStore Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import { createRemoteJWKSet } from 'jose'
import * as z4 from 'zod/v4/core'

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
 * Response from ESI with cache metadata
 */
export interface EsiResponse<T> {
	/** The response data from ESI */
	data: T
	/** Whether this response came from cache */
	cached: boolean
	/** When the cached response expires */
	expiresAt: Date
	/** ETag header from ESI for conditional requests */
	etag?: string
	/** Total number of pages (from X-Pages header) */
	pages?: number
	/** Current page number (from URL parameter) */
	page?: number
}

/**
 * ESI Corporation Response
 * https://esi.evetech.net/ui/#/Corporation/get_corporations_corporation_id
 */
export interface EsiCorporation {
	/** Corporation ID */
	corporation_id: string
	/** Corporation name */
	name: string
	/** Corporation ticker */
	ticker: string
	/** CEO character ID */
	ceo_id: string
	/** Alliance ID (if in alliance) */
	alliance_id?: string
	/** Corporation description */
	description?: string
	/** Member count */
	member_count: number
	/** Tax rate */
	tax_rate: number
	/** Creation date */
	date_founded?: string
	/** Creator character ID */
	creator_id: string
	/** Home station ID */
	home_station_id?: string
	/** Shares */
	shares?: number
	/** URL */
	url?: string
	/** War eligible */
	war_eligible?: boolean
}

/**
 * ESI Alliance Response
 * https://esi.evetech.net/ui/#/Alliance/get_alliances_alliance_id
 */
export interface EsiAlliance {
	/** Alliance ID */
	alliance_id: string
	/** Alliance name */
	name: string
	/** Alliance ticker */
	ticker: string
	/** Executor corporation ID */
	executor_corporation_id: string
	/** Creator corporation ID */
	creator_corporation_id: string
	/** Creator character ID */
	creator_id: string
	/** Date founded */
	date_founded: string
	/** Faction ID (if factional warfare alliance) */
	faction_id?: string
}

/**
 * Character Affiliation response entry.
 *
 * This matches the normalized contract we expose to callers and keeps the
 * affiliation shape consistent with the rest of the codebase that consumes it.
 */
export interface EsiCharacterAffiliation {
	/** Character ID */
	character_id: number
	/** Corporation ID */
	corporation_id: number
	/** Alliance ID (if in alliance) */
	alliance_id?: number
	/** Faction ID (if in faction warfare) */
	faction_id?: number
}

/**
 * Entity name/ID pair for bulk resolution
 */
export interface EntityNameInfo {
	/** Entity ID */
	id: string
	/** Entity name */
	name: string
	/** Entity category (alliance, character, corporation, etc.) */
	category: string
}

/**
 * Public RPC interface for EveTokenStore Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { EveTokenStore } from '@repo/eve-token-store'
 *
 * // Get the Durable Object stub
 * const id = env.EVE_TOKEN_STORE.idFromName('default')
 * const stub = env.EVE_TOKEN_STORE.get(id) as DurableObjectStub<EveTokenStore>
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
	 * Fetch data from ESI for this character (ESI Gateway)
	 * Automatically handles authentication if token is available for the character
	 * Caches responses according to ESI cache headers
	 *
	 * @param path - ESI path (e.g., '/characters/{character_id}/skills')
	 * @param characterId - Character ID (used for authentication and path interpolation)
	 * @returns ESI response with cache metadata
	 *
	 * @example
	 * ```ts
	 * const tokenStoreId = env.EVE_TOKEN_STORE.idFromString(characterId.toString())
	 * const stub = env.EVE_TOKEN_STORE.get(tokenStoreId)
	 * const response = await stub.fetchEsi<EsiCharacterSkills>(
	 *   `/characters/${characterId}/skills`,
	 *   characterId
	 * )
	 * ```
	 */
	fetchEsi<T>(path: string, characterId: string): Promise<EsiResponse<T>>
	fetchEsi<T>(
		path: string,
		characterId: string,
		options?: { cacheMode?: 'default' | 'no-store' }
	): Promise<EsiResponse<T>>

	/**
	 * Fetch data from ESI for this character (ESI Gateway) with a schema
	 * Automatically handles authentication if token is available for the character
	 * Caches responses according to ESI cache headers
	 *
	 * @param path - ESI path (e.g., '/characters/{character_id}/skills')
	 * @param characterId - Character ID (used for authentication and path interpolation)
	 * @param schema - Zod schema to parse the response data
	 * @returns ESI response with cache metadata
	 **/
	fetchEsiWithSchema<S extends z4.$ZodType>(
		path: string,
		characterId: string,
		schema: S
	): Promise<EsiResponse<z4.output<S>>>

	/**
	 * Fetch public data from ESI (unauthenticated ESI Gateway)
	 * For public endpoints that don't require authentication
	 * Caches responses according to ESI cache headers
	 *
	 * @param path - ESI path (e.g., '/universe/types/587' or '/markets/prices')
	 * @returns ESI response with cache metadata
	 *
	 * @example
	 * ```ts
	 * const tokenStoreId = env.EVE_TOKEN_STORE.idFromName('default')
	 * const stub = env.EVE_TOKEN_STORE.get(tokenStoreId)
	 * const response = await stub.fetchPublicEsi<EsiMarketPrices>(
	 *   '/markets/prices'
	 * )
	 * ```
	 */
	fetchPublicEsi<T>(path: string): Promise<EsiResponse<T>>

	/**
	 * Fetch character affiliation data from ESI.
	 * Uses POST /characters/affiliation with token-store caching and ETag support.
	 *
	 * @param characterIds - One or more EVE character IDs
	 * @returns Affiliation entries for provided character IDs
	 */
	fetchCharacterAffiliations(characterIds: string[]): Promise<EsiCharacterAffiliation[]>

	/**
	 * Fetch public data from ESI with a schema
	 * @param path - ESI path (e.g., '/universe/types/587' or '/markets/prices')
	 * @param schema - Zod schema to parse the response data
	 * @returns ESI response with cache metadata
	 */
	fetchPublicEsiWithSchema<S extends z4.$ZodType>(
		path: string,
		schema: S
	): Promise<EsiResponse<z4.output<S>>>
	/**
	 * Clear ESI cache for a specific path
	 * Use this when you need to force a fresh fetch on the next request
	 *
	 * @param path - ESI path to clear from cache
	 * @param characterId - Character ID for authenticated cache (optional for public cache)
	 * @returns Number of cache entries cleared
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * // Clear authenticated cache
	 * await stub.clearEsiCache('/corporations/123/wallets/1/journal', '2119123456')
	 * // Clear public cache
	 * await stub.clearEsiCache('/markets/prices')
	 * ```
	 */
	clearEsiCache(path: string, characterId?: string): Promise<number>

	/**
	 * Fetch all pages from a paginated ESI endpoint (authenticated)
	 * Automatically fetches all pages in parallel and returns combined results
	 *
	 * @param basePath - ESI path without page parameter (e.g., '/corporations/{corporation_id}/assets')
	 * @param characterId - Character ID for authentication
	 * @param options - Optional configuration
	 * @param options.maxConcurrent - Maximum concurrent requests (default: 5)
	 * @returns Combined data array, total pages, and individual page responses
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const result = await stub.fetchEsiAllPages<Asset[]>(
	 *   `/corporations/${corporationId}/assets`,
	 *   characterId,
	 *   { maxConcurrent: 10 }
	 * )
	 * console.log(`Fetched ${result.data.length} items across ${result.pages} pages`)
	 * ```
	 */
	fetchEsiAllPages<T>(
		basePath: string,
		characterId: string,
		options?: { maxConcurrent?: number; cacheMode?: 'default' | 'no-store' }
	): Promise<{
		data: T[]
		pages: number
		responses: EsiResponse<T[]>[]
	}>

	/**
	 * Fetch all pages from a paginated public ESI endpoint (unauthenticated)
	 * Automatically fetches all pages in parallel and returns combined results
	 *
	 * @param basePath - ESI path without page parameter (e.g., '/markets/prices')
	 * @param options - Optional configuration
	 * @param options.maxConcurrent - Maximum concurrent requests (default: 5)
	 * @returns Combined data array, total pages, and individual page responses
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const result = await stub.fetchPublicEsiAllPages<MarketOrder[]>(
	 *   `/markets/10000002/orders`,
	 *   { maxConcurrent: 10 }
	 * )
	 * console.log(`Fetched ${result.data.length} orders across ${result.pages} pages`)
	 * ```
	 */
	fetchPublicEsiAllPages<T>(
		basePath: string,
		options?: { maxConcurrent?: number }
	): Promise<{
		data: T[]
		pages: number
		responses: EsiResponse<T[]>[]
	}>

	/**
	 * Fetch all pages from a paginated public ESI endpoint as a stream (unauthenticated)
	 * Returns a ReadableStream that yields newline-delimited JSON for each order
	 * Use this for large datasets (>32MiB) to bypass RPC size limits
	 *
	 * @param basePath - ESI path without page parameter (e.g., '/markets/10000002/orders')
	 * @param options - Optional configuration
	 * @param options.maxConcurrent - Maximum concurrent requests (default: 5)
	 * @returns ReadableStream of Uint8Array containing newline-delimited JSON
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const stream = await stub.fetchPublicEsiAllPagesStream(
	 *   `/markets/10000002/orders`,
	 *   { maxConcurrent: 10 }
	 * )
	 *
	 * // Decode and parse line by line
	 * const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
	 * let buffer = ''
	 * while (true) {
	 *   const { done, value } = await reader.read()
	 *   if (done) break
	 *   buffer += value
	 *   const lines = buffer.split('\n')
	 *   buffer = lines.pop() || ''
	 *   for (const line of lines) {
	 *     if (line.trim()) {
	 *       const order = JSON.parse(line)
	 *       // Process order...
	 *     }
	 *   }
	 * }
	 * ```
	 */
	fetchPublicEsiAllPagesStream(
		basePath: string,
		options?: { maxConcurrent?: number }
	): Promise<ReadableStream<Uint8Array>>

	/**
	 * Get corporation information by ID
	 * Automatically caches results in SQLite storage
	 *
	 * @param corporationId - EVE corporation ID
	 * @returns Corporation information or null if not found
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const corp = await stub.getCorporationById('98012345')
	 * ```
	 */
	getCorporationById(corporationId: string): Promise<EsiCorporation | null>

	/**
	 * Get alliance information by ID
	 * Automatically caches results in SQLite storage
	 *
	 * @param allianceId - EVE alliance ID
	 * @returns Alliance information or null if not found
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const alliance = await stub.getAllianceById('99000001')
	 * ```
	 */
	getAllianceById(allianceId: string): Promise<EsiAlliance | null>

	/**
	 * Get corporation information by name
	 * Uses bulk name resolution and caches results
	 *
	 * @param name - Corporation name (case-sensitive)
	 * @returns Corporation information or null if not found
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const corp = await stub.getCorporationByName('Jita Holding Corporation')
	 * ```
	 */
	getCorporationByName(name: string): Promise<EsiCorporation | null>

	/**
	 * Get alliance information by name
	 * Uses bulk name resolution and caches results
	 *
	 * @param name - Alliance name (case-sensitive)
	 * @returns Alliance information or null if not found
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const alliance = await stub.getAllianceByName('Goonswarm Federation')
	 * ```
	 */
	getAllianceByName(name: string): Promise<EsiAlliance | null>

	/**
	 * Resolve multiple entity names to IDs
	 * Supports alliances, characters, corporations, systems, etc.
	 * Caches results for future lookups
	 *
	 * @param names - Array of entity names to resolve
	 * @returns Map of name to ID for found entities
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const nameMap = await stub.resolveNames(['Jita', 'Goonswarm Federation'])
	 * // Returns: { 'Jita': '30000142', 'Goonswarm Federation': '1354830081' }
	 * ```
	 */
	resolveNames(names: string[]): Promise<Record<string, string>>

	/**
	 * Resolve multiple entity IDs to names
	 * Supports alliances, characters, corporations, systems, etc.
	 * Caches results for future lookups
	 *
	 * @param ids - Array of entity IDs to resolve
	 * @returns Map of ID to name for found entities
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const idMap = await stub.resolveIds(['30000142', '1354830081'])
	 * // Returns: { '30000142': 'Jita', '1354830081': 'Goonswarm Federation' }
	 * ```
	 */
	resolveIds(ids: string[]): Promise<Record<string, string>>

	/**
	 * Search for a character by name using ESI
	 *
	 * @param characterName - Character name to search for
	 * @param strict - If true, only exact matches are returned (default: true)
	 * @returns Array of character IDs matching the search, or empty array if none found
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	 * const ids = await stub.searchCharacter('Ozzie Dreadnaught', true)
	 * // Returns: ['123456789'] or []
	 * ```
	 */
	searchCharacter(characterName: string, strict?: boolean): Promise<string[]>

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
