/**
 * Admin routes - Administrative operations for managing users and characters
 *
 * All endpoints require authentication and admin privileges.
 * These endpoints call the admin worker via RPC for actual operations.
 */

import { Hono } from 'hono'
import { z } from 'zod'

import { and, desc, eq, gt, inArray, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { corporationDiscordServers, userActivityLog, userCharacters, users } from '../db/schema'
import { getIpHashMatches, getUserIpHistory } from '../lib/ip-history'
import { recordUserIpAddress } from '../lib/ip-tracking'
import { validatePagination } from '../lib/validation'
import { triggerUserRefreshWorkflow } from '../lib/workflow-triggers'
import { requireAdmin, requireAuth } from '../middleware/session'
import * as discordService from '../services/discord.service'
import { SessionService } from '../services/session.service'
import { UserService } from '../services/user.service'

import type { Context } from 'hono'
import type { Core } from '@repo/core'
import type { Discord } from '@repo/discord'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Groups } from '@repo/groups'
import type { Hr } from '@repo/hr'
import type { Legacy } from '@repo/legacy'
import type { App } from '../context'

const app = new Hono<App>()

/**
 * GET /admin/users
 * Search/list users with pagination
 *
 * Query params:
 * - search?: string - Search by character name
 * - limit?: number - Results per page (default 50)
 * - offset?: number - Pagination offset (default 0)
 */
app.get('/users', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const search = c.req.query('search')

		// Validate pagination parameters
		const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
		if (!pagination.success) {
			return c.json({ error: pagination.error }, pagination.status)
		}

		// Call admin worker via RPC
		const result = await c.env.ADMIN.searchUsers(
			{
				search,
				limit: pagination.data.limit,
				offset: pagination.data.offset,
			},
			user.id
		)

		return c.json(result)
	} catch (error) {
		logger.error('[AdminRoute.searchUsers] Failed', {
			error: error instanceof Error ? error.message : String(error),
			name: error instanceof Error ? error.name : undefined,
			cause:
				error instanceof Error && error.cause
					? error.cause instanceof Error
						? error.cause.message
						: String(error.cause)
					: undefined,
		})
		return c.json({ error: 'Failed to search users' }, 500)
	}
})

/**
 * GET /admin/users/:userId
 * Get detailed user information
 */
app.get('/users/:userId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Call admin worker via RPC
		const result = await c.env.ADMIN.getUserDetails(userId, user.id)

		if (!result) {
			return c.json({ error: 'User not found' }, 404)
		}

		return c.json(result)
	} catch (error) {
		logger.error('Error fetching user details:', error)
		return c.json({ error: 'Failed to fetch user details' }, 500)
	}
})

/**
 * GET /admin/users/:userId/ip-history
 * Returns hashed-only IP history for a user.
 */
app.get('/users/:userId/ip-history', requireAuth(), requireAdmin(), async (c) => {
	const userId = c.req.param('userId')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database unavailable' }, 500)

	try {
		const entries = await getUserIpHistory(db, userId)
		return c.json({ entries })
	} catch (error) {
		logger.error('[AdminRoute.getUserIpHistory] Failed', {
			userId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to fetch IP history' }, 500)
	}
})

/**
 * GET /admin/ip-history/:ipAddressHash/matches
 * Returns users associated with the same hashed IP.
 */
app.get('/ip-history/:ipAddressHash/matches', requireAuth(), requireAdmin(), async (c) => {
	const ipAddressHash = c.req.param('ipAddressHash')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database unavailable' }, 500)

	try {
		const matches = await getIpHashMatches(db, ipAddressHash)
		return c.json({ matches })
	} catch (error) {
		logger.error('[AdminRoute.getIpHashMatches] Failed', {
			ipAddressHash,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to fetch IP hash matches' }, 500)
	}
})

/**
 * Legacy migration queue endpoints (admin-scoped).
 */
app.get('/legacy/migrations', requireAuth(), requireAdmin(), async (c) => {
	const stub = getStub<Legacy>(c.env.LEGACY, 'default')
	const page = Number(c.req.query('page') ?? '1')
	const pageSize = Number(c.req.query('pageSize') ?? '25')
	const status = c.req.query('status') as
		| 'pending'
		| 'partially_applied'
		| 'applied'
		| 'dismissed'
		| 'error'
		| undefined
	const severity = c.req.query('severity') as 'none' | 'high' | 'critical' | undefined
	const modernUserId = c.req.query('modernUserId') || undefined
	const legacyAuthUserId = c.req.query('legacyAuthUserId') || undefined
	const result = await stub.listMigrations({
		page,
		pageSize,
		status,
		severity,
		modernUserId,
		legacyAuthUserId,
	})
	return c.json(result)
})

app.get('/legacy/migrations/:id', requireAuth(), requireAdmin(), async (c) => {
	const id = c.req.param('id')
	const stub = getStub<Legacy>(c.env.LEGACY, 'default')
	const result = await stub.getMigration(id)
	if (!result) return c.json({ error: 'Migration queue item not found' }, 404)
	return c.json(result)
})

app.post('/legacy/migrations/:id/apply', requireAuth(), requireAdmin(), async (c) => {
	const id = c.req.param('id')
	const stub = getStub<Legacy>(c.env.LEGACY, 'default')
	const body = (await c.req.json().catch(() => ({}))) as { payload?: Record<string, unknown> }
	const result = await stub.applyMigration(id, body.payload)
	if (!result) return c.json({ error: 'Migration queue item not found' }, 404)
	return c.json(result)
})

app.post('/legacy/migrations/:id/dismiss', requireAuth(), requireAdmin(), async (c) => {
	const id = c.req.param('id')
	const stub = getStub<Legacy>(c.env.LEGACY, 'default')
	const body = (await c.req.json().catch(() => ({}))) as { payload?: Record<string, unknown> }
	const result = await stub.dismissMigration(id, body.payload)
	if (!result) return c.json({ error: 'Migration queue item not found' }, 404)
	return c.json(result)
})

app.post('/legacy/migrations/:id/resolve', requireAuth(), requireAdmin(), async (c) => {
	const id = c.req.param('id')
	const body = (await c.req.json()) as { decision: 'accept' | 'reject' | 'needs_review'; note?: string }
	const stub = getStub<Legacy>(c.env.LEGACY, 'default')
	const result = await stub.resolveMigration(id, body)
	if (!result) return c.json({ error: 'Migration queue item not found' }, 404)
	return c.json(result)
})

app.post('/legacy/migrations/recheck/:modernUserId', requireAuth(), requireAdmin(), async (c) => {
	const modernUserId = c.req.param('modernUserId')
	const user = c.get('user')!
	const stub = getStub<Legacy>(c.env.LEGACY, 'default')
	const result = await stub.recheckUser(modernUserId, user.id)
	return c.json(result)
})

app.get('/legacy/history', requireAuth(), requireAdmin(), async (c) => {
	const stub = getStub<Legacy>(c.env.LEGACY, 'default')
	const result = await stub.listHistory({
		page: Number(c.req.query('page') ?? '1'),
		pageSize: Number(c.req.query('pageSize') ?? '25'),
		corporationId: c.req.query('corporationId') || undefined,
		characterId: c.req.query('characterId') || undefined,
		characterIds: c.req.query('characterIds') || undefined,
		characterName: c.req.query('characterName') || undefined,
	})
	return c.json(result)
})

app.get('/legacy/history/:legacyApplicationId', requireAuth(), requireAdmin(), async (c) => {
	const legacyApplicationId = c.req.param('legacyApplicationId')
	const stub = getStub<Legacy>(c.env.LEGACY, 'default')
	const result = await stub.getHistoryApplication(legacyApplicationId)
	if (!result) return c.json({ error: 'Legacy application not found' }, 404)
	return c.json(result)
})

app.post('/legacy/import-character-links', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')!
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database unavailable' }, 500)

	const schema = z.object({
		modernUserId: z.string().uuid(),
		legacyAuthUserId: z.string().min(1),
		characters: z.array(
			z.object({
				characterId: z.string().min(1),
				characterName: z.string().min(1),
				source: z.enum(['esi_owner', 'xml_account']).optional(),
			})
		),
	})
	const parsed = schema.safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)

	const { modernUserId, legacyAuthUserId, characters } = parsed.data
	const uniqueCharacters = [...new Map(characters.map((ch) => [ch.characterId, ch])).values()]
	const existing = await db.query.userCharacters.findMany({
		where: inArray(
			userCharacters.characterId,
			uniqueCharacters.map((ch) => ch.characterId)
		),
		columns: { characterId: true, userId: true },
	})
	const existingByCharacterId = new Map(existing.map((row) => [row.characterId, row]))
	let inserted = 0
	let alreadyLinkedToUser = 0
	let linkedToOtherUser = 0

	for (const character of uniqueCharacters) {
		const existingRow = existingByCharacterId.get(character.characterId)
		if (existingRow) {
			if (existingRow.userId === modernUserId) {
				alreadyLinkedToUser += 1
			} else {
				linkedToOtherUser += 1
			}
			continue
		}

		await db.insert(userCharacters).values({
			userId: modernUserId,
			characterId: character.characterId,
			characterName: character.characterName,
			characterOwnerHash: `legacy-import:${legacyAuthUserId}:${character.source ?? 'unknown'}`,
			is_primary: false,
			hasValidToken: null,
			isDeleted: false,
		})
		inserted += 1
	}

	await db
		.update(users)
		.set({
			legacyAuthUserId,
			updatedAt: new Date(),
		})
		.where(and(eq(users.id, modernUserId), sql`${users.legacyAuthUserId} is null`))

	logger.info('[Admin Legacy Import] Character links imported', {
		actorUserId: user.id,
		modernUserId,
		legacyAuthUserId,
		inserted,
		alreadyLinkedToUser,
		linkedToOtherUser,
	})

	return c.json({
		inserted,
		alreadyLinkedToUser,
		linkedToOtherUser,
		totalRequested: uniqueCharacters.length,
	})
})

app.post('/legacy/import-notes', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')!
	const schema = z.object({
		modernUserId: z.string().uuid(),
		legacyAuthUserId: z.string().min(1),
		notes: z.array(
			z.object({
				legacyNoteId: z.string().min(1),
				note: z.string().min(1),
				legacyCreatedByUserId: z.string().optional().nullable(),
				legacyDateCreated: z.string().optional().nullable(),
				metadata: z.record(z.string(), z.unknown()).optional(),
			})
		),
	})
	const parsed = schema.safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)

	const hrStub = getStub<Hr>(c.env.HR, 'default')
	const primaryCharacter = user.characters.find((ch) => ch.is_primary)
	const authorCharacterId = primaryCharacter?.characterId ?? user.mainCharacterId
	const authorCharacterName = primaryCharacter?.characterName ?? 'System'
	let created = 0
	let failed = 0
	for (const note of parsed.data.notes) {
		try {
			await hrStub.createNote(
				parsed.data.modernUserId,
				null,
				user.id,
				authorCharacterId,
				authorCharacterName,
				note.note,
				'background_check',
				'normal',
				{
					source: 'legacy_import',
					legacyAuthUserId: parsed.data.legacyAuthUserId,
					legacyNoteId: note.legacyNoteId,
					legacyCreatedByUserId: note.legacyCreatedByUserId ?? null,
					legacyDateCreated: note.legacyDateCreated ?? null,
					...(note.metadata ?? {}),
				}
			)
			created += 1
		} catch {
			failed += 1
		}
	}

	logger.info('[Admin Legacy Import] Notes imported', {
		actorUserId: user.id,
		modernUserId: parsed.data.modernUserId,
		legacyAuthUserId: parsed.data.legacyAuthUserId,
		created,
		failed,
	})

	return c.json({ created, failed, totalRequested: parsed.data.notes.length })
})

app.post('/legacy/import-ip-associations', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database unavailable' }, 500)
	const hashSecret = c.env.IP_ADDRESS_HASH_SECRET
	if (!hashSecret) return c.json({ error: 'IP hash secret not configured' }, 500)

	const schema = z.object({
		modernUserId: z.string().uuid(),
		legacyAuthUserId: z.string().min(1),
		ipAddresses: z.array(
			z.object({
				ipAddress: z.string().min(1),
			})
		),
	})
	const parsed = schema.safeParse(await c.req.json())
	if (!parsed.success) return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)

	const uniqueIps = [...new Set(parsed.data.ipAddresses.map((ip) => ip.ipAddress.trim()).filter(Boolean))]
	let imported = 0
	let failed = 0
	for (const ip of uniqueIps) {
		try {
			await recordUserIpAddress({
				db,
				userId: parsed.data.modernUserId,
				ip,
				hashSecret,
			})
			imported += 1
		} catch {
			failed += 1
		}
	}

	return c.json({
		imported,
		failed,
		totalRequested: uniqueIps.length,
	})
})

/**
 * DELETE /admin/users/:userId
 * Delete a user and all associated data
 */
app.delete('/users/:userId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	// Validate UUID format
	const uuidSchema = z.string().uuid()
	const validation = uuidSchema.safeParse(userId)

	if (!validation.success) {
		return c.json({ error: 'Invalid user ID format' }, 400)
	}

	try {
		// Call admin worker via RPC
		const result = await c.env.ADMIN.deleteUser(userId, user.id)

		return c.json(result)
	} catch (error) {
		if (error instanceof Error) {
			if (error.message === 'User not found') {
				return c.json({ error: 'User not found' }, 404)
			}
			logger.error('Error deleting user:', error)
			return c.json({ error: error.message }, 500)
		}
		logger.error('Error deleting user:', error)
		return c.json({ error: 'Failed to delete user' }, 500)
	}
})

/**
 * GET /admin/characters/:characterId
 * Get detailed character information with ownership
 */
app.get('/characters/:characterId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const characterId = c.req.param('characterId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Call admin worker via RPC
		const result = await c.env.ADMIN.getCharacterDetails(characterId, user.id)

		if (!result) {
			return c.json({ error: 'Character not found' }, 404)
		}

		return c.json(result)
	} catch (error) {
		logger.error('Error fetching character details:', error)
		return c.json({ error: 'Failed to fetch character details' }, 500)
	}
})

/**
 * POST /admin/characters/:characterId/transfer
 * Transfer character ownership to another user
 *
 * Body: {
 *   newUserId: string (UUID)
 * }
 */
app.post('/characters/:characterId/transfer', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const characterId = c.req.param('characterId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Validate request body
		const bodySchema = z.object({
			newUserId: z.string().uuid(),
		})

		const body = await c.req.json()
		const validation = bodySchema.safeParse(body)

		if (!validation.success) {
			return c.json(
				{
					error: 'Invalid request body',
					details: validation.error.format(),
				},
				400
			)
		}

		const { newUserId } = validation.data

		// Call admin worker via RPC
		const result = await c.env.ADMIN.transferCharacterOwnership(characterId, newUserId, user.id)

		return c.json(result)
	} catch (error) {
		if (error instanceof Error) {
			if (error.message === 'Character not found') {
				return c.json({ error: 'Character not found' }, 404)
			}
			if (error.message === 'Target user not found') {
				return c.json({ error: 'Target user not found' }, 404)
			}
			if (error.message.includes('only character') || error.message.includes('already owned')) {
				return c.json({ error: error.message }, 400)
			}
			logger.error('Error transferring character:', error)
			return c.json({ error: error.message }, 500)
		}
		logger.error('Error transferring character:', error)
		return c.json({ error: 'Failed to transfer character' }, 500)
	}
})

/**
 * DELETE /admin/characters/:characterId
 * Delete/unlink a character from its owner
 */
app.delete('/characters/:characterId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const characterId = c.req.param('characterId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Call admin worker via RPC
		const result = await c.env.ADMIN.deleteCharacter(characterId, user.id)

		return c.json(result)
	} catch (error) {
		if (error instanceof Error) {
			if (error.message === 'Character not found') {
				return c.json({ error: 'Character not found' }, 404)
			}
			if (error.message.includes('only character')) {
				return c.json({ error: error.message }, 400)
			}
			logger.error('Error deleting character:', error)
			return c.json({ error: error.message }, 500)
		}
		logger.error('Error deleting character:', error)
		return c.json({ error: 'Failed to delete character' }, 500)
	}
})

/**
 * GET /admin/activity-log
 * Get admin activity log with filters
 *
 * Query params:
 * - limit?: number - Results per page (default 50)
 * - offset?: number - Pagination offset (default 0)
 * - action?: string - Filter by action type
 * - adminUserId?: string - Filter by admin user
 */
app.get('/activity-log', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Validate pagination parameters
		const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
		if (!pagination.success) {
			return c.json({ error: pagination.error }, pagination.status)
		}

		const action = c.req.query('action') as any // AdminAction type
		const adminUserId = c.req.query('adminUserId')

		// Call admin worker via RPC
		const result = await c.env.ADMIN.getActivityLog(
			{
				limit: pagination.data.limit,
				offset: pagination.data.offset,
				action,
				adminUserId,
			},
			user.id
		)

		return c.json(result)
	} catch (error) {
		logger.error('Error fetching activity log:', error)
		return c.json({ error: 'Failed to fetch activity log' }, 500)
	}
})

/**
 * POST /admin/users/:userId/admin
 * Set or revoke admin status for a user
 *
 * Body: { isAdmin: boolean }
 */
app.post('/users/:userId/admin', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const body = await c.req.json<{ isAdmin: boolean }>()
		const { isAdmin } = body

		if (typeof isAdmin !== 'boolean') {
			return c.json({ error: 'isAdmin must be a boolean' }, 400)
		}

		const db = createDb(c.env.DATABASE_URL)

		// Update user admin status
		await db.update(users).set({ is_admin: isAdmin }).where(eq(users.id, userId))

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error setting user admin status:', error)
		return c.json({ error: 'Failed to set admin status' }, 500)
	}
})

/**
 * DELETE /admin/users/:userId/characters/:characterId
 * Delete a character from a user account
 */
app.delete('/users/:userId/characters/:characterId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')
	const characterId = c.req.param('characterId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const db = createDb(c.env.DATABASE_URL)

		// Verify character belongs to user
		const char = await db.query.userCharacters.findFirst({
			where: and(eq(userCharacters.userId, userId), eq(userCharacters.characterId, characterId)),
		})

		if (!char) {
			return c.json({ error: 'Character not found' }, 404)
		}

		// Check if this is the user's only character
		const userChars = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		if (userChars.length === 1) {
			return c.json({ error: 'Cannot delete the only character on an account' }, 400)
		}

		// Revoke ESI token
		const eveTokenStore = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
		await eveTokenStore.revokeToken(characterId)

		// Delete character
		await db.delete(userCharacters).where(eq(userCharacters.characterId, characterId))

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting character:', error)
		return c.json({ error: 'Failed to delete character' }, 500)
	}
})

/**
 * POST /admin/users/:userId/characters/:characterId/set-primary
 * Set a character as the primary character for a user
 */
app.post(
	'/users/:userId/characters/:characterId/set-primary',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')
		const userId = c.req.param('userId')
		const characterId = c.req.param('characterId')

		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		try {
			const db = createDb(c.env.DATABASE_URL)

			// Verify character belongs to user
			const char = await db.query.userCharacters.findFirst({
				where: and(eq(userCharacters.userId, userId), eq(userCharacters.characterId, characterId)),
			})

			if (!char) {
				return c.json({ error: 'Character not found or not owned by user' }, 404)
			}

			// Use UserService to set primary character
			const userService = new UserService(db)

			const success = await userService.setPrimaryCharacter(userId, characterId)

			if (!success) {
				return c.json({ error: 'Failed to set primary character' }, 500)
			}

			logger.info('[Admin] Primary character set by admin', {
				adminUserId: user.id,
				targetUserId: userId,
				characterId,
			})

			return c.json({ success: true })
		} catch (error) {
			if (error instanceof Error && error.message.includes('Character not found')) {
				return c.json({ error: error.message }, 404)
			}
			logger.error('Error setting primary character:', error)
			return c.json({ error: 'Failed to set primary character' }, 500)
		}
	}
)

/**
 * POST /admin/users/:userId/discord/join-servers
 * Trigger Discord server joining for a specific user (admin action)
 *
 * Joins the user to all corporation and group Discord servers they're eligible for
 */
app.post('/users/:userId/discord/join-servers', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const result = await discordService.syncUserDiscordAccess(c.env, userId, true)
		return c.json(result)
	} catch (error) {
		logger.error('Error joining user to Discord servers:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to join Discord servers',
			},
			500
		)
	}
})

/**
 * GET /admin/users/:userId/discord/inspect
 * Inspect Discord access drift for a specific user (admin action)
 *
 * Returns per-guild membership, expected managed roles, and current role deltas.
 */
app.get('/users/:userId/discord/inspect', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const result = await discordService.inspectUserDiscordAccess(c.env, userId)
		return c.json(result)
	} catch (error) {
		logger.error('Error inspecting user Discord access:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to inspect Discord access',
			},
			500
		)
	}
})

/**
 * POST /admin/users/:userId/discord/revoke
 * Manually revoke a user's Discord authorization (admin action)
 *
 * Marks authorization revoked and strips managed Discord roles without unlinking
 */
app.post('/users/:userId/discord/revoke', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Get Discord DO stub
		const discordStub = getStub<Discord>(c.env.DISCORD, 'default')

		// Get current Discord status
		const status = await discordStub.getDiscordUserStatus(userId)

		if (!status) {
			return c.json({ error: 'User does not have a Discord account linked' }, 404)
		}

		if (status.authRevoked) {
			return c.json({ error: 'Discord authorization already revoked' }, 400)
		}

		// Revoke authorization via Discord DO
		const success = await discordStub.revokeAuthorization(userId)

		if (!success) {
			return c.json({ error: 'Failed to revoke Discord authorization' }, 500)
		}

		// Authorization revoked now supersedes role attachments.
		// Apply a managed-role strip pass immediately (no bans in this path).
		const stripResult = await discordService.enforceRevokedAuthorizationDiscordAccess(
			c.env,
			userId
		)

		logger.info('[Admin] Discord authorization revoked by admin', {
			adminUserId: user.id,
			targetUserId: userId,
			rolesStrippedFromGuilds: stripResult.totalUpdated,
			roleStripFailures: stripResult.totalFailed,
		})

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error revoking Discord authorization:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to revoke Discord authorization',
			},
			500
		)
	}
})

/**
 * DELETE /admin/users/:userId/discord/unlink
 * Completely unlink a user's Discord account (admin action)
 *
 * Removes Discord link, revokes authorization, deletes tokens, and removes user from Discord servers
 */
app.delete('/users/:userId/discord/unlink', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Call Discord service to unlink
		const success = await discordService.unlinkUser(c.env, userId)

		if (!success) {
			return c.json({ error: 'Failed to unlink Discord account' }, 500)
		}

		logger.info('[Admin] Discord account unlinked by admin', {
			adminUserId: user.id,
			targetUserId: userId,
		})

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error unlinking Discord account:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to unlink Discord account',
			},
			500
		)
	}
})

/**
 * POST /admin/users/:userId/clear-sessions
 * Clear all active sessions for a user (admin action)
 *
 * Forces the user to re-authenticate on all devices
 */
app.post('/users/:userId/clear-sessions', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const db = createDb(c.env.DATABASE_URL)
		const sessionService = new SessionService(db)

		// Invalidate all sessions for the user
		await sessionService.invalidateAllUserSessions(userId)

		logger.info('[Admin] All sessions cleared by admin', {
			adminUserId: user.id,
			targetUserId: userId,
		})

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error clearing user sessions:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to clear user sessions',
			},
			500
		)
	}
})

/**
 * POST /admin/users/:userId/sync
 * Trigger user refresh workflow (admin action)
 *
 * Bypasses the 5-minute throttle for immediate sync.
 * Refreshes character data, authenticated data, and role assignments.
 */
app.post('/users/:userId/sync', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	// Validate UUID format
	const uuidSchema = z.string().uuid()
	const validation = uuidSchema.safeParse(userId)

	if (!validation.success) {
		return c.json({ error: 'Invalid user ID format' }, 400)
	}

	try {
		const db = createDb(c.env.DATABASE_URL)

		// Verify user exists
		const targetUser = await db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { id: true },
		})

		if (!targetUser) {
			return c.json({ error: 'User not found' }, 404)
		}

		// Trigger user refresh workflow, bypassing throttle for admin action
		const triggerResult = await triggerUserRefreshWorkflow({
			db,
			env: c.env,
			userId,
			source: `admin-sync-${user.id}`,
			bypassThrottle: true,
			refreshMode: 'manual',
		})
		if (triggerResult.status === 'failed') {
			return c.json(
				{
					error: triggerResult.error || 'Failed to trigger user sync',
				},
				500
			)
		}

		logger.info('[Admin] User sync triggered by admin', {
			adminUserId: user.id,
			targetUserId: userId,
			workflowStatus: triggerResult.status,
			workflowInstanceId: triggerResult.workflowInstanceId,
		})

		return c.json({
			success: true,
			message:
				triggerResult.status === 'triggered'
					? 'User sync workflow triggered'
					: 'User sync request accepted (throttled)',
			status: triggerResult.status,
			workflowInstanceId: triggerResult.workflowInstanceId,
		})
	} catch (error) {
		logger.error('Error triggering user sync:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to trigger user sync',
			},
			500
		)
	}
})

/**
 * POST /admin/blacklist/user
 * Create a user blacklist entry
 *
 * Body: {
 *   userId: string,
 *   reason: string,
 *   metadata?: Record<string, unknown>
 * }
 */
app.post('/blacklist/user', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const bodySchema = z.object({
			userId: z.string().uuid(),
			reason: z.string().min(1),
			metadata: z.record(z.string(), z.unknown()).optional(),
		})

		const body = await c.req.json()
		const validation = bodySchema.safeParse(body)

		if (!validation.success) {
			return c.json(
				{
					error: 'Invalid request body',
					details: validation.error.format(),
				},
				400
			)
		}

		const { userId, reason, metadata } = validation.data

		// Capture user ID for nested function
		const blacklistedByUserId = user.id

		// Track all blacklisted entities for the response
		const blacklistedCharacters: string[] = []
		const blacklistedUsers: string[] = []
		const processedUsers = new Set<string>()
		const processedCharacters = new Set<string>()

		const removeUserFromAllGroups = async (targetUserId: string): Promise<void> => {
			try {
				const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
				const memberships = await groupsStub.getUserMemberships(targetUserId)
				if (memberships.length === 0) return

				const removalResults = await Promise.allSettled(
					memberships.map((membership) =>
						groupsStub.removeMember(membership.groupId, blacklistedByUserId, targetUserId)
					)
				)

				const failedRemovals = removalResults.filter(
					(result) => result.status === 'rejected'
				).length
				if (failedRemovals > 0) {
					logger.warn('[Admin] Some group membership removals failed during blacklist', {
						targetUserId,
						totalMemberships: memberships.length,
						failedRemovals,
					})
				}
			} catch (error) {
				logger.error('[Admin] Failed to remove user from groups during blacklist', {
					targetUserId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		// Helper function to cascade blacklists with depth limiting
		async function cascadeBlacklist(
			targetUserId: string,
			cascadeReason: string,
			triggeredBy: string | undefined,
			isAuto: boolean,
			depth: number,
			extraMetadata?: Record<string, unknown>
		): Promise<void> {
			// Max depth limit to prevent infinite recursion
			if (depth > 10) {
				logger.warn('[Admin] Max cascade depth reached', { targetUserId, depth })
				return
			}

			// Skip if already processed
			if (processedUsers.has(targetUserId)) {
				return
			}
			processedUsers.add(targetUserId)

			const db = createDb(c.env.DATABASE_URL)
			const hrStub = getStub<Hr>(c.env.HR, 'default')
			const sessionService = new SessionService(db)
			const targetUser = await db.query.users.findFirst({
				where: eq(users.id, targetUserId),
				columns: { discordUserId: true },
			})
			const mergedMetadata = {
				...(extraMetadata ?? {}),
				...(targetUser?.discordUserId ? { discordUserId: targetUser.discordUserId } : {}),
			}
			const metadataForEntry =
				Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined

			// 1. Create user blacklist
			const userBlacklistEntry = await hrStub.createUserBlacklist({
				userId: targetUserId,
				discordUserId: targetUser?.discordUserId ?? undefined,
				reason: cascadeReason,
				blacklistedBy: blacklistedByUserId,
				isAutoBlacklist: isAuto,
				triggeredBy,
				metadata: metadataForEntry,
			})
			if (isAuto) {
				blacklistedUsers.push(targetUserId)
			}

			// 2. Invalidate sessions
			await sessionService.invalidateAllUserSessions(targetUserId)
			await removeUserFromAllGroups(targetUserId)

			// 2b. Immediately enforce Discord revocation/ban for blacklisted users
			try {
				await discordService.enforceBlacklistedDiscordAccess(
					c.env,
					targetUserId,
					`Blacklisted by admin ${blacklistedByUserId}`
				)
			} catch (error) {
				logger.error('[Admin] Failed Discord blacklist enforcement during user cascade', {
					targetUserId,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			// 3. Get all characters for this user
			const userChars = await db.query.userCharacters.findMany({
				where: eq(userCharacters.userId, targetUserId),
			})

			// 4. For each character, blacklist it and cascade to other users
			for (const char of userChars) {
				// Skip if character already processed
				if (processedCharacters.has(char.characterId)) {
					continue
				}
				processedCharacters.add(char.characterId)

				// Create character blacklist
				const charEntry = await hrStub.createCharacterBlacklist({
					characterId: char.characterId,
					characterName: char.characterName,
					reason: `Auto-blacklisted: owned by blacklisted user ${targetUserId}`,
					blacklistedBy: blacklistedByUserId,
					triggeredBy: userBlacklistEntry.id,
					metadata: {
						triggeredByUserBlacklist: userBlacklistEntry.id,
						...(targetUser?.discordUserId
							? { discordUserId: targetUser.discordUserId }
							: {}),
					},
				})
				blacklistedCharacters.push(char.characterId)

				// Find all OTHER users with this character
				const otherUsersWithChar = await db.query.userCharacters.findMany({
					where: eq(userCharacters.characterId, char.characterId),
				})

				// Recursively blacklist other users (excluding already processed ones)
				for (const otherChar of otherUsersWithChar) {
					if (!processedUsers.has(otherChar.userId)) {
						await cascadeBlacklist(
							otherChar.userId,
							`Auto-blacklisted: linked to blacklisted character ${char.characterId}`,
							charEntry.id,
							true,
							depth + 1,
							undefined
						)
					}
				}
			}
		}

		// Start the cascade with the initial user
		await cascadeBlacklist(userId, reason, undefined, false, 0, metadata)

		logger.info('[Admin] User blacklisted with cascade', {
			adminUserId: user.id,
			targetUserId: userId,
			reason,
			blacklistedCharactersCount: blacklistedCharacters.length,
			blacklistedUsersCount: blacklistedUsers.length,
		})

		return c.json({
			userId,
			autoBlacklisted: {
				characters: blacklistedCharacters,
				users: blacklistedUsers,
				totalCount: blacklistedCharacters.length + blacklistedUsers.length,
			},
		})
	} catch (error) {
		logger.error('Error creating user blacklist:', error)
		return c.json({ error: 'Failed to create user blacklist' }, 500)
	}
})

/**
 * POST /admin/blacklist/character
 * Create a character blacklist entry
 * Automatically blacklists all users with this character linked
 *
 * Body: {
 *   characterId: string,
 *   reason: string,
 *   metadata?: Record<string, unknown>
 * }
 */
app.post('/blacklist/character', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const bodySchema = z.object({
			characterId: z.string().optional(),
			characterName: z.string().min(1).optional(),
			reason: z.string().min(1),
			metadata: z.record(z.string(), z.unknown()).optional(),
		}).refine((data) => Boolean(data.characterId || data.characterName), {
			message: 'Either characterId or characterName is required',
			path: ['characterId'],
		})

		const body = await c.req.json()
		const validation = bodySchema.safeParse(body)

		if (!validation.success) {
			return c.json(
				{
					error: 'Invalid request body',
					details: validation.error.format(),
				},
				400
			)
		}

		const { characterId: inputCharacterId, characterName: inputCharacterName, reason, metadata } = validation.data

		const db = createDb(c.env.DATABASE_URL)
		let characterId = inputCharacterId
		let characterName = inputCharacterName

		if (!characterId && characterName) {
			const matchedCharacter = await db.query.userCharacters.findFirst({
				where: eq(userCharacters.characterName, characterName),
				columns: { characterId: true, characterName: true },
			})
			if (!matchedCharacter) {
				return c.json(
					{
						error:
							'Character name is not currently linked to any user. Provide characterId to create a paired ID+name blacklist.',
					},
					400
				)
			}
			characterId = matchedCharacter.characterId
			characterName = matchedCharacter.characterName
		}

		if (!characterName && characterId) {
			const matchedCharacter = await db.query.userCharacters.findFirst({
				where: eq(userCharacters.characterId, characterId),
				columns: { characterName: true },
			})
			characterName = matchedCharacter?.characterName
		}

		if (!characterId) {
			return c.json({ error: 'characterId could not be resolved' }, 400)
		}

		// Call HR DO via RPC
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const entry = await hrStub.createCharacterBlacklist({
			characterId,
			characterName,
			reason,
			blacklistedBy: user.id,
			metadata,
		})

		// Find all users with this character and auto-blacklist them
		const usersWithChar = await db.query.userCharacters.findMany({
			where: eq(userCharacters.characterId, characterId),
		})
		const sessionService = new SessionService(db)
		const autoBlacklistedUsers: string[] = []

		for (const char of usersWithChar) {
			const linkedUser = await db.query.users.findFirst({
				where: eq(users.id, char.userId),
				columns: { discordUserId: true },
			})

			// Auto-blacklist each user
			await hrStub.createUserBlacklist({
				userId: char.userId,
				discordUserId: linkedUser?.discordUserId ?? undefined,
				reason: `Auto-blacklisted: linked to blacklisted character ${characterId}`,
				blacklistedBy: user.id,
				triggeredBy: entry.id,
				isAutoBlacklist: true,
				metadata: linkedUser?.discordUserId
					? { discordUserId: linkedUser.discordUserId }
					: undefined,
			})

			// Invalidate all sessions
			await sessionService.invalidateAllUserSessions(char.userId)
			try {
				const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
				const memberships = await groupsStub.getUserMemberships(char.userId)
				if (memberships.length > 0) {
					await Promise.allSettled(
						memberships.map((membership) =>
							groupsStub.removeMember(membership.groupId, user.id, char.userId)
						)
					)
				}
			} catch (error) {
				logger.error('[Admin] Failed to remove character-linked user from groups during blacklist', {
					characterId,
					userId: char.userId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
			try {
				await discordService.enforceBlacklistedDiscordAccess(
					c.env,
					char.userId,
					`Blacklisted via character ${characterId}`
				)
			} catch (error) {
				logger.error('[Admin] Failed Discord blacklist enforcement for character-linked user', {
					characterId,
					userId: char.userId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
			autoBlacklistedUsers.push(char.userId)
		}

		logger.info('[Admin] Character blacklisted', {
			adminUserId: user.id,
			characterId,
			reason,
			autoBlacklistedUserCount: autoBlacklistedUsers.length,
		})

		return c.json({
			entry,
			autoBlacklistedUsers,
			autoBlacklistedCount: autoBlacklistedUsers.length,
		})
	} catch (error) {
		logger.error('Error creating character blacklist:', error)
		return c.json({ error: 'Failed to create character blacklist' }, 500)
	}
})

/**
 * GET /admin/blacklist
 * List all blacklist entries with filters and pagination
 *
 * Query params:
 * - targetType?: blacklist target type - Filter by target type
 * - isAutoBlacklist?: boolean - Filter by auto-blacklist status
 * - limit?: number - Results per page (default 50)
 * - offset?: number - Pagination offset (default 0)
 */
app.get('/blacklist', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Validate pagination parameters
		const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
		if (!pagination.success) {
			return c.json({ error: pagination.error }, pagination.status)
		}

		const targetTypeParam = c.req.query('targetType')
		const targetType =
			targetTypeParam === 'character'
				? 'character_id'
				: (targetTypeParam as
						| 'user'
						| 'character_id'
						| 'character_name'
						| 'discord_id'
						| 'corporation_id'
						| 'corporation_name'
						| 'alliance_id'
						| 'alliance_name'
						| undefined)
		const isAutoBlacklistParam = c.req.query('isAutoBlacklist')
		const isAutoBlacklist =
			isAutoBlacklistParam === 'true' ? true : isAutoBlacklistParam === 'false' ? false : undefined

		// Call HR DO via RPC
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const result = await hrStub.getAllBlacklists({
			targetType,
			isAutoBlacklist,
			limit: pagination.data.limit,
			offset: pagination.data.offset,
		})

		return c.json(result)
	} catch (error) {
		logger.error('Error fetching blacklists:', error)
		return c.json({ error: 'Failed to fetch blacklists' }, 500)
	}
})

/**
 * GET /admin/blacklist/user/:userId
 * Get all blacklist entries for a specific user
 */
app.get('/blacklist/user/:userId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const userId = c.req.param('userId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	// Validate UUID format
	const uuidSchema = z.string().uuid()
	const validation = uuidSchema.safeParse(userId)

	if (!validation.success) {
		return c.json({ error: 'Invalid user ID format' }, 400)
	}

	try {
		const db = createDb(c.env.DATABASE_URL)
		const hrStub = getStub<Hr>(c.env.HR, 'default')

		// Fetch user-type entries and discord_id entries in parallel
		const [userEntries, linkedUser] = await Promise.all([
			hrStub.getBlacklistsForUser(userId),
			db.query.users.findFirst({
				where: eq(users.id, userId),
				columns: { discordUserId: true },
			}),
		])

		const discordEntries = linkedUser?.discordUserId
			? await hrStub.getBlacklistsForDiscordUser(linkedUser.discordUserId)
			: []

		return c.json([...userEntries, ...discordEntries])
	} catch (error) {
		logger.error('Error fetching user blacklists:', error)
		return c.json({ error: 'Failed to fetch user blacklists' }, 500)
	}
})

/**
 * GET /admin/blacklist/character/:characterId
 * Get all blacklist entries for a specific character
 */
app.get('/blacklist/character/:characterId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const characterId = c.req.param('characterId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Call HR DO via RPC
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const entries = await hrStub.getBlacklistsForCharacter(characterId)

		return c.json(entries)
	} catch (error) {
		logger.error('Error fetching character blacklists:', error)
		return c.json({ error: 'Failed to fetch character blacklists' }, 500)
	}
})

/**
 * POST /admin/blacklist/check-characters
 * Bulk check character ID/name blacklist status.
 */
app.post('/blacklist/check-characters', requireAuth(), requireAdmin(), async (c) => {
	const schema = z.object({
		characterIds: z.array(z.string().min(1)).default([]),
		characterNames: z.array(z.string().min(1)).default([]),
	})
	const parsed = schema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
	}
	const uniqueIds = [...new Set(parsed.data.characterIds)]
	const uniqueNames = [...new Set(parsed.data.characterNames)]

	try {
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const [idMatches, nameMatches] = await Promise.all([
			uniqueIds.length > 0 ? hrStub.checkCharactersBlacklisted(uniqueIds) : Promise.resolve({}),
			uniqueNames.length > 0 ? hrStub.checkCharacterNamesBlacklisted(uniqueNames) : Promise.resolve({}),
		])
		return c.json({
			characterIds: idMatches,
			characterNames: nameMatches,
		})
	} catch (error) {
		logger.error('Error bulk checking character blacklists:', error)
		return c.json({ error: 'Failed to bulk check character blacklists' }, 500)
	}
})

/**
 * GET /admin/blacklist/:id
 * Get a single blacklist entry by ID
 */
app.get('/blacklist/:id', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const id = c.req.param('id')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const uuidSchema = z.string().uuid()
	if (!uuidSchema.safeParse(id).success) {
		return c.json({ error: 'Invalid blacklist entry ID format' }, 400)
	}

	try {
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const entry = await hrStub.getBlacklistEntry(id)

		if (!entry) {
			return c.json({ error: 'Blacklist entry not found' }, 404)
		}

		return c.json(entry)
	} catch (error) {
		logger.error('Error fetching blacklist entry:', error)
		return c.json({ error: 'Failed to fetch blacklist entry' }, 500)
	}
})

/**
 * DELETE /admin/blacklist/:id
 * Remove a blacklist entry and all triggered entries (cascading removal)
 */
app.delete('/blacklist/:id', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const blacklistId = c.req.param('id')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	// Validate UUID format
	const uuidSchema = z.string().uuid()
	const validation = uuidSchema.safeParse(blacklistId)

	if (!validation.success) {
		return c.json({ error: 'Invalid blacklist ID format' }, 400)
	}

	try {
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		let removedCount = 0
		const processedIds = new Set<string>()

		// Recursive function to remove entry and all triggered entries
		async function cascadeRemove(entryId: string): Promise<void> {
			// Skip if already processed
			if (processedIds.has(entryId)) {
				return
			}
			processedIds.add(entryId)

			// Find all entries triggered by this one
			const triggered = await hrStub.findTriggeredEntries(entryId)

			// Recursively remove triggered entries first
			for (const triggeredEntry of triggered) {
				await cascadeRemove(triggeredEntry.id)
			}

			// Remove this entry
			await hrStub.removeBlacklistEntry(entryId)
			removedCount++
		}

		// Start cascading removal
		await cascadeRemove(blacklistId)

		logger.info('[Admin] Blacklist entry removed with cascade', {
			adminUserId: user.id,
			blacklistId,
			removedCount,
		})

		return c.json({ success: true, removedCount })
	} catch (error) {
		logger.error('Error removing blacklist entry:', error)
		return c.json({ error: 'Failed to remove blacklist entry' }, 500)
	}
})

/**
 * POST /admin/corporations/:corporationId/discord/refresh
 * Add all users with characters in a corporation to the pending Discord refresh set.
 *
 * Users are added to the Core DO's in-memory set and processed on the next
 * cron tick with staggered workflow creation.
 *
 * Throttled to one request per corporation per 5 minutes.
 *
 * Body: {
 *   allowRemoval?: boolean  - Whether to allow role removal (default: true)
 *   force?: boolean         - Bypass pending queue dedupe and re-queue users (default: true)
 * }
 */
const CORP_DISCORD_REFRESH_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

app.post(
	'/corporations/:corporationId/discord/refresh',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')
		const corporationId = c.req.param('corporationId')

		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		// Validate corporationId is a numeric string (EVE corporation IDs are numeric)
		if (!/^\d+$/.test(corporationId)) {
			return c.json({ error: 'Invalid corporation ID format' }, 400)
		}

		try {
			const body = await c.req.json().catch(() => ({}))
			const allowRemoval = body.allowRemoval !== false // default true
			const force = body.force !== false // default true for explicit admin action

			const db = createDb(c.env.DATABASE_URL)

			// Throttle: check for recent bulk refresh for this corporation
			const cooldownThreshold = new Date(Date.now() - CORP_DISCORD_REFRESH_COOLDOWN_MS)
			const recentRefreshes = await db
				.select({
					timestamp: userActivityLog.timestamp,
					metadata: userActivityLog.metadata,
				})
				.from(userActivityLog)
				.where(
					and(
						eq(userActivityLog.action, 'admin-corp-discord-refresh'),
						gt(userActivityLog.timestamp, cooldownThreshold)
					)
				)
				.orderBy(desc(userActivityLog.timestamp))
				.limit(10)

			// Filter by corporationId in metadata (jsonb, so filter in JS)
			const lastRefresh = recentRefreshes.find(
				(r) => (r.metadata as Record<string, unknown>)?.corporationId === corporationId
			)

			if (lastRefresh) {
				const retryAfterMs =
					CORP_DISCORD_REFRESH_COOLDOWN_MS - (Date.now() - lastRefresh.timestamp.getTime())
				const retryAfterSeconds = Math.ceil(retryAfterMs / 1000)

				return c.json(
					{
						error:
							'Corporation Discord refresh was recently triggered. Please wait before retrying.',
						retryAfterSeconds,
					},
					429
				)
			}

			// Find all users with characters in this corporation (deduplicated)
			const characters = await db
				.select({
					userId: userCharacters.userId,
				})
				.from(userCharacters)
				.where(eq(userCharacters.corporationId, corporationId))

			// Deduplicate userIds
			const uniqueUserIds = [...new Set(characters.map((c) => c.userId))]

			if (uniqueUserIds.length === 0) {
				return c.json({
					success: true,
					message: 'No users found with characters in this corporation',
					usersQueued: 0,
				})
			}

			const corpAttachments = await db.query.corporationDiscordServers.findMany({
				where: eq(corporationDiscordServers.corporationId, corporationId),
				columns: { id: true },
			})
			const refreshSource =
				corpAttachments.length === 0 ? 'corp-admin-refresh-no-attachments' : 'corp-admin-refresh'

			// Add to Core DO's pending Discord refresh set
			const coreStub = getStub<Core>(c.env.CORE, 'default')
			const result = await coreStub.addPendingDiscordRefreshes(uniqueUserIds, {
				source: refreshSource,
				force,
			})

			// Log the action for throttle tracking
			await db.insert(userActivityLog).values({
				userId: user.id,
				action: 'admin-corp-discord-refresh',
				metadata: {
					corporationId,
					allowRemoval,
					force,
					source: refreshSource,
					userCount: uniqueUserIds.length,
					usersAdded: result.added,
					usersSkipped: result.skipped,
				},
			})

			logger.info('[Admin] Corporation Discord refresh queued', {
				adminUserId: user.id,
				corporationId,
				allowRemoval,
				force,
				source: refreshSource,
				userCount: uniqueUserIds.length,
				usersAdded: result.added,
				usersSkipped: result.skipped,
				pendingCount: result.pendingCount,
			})

			return c.json({
				success: true,
				message: `Discord refresh queued for ${result.added} users`,
				usersMatched: uniqueUserIds.length,
				usersQueued: result.added,
				usersSkipped: result.skipped,
				pendingCount: result.pendingCount,
			})
		} catch (error) {
			logger.error('Error triggering corporation Discord refresh:', error)
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: 'Failed to trigger corporation Discord refresh',
				},
				500
			)
		}
	}
)

/**
 * POST /admin/eve-character-sync/manual-run
 * Manually trigger the same EVE character sync fanout workflow used by scheduled cron.
 */
app.post('/eve-character-sync/manual-run', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
		const result = await eveCharacterDataStub.triggerManualCharacterSyncBatch()
		return c.json(result)
	} catch (error) {
		logger.error('[Admin] Failed to trigger manual eve-character-sync batch', {
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to trigger manual sync batch' }, 500)
	}
})

/**
 * GET /admin/eve-character-sync/manual-run/:batchId
 * Fetch status for a manual EVE character sync batch run.
 */
app.get('/eve-character-sync/manual-run/:batchId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const batchId = c.req.param('batchId')
	if (!batchId) {
		return c.json({ error: 'Batch ID is required' }, 400)
	}

	try {
		const eveCharacterDataStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
		const status = await eveCharacterDataStub.getManualCharacterSyncBatchStatus(batchId)
		return c.json(status)
	} catch (error) {
		if (error instanceof Error && error.message === 'Manual sync batch not found') {
			return c.json({ error: 'Batch not found' }, 404)
		}
		logger.error('[Admin] Failed to fetch manual eve-character-sync batch status', {
			error: error instanceof Error ? error.message : String(error),
			batchId,
		})
		return c.json({ error: 'Failed to fetch manual sync batch status' }, 500)
	}
})

export default app
