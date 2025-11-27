import { Hono } from 'hono'
import { z } from 'zod'

import { createDb } from '../db'
import { recordUserFingerprint } from '../lib/fingerprint-tracking'
import { requireAuth } from '../middleware/session'

import type { App } from '../context'

/**
 * Session routes
 *
 * Handles session-related operations including sync.
 */
const session = new Hono<App>()

const syncSchema = z.object({
	sid: z.string().min(1).max(100),
})

/**
 * POST /session/sync
 *
 * Sync session state (records browser fingerprint for security tracking)
 */
session.post('/sync', requireAuth(), async (c) => {
	const user = c.get('user')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const body = await c.req.json()
	const validation = syncSchema.safeParse(body)

	if (!validation.success) {
		return c.json({ error: 'Invalid request' }, 400)
	}

	const { sid } = validation.data
	const db = createDb(c.env.DATABASE_URL)

	c.executionCtx.waitUntil(
		recordUserFingerprint({
			db,
			userId: user.id,
			fingerprint: sid,
		}).catch((error) => {
			console.error('[Session] Failed to record fingerprint:', error)
		})
	)

	return c.json({ ok: true })
})

export default session
