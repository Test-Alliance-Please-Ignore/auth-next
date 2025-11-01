import { relations } from 'drizzle-orm'
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

/**
 * Users table - Root user accounts
 *
 * Each user has one "main" character that they claimed when creating their account.
 * Additional characters can be linked manually.
 */
export const users = pgTable(
	'users',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** EVE character ID of the main character */
		mainCharacterId: text('main_character_id').notNull().unique(),
		/** Discord user ID (links to Discord worker's discordUsers table) */
		discordUserId: varchar('discord_user_id', { length: 255 }).unique(),
		/** Whether this user is an admin */
		is_admin: boolean('is_admin').default(false).notNull(),
		/** Last time Discord access was refreshed (tokens, roles, server membership) */
		lastDiscordRefresh: timestamp('last_discord_refresh', { withTimezone: true }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('users_main_character_id_idx').on(table.mainCharacterId),
		index('users_discord_user_id_idx').on(table.discordUserId),
		index('users_last_discord_refresh_idx').on(table.lastDiscordRefresh),
	]
)

/**
 * User characters table - Linked characters for each user
 *
 * Users can have multiple characters linked to their account.
 * One character is always marked as primary (their main).
 */
export const userCharacters = pgTable(
	'user_characters',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Character owner hash (stored for transfer detection only) */
		characterOwnerHash: varchar('character_owner_hash', { length: 255 }).notNull(),
		/** EVE character ID (primary identifier) */
		characterId: text('character_id').notNull().unique(),
		/** EVE character name (cached from eve-token-store for convenience) */
		characterName: varchar('character_name', { length: 255 }).notNull(),
		/** Whether this is the user's primary character */
		is_primary: boolean('is_primary').default(false).notNull(),
		/** Cached token validity status (NULL = unknown, true = valid, false = invalid/expired) */
		hasValidToken: boolean('has_valid_token'),
		linkedAt: timestamp('linked_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		// Index for finding characters by user
		index('user_characters_user_id_idx').on(table.userId),
		// Index for finding user by characterId
		index('user_characters_character_id_idx').on(table.characterId),
		// Index for finding primary character (enforced in application logic: only one primary per user)
		index('user_characters_is_primary_idx').on(table.userId, table.is_primary),
	]
)

/**
 * User sessions table - Session management
 *
 * Sessions are stored in the database for revocation capability.
 * Each session has a unique token, expiration, and metadata.
 */
export const userSessions = pgTable(
	'user_sessions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Unique session token (UUID) */
		sessionToken: varchar('session_token', { length: 255 }).notNull().unique(),
		/** When the session expires */
		expiresAt: timestamp('expires_at').notNull(),
		/** Session metadata (IP, user agent, etc.) */
		metadata: jsonb('metadata').$type<{
			ip?: string
			userAgent?: string
			characterId?: string
		}>(),
		/** Last activity timestamp */
		lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [
		index('user_sessions_user_id_idx').on(table.userId),
		index('user_sessions_session_token_idx').on(table.sessionToken),
		index('user_sessions_expires_at_idx').on(table.expiresAt),
	]
)

/**
 * User preferences table - User settings
 *
 * Stores user preferences and UI settings.
 */
export const userPreferences = pgTable('user_preferences', {
	userId: uuid('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	/** JSONB preferences object */
	preferences: jsonb('preferences')
		.$type<{
			theme?: 'light' | 'dark' | 'auto'
			notifications?: {
				email?: boolean
				push?: boolean
			}
			[key: string]: unknown
		}>()
		.notNull()
		.default({}),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * User activity log table - Audit trail
 *
 * Tracks important user actions for security and debugging.
 */
export const userActivityLog = pgTable(
	'user_activity_log',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
		/** Action type (e.g., 'login', 'logout', 'character_linked', 'role_granted') */
		action: varchar('action', { length: 100 }).notNull(),
		/** Additional metadata about the action */
		metadata: jsonb('metadata').$type<{
			ip?: string
			userAgent?: string
			characterId?: string
			success?: boolean
			error?: string
			[key: string]: unknown
		}>(),
		timestamp: timestamp('timestamp').defaultNow().notNull(),
	},
	(table) => [
		index('user_activity_log_user_id_idx').on(table.userId),
		index('user_activity_log_action_idx').on(table.action),
		index('user_activity_log_timestamp_idx').on(table.timestamp),
	]
)

/**
 * OAuth states table - Track OAuth flow types
 *
 * Tracks OAuth state parameters to distinguish between login, character linking, and Discord linking flows.
 * States are short-lived and cleaned up after use or expiration.
 */
export const oauthStates = pgTable(
	'oauth_states',
	{
		/** OAuth state parameter (UUID) */
		state: varchar('state', { length: 255 }).primaryKey(),
		/** Flow type: 'login', 'character', or 'discord' */
		flowType: varchar('flow_type', { length: 50 }).notNull(),
		/** Optional user ID for character/discord linking (must be authenticated) */
		userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
		/** Optional redirect URL after successful authentication */
		redirectUrl: varchar('redirect_url', { length: 500 }),
		/** When this state was created */
		createdAt: timestamp('created_at').defaultNow().notNull(),
		/** When this state expires (15 minutes from creation) */
		expiresAt: timestamp('expires_at').notNull(),
	},
	(table) => [index('oauth_states_expires_at_idx').on(table.expiresAt)]
)

/**
 * Managed Corporations table - Global corporation registry for admin management
 *
 * Tracks EVE Online corporations configured for data collection.
 * Director characters are managed in the eve-corporation-data worker.
 * This table caches metadata and overall verification status.
 * assignedCharacterId represents the "primary" director for backwards compatibility.
 */
export const managedCorporations = pgTable(
	'managed_corporations',
	{
		/** EVE corporation ID */
		corporationId: text('corporation_id').primaryKey(),
		/** Corporation name (cached from ESI) */
		name: varchar('name', { length: 255 }).notNull(),
		/** Corporation ticker (cached from ESI) */
		ticker: varchar('ticker', { length: 10 }).notNull(),
		/** Primary director character ID (for backwards compatibility, can be null) */
		assignedCharacterId: text('assigned_character_id'),
		/** Primary director character name (cached) */
		assignedCharacterName: varchar('assigned_character_name', { length: 255 }),
		/** Whether this corporation is active for data collection */
		isActive: boolean('is_active').default(true).notNull(),
		/** Whether this corporation should be included in background data refresh */
		includeInBackgroundRefresh: boolean('include_in_background_refresh').default(false).notNull(),
		/** Last successful data sync timestamp */
		lastSync: timestamp('last_sync', { withTimezone: true }),
		/** Last verification timestamp (any director verified) */
		lastVerified: timestamp('last_verified', { withTimezone: true }),
		/** Whether at least one director has verified access */
		isVerified: boolean('is_verified').default(false).notNull(),
		/** Number of healthy directors currently available */
		healthyDirectorCount: integer('healthy_director_count').default(0).notNull(),
		/** Admin user who configured this corporation */
		configuredBy: uuid('configured_by').references(() => users.id, { onDelete: 'set null' }),
		/** Whether this corporation is a member corporation of the alliance */
		isMemberCorporation: boolean('is_member_corporation').default(false).notNull(),
		/** Whether this corporation is an alt corporation */
		isAltCorp: boolean('is_alt_corp').default(false).notNull(),
		/** Whether this corporation is a special purpose corporation */
		isSpecialPurpose: boolean('is_special_purpose').default(false).notNull(),
		/** Whether this corporation is actively recruiting (shown in browse corporations) */
		isRecruiting: boolean('is_recruiting').default(true).notNull(),
		/** Short description shown on browse corporations page (max 250 chars) */
		shortDescription: varchar('short_description', { length: 250 }),
		/** Full description and application instructions shown on corporation detail page */
		fullDescription: text('full_description'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('managed_corporations_name_idx').on(table.name),
		index('managed_corporations_ticker_idx').on(table.ticker),
		index('managed_corporations_assigned_character_id_idx').on(table.assignedCharacterId),
		index('managed_corporations_is_active_idx').on(table.isActive),
		index('managed_corporations_include_in_background_refresh_idx').on(
			table.includeInBackgroundRefresh
		),
		index('managed_corporations_corporation_id_is_member_idx').on(
			table.corporationId,
			table.isMemberCorporation
		),
		index('managed_corporations_corporation_id_is_alt_idx').on(
			table.corporationId,
			table.isAltCorp
		),
		index('managed_corporations_corporation_id_is_special_purpose_idx').on(
			table.corporationId,
			table.isSpecialPurpose
		),
	]
)

/**
 * Discord Servers Registry
 *
 * Centralized registry of Discord servers that can be linked to corporations and groups.
 * Admins add servers here once and reuse across multiple entities.
 */
export const discordServers = pgTable(
	'discord_servers',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Discord guild/server ID */
		guildId: text('guild_id').unique().notNull(),
		/** Discord guild/server name */
		guildName: text('guild_name').notNull(),
		/** Description/notes about this server */
		description: text('description'),
		/** Whether this server is active */
		isActive: boolean('is_active').default(true).notNull(),
		/** Whether to automatically manage user nicknames to match their primary character name */
		manageNicknames: boolean('manage_nicknames').default(false).notNull(),
		/** Admin user who added this server */
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('discord_servers_guild_id_idx').on(table.guildId)]
)

/**
 * Discord Roles
 *
 * Roles that exist within a Discord server in the registry.
 * These can be assigned to users when they join via auto-invite.
 */
export const discordRoles = pgTable(
	'discord_roles',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Which Discord server this role belongs to */
		discordServerId: uuid('discord_server_id')
			.notNull()
			.references(() => discordServers.id, { onDelete: 'cascade' }),
		/** Discord role ID */
		roleId: text('role_id').notNull(),
		/** Discord role name */
		roleName: text('role_name').notNull(),
		/** Description/notes about this role */
		description: text('description'),
		/** Whether this role is active */
		isActive: boolean('is_active').default(true).notNull(),
		/** Whether this role should be auto-applied to all users joining through the system */
		autoApply: boolean('auto_apply').default(false).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('discord_roles_server_id_idx').on(table.discordServerId),
		unique('unique_discord_server_role').on(table.discordServerId, table.roleId),
	]
)

/**
 * Corporation Discord Servers
 *
 * Links corporations to Discord servers from the registry.
 * One corporation can have multiple Discord servers.
 */
export const corporationDiscordServers = pgTable(
	'corporation_discord_servers',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Which corporation this attachment belongs to */
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		/** Which Discord server from the registry */
		discordServerId: uuid('discord_server_id')
			.notNull()
			.references(() => discordServers.id, { onDelete: 'cascade' }),
		/** Whether to automatically invite corporation members */
		autoInvite: boolean('auto_invite').default(false).notNull(),
		/** Whether to automatically assign roles on invite */
		autoAssignRoles: boolean('auto_assign_roles').default(false).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corp_discord_servers_corp_id_idx').on(table.corporationId),
		index('corp_discord_servers_server_id_idx').on(table.discordServerId),
		unique('unique_corp_discord_server').on(table.corporationId, table.discordServerId),
	]
)

/**
 * Corporation Discord Server Roles
 *
 * Roles to assign to users when they join a corporation's Discord server.
 * Links corporation_discord_servers to specific discord_roles.
 */
export const corporationDiscordServerRoles = pgTable(
	'corporation_discord_server_roles',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Which corporation-server attachment */
		corporationDiscordServerId: uuid('corporation_discord_server_id')
			.notNull()
			.references(() => corporationDiscordServers.id, { onDelete: 'cascade' }),
		/** Which role from the Discord server */
		discordRoleId: uuid('discord_role_id')
			.notNull()
			.references(() => discordRoles.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corp_discord_server_roles_attachment_idx').on(table.corporationDiscordServerId),
		unique('unique_corp_discord_server_role').on(
			table.corporationDiscordServerId,
			table.discordRoleId
		),
	]
)

/**
 * Corporation Discord Invites audit table
 *
 * Tracks Discord server join attempts for corporation members.
 * Used for debugging and auditing auto-invite functionality.
 */
export const corporationDiscordInvites = pgTable(
	'corporation_discord_invites',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Corporation ID */
		corporationId: text('corporation_id')
			.notNull()
			.references(() => managedCorporations.corporationId, { onDelete: 'cascade' }),
		/** Corporation Discord Server attachment ID */
		corporationDiscordServerId: uuid('corporation_discord_server_id').references(
			() => corporationDiscordServers.id,
			{ onDelete: 'set null' }
		),
		/** User ID from core users table */
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Discord user ID */
		discordUserId: varchar('discord_user_id', { length: 255 }).notNull(),
		/** Whether the invite/join was successful */
		success: boolean('success').notNull(),
		/** Error message if invite failed */
		errorMessage: text('error_message'),
		/** Array of Discord role IDs that were assigned (if any) */
		assignedRoleIds: text('assigned_role_ids').array(),
		/** When the invite attempt was made */
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corporation_discord_invites_corp_id_idx').on(table.corporationId),
		index('corporation_discord_invites_user_id_idx').on(table.userId),
		index('corporation_discord_invites_server_id_idx').on(table.corporationDiscordServerId),
		index('corporation_discord_invites_created_at_idx').on(table.createdAt),
	]
)

/**
 * Relations
 */
export const usersRelations = relations(users, ({ many, one }) => ({
	characters: many(userCharacters),
	sessions: many(userSessions),
	preferences: one(userPreferences),
	activityLog: many(userActivityLog),
}))

export const userCharactersRelations = relations(userCharacters, ({ one }) => ({
	user: one(users, {
		fields: [userCharacters.userId],
		references: [users.id],
	}),
}))

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
	user: one(users, {
		fields: [userSessions.userId],
		references: [users.id],
	}),
}))

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
	user: one(users, {
		fields: [userPreferences.userId],
		references: [users.id],
	}),
}))

export const userActivityLogRelations = relations(userActivityLog, ({ one }) => ({
	user: one(users, {
		fields: [userActivityLog.userId],
		references: [users.id],
	}),
}))

export const managedCorporationsRelations = relations(managedCorporations, ({ one, many }) => ({
	configuredByUser: one(users, {
		fields: [managedCorporations.configuredBy],
		references: [users.id],
	}),
	discordServers: many(corporationDiscordServers),
	discordInvites: many(corporationDiscordInvites),
}))

export const discordServersRelations = relations(discordServers, ({ one, many }) => ({
	createdByUser: one(users, {
		fields: [discordServers.createdBy],
		references: [users.id],
	}),
	roles: many(discordRoles),
	corporationAttachments: many(corporationDiscordServers),
}))

export const discordRolesRelations = relations(discordRoles, ({ one }) => ({
	discordServer: one(discordServers, {
		fields: [discordRoles.discordServerId],
		references: [discordServers.id],
	}),
}))

export const corporationDiscordServersRelations = relations(
	corporationDiscordServers,
	({ one, many }) => ({
		corporation: one(managedCorporations, {
			fields: [corporationDiscordServers.corporationId],
			references: [managedCorporations.corporationId],
		}),
		discordServer: one(discordServers, {
			fields: [corporationDiscordServers.discordServerId],
			references: [discordServers.id],
		}),
		roles: many(corporationDiscordServerRoles),
		invites: many(corporationDiscordInvites),
	})
)

export const corporationDiscordServerRolesRelations = relations(
	corporationDiscordServerRoles,
	({ one }) => ({
		corporationDiscordServer: one(corporationDiscordServers, {
			fields: [corporationDiscordServerRoles.corporationDiscordServerId],
			references: [corporationDiscordServers.id],
		}),
		discordRole: one(discordRoles, {
			fields: [corporationDiscordServerRoles.discordRoleId],
			references: [discordRoles.id],
		}),
	})
)

export const corporationDiscordInvitesRelations = relations(
	corporationDiscordInvites,
	({ one }) => ({
		corporation: one(managedCorporations, {
			fields: [corporationDiscordInvites.corporationId],
			references: [managedCorporations.corporationId],
		}),
		corporationDiscordServer: one(corporationDiscordServers, {
			fields: [corporationDiscordInvites.corporationDiscordServerId],
			references: [corporationDiscordServers.id],
		}),
		user: one(users, {
			fields: [corporationDiscordInvites.userId],
			references: [users.id],
		}),
	})
)

/**
 * Export schema for db client
 */
export const schema = {
	users,
	userCharacters,
	userSessions,
	userPreferences,
	userActivityLog,
	oauthStates,
	managedCorporations,
	discordServers,
	discordRoles,
	corporationDiscordServers,
	corporationDiscordServerRoles,
	corporationDiscordInvites,
	usersRelations,
	userCharactersRelations,
	userSessionsRelations,
	userPreferencesRelations,
	userActivityLogRelations,
	managedCorporationsRelations,
	discordServersRelations,
	discordRolesRelations,
	corporationDiscordServersRelations,
	corporationDiscordServerRolesRelations,
	corporationDiscordInvitesRelations,
}
