import { and, eq, ilike, inArray, sql } from '@repo/db-utils'

import type { createDb } from '../db'

/**
 * Character lookup service
 *
 * Searches for users by their main character name.
 * Used when creating invitations by character name.
 *
 * ⚠️ TEMPORARY IMPLEMENTATION (MVP):
 * This service currently queries the core database tables directly.
 * This works because both apps share the same DATABASE_URL.
 *
 * 🔄 FUTURE MIGRATION:
 * Replace these direct database queries with RPC calls to the core worker:
 * - Create methods in core worker: lookupUserByCharacter(), lookupCharactersByUser(), searchCharacters()
 * - Add CORE service binding to groups worker
 * - Update these functions to call the service binding instead of DB
 * - Remove the core table definitions below
 */

/**
 * Core database table definitions (for direct access - TEMPORARY)
 * These match the schema in apps/core/src/db/schema.ts
 *
 * TODO: Remove when migrating to RPC
 */
import { bigint, boolean, pgTable, timestamp, uuid, varchar, text } from 'drizzle-orm/pg-core'

const users = pgTable('users', {
	id: uuid('id').defaultRandom().primaryKey(),
	mainCharacterId: text('main_character_id').notNull().unique(),
	discordUserId: varchar('discord_user_id', { length: 255 }).unique(),
	is_admin: boolean('is_admin').default(false).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

const userCharacters = pgTable('user_characters', {
	id: uuid('id').defaultRandom().primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	characterOwnerHash: varchar('character_owner_hash', { length: 255 }).notNull(),
	characterId: text('main_character_id').notNull().unique(),
	characterName: varchar('character_name', { length: 255 }).notNull(),
	is_primary: boolean('is_primary').default(false).notNull(),
	linkedAt: timestamp('linked_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/**
 * Find a user by their main character name
 *
 * MVP: Queries core database directly
 * Future: Replace with RPC call to core worker
 *
 * @param characterName - The main character name to search for (exact match, case-sensitive)
 * @param db - Database client
 * @returns User ID and character ID if found, null otherwise
 */
export async function findUserByMainCharacterName(
	characterName: string,
	db: ReturnType<typeof createDb>
): Promise<{ userId: string; characterId: string } | null> {
	// Query for a primary character with matching name
	const result = await db
		.select({
			userId: userCharacters.userId,
			characterId: userCharacters.characterId,
		})
		.from(userCharacters)
		.where(
			sql`${userCharacters.is_primary} = true AND ${userCharacters.characterName} = ${characterName}`
		)
		.limit(1)

	return result[0] || null
}

/**
 * Find a user by their main character ID
 *
 * MVP: Queries core database directly
 * Future: Replace with RPC call to core worker
 *
 * @param mainCharacterId - The main character ID
 * @param db - Database client
 * @returns User ID and character name if found, null otherwise
 */
export async function findUserByMainCharacterId(
	mainCharacterId: number,
	db: ReturnType<typeof createDb>
): Promise<{ userId: string; characterName: string } | null> {
	const result = await db
		.select({
			userId: userCharacters.userId,
			characterName: userCharacters.characterName,
		})
		.from(userCharacters)
		.where(
			sql`${userCharacters.is_primary} = true AND ${userCharacters.characterId} = ${mainCharacterId}`
		)
		.limit(1)

	return result[0] || null
}

/**
 * Bulk lookup user IDs by main character IDs
 *
 * MVP: Queries core database directly
 * Future: Replace with RPC call to core worker
 *
 * @param userIds - Array of user IDs to look up
 * @param db - Database client
 * @returns Map of userId -> character name
 */
export async function bulkFindMainCharactersByUserIds(
	userIds: string[],
	db: ReturnType<typeof createDb>
): Promise<Map<string, string>> {
	if (userIds.length === 0) {
		return new Map()
	}

	const results = await db
		.select({
			userId: userCharacters.userId,
			characterName: userCharacters.characterName,
		})
		.from(userCharacters)
		.where(and(eq(userCharacters.is_primary, true), inArray(userCharacters.userId, userIds)))

	const map = new Map<string, string>()
	for (const row of results) {
		map.set(row.userId, row.characterName)
	}

	return map
}

/**
 * Bulk lookup user IDs by main character IDs with character IDs included
 *
 * MVP: Queries core database directly
 * Future: Replace with RPC call to core worker
 *
 * @param userIds - Array of user IDs to look up
 * @param db - Database client
 * @returns Map of userId -> {name, characterId}
 */
export async function bulkFindMainCharactersWithIdsByUserIds(
	userIds: string[],
	db: ReturnType<typeof createDb>
): Promise<Map<string, { name: string; characterId: string }>> {
	if (userIds.length === 0) {
		return new Map()
	}

	const results = await db
		.select({
			userId: userCharacters.userId,
			characterName: userCharacters.characterName,
			characterId: userCharacters.characterId,
		})
		.from(userCharacters)
		.where(and(eq(userCharacters.is_primary, true), inArray(userCharacters.userId, userIds)))

	const map = new Map<string, { name: string; characterId: string }>()
	for (const row of results) {
		map.set(row.userId, { name: row.characterName, characterId: row.characterId })
	}

	return map
}

/**
 * Search for users by character name (case-insensitive)
 *
 * MVP: Queries core database directly
 * Future: Replace with RPC call to core worker
 *
 * This searches across all characters (not just main characters) and returns
 * the user IDs of accounts that have a character matching the search term.
 *
 * @param searchTerm - The character name to search for (partial match, case-insensitive)
 * @param db - Database client
 * @returns Array of matching users with their character info
 */
export async function searchUsersByCharacterName(
	searchTerm: string,
	db: ReturnType<typeof createDb>
): Promise<Array<{ userId: string; characterId: string; characterName: string; isMain: boolean }>> {
	const results = await db
		.select({
			userId: userCharacters.userId,
			characterId: userCharacters.characterId,
			characterName: userCharacters.characterName,
			isMain: userCharacters.is_primary,
		})
		.from(userCharacters)
		.where(ilike(userCharacters.characterName, `%${searchTerm}%`))
		.limit(50) // Limit results to prevent overwhelming responses

	return results
}
