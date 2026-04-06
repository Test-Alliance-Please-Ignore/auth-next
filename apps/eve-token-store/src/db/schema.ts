import { relations } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

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
export const eveCharacters = pgTable(
	'eve_characters',
	{
		/** Primary key */
		id: uuid('id').defaultRandom().primaryKey(),

		/** EVE Online character ID */
		characterId: text('character_id').notNull().unique(),

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
		lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }),
		lastAttemptedRefreshAt: timestamp('last_attempted_refresh_at', { withTimezone: true }),

		/** When character ESI data was last successfully synced */
		lastDataSyncAt: timestamp('last_data_sync_at', { withTimezone: true }),
		/** When a data sync was last attempted (used to prevent duplicate dispatch) */
		lastDataSyncAttemptAt: timestamp('last_data_sync_attempt_at', { withTimezone: true }),

		/**
		 * When the character was marked as deleted from EVE.
		 * null = active character, set = character has been deleted from EVE
		 * (biomassed or otherwise removed by CCP)
		 */
		deletedAt: timestamp('deleted_at'),
	},
	(table) => [
		index('eve_characters_character_id_idx').on(table.characterId),
		index('eve_characters_character_owner_hash_idx').on(table.characterOwnerHash),
		index('eve_characters_last_refresh_at_idx').on(table.lastRefreshAt),
		index('eve_characters_last_attempted_refresh_at_idx').on(table.lastAttemptedRefreshAt),
		index('eve_characters_last_data_sync_at_idx').on(table.lastDataSyncAt),
		index('eve_characters_last_data_sync_attempt_at_idx').on(table.lastDataSyncAttemptAt),
	]
)

/**
 * EVE Online OAuth tokens table
 *
 * Stores encrypted access and refresh tokens for EVE SSO authentication.
 * Tokens are encrypted at rest for security.
 */
export const eveTokens = pgTable(
	'eve_tokens',
	{
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
	},
	(table) => [index('eve_tokens_character_id_idx').on(table.characterId)]
)

/**
 * Relations
 */
export const eveCharactersRelations = relations(eveCharacters, ({ many }) => ({
	tokens: many(eveTokens),
}))

export const eveTokensRelations = relations(eveTokens, ({ one }) => ({
	character: one(eveCharacters, {
		fields: [eveTokens.characterId],
		references: [eveCharacters.id],
	}),
}))

/**
 * Export schema object for Drizzle
 */
export const schema = {
	eveCharacters,
	eveTokens,
	eveCharactersRelations,
	eveTokensRelations,
}
