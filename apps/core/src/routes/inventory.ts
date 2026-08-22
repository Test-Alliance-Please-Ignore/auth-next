/**
 * Inventory routes.
 *
 * All endpoints require authentication.
 */

import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { requireAllianceMember } from '../middleware/session'

import type { InventoryParseResult } from '@repo/eve-types'
import type { Universe } from '@repo/universe'
import type { App } from '../context'

const app = new Hono<App>()

// Require authentication for all inventory routes
app.use('*', requireAllianceMember())

/**
 * POST /inventory/parse
 * Parse inventory text and return detailed item information
 */
app.post('/parse', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const body = await c.req.json<{ inventoryText: string }>()

		if (!body.inventoryText || typeof body.inventoryText !== 'string') {
			return c.json({ error: 'Missing or invalid inventoryText' }, 400)
		}

		const universe = getStub<Universe>(c.env.UNIVERSE, 'default')
		const result: InventoryParseResult = await universe.parseInventoryText(body.inventoryText)
		return c.json(result)
	} catch (error) {
		logger.error('Error parsing inventory:', error)
		return c.json({ error: 'Failed to parse inventory' }, 500)
	}
})

export default app
