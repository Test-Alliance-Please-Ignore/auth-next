import { Hono } from 'hono'
import { TimeCache } from '@repo/hono-helpers'
import { getStub } from '@repo/do-utils'

import { requireAuth } from '../middleware/session'

import type { App } from '../context'
import type { Broadcasts } from '@repo/broadcasts'
import type { Groups } from '@repo/groups'

/**
 * Permission check cache - 15 second TTL
 */
const permissionCache = new TimeCache<boolean>(15000)

/**
 * Helper function to check if a user has a specific permission
 * Results are cached for 15 seconds to reduce load on Groups DO
 */
async function hasPermission(
	groupsStub: Groups,
	userId: string,
	permissionUrn: string,
	isAdmin: boolean
): Promise<boolean> {
	// Admins bypass permission checks
	if (isAdmin) return true

	// Check cache or fetch user permissions
	const cacheKey = `${userId}:${permissionUrn}`
	return permissionCache.getOrSet(cacheKey, async () => {
		const permissions = await groupsStub.getUserPermissions(userId)
		return permissions.some((p) => p.urn === permissionUrn)
	})
}

/**
 * Broadcasts routes
 *
 * Provides API endpoints for managing broadcast targets, templates, and broadcasts.
 * All requests are authenticated and permission-checked before being forwarded to the Broadcasts DO.
 */
const broadcasts = new Hono<App>()

// Apply authentication middleware to all routes
broadcasts.use('*', requireAuth())

// =============================================================================
// BROADCAST TARGETS
// =============================================================================

/**
 * List all broadcast targets (optionally filtered by group)
 * GET /api/broadcasts/targets?groupId=xxx
 */
broadcasts.get('/targets', async (c) => {
	const user = c.get('user')!
	const groupId = c.req.query('groupId')

	// Get Broadcasts DO stub
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')

	const targets = await broadcastsStub.listTargets(user.id, groupId)
	return c.json(targets)
})

/**
 * Get a single broadcast target by ID
 * GET /api/broadcasts/targets/:id
 */
broadcasts.get('/targets/:id', async (c) => {
	const user = c.get('user')!
	const targetId = c.req.param('id')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcastsStub.getTarget(targetId, user.id)

	if (!target) {
		return c.json({ error: 'Target not found' }, 404)
	}

	return c.json(target)
})

/**
 * Create a new broadcast target
 * POST /api/broadcasts/targets
 */
broadcasts.post('/targets', async (c) => {
	const user = c.get('user')!
	const data = await c.req.json()

	// Check permissions - user must be admin or have broadcast permission in the group
	const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
	const allowed = await hasPermission(
		groupsStub,
		user.id,
		`urn:group:${data.groupId}:broadcasts:manage`,
		user.is_admin
	)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcastsStub.createTarget(data, user.id)

	return c.json(target, 201)
})

/**
 * Update a broadcast target
 * PATCH /api/broadcasts/targets/:id
 */
broadcasts.patch('/targets/:id', async (c) => {
	const user = c.get('user')!
	const targetId = c.req.param('id')
	const data = await c.req.json()

	// Get target to check group ownership
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcastsStub.getTarget(targetId, user.id)

	if (!target) {
		return c.json({ error: 'Target not found' }, 404)
	}

	// Check permissions
	const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
	const allowed = await hasPermission(
		groupsStub,
		user.id,
		`urn:group:${target.groupId}:broadcasts:manage`,
		user.is_admin
	)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	const updated = await broadcastsStub.updateTarget(targetId, data, user.id)
	return c.json(updated)
})

/**
 * Delete a broadcast target
 * DELETE /api/broadcasts/targets/:id
 */
broadcasts.delete('/targets/:id', async (c) => {
	const user = c.get('user')!
	const targetId = c.req.param('id')

	// Get target to check group ownership
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcastsStub.getTarget(targetId, user.id)

	if (!target) {
		return c.json({ error: 'Target not found' }, 404)
	}

	// Check permissions
	const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
	const allowed = await hasPermission(
		groupsStub,
		user.id,
		`urn:group:${target.groupId}:broadcasts:manage`,
		user.is_admin
	)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	await broadcastsStub.deleteTarget(targetId, user.id)
	return c.json({ success: true })
})

// =============================================================================
// BROADCAST TEMPLATES
// =============================================================================

/**
 * List broadcast templates (optionally filtered by targetType and/or groupId)
 * GET /api/broadcasts/templates?targetType=xxx&groupId=xxx
 */
broadcasts.get('/templates', async (c) => {
	const user = c.get('user')!
	const targetType = c.req.query('targetType')
	const groupId = c.req.query('groupId')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const templates = await broadcastsStub.listTemplates(user.id, { targetType, groupId })

	return c.json(templates)
})

/**
 * Get a single template by ID
 * GET /api/broadcasts/templates/:id
 */
broadcasts.get('/templates/:id', async (c) => {
	const user = c.get('user')!
	const templateId = c.req.param('id')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const template = await broadcastsStub.getTemplate(templateId, user.id)

	if (!template) {
		return c.json({ error: 'Template not found' }, 404)
	}

	return c.json(template)
})

/**
 * Create a new broadcast template
 * POST /api/broadcasts/templates
 */
broadcasts.post('/templates', async (c) => {
	const user = c.get('user')!
	const data = await c.req.json()

	// Check permissions
	const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
	const allowed = await hasPermission(
		groupsStub,
		user.id,
		`urn:group:${data.groupId}:broadcasts:manage`,
		user.is_admin
	)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const template = await broadcastsStub.createTemplate(data, user.id)

	return c.json(template, 201)
})

/**
 * Update a broadcast template
 * PATCH /api/broadcasts/templates/:id
 */
broadcasts.patch('/templates/:id', async (c) => {
	const user = c.get('user')!
	const templateId = c.req.param('id')
	const data = await c.req.json()

	// Get template to check group ownership
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const template = await broadcastsStub.getTemplate(templateId, user.id)

	if (!template) {
		return c.json({ error: 'Template not found' }, 404)
	}

	// Check permissions
	const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
	const allowed = await hasPermission(
		groupsStub,
		user.id,
		`urn:group:${template.groupId}:broadcasts:manage`,
		user.is_admin
	)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	const updated = await broadcastsStub.updateTemplate(templateId, data, user.id)
	return c.json(updated)
})

/**
 * Delete a broadcast template
 * DELETE /api/broadcasts/templates/:id
 */
broadcasts.delete('/templates/:id', async (c) => {
	const user = c.get('user')!
	const templateId = c.req.param('id')

	// Get template to check group ownership
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const template = await broadcastsStub.getTemplate(templateId, user.id)

	if (!template) {
		return c.json({ error: 'Template not found' }, 404)
	}

	// Check permissions
	const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
	const allowed = await hasPermission(
		groupsStub,
		user.id,
		`urn:group:${template.groupId}:broadcasts:manage`,
		user.is_admin
	)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	await broadcastsStub.deleteTemplate(templateId, user.id)
	return c.json({ success: true })
})

// =============================================================================
// BROADCASTS
// =============================================================================

/**
 * List broadcasts (optionally filtered by groupId and/or status)
 * GET /api/broadcasts?groupId=xxx&status=xxx
 */
broadcasts.get('/', async (c) => {
	const user = c.get('user')!
	const groupId = c.req.query('groupId')
	const status = c.req.query('status') as any

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcastList = await broadcastsStub.listBroadcasts(user.id, { groupId, status })

	return c.json(broadcastList)
})

/**
 * Get a single broadcast with full details
 * GET /api/broadcasts/:id
 */
broadcasts.get('/:id', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcast = await broadcastsStub.getBroadcast(broadcastId, user.id)

	if (!broadcast) {
		return c.json({ error: 'Broadcast not found' }, 404)
	}

	return c.json(broadcast)
})

/**
 * Create a new broadcast
 * POST /api/broadcasts
 */
broadcasts.post('/', async (c) => {
	const user = c.get('user')!
	const data = await c.req.json()

	// Check permissions
	const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
	const allowed = await hasPermission(
		groupsStub,
		user.id,
		`urn:group:${data.groupId}:broadcasts:send`,
		user.is_admin
	)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	// Get main character name
	const mainCharacter = user.characters.find((c) => c.is_primary)
	const createdByCharacterName = mainCharacter?.characterName || 'Unknown'

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcast = await broadcastsStub.createBroadcast(
		{ ...data, createdByCharacterName },
		user.id
	)

	return c.json(broadcast, 201)
})

/**
 * Send a broadcast immediately
 * POST /api/broadcasts/:id/send
 */
broadcasts.post('/:id/send', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')

	// Get broadcast to check group ownership
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcast = await broadcastsStub.getBroadcast(broadcastId, user.id)

	if (!broadcast) {
		return c.json({ error: 'Broadcast not found' }, 404)
	}

	// Check permissions
	const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
	const allowed = await hasPermission(
		groupsStub,
		user.id,
		`urn:group:${broadcast.groupId}:broadcasts:send`,
		user.is_admin
	)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	// Send broadcast
	const result = await broadcastsStub.sendBroadcast(broadcastId, user.id)

	return c.json(result)
})

/**
 * Delete a broadcast
 * DELETE /api/broadcasts/:id
 */
broadcasts.delete('/:id', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')

	// Get broadcast to check group ownership
	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const broadcast = await broadcastsStub.getBroadcast(broadcastId, user.id)

	if (!broadcast) {
		return c.json({ error: 'Broadcast not found' }, 404)
	}

	// Check permissions
	const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
	const allowed = await hasPermission(
		groupsStub,
		user.id,
		`urn:group:${broadcast.groupId}:broadcasts:manage`,
		user.is_admin
	)

	if (!allowed) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	await broadcastsStub.deleteBroadcast(broadcastId, user.id)
	return c.json({ success: true })
})

/**
 * Get deliveries for a broadcast
 * GET /api/broadcasts/:id/deliveries
 */
broadcasts.get('/:id/deliveries', async (c) => {
	const user = c.get('user')!
	const broadcastId = c.req.param('id')

	const broadcastsStub = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const deliveries = await broadcastsStub.getDeliveries(broadcastId, user.id)

	return c.json(deliveries)
})

export default broadcasts
