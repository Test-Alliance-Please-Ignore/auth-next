import { Hono } from 'hono'

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../../db'
import { userCharacters } from '../../db/schema'
import { clearUserCache } from '../../lib/groups-cache'
import { requireAdmin, requireAuth } from '../../middleware/session'

import type { Groups } from '@repo/groups'
import type { App } from '../../context'

const app = new Hono<App>()

/**
 * GET /corporations/:corporationId/permissions
 * List all permissions attached to a corporation
 */
app.get('/:corporationId/permissions', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')

	try {
		const stub = getStub<Groups>(c.env.GROUPS, 'default')
		const permissions = await stub.listCorporationPermissions(corporationId)

		return c.json({ permissions })
	} catch (error) {
		logger.error('Error listing corporation permissions:', error)
		return c.json({ error: 'Failed to list corporation permissions' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/permissions
 * Attach a permission to a corporation (admin only)
 */
app.post('/:corporationId/permissions', requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const user = c.get('user')!

	try {
		const body = await c.req.json<{ permissionId: string }>()

		if (!body.permissionId) {
			return c.json({ error: 'permissionId is required' }, 400)
		}

		const stub = getStub<Groups>(c.env.GROUPS, 'default')
		const permission = await stub.attachPermissionToCorporation(
			{
				corporationId,
				permissionId: body.permissionId,
			},
			user.id
		)
		const db = createDb(c.env.DATABASE_URL)
		const linkedUsers = await db.query.userCharacters.findMany({
			where: eq(userCharacters.corporationId, corporationId),
			columns: { userId: true },
		})
		for (const linkedUser of linkedUsers) {
			await clearUserCache(linkedUser.userId, c.env.BILLING_SCOPE_CACHE)
		}

		logger.info(`Permission ${body.permissionId} attached to corporation ${corporationId}`)
		return c.json({ permission })
	} catch (error) {
		logger.error('Error attaching permission to corporation:', error)
		if (error instanceof Error) {
			if (error.message.includes('not found')) {
				return c.json({ error: error.message }, 404)
			}
			if (error.message.includes('already attached')) {
				return c.json({ error: error.message }, 409)
			}
		}
		return c.json({ error: 'Failed to attach permission' }, 500)
	}
})

/**
 * DELETE /corporations/:corporationId/permissions/:permissionId
 * Remove a permission from a corporation (admin only)
 */
app.delete('/:corporationId/permissions/:permissionId', requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const permissionId = c.req.param('permissionId')
	const user = c.get('user')!

	try {
		const stub = getStub<Groups>(c.env.GROUPS, 'default')
		await stub.removePermissionFromCorporation(permissionId, user.id)
		const db = createDb(c.env.DATABASE_URL)
		const linkedUsers = await db.query.userCharacters.findMany({
			where: eq(userCharacters.corporationId, corporationId),
			columns: { userId: true },
		})
		for (const linkedUser of linkedUsers) {
			await clearUserCache(linkedUser.userId, c.env.BILLING_SCOPE_CACHE)
		}

		logger.info(`Permission ${permissionId} removed from corporation ${corporationId}`)
		return c.json({ success: true })
	} catch (error) {
		logger.error('Error removing permission from corporation:', error)
		if (error instanceof Error && error.message.includes('not found')) {
			return c.json({ error: error.message }, 404)
		}
		return c.json({ error: 'Failed to remove permission' }, 500)
	}
})

export default app
