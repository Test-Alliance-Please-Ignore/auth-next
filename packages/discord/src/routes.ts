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

	/**
	 * Route for guild scheduled events.
	 * GET /guilds/{guildId}/scheduled-events?with_user_count=true
	 *
	 * `with_user_count` makes Discord include the interested-user count.
	 */
	guildScheduledEvents: (guildId: string) =>
		`/guilds/${guildId}/scheduled-events?with_user_count=true`,
} as const

export type DiscordRoutesType = typeof DiscordRoutes
