/**
 * Test helpers for admin worker integration tests
 */

import { eq } from '@repo/db-utils'
import type { DbClient } from '@repo/db-utils'

import { adminAuditLog, userCharacters, users } from '../db/schema'
import type { schema } from '../db'

/**
 * Create a test user in the database
 * @returns User ID
 */
export async function createTestUser(db: DbClient<typeof schema>): Promise<string> {
	const characterId = `${Math.floor(Math.random() * 100000000)}`

	const [user] = await db
		.insert(users)
		.values({
			mainCharacterId: characterId,
			is_admin: false,
		})
		.returning()

	// Create the main character
	await db.insert(userCharacters).values({
		userId: user.id,
		characterId,
		characterName: `Test Character ${characterId}`,
		characterOwnerHash: `test-hash-${characterId}`,
		is_primary: true,
	})

	return user.id
}

/**
 * Create an admin user in the database
 * @returns Admin user ID
 */
export async function createAdminUser(db: DbClient<typeof schema>): Promise<string> {
	const characterId = `${Math.floor(Math.random() * 100000000)}`

	const [user] = await db
		.insert(users)
		.values({
			mainCharacterId: characterId,
			is_admin: true,
		})
		.returning()

	// Create the main character
	await db.insert(userCharacters).values({
		userId: user.id,
		characterId,
		characterName: `Admin Character ${characterId}`,
		characterOwnerHash: `admin-hash-${characterId}`,
		is_primary: true,
	})

	return user.id
}

/**
 * Create a test character for a user
 * @returns Character ID
 */
export async function createTestCharacter(
	db: DbClient<typeof schema>,
	userId: string
): Promise<string> {
	const characterId = `${Math.floor(Math.random() * 100000000)}`

	await db.insert(userCharacters).values({
		userId,
		characterId,
		characterName: `Character ${characterId}`,
		characterOwnerHash: `hash-${characterId}`,
		is_primary: false,
	})

	return characterId
}

/**
 * Get all audit log entries for an admin user
 */
export async function getAuditLogs(
	db: DbClient<typeof schema>,
	adminUserId: string
): Promise<any[]> {
	return db.query.adminAuditLog.findMany({
		where: eq(adminAuditLog.adminUserId, adminUserId),
	})
}

/**
 * Clean up test user and all related data
 */
export async function cleanupTestUser(db: DbClient<typeof schema>, userId: string): Promise<void> {
	// Delete user (CASCADE handles characters)
	await db.delete(users).where(eq(users.id, userId))
}

/**
 * Clean up all audit logs
 */
export async function cleanupAuditLogs(db: DbClient<typeof schema>): Promise<void> {
	await db.delete(adminAuditLog)
}

/**
 * Get user character count
 */
export async function getUserCharacterCount(
	db: DbClient<typeof schema>,
	userId: string
): Promise<number> {
	const chars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
	})
	return chars.length
}

/**
 * Check if character exists
 */
export async function characterExists(
	db: DbClient<typeof schema>,
	characterId: string
): Promise<boolean> {
	const char = await db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
	})
	return char !== undefined
}

/**
 * Check if user exists
 */
export async function userExists(db: DbClient<typeof schema>, userId: string): Promise<boolean> {
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
	})
	return user !== undefined
}
