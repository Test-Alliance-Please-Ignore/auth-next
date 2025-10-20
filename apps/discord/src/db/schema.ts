import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Database schema for the discord worker
 *
 * Stores Discord user information and OAuth tokens.
 */

/**
 * Discord users table
 *
 * Stores user information from Discord OAuth.
 */
export const discordUsers = pgTable('discord_users', {
	/** Primary key */
	id: uuid('id').defaultRandom().primaryKey(),

	/** Discord user ID */
	userId: varchar('user_id', { length: 255 }).notNull().unique(),

	/** Discord username */
	username: varchar('username', { length: 255 }).notNull(),

	/** Discord discriminator (legacy, may be "0" for new usernames) */
	discriminator: varchar('discriminator', { length: 4 }).notNull(),

	/** Granted OAuth scopes as JSON array */
	scopes: text('scopes').notNull(),

	/** Core worker user ID (links to users.id in core database) */
	coreUserId: varchar('core_user_id', { length: 255 }).unique(),

	/** When the user was first added */
	createdAt: timestamp('created_at').defaultNow().notNull(),

	/** When the user record was last updated */
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Discord OAuth tokens table
 *
 * Stores encrypted access and refresh tokens for Discord OAuth.
 * Tokens are encrypted at rest for security.
 */
export const discordTokens = pgTable('discord_tokens', {
	/** Primary key */
	id: uuid('id').defaultRandom().primaryKey(),

	/** Foreign key to discord_users table */
	userId: uuid('user_id')
		.notNull()
		.references(() => discordUsers.id, { onDelete: 'cascade' }),

	/** Encrypted OAuth access token */
	accessToken: text('access_token').notNull(),

	/** Encrypted OAuth refresh token (may be null for some flows) */
	refreshToken: text('refresh_token'),

	/** When the access token expires */
	expiresAt: timestamp('expires_at').notNull(),

	/** When the token was created */
	createdAt: timestamp('created_at').defaultNow().notNull(),

	/** When the token was last updated (e.g., after refresh) */
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Relations
 */
export const discordUsersRelations = relations(discordUsers, ({ many }) => ({
	tokens: many(discordTokens),
}))

export const discordTokensRelations = relations(discordTokens, ({ one }) => ({
	user: one(discordUsers, {
		fields: [discordTokens.userId],
		references: [discordUsers.id],
	}),
}))

/**
 * Export schema object for Drizzle
 */
export const schema = {
	discordUsers,
	discordTokens,
	discordUsersRelations,
	discordTokensRelations,
}
