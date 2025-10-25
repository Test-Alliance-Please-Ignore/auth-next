import { relations } from 'drizzle-orm'
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
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
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('users_main_character_id_idx').on(table.mainCharacterId),
		index('users_discord_user_id_idx').on(table.discordUserId),
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
		/** Last successful data sync timestamp */
		lastSync: timestamp('last_sync', { withTimezone: true }),
		/** Last verification timestamp (any director verified) */
		lastVerified: timestamp('last_verified', { withTimezone: true }),
		/** Whether at least one director has verified access */
		isVerified: boolean('is_verified').default(false).notNull(),
		/** Number of healthy directors currently available */
		healthyDirectorCount: integer('healthy_director_count').default(0).notNull(),
		/** Discord server/guild ID linked to this corporation */
		discordGuildId: varchar('discord_guild_id', { length: 255 }),
		/** Discord server name (cached) */
		discordGuildName: varchar('discord_guild_name', { length: 255 }),
		/** Whether to automatically invite corporation members to Discord server */
		discordAutoInvite: boolean('discord_auto_invite').default(false).notNull(),
		/** Admin user who configured this corporation */
		configuredBy: uuid('configured_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('managed_corporations_name_idx').on(table.name),
		index('managed_corporations_ticker_idx').on(table.ticker),
		index('managed_corporations_assigned_character_id_idx').on(table.assignedCharacterId),
		index('managed_corporations_is_active_idx').on(table.isActive),
		index('managed_corporations_discord_guild_id_idx').on(table.discordGuildId),
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
		/** When the invite attempt was made */
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('corporation_discord_invites_corp_id_idx').on(table.corporationId),
		index('corporation_discord_invites_user_id_idx').on(table.userId),
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

export const managedCorporationsRelations = relations(managedCorporations, ({ one }) => ({
	configuredByUser: one(users, {
		fields: [managedCorporations.configuredBy],
		references: [users.id],
	}),
}))

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
	corporationDiscordInvites,
	usersRelations,
	userCharactersRelations,
	userSessionsRelations,
	userPreferencesRelations,
	userActivityLogRelations,
	managedCorporationsRelations,
}
