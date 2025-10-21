import type { createDb } from '../db'

/**
 * Character lookup service
 *
 * Searches for users by their main character name.
 * Used when creating invitations by character name.
 *
 * NOTE: This service requires integration with the core worker to access
 * the users and userCharacters tables. For now, these are placeholder implementations.
 */

/**
 * Find a user by their main character name
 *
 * TODO: Implement by calling the core worker or accessing a shared database
 *
 * @param characterName - The main character name to search for
 * @param db - Database client (currently unused - would need core DB access)
 * @returns User ID and character ID if found, null otherwise
 */
export async function findUserByMainCharacterName(
	characterName: string,
	db: ReturnType<typeof createDb>
): Promise<{ userId: string; characterId: number } | null> {
	// TODO: Implement character lookup via core worker or shared database
	// This would require either:
	// 1. RPC call to core worker
	// 2. Shared database access
	// 3. Separate lookup service

	console.warn('findUserByMainCharacterName not yet implemented - requires core worker integration')
	return null
}

/**
 * Find a user by their main character ID
 *
 * TODO: Implement by calling the core worker or accessing a shared database
 *
 * @param mainCharacterId - The main character ID
 * @param db - Database client (currently unused - would need core DB access)
 * @returns User ID and character name if found, null otherwise
 */
export async function findUserByMainCharacterId(
	mainCharacterId: number,
	db: ReturnType<typeof createDb>
): Promise<{ userId: string; characterName: string } | null> {
	// TODO: Implement via core worker integration

	console.warn('findUserByMainCharacterId not yet implemented - requires core worker integration')
	return null
}

/**
 * Search for users by character name (case-insensitive)
 *
 * TODO: Implement by calling the core worker or accessing a shared database
 *
 * This searches across all characters (not just main characters) and returns
 * the user IDs of accounts that have a character matching the search term.
 *
 * @param searchTerm - The character name to search for
 * @param db - Database client (currently unused - would need core DB access)
 * @returns Array of matching users with their character info
 */
export async function searchUsersByCharacterName(
	searchTerm: string,
	db: ReturnType<typeof createDb>
): Promise<Array<{ userId: string; characterId: number; characterName: string; isMain: boolean }>> {
	// TODO: Implement via core worker integration

	console.warn('searchUsersByCharacterName not yet implemented - requires core worker integration')
	return []
}
