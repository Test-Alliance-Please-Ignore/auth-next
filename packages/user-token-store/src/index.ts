/**
 * UserTokenStore Durable Object Interface
 *
 * This package provides TypeScript interfaces for the UserTokenStore Durable Object
 * which manages ESI OAuth tokens for EVE Online characters.
 *
 * The actual implementation lives in apps/esi/src/user-token-store.ts
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

export interface TokenListResult {
	total: number
	limit: number
	offset: number
	results: Array<{
		characterId: number
		characterName: string
		scopes: string
		expiresAt: number
		createdAt: number
		updatedAt: number
	}>
}

export interface TokenStats {
	totalCount: number
	expiredCount: number
	activeCount: number
}

// ========== Durable Object Interface ==========

/**
 * UserTokenStore Durable Object Interface
 *
 * Manages ESI OAuth tokens for EVE Online characters. Automatically refreshes
 * tokens when they expire and provides proxy tokens for secure access.
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/esi/src/user-token-store.ts
 */
export interface UserTokenStore {
	/**
	 * Store or update tokens for a character
	 * @returns Token information including proxy token
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
	 * @throws {Error} If token not found
	 */
	getAccessToken(characterId: number): Promise<AccessTokenInfo>

	/**
	 * Find token by proxy token, automatically refreshing if needed
	 * @throws {Error} If token not found
	 */
	findByProxyToken(proxyToken: string): Promise<AccessTokenInfo>

	/**
	 * Revoke tokens for a character
	 */
	revokeToken(characterId: number): Promise<void>

	/**
	 * Get token info without exposing sensitive data
	 * @throws {Error} If token not found
	 */
	getTokenInfo(characterId: number): Promise<Omit<AccessTokenInfo, 'accessToken'>>

	/**
	 * List all tokens with pagination (excludes sensitive data)
	 */
	listAllTokens(limit?: number, offset?: number): Promise<TokenListResult>

	/**
	 * Get proxy token for a character
	 * @throws {Error} If token not found
	 */
	getProxyToken(characterId: number): Promise<TokenInfo>

	/**
	 * Delete token by proxy token
	 * @throws {Error} If token not found
	 */
	deleteByProxyToken(proxyToken: string): Promise<void>

	/**
	 * Get statistics about stored tokens
	 */
	getStats(): Promise<TokenStats>

	/**
	 * Create ESI OAuth state for CSRF protection
	 * @returns State token
	 */
	createESIOAuthState(sessionId: string): Promise<string>

	/**
	 * Validate and consume ESI OAuth state
	 * @returns Session ID associated with the state
	 * @throws {Error} If state is invalid or expired
	 */
	validateESIOAuthState(state: string): Promise<string>
}
