/**
 * @repo/discord
 *
 * Shared types and interfaces for the Discord Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

export interface DiscordTokenResponse {
	/** OAuth access token */
	access_token: string
	/** Seconds until token expires */
	expires_in: number
	/** OAuth token type (Bearer) */
	token_type: string
	/** OAuth refresh token (if available) */
	refresh_token?: string
	/** Space Delimited list of scopes */
	scope: string
}

/**
 * Stored token data
 */
export interface StoredToken {
	/** Database ID */
	id: string
	/** Discord user ID */
	userId: string
	/** Encrypted access token */
	accessToken: string
	/** Encrypted refresh token */
	refreshToken: string | null
	/** When the record was created */
	createdAt: Date
	/** Token expiration timestamp */
	expiresAt: Date
	/** Granted scopes as array */
	scopes: string[]
	/** When the record was last updated */
	updatedAt: Date
}

/**
 * Discord profile information
 */
export interface DiscordProfile {
	/** Discord user ID */
	userId: string
	/** Discord username */
	username: string
	/** Discord discriminator */
	discriminator: string
	/** Granted scopes */
	scopes: string[]
}

export interface Discord {
	/**
	 * Get Discord profile by core user ID
	 * @param coreUserId - Core user ID
	 * @returns Discord profile or null if not found
	 */
	getProfileByCoreUserId(coreUserId: string): Promise<DiscordProfile | null>

	/**
	 * Refresh token by core user ID
	 * @param coreUserId - Core user ID
	 * @returns Whether refresh was successful
	 */
	refreshTokenByCoreUserId(coreUserId: string): Promise<boolean>

	/**
	 * Store Discord tokens directly (for PKCE flow)
	 * @param userId - Discord user ID
	 * @param username - Discord username
	 * @param discriminator - Discord discriminator
	 * @param scopes - OAuth scopes
	 * @param accessToken - Access token
	 * @param refreshToken - Refresh token
	 * @param expiresAt - Expiration date
	 * @param coreUserId - Core user ID to link to
	 * @returns Whether storage was successful
	 */
	storeTokensDirect(
		userId: string,
		username: string,
		discriminator: string,
		scopes: string[],
		accessToken: string,
		refreshToken: string,
		expiresAt: Date,
		coreUserId: string
	): Promise<boolean>
}
