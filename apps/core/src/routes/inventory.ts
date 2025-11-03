/**
 * Inventory routes - Proxy to eve-static-data worker for inventory parsing
 *
 * All endpoints require authentication.
 * These endpoints proxy to the eve-static-data worker's REST API.
 */

import { Hono } from 'hono'

import { logger } from '@repo/hono-helpers'

import { requireAuth } from '../middleware/session'

import type { InventoryParseResult } from '@repo/eve-types'
import type { App } from '../context'

const app = new Hono<App>()

// Require authentication for all inventory routes
app.use('*', requireAuth())

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

		// Call the eve-static-data worker via service binding
		const response = await c.env.EVE_STATIC_DATA.fetch('http://internal/inventory/parse', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ inventoryText: body.inventoryText }),
		})

		if (!response.ok) {
			const errorText = await response.text()
			logger.error('Eve-static-data parse failed:', { status: response.status, error: errorText })
			return c.json({ error: 'Failed to parse inventory' }, 500)
		}

		const result: InventoryParseResult = await response.json()
		return c.json(result)
	} catch (error) {
		logger.error('Error parsing inventory:', error)
		return c.json({ error: 'Failed to parse inventory' }, 500)
	}
})

export default app
