import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { requireAuth } from '../middleware/session'
import { EntityResolverService } from '../services/entity-resolver.service'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { App } from '../context'

const app = new Hono<App>()

/**
 * POST /entities/names
 * Resolve EVE entity IDs to display names for authenticated UI consumers.
 */
app.post('/names', requireAuth(), async (c) => {
	try {
		const body: { ids?: unknown } | null = await c.req.json().catch(() => null)
		const ids =
			body && Array.isArray(body.ids)
				? [
						...new Set(
							body.ids
								.filter((value: unknown): value is string => typeof value === 'string')
								.map((value: string) => value.trim())
								.filter((value: string) => value.length > 0)
						),
					]
				: []

		if (ids.length === 0) {
			return c.json({})
		}

		if (ids.length > 200) {
			return c.json({ error: 'Too many ids; maximum 200 per request' }, 400)
		}

		const eveTokenStore = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
		const resolver = new EntityResolverService(eveTokenStore)
		const resolvedNames = await resolver.resolveEntityNames(ids)
		return c.json(Object.fromEntries(resolvedNames.entries()))
	} catch (error) {
		logger.error('Error resolving entity names:', error)
		return c.json({ error: 'Failed to resolve entity names' }, 500)
	}
})

export default app
