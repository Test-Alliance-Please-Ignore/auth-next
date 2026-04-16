/**
 * Admin routes - Administrative operations for managing users and characters
 *
 * All endpoints require authentication and admin privileges.
 * These endpoints call the admin worker via RPC for actual operations.
 */

import { Hono } from 'hono'
import { z } from 'zod'

import { and, desc, eq, gt } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { userActivityLog, userCharacters, users } from '../db/schema'
import { validatePagination } from '../lib/validation'
import { triggerUserRefreshWorkflow } from '../lib/workflow-triggers'
import { requireAdmin, requireAuth } from '../middleware/session'
import * as discordService from '../services/discord.service'
import { SessionService } from '../services/session.service'
import { UserService } from '../services/user.service'

import type { Core } from '@repo/core'
import type { Discord } from '@repo/discord'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Groups } from '@repo/groups'
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

			// Add to Core DO's pending Discord refresh set
			const coreStub = getStub<Core>(c.env.CORE, 'default')
			const result = await coreStub.addPendingDiscordRefreshes(uniqueUserIds, {
				source: 'corp-admin-refresh',
			})

			// Log the action for throttle tracking
			await db.insert(userActivityLog).values({
				userId: user.id,
				action: 'admin-corp-discord-refresh',
				metadata: {
					corporationId,
					allowRemoval,
					userCount: uniqueUserIds.length,
				},
			})

			logger.info('[Admin] Corporation Discord refresh queued', {
				adminUserId: user.id,
				corporationId,
				allowRemoval,
				userCount: uniqueUserIds.length,
				pendingCount: result.pendingCount,
			})

			return c.json({
				success: true,
				message: `Discord refresh queued for ${uniqueUserIds.length} users`,
				usersQueued: uniqueUserIds.length,
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

export default app
