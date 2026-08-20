import { Hono } from 'hono'

import { and, desc, eq, inArray } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	corporationDiscordServerNicknameConfigs,
	corporationDiscordServerRoles,
	corporationDiscordServers,
	corporationDiscordServerScenarioRoles,
	discordRoles,
	discordServers,
	userCharacters,
} from '../../db/schema'
import { requireAdmin, requireAuth } from '../../middleware/session'

import type { Core } from '@repo/core'
import type { App } from '../../context'

const app = new Hono<App>()

type NicknameTickerSource = 'corp' | 'alliance' | 'custom'
type ScenarioRoleBucket = 'alliance_guest' | 'non_alliance_guest'
type NicknameBucket = 'corp_member' | 'alliance_guest' | 'non_alliance_guest'

const NICKNAME_SOURCE_VALUES: NicknameTickerSource[] = ['corp', 'alliance', 'custom']

const scenarioRoleBucketFields = [
	{
		bucket: 'alliance_guest' as const,
		roleField: 'allianceGuestRoleId',
		autoApplyField: 'allianceGuestAutoApply',
	},
	{
		bucket: 'non_alliance_guest' as const,
		roleField: 'nonAllianceGuestRoleId',
		autoApplyField: 'nonAllianceGuestAutoApply',
	},
] as const

const nicknameBucketFields = [
	{
		bucket: 'corp_member' as const,
		enabledField: 'corpMemberNicknameEnabled',
		sourceField: 'corpMemberNicknameSource',
		customField: 'corpMemberNicknameCustomTicker',
	},
	{
		bucket: 'alliance_guest' as const,
		enabledField: 'allianceGuestNicknameEnabled',
		sourceField: 'allianceGuestNicknameSource',
		customField: 'allianceGuestNicknameCustomTicker',
	},
	{
		bucket: 'non_alliance_guest' as const,
		enabledField: 'nonAllianceGuestNicknameEnabled',
		sourceField: 'nonAllianceGuestNicknameSource',
		customField: 'nonAllianceGuestNicknameCustomTicker',
	},
] as const

function normalizeTickerInput(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null
	}

	const normalized = value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, 5)
	return normalized || null
}

function parseNicknameSource(value: unknown): NicknameTickerSource | null {
	if (typeof value !== 'string') {
		return null
	}

	return NICKNAME_SOURCE_VALUES.includes(value as NicknameTickerSource)
		? (value as NicknameTickerSource)
		: null
}

function getBucketFieldValue(body: Record<string, unknown>, field: string): unknown {
	return Object.prototype.hasOwnProperty.call(body, field) ? body[field] : undefined
}

function buildScenarioRoleUpdateValues(
	body: Record<string, unknown>,
	existing?: Record<string, unknown>
): Record<string, unknown> {
	const values: Record<string, unknown> = {}

	for (const bucket of scenarioRoleBucketFields) {
		const roleValue = getBucketFieldValue(body, bucket.roleField)
		if (roleValue !== undefined) {
			values[bucket.roleField] = roleValue === null ? null : (roleValue as string)
		} else if (existing) {
			values[bucket.roleField] = (existing[bucket.roleField] as string | null | undefined) ?? null
		} else {
			values[bucket.roleField] = null
		}

		const autoApplyValue = getBucketFieldValue(body, bucket.autoApplyField)
		if (autoApplyValue !== undefined) {
			values[bucket.autoApplyField] = Boolean(autoApplyValue)
		} else if (existing) {
			values[bucket.autoApplyField] = Boolean(existing[bucket.autoApplyField])
		} else {
			values[bucket.autoApplyField] = false
		}
	}

	return values
}

function buildNicknameUpdateValues(
	body: Record<string, unknown>,
	existing?: Record<string, unknown>
): Record<string, unknown> {
	const values: Record<string, unknown> = {}

	for (const bucket of nicknameBucketFields) {
		const enabledValue = getBucketFieldValue(body, bucket.enabledField)
		if (enabledValue !== undefined) {
			values[bucket.enabledField] = Boolean(enabledValue)
		} else if (existing) {
			values[bucket.enabledField] = Boolean(existing[bucket.enabledField])
		} else {
			values[bucket.enabledField] = false
		}

		const sourceValue = getBucketFieldValue(body, bucket.sourceField)
		if (sourceValue !== undefined) {
			const source = parseNicknameSource(sourceValue)
			if (!source) {
				throw new Error(`Invalid ${bucket.bucket} nickname source`)
			}
			values[bucket.sourceField] = source
		} else if (existing) {
			values[bucket.sourceField] =
				(existing[bucket.sourceField] as NicknameTickerSource | undefined) ?? 'corp'
		} else {
			values[bucket.sourceField] = 'corp'
		}

		const customTickerValue = getBucketFieldValue(body, bucket.customField)
		if (customTickerValue !== undefined) {
			values[bucket.customField] = normalizeTickerInput(customTickerValue)
		} else if (existing) {
			values[bucket.customField] =
				(existing[bucket.customField] as string | null | undefined) ?? null
		} else {
			values[bucket.customField] = null
		}
	}

	return values
}

function flattenCorporationDiscordAttachment(attachment: any) {
	const scenarioRolesByBucket = new Map<ScenarioRoleBucket, any>(
		(attachment.scenarioRoles ?? []).map((row: any) => [row.bucket as ScenarioRoleBucket, row])
	)
	const nicknameConfigsByBucket = new Map<NicknameBucket, any>(
		(attachment.nicknameConfigs ?? []).map((row: any) => [row.bucket as NicknameBucket, row])
	)

	return {
		...attachment,
		allianceGuestRoleId: scenarioRolesByBucket.get('alliance_guest')?.discordRoleId ?? null,
		allianceGuestAutoApply: scenarioRolesByBucket.get('alliance_guest')?.autoApply ?? false,
		nonAllianceGuestRoleId: scenarioRolesByBucket.get('non_alliance_guest')?.discordRoleId ?? null,
		nonAllianceGuestAutoApply: scenarioRolesByBucket.get('non_alliance_guest')?.autoApply ?? false,
		corpMemberNicknameEnabled: nicknameConfigsByBucket.get('corp_member')?.enabled ?? false,
		corpMemberNicknameSource: nicknameConfigsByBucket.get('corp_member')?.source ?? 'corp',
		corpMemberNicknameCustomTicker:
			nicknameConfigsByBucket.get('corp_member')?.customTicker ?? null,
		allianceGuestNicknameEnabled: nicknameConfigsByBucket.get('alliance_guest')?.enabled ?? false,
		allianceGuestNicknameSource: nicknameConfigsByBucket.get('alliance_guest')?.source ?? 'corp',
		allianceGuestNicknameCustomTicker:
			nicknameConfigsByBucket.get('alliance_guest')?.customTicker ?? null,
		nonAllianceGuestNicknameEnabled:
			nicknameConfigsByBucket.get('non_alliance_guest')?.enabled ?? false,
		nonAllianceGuestNicknameSource:
			nicknameConfigsByBucket.get('non_alliance_guest')?.source ?? 'corp',
		nonAllianceGuestNicknameCustomTicker:
			nicknameConfigsByBucket.get('non_alliance_guest')?.customTicker ?? null,
	}
}

async function fetchCorporationDiscordAttachments(db: any, corporationId: string) {
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
			scenarioRoles: true,
			nicknameConfigs: true,
		},
		orderBy: desc(corporationDiscordServers.createdAt),
	})

	return attachments.map(flattenCorporationDiscordAttachment)
}

async function fetchCorporationDiscordAttachment(
	db: any,
	corporationId: string,
	attachmentId: string
) {
	const attachment = await db.query.corporationDiscordServers.findFirst({
		where: and(
			eq(corporationDiscordServers.id, attachmentId),
			eq(corporationDiscordServers.corporationId, corporationId)
		),
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
			scenarioRoles: true,
			nicknameConfigs: true,
		},
	})

	return attachment ? flattenCorporationDiscordAttachment(attachment) : null
}

async function validateScenarioRoleSelections(
	db: any,
	discordServerId: string,
	roleIds: Array<string | null | undefined>
): Promise<void> {
	const uniqueRoleIds = Array.from(new Set(roleIds.filter((roleId): roleId is string => !!roleId)))
	if (uniqueRoleIds.length === 0) {
		return
	}

	const roles = await db.query.discordRoles.findMany({
		where: inArray(discordRoles.id, uniqueRoleIds),
		columns: { id: true, discordServerId: true },
	})

	for (const roleId of uniqueRoleIds) {
		const role = roles.find(
			(candidate: { id: string; discordServerId: string }) => candidate.id === roleId
		)
		if (!role) {
			throw new Error(`Role ${roleId} not found`)
		}
		if (role.discordServerId !== discordServerId) {
			throw new Error(`Role ${roleId} does not belong to this Discord server`)
		}
	}
}

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
		const attachments = await fetchCorporationDiscordAttachments(db, corporationId)
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
		const body = (await c.req.json()) as Record<string, unknown>
		const discordServerId = body.discordServerId as string | undefined
		const autoInvite = body.autoInvite as boolean | undefined
		const autoAssignRoles = body.autoAssignRoles as boolean | undefined
		const scenarioRoleIds = [
			body.allianceGuestRoleId as string | null | undefined,
			body.nonAllianceGuestRoleId as string | null | undefined,
		]

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

		await validateScenarioRoleSelections(db, server.id, scenarioRoleIds)
		const scenarioValues = buildScenarioRoleUpdateValues(body)
		const nicknameValues = buildNicknameUpdateValues(body)

		const [attachment] = await db
			.insert(corporationDiscordServers)
			.values({
				corporationId,
				discordServerId,
				autoInvite: autoInvite ?? false,
				autoAssignRoles: autoAssignRoles ?? false,
			})
			.returning()

		await db.insert(corporationDiscordServerScenarioRoles).values([
			{
				corporationDiscordServerId: attachment.id,
				bucket: 'alliance_guest',
				discordRoleId: (scenarioValues.allianceGuestRoleId as string | null | undefined) ?? null,
				autoApply: (scenarioValues.allianceGuestAutoApply as boolean | undefined) ?? false,
			},
			{
				corporationDiscordServerId: attachment.id,
				bucket: 'non_alliance_guest',
				discordRoleId: (scenarioValues.nonAllianceGuestRoleId as string | null | undefined) ?? null,
				autoApply: (scenarioValues.nonAllianceGuestAutoApply as boolean | undefined) ?? false,
			},
		])

		await db.insert(corporationDiscordServerNicknameConfigs).values(
			nicknameBucketFields.map((bucket) => ({
				corporationDiscordServerId: attachment.id,
				bucket: bucket.bucket,
				enabled: (nicknameValues[bucket.enabledField] as boolean | undefined) ?? false,
				source: (nicknameValues[bucket.sourceField] as NicknameTickerSource | undefined) ?? 'corp',
				customTicker: (nicknameValues[bucket.customField] as string | null | undefined) ?? null,
			}))
		)

		const hydratedAttachment = await fetchCorporationDiscordAttachment(
			db,
			corporationId,
			attachment.id
		)
		logger.info(`Discord server ${server.guildName} attached to corporation ${corporationId}`)

		return c.json(hydratedAttachment ?? attachment, 201)
	} catch (error) {
		logger.error('Error attaching Discord server to corporation:', error)
		const message = error instanceof Error ? error.message : ''
		if (
			message.startsWith('Role ') ||
			message.startsWith('Invalid ') ||
			message.startsWith('Custom ticker is required')
		) {
			return c.json({ error: message }, 400)
		}
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
			const attachment = await fetchCorporationDiscordAttachment(db, corporationId, attachmentId)

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
			const body = (await c.req.json()) as Record<string, unknown>
			const autoInvite = body.autoInvite as boolean | undefined
			const autoAssignRoles = body.autoAssignRoles as boolean | undefined
			const scenarioRoleIds = [
				body.allianceGuestRoleId as string | null | undefined,
				body.nonAllianceGuestRoleId as string | null | undefined,
			]

			const existing = await fetchCorporationDiscordAttachment(db, corporationId, attachmentId)

			if (!existing) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			await validateScenarioRoleSelections(db, existing.discordServer.id, scenarioRoleIds)

			const [updated] = await db
				.update(corporationDiscordServers)
				.set({
					...(autoInvite !== undefined && { autoInvite }),
					...(autoAssignRoles !== undefined && { autoAssignRoles }),
					updatedAt: new Date(),
				})
				.where(eq(corporationDiscordServers.id, attachmentId))
				.returning()

			const scenarioValues = buildScenarioRoleUpdateValues(
				body,
				existing as Record<string, unknown>
			)
			await db
				.delete(corporationDiscordServerScenarioRoles)
				.where(eq(corporationDiscordServerScenarioRoles.corporationDiscordServerId, attachmentId))
			await db.insert(corporationDiscordServerScenarioRoles).values(
				scenarioRoleBucketFields.map((bucket) => ({
					corporationDiscordServerId: attachmentId,
					bucket: bucket.bucket,
					discordRoleId: (scenarioValues[bucket.roleField] as string | null | undefined) ?? null,
					autoApply: (scenarioValues[bucket.autoApplyField] as boolean | undefined) ?? false,
				}))
			)

			const hydratedAttachment = await fetchCorporationDiscordAttachment(
				db,
				corporationId,
				attachmentId
			)
			return c.json(hydratedAttachment ?? updated)
		} catch (error) {
			logger.error('Error updating Discord server attachment:', error)
			const message = error instanceof Error ? error.message : ''
			if (message.startsWith('Role ')) {
				return c.json({ error: message }, 400)
			}
			return c.json({ error: 'Failed to update Discord server attachment' }, 500)
		}
	}
)

/**
 * PUT /corporations/:corporationId/discord-servers/:attachmentId/nickname-config
 * Update nickname ticker settings for a corporation Discord server attachment
 */
app.put(
	'/:corporationId/discord-servers/:attachmentId/nickname-config',
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
			const body = (await c.req.json()) as Record<string, unknown>
			const existing = await fetchCorporationDiscordAttachment(db, corporationId, attachmentId)

			if (!existing) {
				return c.json({ error: 'Discord server attachment not found' }, 404)
			}

			const nicknameValues = buildNicknameUpdateValues(body, existing as Record<string, unknown>)

			const [updated] = await db
				.update(corporationDiscordServers)
				.set({
					updatedAt: new Date(),
				})
				.where(eq(corporationDiscordServers.id, attachmentId))
				.returning()

			await db
				.delete(corporationDiscordServerNicknameConfigs)
				.where(eq(corporationDiscordServerNicknameConfigs.corporationDiscordServerId, attachmentId))
			await db.insert(corporationDiscordServerNicknameConfigs).values(
				nicknameBucketFields.map((bucket) => ({
					corporationDiscordServerId: attachmentId,
					bucket: bucket.bucket,
					enabled: (nicknameValues[bucket.enabledField] as boolean | undefined) ?? false,
					source:
						(nicknameValues[bucket.sourceField] as NicknameTickerSource | undefined) ?? 'corp',
					customTicker: (nicknameValues[bucket.customField] as string | null | undefined) ?? null,
				}))
			)

			const hydratedAttachment = await fetchCorporationDiscordAttachment(
				db,
				corporationId,
				attachmentId
			)
			return c.json(hydratedAttachment ?? updated)
		} catch (error) {
			logger.error('Error updating Discord server nickname config:', error)
			const message = error instanceof Error ? error.message : ''
			if (message.startsWith('Invalid ') || message.startsWith('Custom ticker is required')) {
				return c.json({ error: message }, 400)
			}
			return c.json({ error: 'Failed to update Discord server nickname config' }, 500)
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
					allowRemoval: true,
					hardStripAllRoles: remainingAttachments.length === 0,
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
