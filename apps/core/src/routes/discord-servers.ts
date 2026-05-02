import { Hono } from 'hono'

import { and, asc, desc, eq, gt, ilike, inArray, isNotNull } from '@repo/db-utils'
import { getDiscordStub } from '@repo/discord'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	corporationDiscordServers,
	discordRoles,
	discordMemberAuditRows,
	discordMemberAuditRuns,
	discordServerCommands,
	discordServers,
	managedCorporations,
	userCharacters,
	users,
} from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/session'
import * as discordService from '../services/discord.service'
import {
	buildDiscordSlashCommandDefinition,
	deleteGuildSlashCommand,
	upsertGuildSlashCommand,
} from '../services/discord-commands.service'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Groups } from '@repo/groups'
import type { App } from '../context'

const app = new Hono<App>()

type DiscordAuditTab = 'linked' | 'unlinked'
type DiscordAuditFilter =
	| 'all'
	| 'member_corp'
	| 'external'
	| 'roles_without_member_corp'
	| 'drifted'

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

		await c.env.DISCORD_MEMBER_AUDIT_WORKFLOW.create({
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
 * GET /discord-servers/:id/audit
 * Read latest persisted guild member audit snapshot with pagination.
 *
 * Query:
 * - tab: linked | unlinked (default linked)
 * - limit: page size 1..100 (default 50)
 * - cursor: optional Discord user ID cursor ("after" pagination)
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

	const parsedLimit = Number.parseInt(c.req.query('limit') ?? '50', 10)
	const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50
	const initialCursor = c.req.query('cursor')?.trim() || null
	const filter = (c.req.query('filter') ?? 'all') as DiscordAuditFilter
	const allowedFilters: DiscordAuditFilter[] = [
		'all',
		'member_corp',
		'external',
		'roles_without_member_corp',
		'drifted',
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
			})
		}

		const whereClauses = [eq(discordMemberAuditRows.runId, latestRun.id), eq(discordMemberAuditRows.linked, tab === 'linked')]
		if (initialCursor) {
			whereClauses.push(gt(discordMemberAuditRows.discordUserId, initialCursor))
		}

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

		if (filter === 'member_corp' && memberCorporations.length > 0) {
			whereClauses.push(inArray(discordMemberAuditRows.corporationId, memberCorporations.map((corp) => corp.corporationId)))
		}
		const rows = await db.query.discordMemberAuditRows.findMany({
			where: and(...whereClauses),
			orderBy: asc(discordMemberAuditRows.discordUserId),
			limit: filter === 'drifted' || filter === 'roles_without_member_corp' ? 5000 : limit + 1,
		})

		let filteredRows = rows
		if (filter === 'roles_without_member_corp') {
			filteredRows = rows.filter(
				(row) => row.roleIds.length > 0 && (!row.corporationId || !memberCorpIdSet.has(row.corporationId))
			)
		}
		if (filter === 'external') {
			filteredRows = rows.filter((row) => !row.corporationId || !memberCorpIdSet.has(row.corporationId))
		}
		if (filter === 'drifted') {
			filteredRows = rows.filter((row) =>
				row.roleIds.some((roleId) => !managedRoleIdSet.has(roleId))
			)
		}
		const hasMore = filteredRows.length > limit
		const visibleRows = hasMore ? filteredRows.slice(0, limit) : filteredRows
		const results: DiscordAuditMemberRow[] = visibleRows.map((row) => {
			const unmanagedRoleCount = row.roleIds.filter((roleId) => !managedRoleIdSet.has(roleId)).length
			return {
				isInMemberCorporation: !!row.corporationId && memberCorpIdSet.has(row.corporationId),
				hasRoleAffiliationMismatch:
					row.roleIds.length > 0 &&
					(!row.corporationId || !memberCorpIdSet.has(row.corporationId)),
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
			nextCursor: hasMore ? visibleRows[visibleRows.length - 1]?.discordUserId ?? null : null,
			scanned: latestRun.scanned,
			runId: latestRun.id,
			runStatus: latestRun.status,
			runStartedAt: latestRun.startedAt,
			runCompletedAt: latestRun.completedAt,
			linkedCount: latestRun.linkedCount,
			unlinkedCount: latestRun.unlinkedCount,
			runError: latestRun.errorMessage,
			filter,
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
