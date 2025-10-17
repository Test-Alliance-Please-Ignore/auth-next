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
	socialUserId: string
	accessToken: string
	expiresAt: number
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
	 * @param socialUserId - Social user ID from SessionStore
	 * @param accessToken - Discord OAuth access token
	 * @param refreshToken - Discord OAuth refresh token
	 * @param expiresIn - Token expiration time in seconds
	 * @returns Discord user ID and username
	 */
	storeDiscordTokens(
		socialUserId: string,
		accessToken: string,
		refreshToken: string,
		expiresIn: number
	): Promise<{ discordUserId: string; discordUsername: string }>

	/**
	 * Get Discord OAuth tokens for a user, automatically refreshing if needed
	 * @param discordUserId - Discord user ID
	 * @returns Token information including access token
	 * @throws {Error} If tokens not found
	 */
	getDiscordTokens(discordUserId: string): Promise<DiscordTokenInfo>
}
