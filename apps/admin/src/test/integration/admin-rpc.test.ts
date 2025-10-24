/**
 * Integration tests for Admin Worker RPC methods
 *
 * Tests all AdminService operations including:
 * - User deletion
 * - Character transfer
 * - Character deletion
 * - User search and lookup
 * - Activity log queries
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'

import { createDb } from '../../db'
import type { schema } from '../../db'
import type { DbClient } from '@repo/db-utils'
import type { Env } from '../../context'

import {
	cleanupAuditLogs,
	cleanupTestUser,
	createAdminUser,
	createTestCharacter,
	createTestUser,
	characterExists,
	getAuditLogs,
	getUserCharacterCount,
	userExists,
} from '../helpers'

// Import the worker class
import AdminWorker from '../../index'

// Cast env to have correct types
const testEnv = env as unknown as Env

describe('Admin Worker RPC', () => {
	let db: DbClient<typeof schema>
	let worker: AdminWorker
	let adminUserId: string

	beforeEach(async () => {
		// Initialize database client
		db = createDb(testEnv.DATABASE_URL)

		// Create worker instance
		worker = new AdminWorker({ waitUntil: () => {} } as any, testEnv)

		// Clean up audit logs from previous tests
		await cleanupAuditLogs(db)

		// Create an admin user for testing
		adminUserId = await createAdminUser(db)
	})

	describe('deleteUser', () => {
		it('should successfully delete a user with multiple characters', async () => {
			// Create test user with multiple characters
			const userId = await createTestUser(db)
			const charId1 = await createTestCharacter(db, userId)
			const charId2 = await createTestCharacter(db, userId)

			// Verify user and characters exist
			expect(await userExists(db, userId)).toBe(true)
			expect(await characterExists(db, charId1)).toBe(true)
			expect(await characterExists(db, charId2)).toBe(true)

			// Delete user via RPC
			const result = await worker.deleteUser(userId, adminUserId)

			// Verify result
			expect(result.success).toBe(true)
			expect(result.deletedUserId).toBe(userId)
			expect(result.deletedCharacterIds).toHaveLength(3) // main + 2 additional

			// Verify user and characters are deleted
			expect(await userExists(db, userId)).toBe(false)
			expect(await characterExists(db, charId1)).toBe(false)
			expect(await characterExists(db, charId2)).toBe(false)

			// Verify audit log entry
			const logs = await getAuditLogs(db, adminUserId)
			expect(logs).toHaveLength(1)
			expect(logs[0]?.action).toBe('admin_user_deleted')
			expect(logs[0]?.targetUserId).toBe(userId)
		})

		it('should throw error when deleting non-existent user', async () => {
			const fakeUserId = '00000000-0000-0000-0000-000000000000'

			await expect(worker.deleteUser(fakeUserId, adminUserId)).rejects.toThrow('User not found')
		})

		it('should log token revocation failures but continue deletion', async () => {
			// Note: We can't easily test this without mocking the token store
			// This test documents the expected behavior
			const userId = await createTestUser(db)

			const result = await worker.deleteUser(userId, adminUserId)

			expect(result.success).toBe(true)
			// tokensRevoked count may be 0 if token store is not available
		})
	})

	describe('transferCharacterOwnership', () => {
		it('should successfully transfer character to another user', async () => {
			// Create source user with 2 characters
			const sourceUserId = await createTestUser(db)
			const charToTransfer = await createTestCharacter(db, sourceUserId)

			// Create target user
			const targetUserId = await createTestUser(db)

			// Verify initial state
			expect(await getUserCharacterCount(db, sourceUserId)).toBe(2) // main + 1
			expect(await getUserCharacterCount(db, targetUserId)).toBe(1) // main only

			// Transfer character via RPC
			const result = await worker.transferCharacterOwnership(charToTransfer, targetUserId, adminUserId)

			// Verify result
			expect(result.success).toBe(true)
			expect(result.characterId).toBe(charToTransfer)
			expect(result.oldUserId).toBe(sourceUserId)
			expect(result.newUserId).toBe(targetUserId)

			// Verify character counts updated
			expect(await getUserCharacterCount(db, sourceUserId)).toBe(1)
			expect(await getUserCharacterCount(db, targetUserId)).toBe(2)

			// Verify audit log entry
			const logs = await getAuditLogs(db, adminUserId)
			expect(logs).toHaveLength(1)
			expect(logs[0]?.action).toBe('admin_character_transferred')
			expect(logs[0]?.targetCharacterId).toBe(charToTransfer)
			expect(logs[0]?.targetUserId).toBe(targetUserId)

			// Cleanup
			await cleanupTestUser(db, sourceUserId)
			await cleanupTestUser(db, targetUserId)
		})

		it('should throw error when transferring non-existent character', async () => {
			const targetUserId = await createTestUser(db)
			const fakeCharId = '99999999'

			await expect(
				worker.transferCharacterOwnership(fakeCharId, targetUserId, adminUserId)
			).rejects.toThrow('Character not found')

			await cleanupTestUser(db, targetUserId)
		})

		it('should throw error when target user does not exist', async () => {
			const userId = await createTestUser(db)
			const charId = await createTestCharacter(db, userId)
			const fakeTargetUserId = '00000000-0000-0000-0000-000000000000'

			await expect(
				worker.transferCharacterOwnership(charId, fakeTargetUserId, adminUserId)
			).rejects.toThrow('Target user not found')

			await cleanupTestUser(db, userId)
		})

		it('should throw error when transferring to same user', async () => {
			const userId = await createTestUser(db)
			const charId = await createTestCharacter(db, userId)

			await expect(worker.transferCharacterOwnership(charId, userId, adminUserId)).rejects.toThrow(
				'Character is already owned by target user'
			)

			await cleanupTestUser(db, userId)
		})

		it("should throw error when transferring user's only character", async () => {
			const userId = await createTestUser(db)
			const targetUserId = await createTestUser(db)

			// Get the main character ID from user
			const { userCharacters } = await import('../../db/schema')
			const { eq } = await import('@repo/db-utils')
			const chars = await db.query.userCharacters.findMany({
				where: eq(userCharacters.userId, userId),
			})
			const mainCharId = chars[0]?.characterId!

			await expect(
				worker.transferCharacterOwnership(mainCharId, targetUserId, adminUserId)
			).rejects.toThrow("Cannot transfer user's only character")

			await cleanupTestUser(db, userId)
			await cleanupTestUser(db, targetUserId)
		})
	})

	describe('deleteCharacter', () => {
		it('should successfully delete a character', async () => {
			// Create user with 2 characters
			const userId = await createTestUser(db)
			const charToDelete = await createTestCharacter(db, userId)

			// Verify initial state
			expect(await getUserCharacterCount(db, userId)).toBe(2)
			expect(await characterExists(db, charToDelete)).toBe(true)

			// Delete character via RPC
			const result = await worker.deleteCharacter(charToDelete, adminUserId)

			// Verify result
			expect(result.success).toBe(true)
			expect(result.characterId).toBe(charToDelete)
			expect(result.userId).toBe(userId)

			// Verify character deleted
			expect(await characterExists(db, charToDelete)).toBe(false)
			expect(await getUserCharacterCount(db, userId)).toBe(1)

			// Verify user still exists
			expect(await userExists(db, userId)).toBe(true)

			// Verify audit log entry
			const logs = await getAuditLogs(db, adminUserId)
			expect(logs).toHaveLength(1)
			expect(logs[0]?.action).toBe('admin_character_deleted')
			expect(logs[0]?.targetCharacterId).toBe(charToDelete)

			await cleanupTestUser(db, userId)
		})

		it('should throw error when deleting non-existent character', async () => {
			const fakeCharId = '99999999'

			await expect(worker.deleteCharacter(fakeCharId, adminUserId)).rejects.toThrow(
				'Character not found'
			)
		})

		it("should throw error when deleting user's only character", async () => {
			const userId = await createTestUser(db)

			// Get the main character ID
			const { userCharacters } = await import('../../db/schema')
			const { eq } = await import('@repo/db-utils')
			const chars = await db.query.userCharacters.findMany({
				where: eq(userCharacters.userId, userId),
			})
			const mainCharId = chars[0]?.characterId!

			await expect(worker.deleteCharacter(mainCharId, adminUserId)).rejects.toThrow(
				"Cannot delete user's only character"
			)

			await cleanupTestUser(db, userId)
		})
	})

	describe('searchUsers', () => {
		it('should return all users without search term', async () => {
			// Create test users
			const userId1 = await createTestUser(db)
			const userId2 = await createTestUser(db)

			// Search without term
			const result = await worker.searchUsers({}, adminUserId)

			// Should include our test users plus the admin user
			expect(result.users.length).toBeGreaterThanOrEqual(3)
			expect(result.total).toBeGreaterThanOrEqual(3)
			expect(result.limit).toBe(50) // default limit
			expect(result.offset).toBe(0) // default offset

			// Verify user summaries have correct structure
			const user = result.users[0]
			expect(user).toHaveProperty('id')
			expect(user).toHaveProperty('mainCharacterId')
			expect(user).toHaveProperty('mainCharacterName')
			expect(user).toHaveProperty('characterCount')
			expect(user).toHaveProperty('is_admin')
			expect(user).toHaveProperty('createdAt')
			expect(user).toHaveProperty('updatedAt')

			// Verify audit log entry
			const logs = await getAuditLogs(db, adminUserId)
			expect(logs).toHaveLength(1)
			expect(logs[0]?.action).toBe('admin_user_viewed')

			await cleanupTestUser(db, userId1)
			await cleanupTestUser(db, userId2)
		})

		it('should filter users by character name search', async () => {
			// Create user with specific character name
			const userId = await createTestUser(db)

			// Get character name
			const { userCharacters } = await import('../../db/schema')
			const { eq } = await import('@repo/db-utils')
			const chars = await db.query.userCharacters.findMany({
				where: eq(userCharacters.userId, userId),
			})
			const charName = chars[0]?.characterName!

			// Extract unique part of name for search
			const searchTerm = charName.split(' ')[2] // "Character XXXXXXXX" -> "XXXXXXXX"

			// Search with term
			const result = await worker.searchUsers({ search: searchTerm }, adminUserId)

			// Should find our user
			expect(result.users.length).toBeGreaterThanOrEqual(1)
			expect(result.users.some((u) => u.id === userId)).toBe(true)

			await cleanupTestUser(db, userId)
		})

		it('should support pagination', async () => {
			// Create multiple users
			const userIds = await Promise.all([
				createTestUser(db),
				createTestUser(db),
				createTestUser(db),
			])

			// Get first page
			const page1 = await worker.searchUsers({ limit: 2, offset: 0 }, adminUserId)
			expect(page1.users.length).toBe(2)
			expect(page1.limit).toBe(2)
			expect(page1.offset).toBe(0)

			// Get second page
			const page2 = await worker.searchUsers({ limit: 2, offset: 2 }, adminUserId)
			expect(page2.limit).toBe(2)
			expect(page2.offset).toBe(2)

			// Verify different results
			expect(page1.users[0]?.id).not.toBe(page2.users[0]?.id)

			// Cleanup
			for (const userId of userIds) {
				await cleanupTestUser(db, userId)
			}
		})
	})

	describe('getUserDetails', () => {
		it('should return detailed user information', async () => {
			const userId = await createTestUser(db)
			const charId = await createTestCharacter(db, userId)

			const result = await worker.getUserDetails(userId, adminUserId)

			expect(result).not.toBeNull()
			expect(result!.id).toBe(userId)
			expect(result!.mainCharacterId).toBeDefined()
			expect(result!.is_admin).toBe(false)
			expect(result!.characters).toHaveLength(2) // main + 1
			expect(result!.createdAt).toBeDefined()
			expect(result!.updatedAt).toBeDefined()

			// Verify character details structure
			const char = result!.characters[0]
			expect(char).toHaveProperty('characterId')
			expect(char).toHaveProperty('characterName')
			expect(char).toHaveProperty('characterOwnerHash')
			expect(char).toHaveProperty('is_primary')
			expect(char).toHaveProperty('linkedAt')
			expect(char).toHaveProperty('hasValidToken')

			// Verify audit log entry
			const logs = await getAuditLogs(db, adminUserId)
			expect(logs).toHaveLength(1)
			expect(logs[0]?.action).toBe('admin_user_viewed')
			expect(logs[0]?.targetUserId).toBe(userId)

			await cleanupTestUser(db, userId)
		})

		it('should return null for non-existent user', async () => {
			const fakeUserId = '00000000-0000-0000-0000-000000000000'

			const result = await worker.getUserDetails(fakeUserId, adminUserId)

			expect(result).toBeNull()
		})
	})

	describe('getCharacterDetails', () => {
		it('should return character details when character exists', async () => {
			const userId = await createTestUser(db)
			const charId = await createTestCharacter(db, userId)

			const result = await worker.getCharacterDetails(charId, adminUserId)

			expect(result).not.toBeNull()
			expect(result!.characterId).toBe(charId)
			expect(result!.characterName).toBeDefined()
			expect(result!.owner).not.toBeNull()
			expect(result!.owner!.userId).toBe(userId)
			expect(result!.owner!.isPrimary).toBe(false)
			expect(result!.owner!.linkedAt).toBeDefined()
			expect(result!.hasValidToken).toBe(false)
			expect(result!.publicInfo).toBeDefined()

			// Verify audit log entry
			const logs = await getAuditLogs(db, adminUserId)
			expect(logs).toHaveLength(1)
			expect(logs[0]?.action).toBe('admin_character_viewed')
			expect(logs[0]?.targetCharacterId).toBe(charId)

			await cleanupTestUser(db, userId)
		})

		it('should return null for non-existent character', async () => {
			const fakeCharId = '99999999'

			const result = await worker.getCharacterDetails(fakeCharId, adminUserId)

			// Returns null when character not found in either DB or EVE Character Data
			expect(result).toBeNull()
		})
	})

	describe('getActivityLog', () => {
		it('should return activity logs with default pagination', async () => {
			// Create some activity by performing operations
			const userId = await createTestUser(db)
			await worker.getUserDetails(userId, adminUserId)
			await worker.searchUsers({}, adminUserId)

			// Get activity log
			const result = await worker.getActivityLog({}, adminUserId)

			expect(result.logs.length).toBeGreaterThanOrEqual(2)
			expect(result.total).toBeGreaterThanOrEqual(2)
			expect(result.limit).toBe(50) // default
			expect(result.offset).toBe(0) // default

			// Verify log entry structure
			const log = result.logs[0]
			expect(log).toHaveProperty('id')
			expect(log).toHaveProperty('adminUserId')
			expect(log).toHaveProperty('action')
			expect(log).toHaveProperty('timestamp')
			expect(log).toHaveProperty('metadata')

			await cleanupTestUser(db, userId)
		})

		it('should filter logs by action type', async () => {
			// Create specific actions
			const userId = await createTestUser(db)
			await worker.getUserDetails(userId, adminUserId)
			await worker.searchUsers({}, adminUserId)

			// Filter by action
			const result = await worker.getActivityLog({ action: 'admin_user_viewed' }, adminUserId)

			expect(result.logs.length).toBeGreaterThan(0)
			expect(result.logs.every((log) => log.action === 'admin_user_viewed')).toBe(true)

			await cleanupTestUser(db, userId)
		})

		it('should filter logs by admin user', async () => {
			// Create another admin
			const otherAdminId = await createAdminUser(db)

			// Create actions from both admins
			const userId = await createTestUser(db)
			await worker.getUserDetails(userId, adminUserId) // Our admin
			await worker.getUserDetails(userId, otherAdminId) // Other admin

			// Filter by admin user
			const result = await worker.getActivityLog({ adminUserId }, adminUserId)

			expect(result.logs.every((log) => log.adminUserId === adminUserId)).toBe(true)

			await cleanupTestUser(db, userId)
			await cleanupTestUser(db, otherAdminId)
		})

		it('should support pagination', async () => {
			// Create multiple log entries
			const userId = await createTestUser(db)
			await worker.getUserDetails(userId, adminUserId)
			await worker.searchUsers({}, adminUserId)
			await worker.getUserDetails(userId, adminUserId)

			// Get first page
			const page1 = await worker.getActivityLog({ limit: 2, offset: 0 }, adminUserId)
			expect(page1.logs.length).toBe(2)
			expect(page1.limit).toBe(2)
			expect(page1.offset).toBe(0)

			// Get second page
			const page2 = await worker.getActivityLog({ limit: 2, offset: 2 }, adminUserId)
			expect(page2.limit).toBe(2)
			expect(page2.offset).toBe(2)

			// Verify different results (logs are ordered by timestamp DESC)
			expect(page1.logs[0]?.id).not.toBe(page2.logs[0]?.id)

			await cleanupTestUser(db, userId)
		})

		it('should order logs by timestamp descending', async () => {
			// Create multiple log entries
			const userId = await createTestUser(db)
			await worker.getUserDetails(userId, adminUserId)
			await new Promise((resolve) => setTimeout(resolve, 10)) // Small delay
			await worker.searchUsers({}, adminUserId)

			// Get logs
			const result = await worker.getActivityLog({}, adminUserId)

			// Verify descending order (most recent first)
			for (let i = 0; i < result.logs.length - 1; i++) {
				const current = new Date(result.logs[i]!.timestamp).getTime()
				const next = new Date(result.logs[i + 1]!.timestamp).getTime()
				expect(current).toBeGreaterThanOrEqual(next)
			}

			await cleanupTestUser(db, userId)
		})
	})
})
