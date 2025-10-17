/**
 * EveSSO Durable Object Interface
 *
 * This package provides TypeScript interfaces for the EveSSO Durable Object
 * which manages EVE SSO OAuth tokens, proxy tokens, and ESI API integration.
 *
 * The actual implementation lives in apps/evesso/src/evesso.ts
 */

// ========== Types ==========

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

export interface ESIOAuthTokens {
	accessToken: string
	refreshToken: string
	expiresIn: number
	scopes: string
}

// ========== Durable Object Interface ==========

/**
 * EveSSO Durable Object Interface
 *
 * Manages EVE SSO OAuth tokens, proxy tokens, and ESI OAuth state
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/evesso/src/evesso.ts
 */
export interface EveSSO {
	/**
	 * Store EVE SSO OAuth tokens for a character
	 * Generates a proxy token if this is the first time storing tokens for this character
	 * @param characterId - EVE character ID
	 * @param characterName - EVE character name
	 * @param accessToken - EVE SSO access token
	 * @param refreshToken - EVE SSO refresh token
	 * @param expiresIn - Token expiration time in seconds
	 * @param scopes - Space-separated list of ESI scopes
	 * @returns Token info including the proxy token
	 */
	storeTokens(
		characterId: number,
		characterName: string,
		accessToken: string,
		refreshToken: string,
		expiresIn: number,
		scopes: string
	): Promise<TokenInfo>

	/**
	 * Get access token for a character, automatically refreshing if needed
	 * Tokens are refreshed if they expire within 5 minutes
	 * @param characterId - EVE character ID
	 * @returns Access token info
	 * @throws {Error} If token not found
	 */
	getAccessToken(characterId: number): Promise<AccessTokenInfo>

	/**
	 * Find and get access token by proxy token, automatically refreshing if needed
	 * @param proxyToken - 64-character hex proxy token
	 * @returns Access token info
	 * @throws {Error} If token not found
	 */
	findByProxyToken(proxyToken: string): Promise<AccessTokenInfo>

	/**
	 * Get proxy token info for a character (without access token)
	 * @param characterId - EVE character ID
	 * @returns Token info including proxy token
	 * @throws {Error} If token not found
	 */
	getProxyToken(characterId: number): Promise<TokenInfo>

	/**
	 * Revoke tokens for a character
	 * @param characterId - EVE character ID
	 */
	revokeToken(characterId: number): Promise<void>

	/**
	 * Delete tokens by proxy token
	 * @param proxyToken - 64-character hex proxy token
	 * @throws {Error} If token not found
	 */
	deleteByProxyToken(proxyToken: string): Promise<void>

	/**
	 * Create ESI OAuth state for CSRF protection
	 * State expires in 5 minutes
	 * @param sessionId - Session ID from SessionStore
	 * @returns Random state token (64-character hex)
	 */
	createESIOAuthState(sessionId: string): Promise<string>

	/**
	 * Validate and consume ESI OAuth state (one-time use)
	 * @param state - State token from OAuth callback
	 * @returns Session ID associated with this state
	 * @throws {Error} If state is invalid or expired
	 */
	validateESIOAuthState(state: string): Promise<string>
}
