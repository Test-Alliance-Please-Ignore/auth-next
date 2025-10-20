/**
 * @repo/discord
 *
 * Shared types and interfaces for the Discord Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * List of required scopes to request from Discord.
 */
export const DISCORD_REQUIRED_SCOPES = ['guilds', 'guilds.join', 'identify']

export type GuildId = string
export type UserId = string

/**
 * Authorization URL response for starting OAuth flow
 */
export interface AuthorizationUrlResponse {
	/** Full authorization URL to redirect user to */
	url: string
	/** State parameter for CSRF protection */
	state: string
}

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

export interface CallbackResult {
	/** Whether the callback was successful */
	success: boolean

	/** Discord user ID if successful */
	userId?: string

	/** Discord username if successful */
	username?: string

	/** Discord discriminator if successful */
	discriminator?: string

	/** Error message if failed */
	error?: string
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
	 * Start OAuth flow for login (publicData scope only)
	 * @param state - Optional state parameter for CSRF protection
	 * @returns Authorization URL and state
	 */
	startLoginFlow(state?: string): Promise<AuthorizationUrlResponse>

	/**
	 * Handle OAuth callback - exchange code for tokens and store them
	 * @param code - Authorization code from Discord OAuth
	 * @param state - State parameter for CSRF validation
	 * @param coreUserId - Optional core user ID to link this Discord account to
	 * @returns Result with discord information or error
	 */
	handleCallback(code: string, state?: string, coreUserId?: string): Promise<CallbackResult>

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
	 * Manually refresh a token
	 * @param userId - Discord User ID
	 * @returns Whether refresh was successful
	 */
	refreshToken(userId: string): Promise<boolean>

	/**
	 * Revoke and delete a token
	 * @param userId - Discord User ID
	 * @returns Whether revocation was successful
	 */
	revokeToken(userId: string): Promise<boolean>

	inviteUserToGuild(userId: string, guildId: string): Promise<boolean>

	// kickUserFromGuild(guildId: string, userId: string): Promise<boolean>
}
