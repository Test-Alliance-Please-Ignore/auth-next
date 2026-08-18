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
	/** Interactive message components */
	components?: DiscordActionRow[]
	/** Whether to allow @everyone and @here mentions */
	allowEveryone?: boolean
}

export interface DiscordWebhookAllowedMentions {
	parse: Array<'everyone' | 'roles' | 'users'>
}

export interface DiscordWebhookMessagePayload {
	content: string
	embeds?: DiscordEmbed[]
	components?: DiscordActionRow[]
	allowed_mentions?: DiscordWebhookAllowedMentions
}

export function buildDiscordWebhookMessagePayload(
	message: MessageContent
): DiscordWebhookMessagePayload {
	const payload: DiscordWebhookMessagePayload = {
		content: message.content,
	}

	if (message.embeds && message.embeds.length > 0) {
		payload.embeds = message.embeds
	}

	if (message.components && message.components.length > 0) {
		payload.components = message.components
	}

	if (message.allowEveryone === false) {
		payload.allowed_mentions = {
			parse: [],
		}
	} else if (message.allowEveryone === true) {
		payload.allowed_mentions = {
			parse: ['everyone', 'roles', 'users'],
		}
	} else {
		payload.allowed_mentions = {
			parse: ['roles', 'users'],
		}
	}

	return payload
}

/**
 * Message components (action rows + buttons).
 * https://discord.com/developers/docs/interactions/message-components
 */
export const DISCORD_COMPONENT_TYPE = {
	ACTION_ROW: 1,
	BUTTON: 2,
	STRING_SELECT: 3,
} as const

export const DISCORD_BUTTON_STYLE = {
	PRIMARY: 1,
	SECONDARY: 2,
	SUCCESS: 3,
	DANGER: 4,
	LINK: 5,
} as const

export type DiscordButtonStyle = (typeof DISCORD_BUTTON_STYLE)[keyof typeof DISCORD_BUTTON_STYLE]

export interface DiscordButtonComponent {
	type: 2
	style: DiscordButtonStyle
	/** Text label (≤80 chars). Omit only for emoji-only buttons. */
	label?: string
	/** Developer-defined id (≤100 chars). Required for non-link buttons. */
	custom_id?: string
	/** URL for LINK-style buttons. */
	url?: string
	disabled?: boolean
	emoji?: { id?: string; name?: string }
}

export interface DiscordSelectOption {
	label: string
	value: string
	description?: string
	default?: boolean
	emoji?: { id?: string; name?: string }
}

export interface DiscordStringSelectComponent {
	type: 3
	custom_id: string
	options: DiscordSelectOption[]
	placeholder?: string
	min_values?: number
	max_values?: number
	disabled?: boolean
}

export interface DiscordUserSelectComponent {
	type: 5
	custom_id: string
	placeholder?: string
	min_values?: number
	max_values?: number
	required?: boolean
	disabled?: boolean
}

export interface DiscordTextInputComponent {
	type: 4
	custom_id: string
	style: 1 | 2
	label?: string
	required?: boolean
	min_length?: number
	max_length?: number
	placeholder?: string
	value?: string
}

export interface DiscordModalLabelComponent {
	type: 18
	label: string
	description?: string
	component: DiscordStringSelectComponent | DiscordUserSelectComponent | DiscordTextInputComponent
}

export interface DiscordActionRow {
	type: 1
	components: Array<DiscordButtonComponent | DiscordStringSelectComponent>
}

export interface DiscordInteractionResponse {
	type: number
	data?: {
		content?: string
		flags?: number
		embeds?: DiscordEmbed[]
		components?: DiscordActionRow[] | DiscordModalLabelComponent[]
		custom_id?: string
		title?: string
	}
}

/**
 * Discord channel type subset we use.
 * https://discord.com/developers/docs/resources/channel#channel-object-channel-types
 */
export const DISCORD_CHANNEL_TYPE = {
	GUILD_CATEGORY: 4,
	GUILD_FORUM: 15,
} as const

/** A forum channel tag (available_tags / applied_tags). */
export interface DiscordForumTag {
	id: string
	name: string
	moderated?: boolean
	emoji_id?: string | null
	emoji_name?: string | null
}

/** A channel permission overwrite. type: 0 = role, 1 = member; allow/deny are stringified bitfields. */
export interface DiscordPermissionOverwrite {
	id: string
	type: number
	allow: string
	deny: string
}

/** Minimal channel shape returned by GET /channels/{id} (category or forum). */
export interface DiscordChannelSummary {
	id: string
	type: number
	parent_id?: string | null
	permission_overwrites?: DiscordPermissionOverwrite[]
	available_tags?: DiscordForumTag[]
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
	/** Whether the caller should retry this delivery */
	retryable?: boolean
}

export interface DiscordGuildRoleDetail {
	/** Discord role ID */
	roleId: string
	/** Discord role name (if resolvable) */
	roleName: string | null
}

export interface DiscordGuildMembershipDetail {
	/** Discord guild/server ID */
	guildId: string
	/** Whether the user is currently a guild member */
	isMember: boolean
	/** Current role IDs assigned to the user in this guild */
	currentRoleIds: string[]
	/** Current roles with best-effort role-name resolution */
	currentRoles: DiscordGuildRoleDetail[]
	/** Error message if membership inspection failed for this guild */
	errorMessage?: string
}

export interface DiscordGuildRoleSummary {
	id: string
	name: string
}

export interface DiscordGuildMemberSnapshot {
	/** Discord user ID */
	discordUserId: string
	/** Discord username */
	username: string
	/** Discord discriminator */
	discriminator: string
	/** Best-effort display name (nickname or global display name or username) */
	displayName: string
	/** Role IDs currently assigned in the guild */
	roleIds: string[]
	/** Whether this account is a bot user */
	isBot: boolean
}

export interface DiscordSlashCommandDefinition {
	name: string
	description: string
	options?: DiscordSlashCommandOption[]
}

/**
 * Discord application command option types:
 * https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-type
 */
export const DISCORD_SLASH_COMMAND_OPTION_TYPE = {
	SUB_COMMAND: 1,
	SUB_COMMAND_GROUP: 2,
	STRING: 3,
	INTEGER: 4,
	BOOLEAN: 5,
	USER: 6,
	CHANNEL: 7,
	ROLE: 8,
	MENTIONABLE: 9,
	NUMBER: 10,
	ATTACHMENT: 11,
} as const

export type DiscordSlashCommandOptionType =
	(typeof DISCORD_SLASH_COMMAND_OPTION_TYPE)[keyof typeof DISCORD_SLASH_COMMAND_OPTION_TYPE]

export const DISCORD_SLASH_COMMAND_OPTION_TYPE_NAME: Record<DiscordSlashCommandOptionType, string> =
	{
		1: 'SUB_COMMAND',
		2: 'SUB_COMMAND_GROUP',
		3: 'STRING',
		4: 'INTEGER',
		5: 'BOOLEAN',
		6: 'USER',
		7: 'CHANNEL',
		8: 'ROLE',
		9: 'MENTIONABLE',
		10: 'NUMBER',
		11: 'ATTACHMENT',
	}

export interface DiscordSlashCommandOptionChoice {
	name: string
	value: string | number
}

export interface DiscordSlashCommandOption {
	type: DiscordSlashCommandOptionType
	name: string
	description: string
	required?: boolean
	autocomplete?: boolean
	choices?: DiscordSlashCommandOptionChoice[]
	options?: DiscordSlashCommandOption[]
	min_value?: number
	max_value?: number
	min_length?: number
	max_length?: number
}

/**
 * Canonical Discord role IDs we intentionally exclude from auth/role-audit logic.
 */
export const DISCORD_EXCLUDED_NITRO_BOOSTER_ROLE_ID = '585546446120419328'
export const DISCORD_EXCLUDED_AUTH_GIGACHAD_ROLE_ID = '1431816436640256060'
export const DISCORD_EXCLUDED_AUTH_ROLE_IDS = new Set([
	DISCORD_EXCLUDED_NITRO_BOOSTER_ROLE_ID,
	DISCORD_EXCLUDED_AUTH_GIGACHAD_ROLE_ID,
])

export interface DiscordRegisteredSlashCommand {
	id: string
	name: string
	description: string
}

export interface Discord {
	/**
	 * Search linked core users by Discord username (case-insensitive, partial match)
	 * @param usernameQuery - Discord username search string
	 * @param limit - Maximum rows to return (default: 50, max: 200)
	 */
	searchCoreUsersByUsername(
		usernameQuery: string,
		limit?: number
	): Promise<
		Array<{
			coreUserId: string
			discordUserId: string
			username: string
		}>
	>

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
	 * Get Discord statuses for multiple core users in one database query.
	 */
	getDiscordUserStatuses(coreUserIds: string[]): Promise<Record<string, DiscordUserStatus>>

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
	 * @param guildIds - Array of guild IDs to check for membership and remove user from
	 * @returns Whether unlinking was successful
	 */
	unlinkCoreUser(coreUserId: string, guildIds: string[]): Promise<boolean>

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
	 * Link a Discord account using OAuth tokens
	 * Fetches user info from Discord and stores tokens
	 * @param accessToken - OAuth access token
	 * @param refreshToken - OAuth refresh token
	 * @param expiresIn - Token expiration in seconds
	 * @param scopes - OAuth scopes (space-separated)
	 * @param coreUserId - Core user ID to link to
	 * @returns User info and success status
	 */
	linkAccountWithTokens(
		accessToken: string,
		refreshToken: string,
		expiresIn: number,
		scopes: string,
		coreUserId: string
	): Promise<{
		success: boolean
		error?: string
		discordUserId?: string
		username?: string
	}>

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
	 * Edit an existing channel message by ID
	 */
	editMessage(channelId: string, messageId: string, content: string): Promise<SendMessageResult>

	/**
	 * Delete a channel message by ID
	 */
	deleteMessage(channelId: string, messageId: string): Promise<{ success: boolean; error?: string }>

	/**
	 * Check which guilds a user is a member of using bot token
	 * @param coreUserId - Core user ID
	 * @param guildIds - Array of guild IDs to check
	 * @returns Array of guild IDs the user is a member of
	 */
	checkGuildMembershipWithBot(coreUserId: string, guildIds: string[]): Promise<string[]>

	/**
	 * Get detailed guild membership and current role assignments for a user
	 * Uses bot token and does not modify guild state.
	 * @param coreUserId - Core user ID
	 * @param guildIds - Array of guild IDs to inspect
	 * @returns Array of per-guild membership and role details
	 */
	getUserGuildMembershipDetails(
		coreUserId: string,
		guildIds: string[]
	): Promise<DiscordGuildMembershipDetail[]>

	/**
	 * List the roles available in a Discord guild.
	 */
	getGuildRoles(guildId: string): Promise<DiscordGuildRoleSummary[]>
	getGuildMemberByDiscordUserId(
		guildId: string,
		discordUserId: string
	): Promise<{ isMember: boolean; roleIds: string[] }>

	/** Add one explicitly managed role without replacing any other member roles. */
	addGuildMemberRole(
		guildId: string,
		discordUserId: string,
		roleId: string
	): Promise<{ success: boolean; error?: string }>

	/** Remove one explicitly managed role without replacing any other member roles. */
	removeGuildMemberRole(
		guildId: string,
		discordUserId: string,
		roleId: string
	): Promise<{ success: boolean; error?: string }>

	/**
	 * List guild members using bot access.
	 * @param guildId - Discord guild/server ID
	 * @param options - Pagination options
	 */
	listGuildMembers(
		guildId: string,
		options?: {
			limit?: number
			afterDiscordUserId?: string
		}
	): Promise<DiscordGuildMemberSnapshot[]>

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
			preserveRoleIds?: string[] // Roles preserved when one role source is unavailable
			preserveAllCurrentRoles?: boolean // Fail-safe when the managed-role inventory is unavailable
			clearAllRoles?: boolean // When true, clear all roles for this guild (managed + unmanaged)
		}>,
		allowRemoval?: boolean // When true, overrides add-only mode and removes managed roles the user no longer qualifies for
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
	 * Clear all assignable roles for raw Discord user IDs in a guild.
	 * Intended for admin tooling on unlinked users.
	 */
	clearGuildRolesByDiscordUserIds(
		guildId: string,
		discordUserIds: string[]
	): Promise<
		Array<{
			discordUserId: string
			success: boolean
			errorMessage?: string
		}>
	>

	/**
	 * Remove raw Discord user IDs from a guild.
	 * Intended for admin tooling on unlinked users.
	 */
	removeGuildMembersByDiscordUserIds(
		guildId: string,
		discordUserIds: string[]
	): Promise<
		Array<{
			discordUserId: string
			success: boolean
			errorMessage?: string
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
	 * Forcibly remove a user from access across guilds by clearing roles and banning.
	 * Intended for blacklist/security enforcement.
	 * @param coreUserId - Core user ID
	 * @param guildIds - Guild IDs to enforce on
	 * @param reason - Optional ban reason
	 */
	revokeAccessAndBan(
		coreUserId: string,
		guildIds: string[],
		reason?: string
	): Promise<
		Array<{
			guildId: string
			success: boolean
			rolesCleared: boolean
			banned: boolean
			errorMessage?: string
		}>
	>

	/**
	 * Send a direct message to a user by their core user ID
	 * Creates or gets a DM channel and sends the message
	 * @param coreUserId - Core user ID
	 * @param message - Message content to send
	 * @returns Result indicating success or failure
	 */
	sendDirectMessage(coreUserId: string, message: MessageContent): Promise<SendMessageResult>

	/**
	 * Create or update a guild slash command by name.
	 * @param guildId - Discord guild ID
	 * @param command - Slash command definition
	 * @returns Registered command details
	 */
	upsertGuildSlashCommand(
		guildId: string,
		command: DiscordSlashCommandDefinition
	): Promise<DiscordRegisteredSlashCommand>

	/**
	 * Delete a guild slash command by ID or name.
	 * @param guildId - Discord guild ID
	 * @param opts - Command identifier
	 * @returns Deletion status
	 */
	deleteGuildSlashCommand(
		guildId: string,
		opts: { commandId?: string; commandName?: string }
	): Promise<{ success: boolean; deletedCommandId?: string; error?: string }>

	/**
	 * Edit the original (deferred) interaction response via the interaction webhook.
	 * Used to deliver the result of a deferred (type:5) slash command. Authorized by the
	 * interaction token in the URL path — no bot token is sent. Ephemerality was fixed at
	 * ACK time, so no flags are sent here.
	 * @param interactionToken - The token from the original interaction
	 * @param message - The message content (and optional embeds) to set
	 */
	editOriginalInteractionResponse(
		interactionToken: string,
		message: {
			content: string
			embeds?: DiscordEmbed[]
			components?: DiscordActionRow[]
		}
	): Promise<{ success: boolean; error?: string }>

	/**
	 * Read a channel (GET /channels/{id}). Used to copy a category's permission
	 * overwrites onto a new forum channel and to read a forum's available tags.
	 */
	getChannel(channelId: string): Promise<DiscordChannelSummary>

	/**
	 * Create a GUILD_FORUM channel under a category. `permissionOverwrites` should be the
	 * category's overwrites (copied verbatim = Discord "synced/inherited" permissions).
	 * `availableTags` are created with the channel; the returned channel carries their ids.
	 * Requires the bot to hold MANAGE_CHANNELS + MANAGE_ROLES.
	 */
	createForumChannel(
		guildId: string,
		input: {
			name: string
			parentId: string
			permissionOverwrites?: DiscordPermissionOverwrite[]
			availableTags?: Array<{ name: string; moderated?: boolean }>
			topic?: string
		}
	): Promise<DiscordChannelSummary>

	/**
	 * Create a forum post (thread) for a market via
	 * POST /channels/{forumChannelId}/threads. Returns the thread id and starter message id.
	 */
	createMarketForumPost(
		forumChannelId: string,
		input: {
			name: string
			content?: string
			embeds?: DiscordEmbed[]
			components?: DiscordActionRow[]
			appliedTagIds?: string[]
		}
	): Promise<{ threadId: string; messageId: string }>

	/**
	 * Edit a forum post's starter message (embed + components), the embed-capable
	 * replacement for editMessage. Pass `components: []` to strip buttons; omit to leave intact.
	 */
	updateMarketPostMessage(
		threadId: string,
		messageId: string,
		input: { content?: string; embeds?: DiscordEmbed[]; components?: DiscordActionRow[] }
	): Promise<{ success: boolean; error?: string }>

	/** List a forum channel's available tags (GET /channels/{id} → available_tags). */
	getForumTags(forumChannelId: string): Promise<DiscordForumTag[]>

	/** Replace a thread's applied tag set (PATCH /channels/{threadId} { applied_tags }). */
	setThreadTags(
		threadId: string,
		appliedTagIds: string[]
	): Promise<{ success: boolean; error?: string }>

	/**
	 * Archive/lock a thread (optionally flipping tags) in one PATCH — combining avoids
	 * the reorder needed when a thread is already archived.
	 */
	lockThread(
		threadId: string,
		opts: { archived?: boolean; locked?: boolean; appliedTagIds?: string[] }
	): Promise<{ success: boolean; error?: string }>
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
export { DiscordFetch, DiscordAPIError, DiscordRateLimitError, DiscordRoutes } from './client'

export {
	DiscordRateLimitGuard,
	discordRateLimitGuard,
	type DiscordRateLimitRecord,
	type DiscordRateLimitStore,
	type DiscordRateLimitObservation,
	normalizeDiscordRouteKey,
} from './discord-rate-limit'

export {
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
