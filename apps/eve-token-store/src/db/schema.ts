import { bigint, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Database schema for the eve-token-store worker
 *
 * Stores EVE Online character information and OAuth tokens.
 */

/**
 * EVE Online characters table
 *
 * Stores character information from EVE SSO verification.
 * CharacterOwnerHash is unique and changes if character transfers to a new account.
 */
export const eveCharacters = pgTable('eve_characters', {
	/** Primary key */
	id: uuid('id').defaultRandom().primaryKey(),

	/** EVE Online character ID */
	characterId: bigint('character_id', { mode: 'number' }).notNull().unique(),

	/** EVE Online character name */
	characterName: varchar('character_name', { length: 255 }).notNull(),

	/**
	 * Character owner hash - unique identifier for character + account combination
	 * This hash changes if the character is transferred to a different account
	 */
	characterOwnerHash: varchar('character_owner_hash', { length: 255 }).notNull().unique(),

	/** Granted OAuth scopes as JSON array */
	scopes: text('scopes').notNull(),

	/** When the character was first added */
	createdAt: timestamp('created_at').defaultNow().notNull(),

	/** When the character record was last updated */
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * EVE Online OAuth tokens table
 *
 * Stores encrypted access and refresh tokens for EVE SSO authentication.
 * Tokens are encrypted at rest for security.
 */
export const eveTokens = pgTable('eve_tokens', {
	/** Primary key */
	id: uuid('id').defaultRandom().primaryKey(),

	/** Foreign key to eve_characters table */
	characterId: uuid('character_id')
		.notNull()
		.references(() => eveCharacters.id, { onDelete: 'cascade' }),

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
 * Export schema object for Drizzle
 */
export const schema = {
	eveCharacters,
	eveTokens,
}
