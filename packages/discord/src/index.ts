/**
 * Discord Durable Object Interface
 *
 * This package provides TypeScript interfaces for the Discord Durable Object
 * which manages Discord OAuth tokens and Discord API interactions.
 *
 * The actual implementation lives in apps/discord/src/discord.ts
 */

// ========== Types ==========

export interface DiscordTokenInfo {
	discordUserId: string
	discordUsername: string
	rootUserId: string
	accessToken: string
	expiresAt: number
}

export interface DiscordOAuthTokens {
	accessToken: string
	refreshToken: string
	expiresIn: number
}

// ========== Durable Object Interface ==========

/**
 * Discord Durable Object Interface
 *
 * Manages Discord OAuth tokens and provides Discord API integration
 *
 * Note: This interface is used for type-safe cross-worker communication.
 * The actual implementation is in apps/discord/src/discord.ts
 */
export interface Discord {
	/**
	 * Store Discord OAuth tokens for a user
	 * Fetches Discord user info from the API using the access token
	 * @param rootUserId - Root user ID from SessionStore
	 * @param tokens - Discord OAuth tokens (access token, refresh token, and expiration)
	 * @returns Discord user ID and username
	 */
	storeDiscordTokens(
		rootUserId: string,
		tokens: DiscordOAuthTokens
	): Promise<{ discordUserId: string; discordUsername: string }>

	/**
	 * Get Discord OAuth tokens for a user, automatically refreshing if needed
	 * @param params - Lookup parameters (provide either discordUserId or rootUserId)
	 * @param params.discordUserId - Discord user ID
	 * @param params.rootUserId - Root user ID from SessionStore
	 * @returns Token information including access token
	 * @throws {Error} If tokens not found or if neither parameter is provided
	 */
	getDiscordTokens(params: {
		discordUserId?: string
		rootUserId?: string
	}): Promise<DiscordTokenInfo>
}
