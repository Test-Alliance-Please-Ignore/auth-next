import { relations } from 'drizzle-orm'
import {
	bigint,
	boolean,
	index,
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
		mainCharacterId: bigint('main_character_id', { mode: 'number' })
			.notNull()
			.unique(),
		/** Whether this user is an admin */
		is_admin: boolean('is_admin').default(false).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('users_main_character_id_idx').on(table.mainCharacterId),
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
		characterId: bigint('character_id', { mode: 'number' }).notNull().unique(),
		/** EVE character name (cached from eve-token-store for convenience) */
		characterName: varchar('character_name', { length: 255 }).notNull(),
		/** Whether this is the user's primary character */
		is_primary: boolean('is_primary').default(false).notNull(),
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
			characterId?: number
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
			characterId?: number
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
 * Tracks OAuth state parameters to distinguish between login and character linking flows.
 * States are short-lived and cleaned up after use or expiration.
 */
export const oauthStates = pgTable(
	'oauth_states',
	{
		/** OAuth state parameter (UUID) */
		state: varchar('state', { length: 255 }).primaryKey(),
		/** Flow type: 'login' or 'character' */
		flowType: varchar('flow_type', { length: 50 }).notNull(),
		/** Optional user ID for character linking (must be authenticated) */
		userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
		/** When this state was created */
		createdAt: timestamp('created_at').defaultNow().notNull(),
		/** When this state expires (15 minutes from creation) */
		expiresAt: timestamp('expires_at').notNull(),
	},
	(table) => [
		index('oauth_states_expires_at_idx').on(table.expiresAt),
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
	usersRelations,
	userCharactersRelations,
	userSessionsRelations,
	userPreferencesRelations,
	userActivityLogRelations,
}
