/**
 * Admin routes - Administrative operations for managing users and characters
 *
 * All endpoints require authentication and admin privileges.
 * These endpoints call the admin worker via RPC for actual operations.
 */

import { Hono } from 'hono'
import { z } from 'zod'

import { and, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { userCharacters, users } from '../db/schema'
import { validatePagination } from '../lib/validation'
import { triggerUserRefreshWorkflow } from '../lib/workflow-triggers'
import { requireAdmin, requireAuth } from '../middleware/session'
import * as discordService from '../services/discord.service'
import { SessionService } from '../services/session.service'
import { UserService } from '../services/user.service'

import type { Discord } from '@repo/discord'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Hr } from '@repo/hr'
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
		const result = await discordService.syncUserDiscordAccess(c.env, userId)
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
 * POST /admin/users/:userId/discord/revoke
 * Manually revoke a user's Discord authorization (admin action)
 *
 * Marks the user's Discord authorization as revoked without actually unlinking
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

		logger.info('[Admin] Discord authorization revoked by admin', {
			adminUserId: user.id,
			targetUserId: userId,
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
		await triggerUserRefreshWorkflow({
			db,
			env: c.env,
			userId,
			source: `admin-sync-${user.id}`,
			bypassThrottle: true,
			refreshMode: 'manual',
			throwOnError: true,
		})

		logger.info('[Admin] User sync triggered by admin', {
			adminUserId: user.id,
			targetUserId: userId,
		})

		return c.json({ success: true, message: 'User sync workflow triggered' })
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

		// Helper function to cascade blacklists with depth limiting
		async function cascadeBlacklist(
			targetUserId: string,
			cascadeReason: string,
			triggeredBy: string | undefined,
			isAuto: boolean,
			depth: number
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

			// 1. Create user blacklist
			await hrStub.createUserBlacklist({
				userId: targetUserId,
				reason: cascadeReason,
				blacklistedBy: blacklistedByUserId,
				isAutoBlacklist: isAuto,
				triggeredBy,
			})
			if (isAuto) {
				blacklistedUsers.push(targetUserId)
			}

			// 2. Invalidate sessions
			await sessionService.invalidateAllUserSessions(targetUserId)

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
					reason: `Auto-blacklisted: owned by blacklisted user ${targetUserId}`,
					blacklistedBy: blacklistedByUserId,
					metadata: { triggeredByUserBlacklist: triggeredBy || userId },
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
							depth + 1
						)
					}
				}
			}
		}

		// Start the cascade with the initial user
		await cascadeBlacklist(userId, reason, undefined, false, 0)

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
			characterId: z.string(),
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

		const { characterId, reason, metadata } = validation.data

		// Call HR DO via RPC
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const entry = await hrStub.createCharacterBlacklist({
			characterId,
			reason,
			blacklistedBy: user.id,
			metadata,
		})

		// Find all users with this character and auto-blacklist them
		const db = createDb(c.env.DATABASE_URL)
		const usersWithChar = await db.query.userCharacters.findMany({
			where: eq(userCharacters.characterId, characterId),
		})

		const sessionService = new SessionService(db)
		const autoBlacklistedUsers: string[] = []

		for (const char of usersWithChar) {
			// Auto-blacklist each user
			await hrStub.createUserBlacklist({
				userId: char.userId,
				reason: `Auto-blacklisted: linked to blacklisted character ${characterId}`,
				blacklistedBy: user.id,
				triggeredBy: entry.id,
				isAutoBlacklist: true,
			})

			// Invalidate all sessions
			await sessionService.invalidateAllUserSessions(char.userId)
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
 * - targetType?: 'user' | 'character' - Filter by target type
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

		const targetType = c.req.query('targetType') as 'user' | 'character' | undefined
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
		// Call HR DO via RPC
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const entries = await hrStub.getBlacklistsForUser(userId)

		return c.json(entries)
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

export default app
