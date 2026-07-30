import { Hono } from 'hono'

import { ROLE_CORE_CORP_MEMBER } from '@repo/core'
import { and, asc, desc, eq, ilike, inArray, isNotNull, sql } from '@repo/db-utils'
import { DISCORD_EXCLUDED_AUTH_ROLE_IDS, getDiscordStub } from '@repo/discord'
import { getStub } from '@repo/do-utils'
import { ResourceType, RoleAttachmentType } from '@repo/groups'
import { logger } from '@repo/hono-helpers'
import { createWorkflow } from '@repo/workflow-utils'

import {
	corporationDiscordServers,
	discordMemberAuditRows,
	discordMemberAuditRuns,
	discordRoles,
	discordSelfAssignableRoles,
	discordServerCommands,
	discordServers,
	managedCorporations,
	userCharacters,
	users,
} from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/session'
import {
	buildDiscordSlashCommandDefinition,
	deleteGuildSlashCommand,
	upsertGuildSlashCommand,
} from '../services/discord-commands.service'
import { parseDiscordDurationSeconds } from '../services/discord-duration'
import * as discordService from '../services/discord.service'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Groups } from '@repo/groups'
import type { App } from '../context'

const app = new Hono<App>()
const MAX_DISCORD_SELECT_LABEL_LENGTH = 100
const MAX_DISCORD_SELF_ASSIGNABLE_ROLES = 25

function parseConfiguredDiscordDuration(value: unknown): number | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'number' && Number.isInteger(value)) {
		return parseDiscordDurationSeconds(`${value} seconds`)
	}
	if (typeof value !== 'string') throw new Error('Duration must be text or null')
	return parseDiscordDurationSeconds(value)
}

type DiscordAuditTab = 'linked' | 'unlinked'
type DiscordAuditFilter =
	| 'all'
	| 'member_corp'
	| 'external'
	| 'roles_without_member_corp'
	| 'drifted'
	| 'unmanaged_roles'
	| 'with_roles'
	| 'without_roles'
const EXCLUDED_AUDIT_ROLE_IDS = DISCORD_EXCLUDED_AUTH_ROLE_IDS
const EXCLUDED_AFFILIATION_MISMATCH_ROLE_IDS = DISCORD_EXCLUDED_AUTH_ROLE_IDS

type DiscordAuditMemberRow = {
	discordUserId: string
	username: string
	discriminator: string
	displayName: string
	roleIds: string[]
	linked: boolean
	coreUserId: string | null
	mainCharacterId: string | null
	mainCharacterName: string | null
	hasValidToken: boolean | null
	corporationId: string | null
	corporationName: string | null
	isInMemberCorporation?: boolean
	hasManagedRoleDrift?: boolean
	hasRoleAffiliationMismatch?: boolean
	unmanagedRoleCount?: number
	runId?: string
	runStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
	runScanned?: number
	roleState?: 'ok' | 'drift' | 'error'
	roleStateReason?: string
}

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

		if (
			typeof roleId !== 'string' ||
			typeof roleName !== 'string' ||
			roleId.trim() === '' ||
			roleName.trim() === ''
		) {
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
		const sameName = await db.query.discordRoles.findMany({
			where: eq(discordRoles.discordServerId, serverId),
			columns: { roleName: true },
		})
		if (
			sameName.some((role) => role.roleName.trim().toLowerCase() === roleName.trim().toLowerCase())
		) {
			return c.json({ error: 'A role with this name already exists for this server' }, 409)
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
		if (roleName !== undefined && (typeof roleName !== 'string' || roleName.trim() === '')) {
			return c.json({ error: 'roleName must be a non-empty string' }, 400)
		}

		// Check if role exists
		const existing = await db.query.discordRoles.findFirst({
			where: and(eq(discordRoles.id, roleId), eq(discordRoles.discordServerId, serverId)),
		})

		if (!existing) {
			return c.json({ error: 'Discord role not found' }, 404)
		}

		if (roleName !== undefined) {
			const sameName = await db.query.discordRoles.findMany({
				where: eq(discordRoles.discordServerId, serverId),
				columns: { id: true, roleName: true },
			})
			if (
				sameName.some(
					(role) =>
						role.id !== roleId &&
						role.roleName.trim().toLowerCase() === String(roleName).trim().toLowerCase()
				)
			) {
				return c.json({ error: 'A role with this name already exists for this server' }, 409)
			}
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
			.where(and(eq(discordRoles.id, roleId), eq(discordRoles.discordServerId, serverId)))
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
	const serverId = c.req.param('id')
	const roleId = c.req.param('roleId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// Check if role exists
		const existing = await db.query.discordRoles.findFirst({
			where: and(eq(discordRoles.id, roleId), eq(discordRoles.discordServerId, serverId)),
		})

		if (!existing) {
			return c.json({ error: 'Discord role not found' }, 404)
		}

		// Delete the role (cascade will handle assignments)
		await db
			.delete(discordRoles)
			.where(and(eq(discordRoles.id, roleId), eq(discordRoles.discordServerId, serverId)))

		logger.info(`Discord role ${existing.roleName} (${existing.roleId}) deleted`)

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting Discord role:', error)
		return c.json({ error: 'Failed to delete Discord role' }, 500)
	}
})

/**
 * Self-assignable role configuration for one registered Discord server.
 * These rows reference the existing managed-role registry; they never create Discord roles.
 */
app.get('/:id/self-assignable-roles', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	const server = await db.query.discordServers.findFirst({
		where: eq(discordServers.id, serverId),
		columns: { id: true },
	})
	if (!server) return c.json({ error: 'Discord server not found' }, 404)

	const configs = await db.query.discordSelfAssignableRoles.findMany({
		with: {
			discordRole: {
				columns: {
					id: true,
					roleId: true,
					roleName: true,
					isActive: true,
					discordServerId: true,
				},
			},
		},
	})

	return c.json(
		configs
			.filter((config) => config.discordRole.discordServerId === serverId)
			.sort((a, b) => a.displayName.localeCompare(b.displayName))
	)
})

app.post('/:id/self-assignable-roles', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const db = c.get('db')
	const user = c.get('user')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	if (!user) return c.json({ error: 'Unauthorized' }, 401)

	try {
		const body = (await c.req.json()) as {
			discordRoleId?: unknown
			displayName?: unknown
			defaultDuration?: unknown
		}
		const discordRoleId = typeof body.discordRoleId === 'string' ? body.discordRoleId.trim() : ''
		const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
		if (displayName.length > MAX_DISCORD_SELECT_LABEL_LENGTH) {
			return c.json({ error: 'displayName must be 100 characters or fewer' }, 400)
		}
		let duration: number | null
		try {
			duration = parseConfiguredDiscordDuration(body.defaultDuration)
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : 'Invalid duration' }, 400)
		}
		if (!discordRoleId) return c.json({ error: 'discordRoleId is required' }, 400)

		const role = await db.query.discordRoles.findFirst({
			where: and(eq(discordRoles.id, discordRoleId), eq(discordRoles.discordServerId, serverId)),
			columns: { id: true, roleName: true, isActive: true },
		})
		if (!role) return c.json({ error: 'Managed Discord role not found for this server' }, 404)
		if (!role.isActive)
			return c.json({ error: 'Inactive Discord roles cannot be self-assignable' }, 400)

		const [, result] = await db.batch([
			db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${serverId}, 0))`),
			db.execute<{
			id: string
			discord_role_id: string
			display_name: string
			default_duration_seconds: number | null
			created_by: string | null
			created_at: Date
			updated_at: Date
		}>(sql`
			WITH candidate AS (
				SELECT
					${role.id}::uuid AS discord_role_id,
					${displayName || role.roleName}::text AS display_name,
					${duration}::integer AS default_duration_seconds,
					${user.id}::uuid AS created_by
			), eligible AS (
				SELECT candidate.*
				FROM candidate
				WHERE EXISTS (
					SELECT 1
					FROM public.discord_self_assignable_roles
					WHERE discord_role_id = candidate.discord_role_id
				)
				OR (
					SELECT count(*)
					FROM public.discord_self_assignable_roles AS self_assignable
					INNER JOIN public.discord_roles AS managed_role
						ON managed_role.id = self_assignable.discord_role_id
					WHERE managed_role.discord_server_id = ${serverId}::uuid
				) < ${MAX_DISCORD_SELF_ASSIGNABLE_ROLES}
			)
			INSERT INTO public.discord_self_assignable_roles (
				discord_role_id,
				display_name,
				default_duration_seconds,
				created_by
			)
			SELECT
				discord_role_id,
				display_name,
				default_duration_seconds,
				created_by
			FROM eligible
			ON CONFLICT (discord_role_id) DO UPDATE SET
				display_name = EXCLUDED.display_name,
				default_duration_seconds = EXCLUDED.default_duration_seconds,
				updated_at = now()
			RETURNING
				id,
				discord_role_id,
				display_name,
				default_duration_seconds,
				created_by,
				created_at,
				updated_at
			`)
		])
		const row = result.rows[0]
		if (!row) {
			return c.json({ error: 'A Discord server can have at most 25 self-assignable roles' }, 400)
		}
		const config = {
			id: row.id,
			discordRoleId: row.discord_role_id,
			displayName: row.display_name,
			defaultDurationSeconds: row.default_duration_seconds,
			createdBy: row.created_by,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}

		return c.json(config, 201)
	} catch (error) {
		logger.error('[Discord] Failed to create self-assignable role configuration', {
			serverId,
			error: String(error),
		})
		return c.json({ error: 'Failed to save self-assignable role configuration' }, 500)
	}
})

app.put('/:id/self-assignable-roles/:configId', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const configId = c.req.param('configId')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	try {
		const body = (await c.req.json()) as {
			discordRoleId?: unknown
			displayName?: unknown
			defaultDuration?: unknown
		}
		let duration: number | null
		try {
			duration = parseConfiguredDiscordDuration(body.defaultDuration)
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : 'Invalid duration' }, 400)
		}

		const existing = await db.query.discordSelfAssignableRoles.findFirst({
			where: eq(discordSelfAssignableRoles.id, configId),
			with: { discordRole: { columns: { discordServerId: true } } },
		})
		if (!existing || existing.discordRole.discordServerId !== serverId) {
			return c.json({ error: 'Self-assignable role configuration not found' }, 404)
		}

		const discordRoleId =
			typeof body.discordRoleId === 'string' ? body.discordRoleId.trim() : undefined
		const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined
		if (displayName !== undefined && displayName.length > MAX_DISCORD_SELECT_LABEL_LENGTH) {
			return c.json({ error: 'displayName must be 100 characters or fewer' }, 400)
		}
		let roleId: string | undefined
		if (discordRoleId) {
			const role = await db.query.discordRoles.findFirst({
				where: and(eq(discordRoles.id, discordRoleId), eq(discordRoles.discordServerId, serverId)),
				columns: { id: true, roleName: true, isActive: true },
			})
			if (!role) return c.json({ error: 'Managed Discord role not found for this server' }, 404)
			if (!role.isActive)
				return c.json({ error: 'Inactive Discord roles cannot be self-assignable' }, 400)
			roleId = role.id
		}

		if (roleId) {
			const configuredRoles = await db.query.discordSelfAssignableRoles.findMany({
				with: { discordRole: { columns: { id: true, discordServerId: true } } },
			})
			if (
				configuredRoles.some(
					(config) =>
						config.id !== configId &&
						config.discordRole.discordServerId === serverId &&
						config.discordRole.id === roleId
				)
			) {
				return c.json({ error: 'This role is already configured as self-assignable' }, 409)
			}
		}
		if (displayName !== undefined && displayName === '') {
			return c.json({ error: 'displayName must be a non-empty string' }, 400)
		}

		if (roleId) {
			const existingConfigs = await db.query.discordSelfAssignableRoles.findMany({
				with: {
					discordRole: {
						columns: {
							id: true,
							discordServerId: true,
						},
					},
				},
			})
			const serverConfigCount = existingConfigs.filter(
				(config) => config.id !== configId && config.discordRole.discordServerId === serverId
			).length
			if (serverConfigCount >= MAX_DISCORD_SELF_ASSIGNABLE_ROLES) {
				return c.json({ error: 'A Discord server can have at most 25 self-assignable roles' }, 400)
			}
		}

		const [updated] = await db
			.update(discordSelfAssignableRoles)
			.set({
				...(roleId ? { discordRoleId: roleId } : {}),
				...(displayName !== undefined ? { displayName } : {}),
				defaultDurationSeconds: duration,
				updatedAt: new Date(),
			})
			.where(eq(discordSelfAssignableRoles.id, configId))
			.returning()
		return c.json(updated)
	} catch (error) {
		logger.error('[Discord] Failed to update self-assignable role configuration', {
			serverId,
			configId,
			error: String(error),
		})
		return c.json({ error: 'Failed to update self-assignable role configuration' }, 500)
	}
})

app.delete('/:id/self-assignable-roles/:configId', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const configId = c.req.param('configId')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	const existing = await db.query.discordSelfAssignableRoles.findFirst({
		where: eq(discordSelfAssignableRoles.id, configId),
		with: { discordRole: { columns: { discordServerId: true } } },
	})
	if (!existing || existing.discordRole.discordServerId !== serverId) {
		return c.json({ error: 'Self-assignable role configuration not found' }, 404)
	}

	await db.delete(discordSelfAssignableRoles).where(eq(discordSelfAssignableRoles.id, configId))
	return c.json({ success: true })
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
				const corpStub = getStub<EveCorporationData>(
					c.env.EVE_CORPORATION_DATA,
					attachment.corporationId
				)
				const members = await corpStub.getMembers(attachment.corporationId)
				const memberCharacterIds = members.map((m) => m.characterId)

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
			const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')

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
		// Use the refreshServerMembers helper which:
		// 1. Invites each user to this specific server
		// 2. Sets their nickname (before roles)
		// 3. Sets their roles (after nickname)

		const refreshResult = await discordService.refreshServerMembers(
			c.env,
			serverId,
			Array.from(allUserIds)
		)

		return c.json({
			totalProcessed: allUserIds.size,
			successfulInvites: refreshResult.successCount,
			failedInvites: refreshResult.failCount,
			results: refreshResult.results,
		})
	} catch (error) {
		logger.error('Error refreshing Discord server members:', error)
		return c.json({ error: 'Failed to refresh Discord server members' }, 500)
	}
})

/**
 * POST /discord-servers/:id/audit/runs
 * Start async persisted guild member audit workflow.
 */
app.post('/:id/audit/runs', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const user = c.get('user')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)
	if (!user) return c.json({ error: 'Unauthorized' }, 401)

	try {
		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, serverId),
			columns: { id: true, guildId: true, guildName: true },
		})
		if (!server) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		const workflowId = `discord-member-audit-${server.id.replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36)}`
		const [run] = await db
			.insert(discordMemberAuditRuns)
			.values({
				workflowInstanceId: workflowId,
				discordServerId: server.id,
				guildId: server.guildId,
				guildName: server.guildName,
				initiatedByUserId: user.id,
				status: 'pending',
			})
			.returning({
				id: discordMemberAuditRuns.id,
				workflowInstanceId: discordMemberAuditRuns.workflowInstanceId,
				status: discordMemberAuditRuns.status,
			})

		await createWorkflow(c.env.DISCORD_MEMBER_AUDIT_WORKFLOW, {
			id: workflowId,
			params: {
				runId: run.id,
				discordServerId: server.id,
				guildId: server.guildId,
				guildName: server.guildName,
			},
		})

		return c.json({
			runId: run.id,
			workflowInstanceId: run.workflowInstanceId,
			status: run.status,
		})
	} catch (error) {
		logger.error('[Discord] Failed to start member audit workflow', {
			serverId,
			error: String(error),
		})
		return c.json({ error: 'Failed to start audit workflow' }, 500)
	}
})

/**
 * POST /discord-servers/:id/audit/cleanup
 * Remove old audit runs for this server, keeping only the newest run.
 */
app.post('/:id/audit/cleanup', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not available' }, 500)

	try {
		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, serverId),
			columns: { id: true },
		})
		if (!server) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		const runs = await db.query.discordMemberAuditRuns.findMany({
			where: eq(discordMemberAuditRuns.discordServerId, server.id),
			orderBy: desc(discordMemberAuditRuns.startedAt),
			columns: { id: true },
		})

		if (runs.length <= 1) {
			return c.json({ deletedRuns: 0 })
		}

		const staleRunIds = runs.slice(1).map((run) => run.id)
		await db.delete(discordMemberAuditRuns).where(inArray(discordMemberAuditRuns.id, staleRunIds))

		return c.json({ deletedRuns: staleRunIds.length })
	} catch (error) {
		logger.error('[Discord] Failed to clean up member audit runs', {
			serverId,
			error: String(error),
		})
		return c.json({ error: 'Failed to clean up old reports' }, 500)
	}
})

/**
 * GET /discord-servers/:id/audit
 * Read latest persisted guild member audit snapshot with pagination.
 *
 * Query:
 * - tab: linked | unlinked (default linked)
 * - page: page number (default 1)
 * - pageSize: page size 1..100 (default 50)
 */
app.get('/:id/audit', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const db = c.get('db')
	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	const tab = (c.req.query('tab') ?? 'linked') as DiscordAuditTab
	if (tab !== 'linked' && tab !== 'unlinked') {
		return c.json({ error: 'tab must be linked or unlinked' }, 400)
	}

	const parsedPage = Number.parseInt(c.req.query('page') ?? '1', 10)
	const page = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1
	const parsedPageSize = Number.parseInt(c.req.query('pageSize') ?? '50', 10)
	const pageSize = Number.isFinite(parsedPageSize) ? Math.min(Math.max(parsedPageSize, 1), 100) : 50
	const filter = (c.req.query('filter') ?? 'all') as DiscordAuditFilter
	const allowedFilters: DiscordAuditFilter[] = [
		'all',
		'member_corp',
		'external',
		'roles_without_member_corp',
		'drifted',
		'unmanaged_roles',
		'with_roles',
		'without_roles',
	]
	if (!allowedFilters.includes(filter)) {
		return c.json({ error: 'Invalid filter' }, 400)
	}

	try {
		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, serverId),
			columns: { id: true, guildId: true, guildName: true },
		})
		if (!server) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		const latestRun = await db.query.discordMemberAuditRuns.findFirst({
			where: eq(discordMemberAuditRuns.discordServerId, server.id),
			orderBy: desc(discordMemberAuditRuns.startedAt),
		})

		if (!latestRun) {
			return c.json({
				server: {
					id: server.id,
					guildId: server.guildId,
					guildName: server.guildName,
				},
				tab,
				items: [],
				nextCursor: null,
				scanned: 0,
				runId: null,
				runStatus: 'idle',
				pagination: {
					page,
					pageSize,
					totalCount: 0,
					totalPages: 0,
				},
			})
		}

		const whereClauses = [
			eq(discordMemberAuditRows.runId, latestRun.id),
			eq(discordMemberAuditRows.linked, tab === 'linked'),
		]

		const memberCorporations = await db.query.managedCorporations.findMany({
			where: eq(managedCorporations.isMemberCorporation, true),
			columns: { corporationId: true },
		})
		const memberCorpIdSet = new Set(memberCorporations.map((corp) => corp.corporationId))
		const managedRoles = await db.query.discordRoles.findMany({
			where: and(eq(discordRoles.discordServerId, server.id), eq(discordRoles.isActive, true)),
			columns: { roleId: true },
		})
		const managedRoleIdSet = new Set(managedRoles.map((role) => role.roleId))

		const rows = await db.query.discordMemberAuditRows.findMany({
			where: and(...whereClauses),
			orderBy: asc(discordMemberAuditRows.discordUserId),
		})

		const linkedCoreUserIds = [
			...new Set(rows.map((row) => row.coreUserId).filter((id): id is string => !!id)),
		]
		const hasMemberCorpAttachmentByUserId = new Map<string, boolean>()
		const expectedManagedRoleIdsByUserId = new Map<string, Set<string>>()
		if (linkedCoreUserIds.length > 0) {
			const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
			await Promise.all(
				linkedCoreUserIds.map(async (coreUserId) => {
					try {
						const attachments = await groupsStub.getRolesFor({
							attachedToType: RoleAttachmentType.USER,
							attachedToId: coreUserId,
						})
						const hasMemberCorpAttachment = attachments.some(
							(attachment) =>
								attachment.role.name === ROLE_CORE_CORP_MEMBER &&
								attachment.resourceType === ResourceType.CORPORATION &&
								!!attachment.resourceId &&
								memberCorpIdSet.has(attachment.resourceId)
						)
						hasMemberCorpAttachmentByUserId.set(coreUserId, hasMemberCorpAttachment)
					} catch (error) {
						logger.warn('[Discord] Failed to resolve user role attachments for audit row', {
							coreUserId,
							error: error instanceof Error ? error.message : String(error),
						})
						hasMemberCorpAttachmentByUserId.set(coreUserId, false)
					}
				})
			)

			await Promise.all(
				linkedCoreUserIds.map(async (coreUserId) => {
					try {
						const expectedByGuild = await discordService.getExpectedManagedRoleIdsByGuild(
							c.env,
							coreUserId
						)
						expectedManagedRoleIdsByUserId.set(
							coreUserId,
							expectedByGuild.get(server.guildId) ?? new Set<string>()
						)
					} catch (error) {
						logger.warn('[Discord] Failed to resolve expected managed roles for audit row', {
							coreUserId,
							error: error instanceof Error ? error.message : String(error),
						})
						expectedManagedRoleIdsByUserId.set(coreUserId, new Set<string>())
					}
				})
			)
		}

		const normalizedRows = rows.map((row) => {
			const roleIds = (row.roleIds ?? []).filter((roleId) => !EXCLUDED_AUDIT_ROLE_IDS.has(roleId))
			const expectedManagedRoleIds = row.coreUserId
				? (expectedManagedRoleIdsByUserId.get(row.coreUserId) ?? new Set<string>())
				: new Set<string>()
			const currentManagedRoleIds = roleIds.filter((roleId) => managedRoleIdSet.has(roleId))
			return {
				...row,
				roleIds,
				isInMemberCorporationByAttachments: row.coreUserId
					? (hasMemberCorpAttachmentByUserId.get(row.coreUserId) ?? false)
					: false,
				hasManagedRoleDrift: row.coreUserId
					? currentManagedRoleIds.some((roleId) => !expectedManagedRoleIds.has(roleId))
					: false,
			}
		})
		let filteredRows = normalizedRows
		if (filter === 'member_corp') {
			filteredRows = normalizedRows.filter((row) => row.isInMemberCorporationByAttachments)
		}
		if (filter === 'roles_without_member_corp') {
			filteredRows = normalizedRows.filter(
				(row) =>
					row.roleIds.filter((roleId) => !EXCLUDED_AFFILIATION_MISMATCH_ROLE_IDS.has(roleId))
						.length > 0 && !row.isInMemberCorporationByAttachments
			)
		}
		if (filter === 'external') {
			filteredRows = normalizedRows.filter((row) => !row.isInMemberCorporationByAttachments)
		}
		if (filter === 'drifted') {
			filteredRows = normalizedRows.filter((row) => row.hasManagedRoleDrift)
		}
		if (filter === 'unmanaged_roles') {
			filteredRows = normalizedRows.filter((row) =>
				row.roleIds.some((roleId) => !managedRoleIdSet.has(roleId))
			)
		}
		if (filter === 'with_roles') {
			filteredRows = normalizedRows.filter((row) => row.roleIds.length > 0)
		}
		if (filter === 'without_roles') {
			filteredRows = normalizedRows.filter((row) => row.roleIds.length === 0)
		}
		const totalCount = filteredRows.length
		const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize)
		const safePage = totalPages > 0 ? Math.min(page, totalPages) : 1
		const offset = (safePage - 1) * pageSize
		const visibleRows = filteredRows.slice(offset, offset + pageSize)
		const results: DiscordAuditMemberRow[] = visibleRows.map((row) => {
			const unmanagedRoleCount = row.roleIds.filter(
				(roleId) => !managedRoleIdSet.has(roleId)
			).length
			const relevantAffiliationRoleCount = row.roleIds.filter(
				(roleId) => !EXCLUDED_AFFILIATION_MISMATCH_ROLE_IDS.has(roleId)
			).length
			return {
				isInMemberCorporation: row.isInMemberCorporationByAttachments,
				hasManagedRoleDrift: row.hasManagedRoleDrift ?? false,
				hasRoleAffiliationMismatch:
					relevantAffiliationRoleCount > 0 && !row.isInMemberCorporationByAttachments,
				unmanagedRoleCount,
				discordUserId: row.discordUserId,
				username: row.username,
				discriminator: row.discriminator,
				displayName: row.displayName,
				roleIds: row.roleIds,
				linked: row.linked,
				coreUserId: row.coreUserId,
				mainCharacterId: row.mainCharacterId,
				mainCharacterName: row.mainCharacterName,
				hasValidToken: row.hasValidToken,
				corporationId: row.corporationId,
				corporationName: row.corporationName,
				runId: latestRun.id,
				runStatus: latestRun.status,
				runScanned: latestRun.scanned,
			}
		})

		return c.json({
			server: {
				id: server.id,
				guildId: server.guildId,
				guildName: server.guildName,
			},
			tab,
			items: results,
			nextCursor: null,
			scanned: latestRun.scanned,
			runId: latestRun.id,
			runStatus: latestRun.status,
			runStartedAt: latestRun.startedAt,
			runCompletedAt: latestRun.completedAt,
			linkedCount: latestRun.linkedCount,
			unlinkedCount: latestRun.unlinkedCount,
			runError: latestRun.errorMessage,
			filter,
			pagination: {
				page: safePage,
				pageSize,
				totalCount,
				totalPages,
			},
		})
	} catch (error) {
		logger.error('[Discord] Error running guild audit', { serverId, error: String(error) })
		return c.json({ error: 'Failed to audit Discord guild members' }, 500)
	}
})

/**
 * POST /discord-servers/:id/audit/strip-roles
 * Strip all assignable roles for provided Discord user IDs in this guild.
 */
app.post('/:id/audit/strip-roles', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const db = c.get('db')
	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const discordUserIds = Array.isArray(body?.discordUserIds)
			? body.discordUserIds.map((id: unknown) => String(id).trim()).filter(Boolean)
			: []
		const requestedRunId =
			typeof body?.runId === 'string' && body.runId.trim().length > 0 ? body.runId.trim() : null
		if (discordUserIds.length === 0) {
			return c.json({ error: 'discordUserIds is required' }, 400)
		}

		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, serverId),
			columns: { id: true, guildId: true, guildName: true },
		})
		if (!server) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		const discordStub = getDiscordStub(c.env)
		const results = await discordStub.clearGuildRolesByDiscordUserIds(
			server.guildId,
			discordUserIds
		)
		const strippedIds = results
			.filter((result) => result.success)
			.map((result) => result.discordUserId)
		if (strippedIds.length > 0) {
			const targetRunId =
				requestedRunId ??
				(
					await db.query.discordMemberAuditRuns.findFirst({
						where: eq(discordMemberAuditRuns.discordServerId, server.id),
						orderBy: desc(discordMemberAuditRuns.startedAt),
						columns: { id: true },
					})
				)?.id
			if (targetRunId) {
				await db
					.delete(discordMemberAuditRows)
					.where(
						and(
							eq(discordMemberAuditRows.runId, targetRunId),
							inArray(discordMemberAuditRows.discordUserId, strippedIds)
						)
					)
			}
		}
		return c.json({
			guildId: server.guildId,
			guildName: server.guildName,
			results,
			successCount: results.filter((r) => r.success).length,
			failureCount: results.filter((r) => !r.success).length,
		})
	} catch (error) {
		logger.error('[Discord] Error stripping guild roles in audit tool', {
			serverId,
			error: String(error),
		})
		return c.json({ error: 'Failed to strip roles' }, 500)
	}
})

/**
 * POST /discord-servers/:id/audit/kick-users
 * Remove provided Discord user IDs from this guild.
 */
app.post('/:id/audit/kick-users', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const db = c.get('db')
	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const discordUserIds = Array.isArray(body?.discordUserIds)
			? body.discordUserIds.map((id: unknown) => String(id).trim()).filter(Boolean)
			: []
		const requestedRunId =
			typeof body?.runId === 'string' && body.runId.trim().length > 0 ? body.runId.trim() : null
		if (discordUserIds.length === 0) {
			return c.json({ error: 'discordUserIds is required' }, 400)
		}

		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, serverId),
			columns: { id: true, guildId: true, guildName: true },
		})
		if (!server) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		const discordStub = getDiscordStub(c.env)
		const results = await discordStub.removeGuildMembersByDiscordUserIds(
			server.guildId,
			discordUserIds
		)
		const kickedIds = results
			.filter((result) => result.success)
			.map((result) => result.discordUserId)
		if (kickedIds.length > 0) {
			const targetRunId =
				requestedRunId ??
				(
					await db.query.discordMemberAuditRuns.findFirst({
						where: eq(discordMemberAuditRuns.discordServerId, server.id),
						orderBy: desc(discordMemberAuditRuns.startedAt),
						columns: { id: true },
					})
				)?.id
			if (targetRunId) {
				await db
					.delete(discordMemberAuditRows)
					.where(
						and(
							eq(discordMemberAuditRows.runId, targetRunId),
							inArray(discordMemberAuditRows.discordUserId, kickedIds)
						)
					)
			}
		}

		return c.json({
			guildId: server.guildId,
			guildName: server.guildName,
			results,
			successCount: results.filter((r) => r.success).length,
			failureCount: results.filter((r) => !r.success).length,
		})
	} catch (error) {
		logger.error('[Discord] Error kicking guild members in audit tool', {
			serverId,
			error: String(error),
		})
		return c.json({ error: 'Failed to kick users' }, 500)
	}
})

/**
 * POST /discord-servers/:id/resync-commands
 * Re-registers all commands attached to this server against Discord API and updates stored command IDs.
 */
app.post('/:id/resync-commands', requireAuth(), requireAdmin(), async (c) => {
	const serverId = c.req.param('id')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const server = await db.query.discordServers.findFirst({
			where: eq(discordServers.id, serverId),
		})
		if (!server) {
			return c.json({ error: 'Discord server not found' }, 404)
		}

		const attachments = await db.query.discordServerCommands.findMany({
			where: eq(discordServerCommands.discordServerId, serverId),
			with: {
				command: true,
			},
			orderBy: [desc(discordServerCommands.updatedAt)],
		})

		const results: Array<{
			attachmentId: string
			commandId: string
			commandName: string
			success: boolean
			discordCommandId?: string
			error?: string
		}> = []

		for (const attachment of attachments) {
			try {
				if (!attachment.command.isActive) {
					const deleted = await deleteGuildSlashCommand(c.env, server.guildId, {
						commandId: attachment.discordCommandId ?? undefined,
						commandName: attachment.command.name,
					})
					if (!deleted.success) {
						throw new Error(deleted.error ?? 'Failed to delete inactive command')
					}
					await db
						.update(discordServerCommands)
						.set({ discordCommandId: null, updatedAt: new Date() })
						.where(eq(discordServerCommands.id, attachment.id))
					results.push({
						attachmentId: attachment.id,
						commandId: attachment.commandId,
						commandName: attachment.command.name,
						success: true,
					})
					continue
				}
				const registered = await upsertGuildSlashCommand(
					c.env,
					server.guildId,
					buildDiscordSlashCommandDefinition({
						name: attachment.command.name,
						description: attachment.command.description,
						commandType: attachment.command.commandType,
					})
				)

				await db
					.update(discordServerCommands)
					.set({
						discordCommandId: registered.id,
						updatedAt: new Date(),
					})
					.where(eq(discordServerCommands.id, attachment.id))

				if (
					attachment.discordCommandId &&
					attachment.discordCommandId.length > 0 &&
					attachment.discordCommandId !== registered.id
				) {
					await deleteGuildSlashCommand(c.env, server.guildId, {
						commandId: attachment.discordCommandId,
					})
				}

				results.push({
					attachmentId: attachment.id,
					commandId: attachment.commandId,
					commandName: attachment.command.name,
					success: true,
					discordCommandId: registered.id,
				})
			} catch (error) {
				results.push({
					attachmentId: attachment.id,
					commandId: attachment.commandId,
					commandName: attachment.command.name,
					success: false,
					error: error instanceof Error ? error.message : 'Failed to sync command',
				})
			}
		}

		return c.json({
			success: results.every((result) => result.success),
			total: results.length,
			synced: results.filter((result) => result.success).length,
			failed: results.filter((result) => !result.success).length,
			results,
		})
	} catch (error) {
		logger.error('Error resyncing Discord server commands:', error)
		return c.json({ error: 'Failed to resync Discord commands for server' }, 500)
	}
})

export default app
