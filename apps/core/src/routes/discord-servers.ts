import { Hono } from 'hono'

import { and, desc, eq, ilike, inArray, isNotNull } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	corporationDiscordServers,
	discordRoles,
	discordServers,
	userCharacters,
	users,
} from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/session'
import * as discordService from '../services/discord.service'

import type { App } from '../context'

const app = new Hono<App>()

/**
 * GET /discord-servers
 * List all Discord servers in the registry (admin only)
 */
app.get('/', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const servers = await db.query.discordServers.findMany({
			orderBy: desc(discordServers.updatedAt),
			with: {
				roles: true,
			},
		})

		return c.json(servers)
	} catch (error) {
		logger.error('Error fetching Discord servers:', error)
		return c.json({ error: 'Failed to fetch Discord servers' }, 500)
	}
})

/**
 * GET /discord-servers/search?q=:query
 * Search Discord servers by guild name or guild ID
 */
app.get('/search', requireAuth(), requireAdmin(), async (c) => {
	const query = c.req.query('q')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	if (!query || query.length < 2) {
		return c.json({ error: 'Query must be at least 2 characters' }, 400)
	}

	try {
		const results = await db
			.select()
			.from(discordServers)
			.where(ilike(discordServers.guildName, `%${query}%`))
			.limit(20)

		return c.json(results)
	} catch (error) {
		logger.error('Error searching Discord servers:', error)
		return c.json({ error: 'Failed to search Discord servers' }, 500)
	}
})

/**
 * POST /discord-servers
 * Add a new Discord server to the registry
 *
 * Body: {
 *   guildId: string
 *   guildName: string
 *   description?: string
 *   manageNicknames?: boolean
 * }
 */
app.post('/', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')
	const user = c.get('user')!

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { guildId, guildName, description, manageNicknames } = body

		if (!guildId || !guildName) {
			return c.json({ error: 'guildId and guildName are required' }, 400)
		}

		// Check if server already exists
		const existing = await db.query.discordServers.findFirst({
			where: eq(discordServers.guildId, guildId),
		})

		if (existing) {
			return c.json({ error: 'Discord server already exists in registry' }, 409)
		}

		// Create the server
		const [server] = await db
			.insert(discordServers)
			.values({
				guildId,
				guildName,
				description: description || null,
				...(manageNicknames !== undefined && { manageNicknames }),
				createdBy: user.id,
			})
			.returning()

		logger.info(`Discord server ${guildName} (${guildId}) added to registry by ${user.id}`)

		return c.json(server, 201)
	} catch (error) {
		logger.error('Error creating Discord server:', error)
		return c.json({ error: 'Failed to create Discord server' }, 500)
	}
})

/**
 * GET /discord-servers/:id
 * Get a specific Discord server with its roles
 */
app.get('/:id', requireAuth(), requireAdmin(), async (c) => {
	const id = c.req.param('id')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, id),
			with: {
				roles: {
					orderBy: desc(discordRoles.roleName),
				},
			},
		})

		if (!server) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		return c.json(server)
	} catch (error) {
		logger.error('Error fetching Discord server:', error)
		return c.json({ error: 'Failed to fetch Discord server' }, 500)
	}
})

/**
 * PUT /discord-servers/:id
 * Update a Discord server
 *
 * Body: {
 *   guildName?: string
 *   description?: string
 *   isActive?: boolean
 *   manageNicknames?: boolean
 * }
 */
app.put('/:id', requireAuth(), requireAdmin(), async (c) => {
	const id = c.req.param('id')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { guildName, description, isActive, manageNicknames } = body

		// Check if server exists
		const existing = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, id),
		})

		if (!existing) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		// Update the server
		const [updated] = await db
			.update(discordServers)
			.set({
				...(guildName !== undefined && { guildName }),
				...(description !== undefined && { description }),
				...(isActive !== undefined && { isActive }),
				...(manageNicknames !== undefined && { manageNicknames }),
				updatedAt: new Date(),
			})
			.where(eq(discordServers.id, id))
			.returning()

		return c.json(updated)
	} catch (error) {
		logger.error('Error updating Discord server:', error)
		return c.json({ error: 'Failed to update Discord server' }, 500)
	}
})

/**
 * DELETE /discord-servers/:id
 * Delete a Discord server from the registry
 */
app.delete('/:id', requireAuth(), requireAdmin(), async (c) => {
	const id = c.req.param('id')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// Check if server exists
		const existing = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, id),
		})

		if (!existing) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		// Delete the server (cascade will handle roles and attachments)
		await db.delete(discordServers).where(eq(discordServers.id, id))

		logger.info(`Discord server ${existing.guildName} (${existing.guildId}) deleted from registry`)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting Discord server:', error)
		return c.json({ error: 'Failed to delete Discord server' }, 500)
	}
})

/**
 * POST /discord-servers/:id/roles
 * Add a role to a Discord server
 *
 * Body: {
 *   roleId: string
 *   roleName: string
 *   description?: string
 *   autoApply?: boolean
 * }
 */
app.post('/:id/roles', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { roleId, roleName, description, autoApply } = body

		if (!roleId || !roleName) {
			return c.json({ error: 'roleId and roleName are required' }, 400)
		}

		// Check if server exists
		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, serverId),
		})

		if (!server) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		// Check if role already exists for this server
		const existing = await db.query.discordRoles.findFirst({
			where: and(eq(discordRoles.discordServerId, serverId), eq(discordRoles.roleId, roleId)),
		})

		if (existing) {
			return c.json({ error: 'Role already exists for this server' }, 409)
		}

		// Create the role
		const [role] = await db
			.insert(discordRoles)
			.values({
				discordServerId: serverId,
				roleId,
				roleName,
				description: description || null,
				...(autoApply !== undefined && { autoApply }),
			})
			.returning()

		logger.info(
			`Role ${roleName} (${roleId}) added to Discord server ${server.guildName}` +
				(autoApply ? ' with auto-apply enabled' : '')
		)

		return c.json(role, 201)
	} catch (error) {
		logger.error('Error creating Discord role:', error)
		return c.json({ error: 'Failed to create Discord role' }, 500)
	}
})

/**
 * PUT /discord-servers/:id/roles/:roleId
 * Update a Discord role
 *
 * Body: {
 *   roleName?: string
 *   description?: string
 *   isActive?: boolean
 *   autoApply?: boolean
 * }
 */
app.put('/:id/roles/:roleId', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const roleId = c.req.param('roleId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { roleName, description, isActive, autoApply } = body

		// Check if role exists
		const existing = await db.query.discordRoles.findFirst({
			where: eq(discordRoles.id, roleId),
		})

		if (!existing) {
			return c.json({ error: 'Discord role not found' }, 404)
		}

		// Update the role
		const [updated] = await db
			.update(discordRoles)
			.set({
				...(roleName !== undefined && { roleName }),
				...(description !== undefined && { description }),
				...(isActive !== undefined && { isActive }),
				...(autoApply !== undefined && { autoApply }),
				updatedAt: new Date(),
			})
			.where(eq(discordRoles.id, roleId))
			.returning()

		return c.json(updated)
	} catch (error) {
		logger.error('Error updating Discord role:', error)
		return c.json({ error: 'Failed to update Discord role' }, 500)
	}
})

/**
 * DELETE /discord-servers/:id/roles/:roleId
 * Delete a Discord role
 */
app.delete('/:id/roles/:roleId', requireAuth(), requireAdmin(), async (c) => {
	const roleId = c.req.param('roleId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// Check if role exists
		const existing = await db.query.discordRoles.findFirst({
			where: eq(discordRoles.id, roleId),
		})

		if (!existing) {
			return c.json({ error: 'Discord role not found' }, 404)
		}

		// Delete the role (cascade will handle assignments)
		await db.delete(discordRoles).where(eq(discordRoles.id, roleId))

		logger.info(`Discord role ${existing.roleName} (${existing.roleId}) deleted`)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting Discord role:', error)
		return c.json({ error: 'Failed to delete Discord role' }, 500)
	}
})

/**
 * POST /discord-servers/:id/refresh-members
 * Refresh all members for a Discord server
 *
 * Finds all users who should have access to this server based on
 * corporation and group memberships, then invites them or updates
 * their roles. Only processes users who have Discord linked.
 */
app.post('/:id/refresh-members', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// Check if Discord server exists
		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, serverId),
		})

		if (!server) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		logger.info('[Discord] Starting member refresh for Discord server', {
			serverId,
			guildId: server.guildId,
			guildName: server.guildName,
		})

		// === FIND ALL CORPORATIONS WITH THIS DISCORD SERVER ===

		const corpAttachments = await db.query.corporationDiscordServers.findMany({
			where: eq(corporationDiscordServers.discordServerId, serverId),
			with: {
				corporation: true,
			},
		})

		logger.info('[Discord] Found corporation attachments', {
			count: corpAttachments.length,
		})

		// Collect all user IDs from corporations
		const userIdsFromCorps = new Set<string>()

		for (const attachment of corpAttachments) {
			try {
				// Get corporation members via RPC
				const corpStub = getStub<import('@repo/eve-corporation-data').EveCorporationData>(
					c.env.EVE_CORPORATION_DATA,
					attachment.corporationId
				)
				const members = await corpStub.getMembers(attachment.corporationId)
				const memberCharacterIds = members.map((m: any) => m.characterId)

				logger.info('[Discord] Corporation members fetched', {
					corporationId: attachment.corporationId,
					corporationName: attachment.corporation.name,
					memberCount: members.length,
				})

				// Find users who have these characters
				const usersWithChars = await db.query.userCharacters.findMany({
					where: inArray(userCharacters.characterId, memberCharacterIds),
					with: {
						user: true,
					},
				})

				// Collect user IDs who have Discord linked
				for (const userChar of usersWithChars) {
					if (userChar.user.discordUserId) {
						userIdsFromCorps.add(userChar.user.id)
					}
				}
			} catch (error) {
				logger.error('[Discord] Error fetching corporation members', {
					corporationId: attachment.corporationId,
					error: String(error),
				})
			}
		}

		logger.info('[Discord] Collected users from corporations', {
			userCount: userIdsFromCorps.size,
		})

		// === FIND ALL GROUPS WITH THIS DISCORD SERVER ===

		const userIdsFromGroups = new Set<string>()

		try {
			const groupsStub = getStub<import('@repo/groups').Groups>(c.env.GROUPS, 'default')

			// Get all groups that have this Discord server attached
			const groupsWithServer = await groupsStub.getGroupsByDiscordServer(serverId)

			logger.info('[Discord] Found groups with this Discord server', {
				groupCount: groupsWithServer.length,
			})

			// For each group, get member user IDs
			for (const group of groupsWithServer) {
				try {
					const memberUserIds = await groupsStub.getGroupMemberUserIds(group.groupId)

					logger.info('[Discord] Group members fetched', {
						groupId: group.groupId,
						groupName: group.groupName,
						memberCount: memberUserIds.length,
					})

					// Check which users have Discord linked
					if (memberUserIds.length > 0) {
						const usersWithDiscord = await db.query.users.findMany({
							where: and(inArray(users.id, memberUserIds), isNotNull(users.discordUserId)),
						})

						for (const user of usersWithDiscord) {
							userIdsFromGroups.add(user.id)
						}
					}
				} catch (error) {
					logger.error('[Discord] Error fetching group members', {
						groupId: group.groupId,
						error: String(error),
					})
				}
			}
		} catch (error) {
			logger.error('[Discord] Error fetching groups', {
				error: String(error),
			})
		}

		logger.info('[Discord] Collected users from groups', {
			userCount: userIdsFromGroups.size,
		})

		// === COMBINE AND DEDUPLICATE USER IDs ===

		const allUserIds = new Set([...userIdsFromCorps, ...userIdsFromGroups])

		logger.info('[Discord] Total unique users to process', {
			totalUsers: allUserIds.size,
			fromCorps: userIdsFromCorps.size,
			fromGroups: userIdsFromGroups.size,
		})

		if (allUserIds.size === 0) {
			return c.json({
				totalProcessed: 0,
				successfulInvites: 0,
				failedInvites: 0,
				results: [],
			})
		}

		// === PROCESS EACH USER ===

		const results = []
		let successfulInvites = 0
		let failedInvites = 0

		for (const userId of allUserIds) {
			try {
				const result = await discordService.joinUserToCorporationServers(c.env, userId)

				// Find results specific to this guild
				const guildResults = result.results.filter((r) => r.guildId === server.guildId)

				const success = guildResults.some((r) => r.success)
				const errorMessage = guildResults.find((r) => r.errorMessage)?.errorMessage

				if (success) {
					successfulInvites++
				} else {
					failedInvites++
				}

				// Get user info for logging
				const user = await db.query.users.findFirst({
					where: eq(users.id, userId),
					with: {
						characters: {
							where: eq(userCharacters.is_primary, true),
						},
					},
				})

				results.push({
					userId,
					userName: user?.characters[0]?.characterName || 'Unknown',
					success,
					errorMessage,
				})

				logger.info('[Discord] Processed user', {
					userId,
					userName: user?.characters[0]?.characterName,
					success,
				})
			} catch (error) {
				failedInvites++
				logger.error('[Discord] Error processing user', {
					userId,
					error: String(error),
				})

				results.push({
					userId,
					userName: 'Unknown',
					success: false,
					errorMessage: error instanceof Error ? error.message : 'Unknown error',
				})
			}
		}

		logger.info('[Discord] Member refresh complete', {
			serverId,
			guildName: server.guildName,
			totalProcessed: allUserIds.size,
			successfulInvites,
			failedInvites,
		})

		return c.json({
			totalProcessed: allUserIds.size,
			successfulInvites,
			failedInvites,
			results,
		})
	} catch (error) {
		logger.error('Error refreshing Discord server members:', error)
		return c.json({ error: 'Failed to refresh Discord server members' }, 500)
	}
})

export default app
