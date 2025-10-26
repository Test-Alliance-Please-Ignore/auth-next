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
import { requireAdmin, requireAuth } from '../middleware/session'
import * as discordService from '../services/discord.service'

import type { Discord } from '@repo/discord'
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
		const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined
		const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined

		// Call admin worker via RPC
		const result = await c.env.ADMIN.searchUsers(
			{
				search,
				limit,
				offset,
			},
			user.id
		)

		return c.json(result)
	} catch (error) {
		logger.error('Error searching users:', error)
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
		const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined
		const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined
		const action = c.req.query('action') as any // AdminAction type
		const adminUserId = c.req.query('adminUserId')

		// Call admin worker via RPC
		const result = await c.env.ADMIN.getActivityLog(
			{
				limit,
				offset,
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
		const eveTokenStore = getStub<import('@repo/eve-token-store').EveTokenStore>(
			c.env.EVE_TOKEN_STORE,
			'default'
		)
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
		const result = await discordService.joinUserToCorporationServers(c.env, userId)

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

export default app
