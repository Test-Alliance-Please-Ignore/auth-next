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

/**
 * Discord user status information
 */
export interface DiscordUserStatus {
	/** Discord user ID */
	userId: string
	/** Discord username */
	username: string
	/** Discord discriminator */
	discriminator: string
	/** Core user ID */
	coreUserId: string | null
	/** Whether the user has revoked authorization */
	authRevoked: boolean
	/** When authorization was revoked */
	authRevokedAt: Date | null
	/** Last time credentials were successfully used */
	lastSuccessfulAuth: Date | null
	/** Last time we synced Discord access (server invites and role updates) for this user (null if never synced) */
	lastRefreshed: Date | null
	/** When the user was created */
	createdAt: Date
	/** When the user was last updated */
	updatedAt: Date
}

/**
 * Result of attempting to join a user to a Discord server
 */
export interface JoinServerResult {
	/** Discord guild/server ID */
	guildId: string
	/** Discord guild/server name (if available) */
	guildName?: string
	/** Whether the join was successful */
	success: boolean
	/** Error message if join failed */
	errorMessage?: string
	/** Whether the user was already a member */
	alreadyMember?: boolean
}

/**
 * Discord message embed
 */
export interface DiscordEmbed {
	/** Embed title */
	title?: string
	/** Embed description */
	description?: string
	/** Embed color (decimal) */
	color?: number
	/** Embed thumbnail */
	thumbnail?: {
		url: string
	}
	/** Embed fields */
	fields?: Array<{
		name: string
		value: string
		inline?: boolean
	}>
	/** Embed footer */
	footer?: {
		text: string
		icon_url?: string
	}
	/** Embed timestamp (ISO 8601) */
	timestamp?: string
}

/**
 * Message content to send
 */
export interface MessageContent {
	/** Message text content */
	content: string
	/** Message embeds */
	embeds?: DiscordEmbed[]
	/** Whether to allow @everyone and @here mentions */
	allowEveryone?: boolean
}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
	/** Whether the message was sent successfully */
	success: boolean
	/** Discord message ID if successful */
	messageId?: string
	/** Error message if failed */
	error?: string
	/** Retry after seconds if rate limited */
	retryAfter?: number
}

export interface Discord {
	/**
	 * Get Discord profile by core user ID
	 * @param coreUserId - Core user ID
	 * @returns Discord profile or null if not found
	 */
	getProfileByCoreUserId(coreUserId: string): Promise<DiscordProfile | null>

	/**
	 * Get Discord user status including auth revocation info
	 * @param coreUserId - Core user ID
	 * @returns Discord user status or null if not found
	 */
	getDiscordUserStatus(coreUserId: string): Promise<DiscordUserStatus | null>

	/**
	 * Update the last refreshed timestamp for a Discord user
	 * @param coreUserId - Core user ID
	 */
	updateLastRefreshed(coreUserId: string): Promise<void>

	/**
	 * Check if Discord access should be refreshed for a user
	 * @param coreUserId - Core user ID
	 * @param intervalMinutes - Minimum minutes between refreshes (default: 15)
	 * @returns Whether refresh is needed (true if never refreshed or last refresh was more than intervalMinutes ago)
	 */
	shouldRefreshDiscordAccess(coreUserId: string, intervalMinutes?: number): Promise<boolean>

	/**
	 * Get users that need Discord access refresh
	 * Queries Discord database for users where coreUserId is not null and
	 * (lastRefreshed is null OR lastRefreshed is older than intervalMinutes)
	 * @param limit - Maximum number of users to return (default: 50)
	 * @param intervalMinutes - Minimum minutes between refreshes (default: 15)
	 * @returns Array of users needing refresh with coreUserId and discordUserId
	 */
	getUsersNeedingRefresh(
		limit?: number,
		intervalMinutes?: number
	): Promise<
		Array<{
			coreUserId: string
			discordUserId: string
			lastRefreshed: Date | null
		}>
	>

	/**
	 * Manually revoke Discord authorization for a user (admin action)
	 * @param coreUserId - Core user ID
	 * @returns Whether revocation was successful
	 */
	revokeAuthorization(coreUserId: string): Promise<boolean>

	/**
	 * Completely unlink a Discord account from a core user (admin action)
	 * Breaks the link by clearing coreUserId, revokes authorization,
	 * deletes tokens, and removes user from all managed Discord servers
	 * @param coreUserId - Core user ID to unlink
	 * @returns Whether unlinking was successful
	 */
	unlinkCoreUser(coreUserId: string): Promise<boolean>

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

	/**
	 * Join a user to one or more Discord servers
	 * Uses the user's OAuth token and bot token to add them directly to servers
	 * @param coreUserId - Core user ID
	 * @param guildIds - Array of Discord guild/server IDs to join
	 * @returns Array of results for each guild
	 */
	joinUserToServers(coreUserId: string, guildIds: string[]): Promise<JoinServerResult[]>

	/**
	 * Send a message to a Discord channel using the bot token
	 * @param guildId - Discord guild/server ID
	 * @param channelId - Discord channel ID
	 * @param message - Message content to send
	 * @returns Result indicating success or failure
	 */
	sendMessage(
		guildId: string,
		channelId: string,
		message: MessageContent
	): Promise<SendMessageResult>

	/**
	 * Get all Discord servers/guilds that a user is currently a member of
	 * @param coreUserId - Core user ID
	 * @returns Array of guilds the user is a member of
	 */
	getUserGuilds(
		coreUserId: string
	): Promise<
		Array<{ id: string; name: string; icon?: string; owner: boolean; permissions: string }>
	>

	/**
	 * Check which guilds a user is a member of using bot token (fallback for missing guilds scope)
	 * @param coreUserId - Core user ID
	 * @param guildIds - Array of guild IDs to check
	 * @returns Array of guild IDs the user is a member of
	 */
	checkGuildMembershipWithBot(coreUserId: string, guildIds: string[]): Promise<string[]>

	/**
	 * Update Discord roles for a user who is already a member of servers
	 * Does NOT invite them to new servers
	 * @param coreUserId - Core user ID
	 * @param updateRequests - Array of guild IDs, role sets, and optional managed role IDs
	 * @returns Array of update results
	 */
	updateUserRoles(
		coreUserId: string,
		updateRequests: Array<{
			guildId: string
			roleIds: string[]
			managedRoleIds?: string[] // All system-managed role IDs for this guild
		}>
	): Promise<
		Array<{
			guildId: string
			success: boolean
			errorMessage?: string
			rolesAdded?: string[]
			rolesRemoved?: string[]
		}>
	>

	/**
	 * Update user's nickname on specified Discord servers
	 * This is a lightweight operation that only updates the display name
	 * @param coreUserId - Core user ID
	 * @param guildIds - Array of Discord guild/server IDs to update nickname on
	 * @param nickname - New nickname to set
	 */
	updateUserNickname(coreUserId: string, guildIds: string[], nickname: string): Promise<void>

	/**
	 * Send a direct message to a user by their core user ID
	 * Creates or gets a DM channel and sends the message
	 * @param coreUserId - Core user ID
	 * @param message - Message content to send
	 * @returns Result indicating success or failure
	 */
	sendDirectMessage(coreUserId: string, message: MessageContent): Promise<SendMessageResult>
}

/**
 * Get a Discord stub
 * @param env - Environment
 * @returns Discord stub
 */
export const getDiscordStub = (env: { DISCORD: DurableObjectNamespace }): Discord => {
	if (!env.DISCORD) {
		throw new Error('DISCORD namespace is not defined')
	}
	const id = env.DISCORD.newUniqueId()
	return env.DISCORD.get(id) as unknown as Discord
}

// Re-export client utilities
export {
	DiscordFetch,
	DiscordAPIError,
	DiscordRateLimitError,
	DiscordRoutes,
	type DiscordFetchOptions,
	type DiscordProxyConfig,
	type DiscordRoutesType,
	blockQuote,
	bold,
	italic,
	quote,
	spoiler,
	strikethrough,
	underline,
	subtext,
} from './client'
