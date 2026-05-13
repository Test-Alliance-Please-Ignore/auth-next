import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core'

// Core-owned tables queried by legacy worker for trusted internal matching.
// These are read-only from legacy and already exist in the shared database.
export const coreUsers = pgTable('users', {
	id: uuid('id').primaryKey(),
	mainCharacterId: text('main_character_id'),
	discordUserId: text('discord_user_id'),
})

export const coreUserCharacters = pgTable('user_characters', {
	id: uuid('id').primaryKey(),
	userId: uuid('user_id').notNull(),
	characterId: text('character_id').notNull(),
	characterName: text('character_name'),
	corporationId: text('corporation_id'),
	corporationName: text('corporation_name'),
	allianceId: text('alliance_id'),
	allianceName: text('alliance_name'),
	isDeleted: boolean('deleted').notNull(),
})
