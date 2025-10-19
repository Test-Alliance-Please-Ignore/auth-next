/**
 * @repo/eve-token-store
 *
 * Shared types and interfaces for the EveTokenStore Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * EVE Online SSO OAuth Types
 */

/**
 * Response from EVE SSO verify endpoint
 * https://login.eveonline.com/oauth/verify
 */
export interface EveVerifyResponse {
	/** EVE character ID */
	CharacterID: number
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
	characterId: number
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
	characterId: number
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
	characterId?: number
	/** Character info if successful */
	characterInfo?: {
		characterId: number
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
	refreshToken(characterId: number): Promise<boolean>

	/**
	 * Get token information (without actual token values)
	 * @param characterId - EVE character ID
	 * @returns Token info or null if not found
	 */
	getTokenInfo(characterId: number): Promise<TokenInfo | null>

	/**
	 * Get access token for use (decrypted)
	 * @param characterId - EVE character ID
	 * @returns Access token or null if not found/expired
	 */
	getAccessToken(characterId: number): Promise<string | null>

	/**
	 * Revoke and delete a token
	 * @param characterId - EVE character ID
	 * @returns Whether revocation was successful
	 */
	revokeToken(characterId: number): Promise<boolean>

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
	fetchEsi<T>(path: string, characterId: number): Promise<EsiResponse<T>>
}
