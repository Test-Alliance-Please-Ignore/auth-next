/**
 * Discord API route constants
 * Replaces Routes from discord.js
 */
export const DiscordRoutes = {
	/**
	 * Route for creating/getting DM channels
	 * POST /users/@me/channels
	 */
	userChannels: () => '/users/@me/channels',

	/**
	 * Route for sending messages to a channel
	 * POST /channels/{channelId}/messages
	 */
	channelMessages: (channelId: string) => `/channels/${channelId}/messages`,

	/**
	 * Route for a single channel (GET/PATCH)
	 * GET/PATCH /channels/{channelId}
	 */
	channel: (channelId: string) => `/channels/${channelId}`,

	/**
	 * Route for a single channel message (PATCH/DELETE)
	 * PATCH/DELETE /channels/{channelId}/messages/{messageId}
	 * Note: distinct from the plural channelMessages (collection) above.
	 */
	channelMessageById: (channelId: string, messageId: string) =>
		`/channels/${channelId}/messages/${messageId}`,

	/**
	 * Route for a guild's channels (POST creates a channel)
	 * POST /guilds/{guildId}/channels
	 */
	guildChannels: (guildId: string) => `/guilds/${guildId}/channels`,

	/**
	 * Route for creating a thread in a forum/media channel
	 * POST /channels/{channelId}/threads
	 */
	forumThreads: (channelId: string) => `/channels/${channelId}/threads`,

	/**
	 * Route for getting user's guilds
	 * GET /users/@me/guilds
	 */
	userGuilds: () => '/users/@me/guilds',

	/**
	 * Route for guild member operations
	 * GET/PUT/PATCH/DELETE /guilds/{guildId}/members/{userId}
	 */
	guildMember: (guildId: string, userId: string) => `/guilds/${guildId}/members/${userId}`,

	/**
	 * Route for guild members list
	 * GET /guilds/{guildId}/members
	 */
	guildMembers: (guildId: string) => `/guilds/${guildId}/members`,
} as const

export type DiscordRoutesType = typeof DiscordRoutes
