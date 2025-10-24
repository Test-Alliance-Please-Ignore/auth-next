/**
 * Integration tests for Admin HTTP endpoints in Core worker
 *
 * Tests the HTTP API layer that proxies to the Admin worker via RPC.
 * Covers authentication, authorization, request validation, and error handling.
 */

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import worker from '../../index'
import type { Env } from '../../context'

// Import core schema for test helpers
import { createDbClient, eq, type DbClient } from '@repo/db-utils'
import * as schema from '../../db/schema'

// Cast env to have correct types
const testEnv = env as unknown as Env

// Helper to create test session token
async function createTestSession(
	db: DbClient<typeof schema>,
	userId: string,
	_isAdmin = false
): Promise<string> {
	const sessionToken = `test-session-${Date.now()}-${Math.random()}`

	await db.insert(schema.userSessions).values({
		userId,
		sessionToken,
		expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
	})

	return sessionToken
}

// Helper to create test user
async function createTestUser(
	db: DbClient<typeof schema>,
	isAdmin = false
): Promise<{ userId: string; sessionToken: string }> {
	const characterId = `${Math.floor(Math.random() * 100000000)}`

	const [user] = await db
		.insert(schema.users)
		.values({
			mainCharacterId: characterId,
			is_admin: isAdmin,
		})
		.returning()

	await db.insert(schema.userCharacters).values({
		userId: user.id,
		characterId,
		characterName: `Test Character ${characterId}`,
		characterOwnerHash: `test-hash-${characterId}`,
		is_primary: true,
	})

	const sessionToken = await createTestSession(db, user.id, isAdmin)

	return { userId: user.id, sessionToken }
}

// Helper to create test character for user
async function createTestCharacter(db: DbClient<typeof schema>, userId: string): Promise<string> {
	const characterId = `${Math.floor(Math.random() * 100000000)}`

	await db.insert(schema.userCharacters).values({
		userId,
		characterId,
		characterName: `Character ${characterId}`,
		characterOwnerHash: `hash-${characterId}`,
		is_primary: false,
	})

	return characterId
}

// Helper to cleanup test user
async function cleanupTestUser(db: DbClient<typeof schema>, userId: string): Promise<void> {
	await db.delete(schema.users).where(eq(schema.users.id, userId))
}

describe('Admin HTTP Endpoints', () => {
	let db: DbClient<typeof schema>
	let adminUser: { userId: string; sessionToken: string }
	let regularUser: { userId: string; sessionToken: string }

	beforeEach(async () => {
		db = createDbClient(testEnv.DATABASE_URL, schema)

		// Create admin and regular test users
		adminUser = await createTestUser(db, true)
		regularUser = await createTestUser(db, false)
	})

	describe('Authentication & Authorization', () => {
		it('should reject unauthenticated requests', async () => {
			const request = new Request('http://example.com/api/admin/users')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(401)
		})

		it('should reject non-admin users', async () => {
			const request = new Request('http://example.com/api/admin/users', {
				headers: {
					Cookie: `session_token=${regularUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(403)
		})

		it('should allow admin users', async () => {
			const request = new Request('http://example.com/api/admin/users', {
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
		})
	})

	describe('GET /api/admin/users', () => {
		it('should return paginated user list', async () => {
			const request = new Request('http://example.com/api/admin/users', {
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as {
				users: any[]
				total: number
				limit: number
				offset: number
			}

			expect(data).toHaveProperty('users')
			expect(data).toHaveProperty('total')
			expect(data).toHaveProperty('limit')
			expect(data).toHaveProperty('offset')
			expect(Array.isArray(data.users)).toBe(true)
		})

		it('should support search query parameter', async () => {
			const request = new Request('http://example.com/api/admin/users?search=Test', {
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as { users: any[] }
			expect(Array.isArray(data.users)).toBe(true)
		})

		it('should support pagination parameters', async () => {
			const request = new Request('http://example.com/api/admin/users?limit=10&offset=5', {
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as { limit: number; offset: number }
			expect(data.limit).toBe(10)
			expect(data.offset).toBe(5)
		})
	})

	describe('GET /api/admin/users/:userId', () => {
		it('should return user details', async () => {
			const request = new Request(`http://example.com/api/admin/users/${regularUser.userId}`, {
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as {
				id: string
				mainCharacterId: string
				is_admin: boolean
				characters: any[]
			}

			expect(data).toHaveProperty('id')
			expect(data).toHaveProperty('mainCharacterId')
			expect(data).toHaveProperty('is_admin')
			expect(data).toHaveProperty('characters')
			expect(data.id).toBe(regularUser.userId)
		})

		it('should return 404 for non-existent user', async () => {
			const fakeUserId = '00000000-0000-0000-0000-000000000000'
			const request = new Request(`http://example.com/api/admin/users/${fakeUserId}`, {
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(404)
		})
	})

	describe('DELETE /api/admin/users/:userId', () => {
		it('should delete a user successfully', async () => {
			// Create a user to delete with multiple characters
			const userToDelete = await createTestUser(db, false)
			await createTestCharacter(db, userToDelete.userId)

			const request = new Request(`http://example.com/api/admin/users/${userToDelete.userId}`, {
				method: 'DELETE',
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as { success: boolean; deletedUserId: string }
			expect(data.success).toBe(true)
			expect(data.deletedUserId).toBe(userToDelete.userId)

			// Verify user is actually deleted
			const deletedUser = await db.query.users.findFirst({
				where: eq(schema.users.id, userToDelete.userId),
			})
			expect(deletedUser).toBeUndefined()
		})

		it('should return 400 for invalid UUID format', async () => {
			const request = new Request('http://example.com/api/admin/users/invalid-uuid', {
				method: 'DELETE',
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)
			const data = (await response.json()) as { error: string }
			expect(data.error).toContain('Invalid user ID format')
		})

		it('should return 404 for non-existent user', async () => {
			const fakeUserId = '00000000-0000-0000-0000-000000000000'
			const request = new Request(`http://example.com/api/admin/users/${fakeUserId}`, {
				method: 'DELETE',
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(404)
		})
	})

	describe('GET /api/admin/characters/:characterId', () => {
		it('should return character details', async () => {
			const charId = await createTestCharacter(db, regularUser.userId)

			const request = new Request(`http://example.com/api/admin/characters/${charId}`, {
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as {
				characterId: string
				characterName: string
				owner: any
			}

			expect(data).toHaveProperty('characterId')
			expect(data).toHaveProperty('characterName')
			expect(data).toHaveProperty('owner')
			expect(data.characterId).toBe(charId)
		})

		it('should return 404 for non-existent character', async () => {
			const fakeCharId = '99999999'
			const request = new Request(`http://example.com/api/admin/characters/${fakeCharId}`, {
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(404)
		})
	})

	describe('POST /api/admin/characters/:characterId/transfer', () => {
		it('should transfer character ownership', async () => {
			// Create source user with 2 characters
			const sourceUser = await createTestUser(db, false)
			const charToTransfer = await createTestCharacter(db, sourceUser.userId)

			// Create target user
			const targetUser = await createTestUser(db, false)

			const request = new Request(
				`http://example.com/api/admin/characters/${charToTransfer}/transfer`,
				{
					method: 'POST',
					headers: {
						Cookie: `session_token=${adminUser.sessionToken}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ newUserId: targetUser.userId }),
				}
			)
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as {
				success: boolean
				characterId: string
				oldUserId: string
				newUserId: string
			}

			expect(data.success).toBe(true)
			expect(data.characterId).toBe(charToTransfer)
			expect(data.oldUserId).toBe(sourceUser.userId)
			expect(data.newUserId).toBe(targetUser.userId)

			// Cleanup
			await cleanupTestUser(db, sourceUser.userId)
			await cleanupTestUser(db, targetUser.userId)
		})

		it('should validate request body schema', async () => {
			const charId = await createTestCharacter(db, regularUser.userId)

			const request = new Request(`http://example.com/api/admin/characters/${charId}/transfer`, {
				method: 'POST',
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ newUserId: 'invalid-uuid' }),
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)
			const data = (await response.json()) as { error: string }
			expect(data.error).toContain('Invalid request body')
		})

		it('should return 404 for non-existent character', async () => {
			const targetUser = await createTestUser(db, false)
			const fakeCharId = '99999999'

			const request = new Request(
				`http://example.com/api/admin/characters/${fakeCharId}/transfer`,
				{
					method: 'POST',
					headers: {
						Cookie: `session_token=${adminUser.sessionToken}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ newUserId: targetUser.userId }),
				}
			)
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(404)

			await cleanupTestUser(db, targetUser.userId)
		})

		it('should return 404 for non-existent target user', async () => {
			const charId = await createTestCharacter(db, regularUser.userId)
			const fakeTargetUserId = '00000000-0000-0000-0000-000000000000'

			const request = new Request(`http://example.com/api/admin/characters/${charId}/transfer`, {
				method: 'POST',
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ newUserId: fakeTargetUserId }),
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(404)
		})

		it('should return 400 when transferring only character', async () => {
			const sourceUser = await createTestUser(db, false)

			// Get main character ID
			const chars = await db.query.userCharacters.findMany({
				where: eq(schema.userCharacters.userId, sourceUser.userId),
			})
			const mainCharId = chars[0]?.characterId
			if (!mainCharId) throw new Error('No characters found for test user')

			const targetUser = await createTestUser(db, false)

			const request = new Request(
				`http://example.com/api/admin/characters/${mainCharId}/transfer`,
				{
					method: 'POST',
					headers: {
						Cookie: `session_token=${adminUser.sessionToken}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ newUserId: targetUser.userId }),
				}
			)
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)
			const data = (await response.json()) as { error: string }
			expect(data.error).toContain('only character')

			await cleanupTestUser(db, sourceUser.userId)
			await cleanupTestUser(db, targetUser.userId)
		})
	})

	describe('DELETE /api/admin/characters/:characterId', () => {
		it('should delete a character successfully', async () => {
			// Create user with 2 characters
			const user = await createTestUser(db, false)
			const charToDelete = await createTestCharacter(db, user.userId)

			const request = new Request(`http://example.com/api/admin/characters/${charToDelete}`, {
				method: 'DELETE',
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as { success: boolean; characterId: string }
			expect(data.success).toBe(true)
			expect(data.characterId).toBe(charToDelete)

			// Verify character is deleted
			const deletedChar = await db.query.userCharacters.findFirst({
				where: eq(schema.userCharacters.characterId, charToDelete),
			})
			expect(deletedChar).toBeUndefined()

			await cleanupTestUser(db, user.userId)
		})

		it('should return 404 for non-existent character', async () => {
			const fakeCharId = '99999999'
			const request = new Request(`http://example.com/api/admin/characters/${fakeCharId}`, {
				method: 'DELETE',
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(404)
		})

		it('should return 400 when deleting only character', async () => {
			const user = await createTestUser(db, false)

			// Get main character ID
			const chars = await db.query.userCharacters.findMany({
				where: eq(schema.userCharacters.userId, user.userId),
			})
			const mainCharId = chars[0]?.characterId
			if (!mainCharId) throw new Error('No characters found for test user')

			const request = new Request(`http://example.com/api/admin/characters/${mainCharId}`, {
				method: 'DELETE',
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(400)
			const data = (await response.json()) as { error: string }
			expect(data.error).toContain('only character')

			await cleanupTestUser(db, user.userId)
		})
	})

	describe('GET /api/admin/activity-log', () => {
		it('should return activity log with pagination', async () => {
			const request = new Request('http://example.com/api/admin/activity-log', {
				headers: {
					Cookie: `session_token=${adminUser.sessionToken}`,
				},
			})
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as {
				logs: any[]
				total: number
				limit: number
				offset: number
			}

			expect(data).toHaveProperty('logs')
			expect(data).toHaveProperty('total')
			expect(data).toHaveProperty('limit')
			expect(data).toHaveProperty('offset')
			expect(Array.isArray(data.logs)).toBe(true)
		})

		it('should support filter parameters', async () => {
			const request = new Request(
				`http://example.com/api/admin/activity-log?action=admin_user_viewed&limit=10&offset=0`,
				{
					headers: {
						Cookie: `session_token=${adminUser.sessionToken}`,
					},
				}
			)
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, testEnv, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			const data = (await response.json()) as { logs: any[]; limit: number; offset: number }
			expect(data.limit).toBe(10)
			expect(data.offset).toBe(0)
		})
	})
})
