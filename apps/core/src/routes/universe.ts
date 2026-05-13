import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import type { Universe } from '@repo/universe'

import { requireAuth } from '../middleware/session'

import type { App } from '../context'

const app = new Hono<App>()

app.use('*', requireAuth())

/**
 * GET /universe/search/systems?q={query}
 * Universe-backed solar system search.
 */
app.get('/search/systems', async (c) => {
	try {
		const query = c.req.query('q')
		if (!query || query.length < 2) {
			return c.json({ error: 'Query must be at least 2 characters' }, 400)
		}

		const universeStub = getStub<Universe>(c.env.UNIVERSE, 'default')
		const systems = await universeStub.searchSolarSystems(query, 20)
		const regionIds = [...new Set(systems.map((system) => system.regionId).filter(Boolean))]
		const regionsById = regionIds.length > 0 ? await universeStub.resolveRegionsByIds(regionIds) : {}
		const results = systems.map((system) => ({
			id: system.solarSystemId,
			name: system.solarSystemName,
			systemId: system.solarSystemId,
			systemName: system.solarSystemName,
			regionId: system.regionId,
			regionName: regionsById[system.regionId]?.regionName ?? 'Unknown',
			type: 'system' as const,
		}))

		return c.json(results)
	} catch (error) {
		logger.error('Error in Universe systems search:', error)
		return c.json({ error: 'Failed to search systems' }, 500)
	}
})

export default app
