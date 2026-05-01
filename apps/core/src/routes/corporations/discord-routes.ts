import { Hono } from 'hono'

import { and, desc, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	corporationDiscordServerRoles,
	corporationDiscordServers,
	discordRoles,
	discordServers,
	userCharacters,
} from '../../db/schema'
import { requireAdmin, requireAuth } from '../../middleware/session'

import type { Core } from '@repo/core'
import type { App } from '../../context'

const app = new Hono<App>()

/**
 * GET /corporations/:corporationId/discord-servers
 * Get all Discord server attachments for a corporation
 */
app.get('/:corporationId/discord-servers', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const attachments = await db.query.corporationDiscordServers.findMany({
			where: eq(corporationDiscordServers.corporationId, corporationId),
			with: {
				discordServer: {
					with: {
						roles: true,
					},
				},
				roles: {
					with: {
						discordRole: true,
					},
				},
			},
			orderBy: desc(corporationDiscordServers.createdAt),
		})

		return c.json(attachments)
	} catch (error) {
		logger.error('Error fetching corporation Discord servers:', error)
		return c.json({ error: 'Failed to fetch Discord servers' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/discord-servers
 * Attach a Discord server to the corporation
 */
app.post('/:corporationId/discord-servers', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { discordServerId, autoInvite = false, autoAssignRoles = false } = body

		if (!discordServerId) {
			return c.json({ error: 'discordServerId is required' }, 400)
		}

		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, discordServerId),
		})

		if (!server) {
			return c.json({ error: 'Discord server not found in registry' }, 404)
		}

		const existing = await db.query.corporationDiscordServers.findFirst({
			where: and(
				eq(corporationDiscordServers.corporationId, corporationId),
				eq(corporationDiscordServers.discordServerId, discordServerId)
			),
		})

		if (existing) {
			return c.json({ error: 'Discord server already attached to this corporation' }, 409)
		}

		const [attachment] = await db
			.insert(corporationDiscordServers)
			.values({
				corporationId,
				discordServerId,
				autoInvite,
				autoAssignRoles,
			})
			.returning()

		logger.info(`Discord server ${server.guildName} attached to corporation ${corporationId}`)

		return c.json(attachment, 201)
	} catch (error) {
		logger.error('Error attaching Discord server to corporation:', error)
		return c.json({ error: 'Failed to attach Discord server' }, 500)
	}
})

/**
 * GET /corporations/:corporationId/discord-servers/:attachmentId
 * Get a specific Discord server attachment with roles
 */
app.get(
	'/:corporationId/discord-servers/:attachmentId',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const corporationId = c.req.param('corporationId')
		const attachmentId = c.req.param('attachmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			const attachment = await db.query.corporationDiscordServers.findFirst({
				where: eq(corporationDiscordServers.id, attachmentId),
				with: {
					discordServer: {
						with: {
							roles: true,
						},
					},
					roles: {
						with: {
							discordRole: true,
						},
					},
				},
			})

			if (!attachment) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			return c.json(attachment)
		} catch (error) {
			logger.error('Error fetching Discord server attachment:', error)
			return c.json({ error: 'Failed to fetch Discord server attachment' }, 500)
		}
	}
)

/**
 * PUT /corporations/:corporationId/discord-servers/:attachmentId
 * Update Discord server attachment settings
 */
app.put(
	'/:corporationId/discord-servers/:attachmentId',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const corporationId = c.req.param('corporationId')
		const attachmentId = c.req.param('attachmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			const body = await c.req.json()
			const { autoInvite, autoAssignRoles } = body

			const existing = await db.query.corporationDiscordServers.findFirst({
				where: eq(corporationDiscordServers.id, attachmentId),
			})

			if (!existing) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			const [updated] = await db
				.update(corporationDiscordServers)
				.set({
					...(autoInvite !== undefined && { autoInvite }),
					...(autoAssignRoles !== undefined && { autoAssignRoles }),
					updatedAt: new Date(),
				})
				.where(eq(corporationDiscordServers.id, attachmentId))
				.returning()

			return c.json(updated)
		} catch (error) {
			logger.error('Error updating Discord server attachment:', error)
			return c.json({ error: 'Failed to update Discord server attachment' }, 500)
		}
	}
)

/**
 * DELETE /corporations/:corporationId/discord-servers/:attachmentId
 * Remove Discord server attachment from corporation
 */
app.delete(
	'/:corporationId/discord-servers/:attachmentId',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const corporationId = c.req.param('corporationId')
		const attachmentId = c.req.param('attachmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			const existing = await db.query.corporationDiscordServers.findFirst({
				where: eq(corporationDiscordServers.id, attachmentId),
			})

			if (!existing) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			await db
				.delete(corporationDiscordServers)
				.where(eq(corporationDiscordServers.id, attachmentId))

			const remainingAttachments = await db.query.corporationDiscordServers.findMany({
				where: eq(corporationDiscordServers.corporationId, corporationId),
				columns: { id: true },
			})
			const source =
				remainingAttachments.length === 0
					? 'corp-discord-attachment-detached-none-remaining'
					: 'corp-discord-attachment-detached'

			// Force-queue post-detach refresh so corp-ineligible users are stripped promptly.
			const linkedUsers = await db
				.select({ userId: userCharacters.userId })
				.from(userCharacters)
				.where(eq(userCharacters.corporationId, corporationId))
			const uniqueUserIds = [...new Set(linkedUsers.map((row) => row.userId))]
			if (uniqueUserIds.length > 0) {
				const coreStub = getStub<Core>(c.env.CORE, 'default')
				await coreStub.addPendingDiscordRefreshes(uniqueUserIds, {
					source,
					force: true,
				})
			}

			logger.info(`Discord server attachment ${attachmentId} removed`)
			return c.json({ success: true })
		} catch (error) {
			logger.error('Error removing Discord server attachment:', error)
			return c.json({ error: 'Failed to remove Discord server attachment' }, 500)
		}
	}
)

/**
 * POST /corporations/:corporationId/discord-servers/:attachmentId/roles
 * Assign a role to the Discord server attachment
 */
app.post(
	'/:corporationId/discord-servers/:attachmentId/roles',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const attachmentId = c.req.param('attachmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			const body = await c.req.json()
			const { discordRoleId } = body

			if (!discordRoleId) {
				return c.json({ error: 'discordRoleId is required' }, 400)
			}

			const attachment = await db.query.corporationDiscordServers.findFirst({
				where: eq(corporationDiscordServers.id, attachmentId),
			})

			if (!attachment) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			const role = await db.query.discordRoles.findFirst({
				where: eq(discordRoles.id, discordRoleId),
			})

			if (!role) {
				return c.json({ error: 'Discord role not found' }, 404)
			}

			if (role.discordServerId !== attachment.discordServerId) {
				return c.json({ error: 'Role does not belong to this Discord server' }, 400)
			}

			const existingAssignment = await db.query.corporationDiscordServerRoles.findFirst({
				where: and(
					eq(corporationDiscordServerRoles.corporationDiscordServerId, attachmentId),
					eq(corporationDiscordServerRoles.discordRoleId, discordRoleId)
				),
			})

			if (existingAssignment) {
				return c.json({ error: 'Role already assigned to this attachment' }, 409)
			}

			const [roleAssignment] = await db
				.insert(corporationDiscordServerRoles)
				.values({
					corporationDiscordServerId: attachmentId,
					discordRoleId,
				})
				.returning()

			logger.info(
				`Role ${role.roleName} assigned to corporation Discord attachment ${attachmentId}`
			)

			return c.json(roleAssignment, 201)
		} catch (error) {
			logger.error('Error assigning role to Discord server attachment:', error)
			return c.json({ error: 'Failed to assign role' }, 500)
		}
	}
)

/**
 * DELETE /corporations/:corporationId/discord-servers/:attachmentId/roles/:roleAssignmentId
 * Remove a role assignment from the Discord server attachment
 */
app.delete(
	'/:corporationId/discord-servers/:attachmentId/roles/:roleAssignmentId',
	requireAuth(),
	requireAdmin(),
	async (c) => {
		const roleAssignmentId = c.req.param('roleAssignmentId')
		const db = c.get('db')

		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		try {
			const existing = await db.query.corporationDiscordServerRoles.findFirst({
				where: eq(corporationDiscordServerRoles.id, roleAssignmentId),
			})

			if (!existing) {
				return c.json({ error: 'Role assignment not found' }, 404)
			}

			await db
				.delete(corporationDiscordServerRoles)
				.where(eq(corporationDiscordServerRoles.id, roleAssignmentId))

			logger.info(`Role assignment ${roleAssignmentId} removed`)
			return c.json({ success: true })
		} catch (error) {
			logger.error('Error removing role assignment:', error)
			return c.json({ error: 'Failed to remove role assignment' }, 500)
		}
	}
)

export default app
