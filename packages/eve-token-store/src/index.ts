/**
 * @repo/eve-token-store
 *
 * Shared types and interfaces for the EveTokenStore Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import * as z4 from 'zod/v4/core'

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
	 * Get token information (without actual token values)
	 * @param characterId - EVE character ID
	 * @returns Token info or null if not found
	 */
	getTokenInfo(characterId: string): Promise<TokenInfo | null>

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
		options?: { maxConcurrent?: number }
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
}
