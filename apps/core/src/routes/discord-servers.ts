import { Hono } from 'hono'

import { and, desc, eq, ilike } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { discordRoles, discordServers } from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/session'

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
		const { guildId, guildName, description } = body

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
		const { guildName, description, isActive } = body

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
		const { roleId, roleName, description } = body

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
			})
			.returning()

		logger.info(`Role ${roleName} (${roleId}) added to Discord server ${server.guildName}`)

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
		const { roleName, description, isActive } = body

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

export default app
