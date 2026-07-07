/**
 * Prediction Markets — member API (non-admin).
 *
 * Mounted OUTSIDE /api/admin/* (so it is NOT is_admin-gated). Creation is gated on the
 * `urn:markets:creator` tier via hasMarketPermission — the permissions path (getUserPermissions),
 * NOT is_admin and NOT the requireAuth role system. `manager` and site admins also pass. The
 * create flow itself is shared verbatim with the admin route (market-create.service), so both
 * stay in lockstep. Client-side gating is cosmetic; this server check is the real gate.
 */

import { Hono } from 'hono'

import { logger } from '@repo/hono-helpers'

import { hasMarketPermission } from '../lib/market-permissions'
import { requireAuth } from '../middleware/session'
import {
	createAndPublishMarket,
	createMarketSchema,
	mapMarketCreateError,
} from '../services/market-create.service'

import type { App } from '../context'

const app = new Hono<App>()

// A valid session is required for every member endpoint (the per-tier gate is per-route below).
app.use('*', requireAuth())

// POST /markets — a member with urn:markets:creator (or manager/admin) creates a market. `createdBy`
// comes from the session, never the client. The creator can neither bet on nor resolve it (enforced
// in the PM DO: CREATOR_CANNOT_BET / CREATOR_CANNOT_RESOLVE), so open creation is self-dealing-safe.
app.post('/markets', async (c) => {
	const db = c.get('db')
	if (!db) return c.json({ error: 'Database not initialized' }, 500)
	const user = c.get('user')!
	if (!(await hasMarketPermission(c.env, user.id, 'creator', user.is_admin))) {
		return c.json({ error: 'You don’t have permission to create markets' }, 403)
	}
	try {
		const body = createMarketSchema.parse(await c.req.json())
		// Rate-limit non-admin member creation so a creator can't flood the forum; site admins
		// using this route are uncapped (they're fully trusted and could use the admin route anyway).
		const result = await createAndPublishMarket(db, c.env, user.id, body, {
			enforceRateLimit: !user.is_admin,
		})
		logger.info('[PMMember] market created', {
			actorId: user.id,
			marketId: result.market.id,
			posted: Boolean(result.post),
		})
		return c.json(result, 201)
	} catch (error) {
		return mapMarketCreateError(c, error)
	}
})

export default app
