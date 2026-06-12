import { Hono } from 'hono'
import { z } from 'zod'

import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { syncCorporationStructures } from '../services/structures.service'

import type { App } from '../context'

const app = new Hono<App>()

const syncQuerySchema = z.object({
	forceRefresh: z.enum(['true', 'false']).optional(),
})

app.post('/sync/:corporationId', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const corporationId = c.req.param('corporationId')

	try {
		const query = syncQuerySchema.parse({
			forceRefresh: c.req.query('forceRefresh') || undefined,
		})
		const result = await syncCorporationStructures(
			c.env,
			db,
			corporationId,
			query.forceRefresh === 'true'
		)
		return c.json(result)
	} catch (error) {
		logger.error('[Structures] Failed to sync corporation structures', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to sync corporation structures' }, 500)
	}
})

export default app
