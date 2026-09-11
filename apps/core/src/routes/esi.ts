/**
 * ESI routes - Proxy for EVE Online ESI API
 *
 * These endpoints provide a backend proxy to ESI for location searches and lookups.
 * Includes caching to reduce load on ESI and improve performance.
 */

import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { requireAuth } from '../middleware/session'
import { EsiService } from '../services/esi.service'

import type { Universe } from '@repo/universe'
import type { App } from '../context'

const app = new Hono<App>()

// Require authentication for all ESI routes
app.use('*', requireAuth())

/**
 * GET /esi/search/stations?q={query}
 * Search for NPC stations by name
 */
app.get('/search/stations', async (c) => {
	try {
		const query = c.req.query('q')
		logger.info('ESI route /search/stations called', { query, hasUser: !!c.get('user') })

		if (!query || query.length < 2) {
			logger.info('ESI route /search/stations: query too short', { query })
			return c.json({ error: 'Query must be at least 2 characters' }, 400)
		}

		const esiService = new EsiService(c.env)
		logger.info('ESI route /search/stations: calling esiService.searchStations')
		const results = await esiService.searchStations(query)
		logger.info('ESI route /search/stations: returning results', { resultCount: results.length })
		return c.json(results)
	} catch (error) {
		logger.error('Error in ESI stations search:', error)
		return c.json({ error: 'Failed to search stations' }, 500)
	}
})

/**
 * GET /esi/search/structures?q={query}
 * Search for player structures by name (requires authentication)
 */
app.get('/search/structures', async (c) => {
	try {
		const query = c.req.query('q')

		if (!query || query.length < 2) {
			return c.json({ error: 'Query must be at least 2 characters' }, 400)
		}

		const esiService = new EsiService(c.env)
		const results = await esiService.searchStructures(query)
		return c.json(results)
	} catch (error) {
		logger.error('Error in ESI structures search:', error)
		return c.json({ error: 'Failed to search structures' }, 500)
	}
})

app.get('/search/organizations', async (c) => {
	try {
		const query = c.req.query('q')
		if (!query || query.length < 2)
			return c.json({ error: 'Query must be at least 2 characters' }, 400)
		const user = c.get('user')
		if (!user?.mainCharacterId) return c.json({ error: 'Authenticated character is required' }, 403)
		const strict = c.req.query('strict') === 'true'
		const universe = getStub<Universe>(c.env.UNIVERSE, 'default')
		return c.json(await universe.searchCorporations(query, 50, user.mainCharacterId, strict))
	} catch (error) {
		logger.error('Error in ESI organization search:', error)
		return c.json({ error: 'Failed to search organizations' }, 500)
	}
})

/**
 * GET /esi/universe/systems/:systemId
 * Get system details by ID
 */
app.get('/universe/systems/:systemId', async (c) => {
	try {
		const systemId = c.req.param('systemId')

		const esiService = new EsiService(c.env)
		const details = await esiService.getSystemDetails(systemId)
		return c.json(details)
	} catch (error) {
		logger.error('Error getting system details:', error)
		return c.json({ error: 'Failed to get system details' }, 500)
	}
})

/**
 * GET /esi/universe/stations/:stationId
 * Get station details by ID
 */
app.get('/universe/stations/:stationId', async (c) => {
	try {
		const stationId = c.req.param('stationId')

		const esiService = new EsiService(c.env)
		const details = await esiService.getStationDetails(stationId)
		return c.json(details)
	} catch (error) {
		logger.error('Error getting station details:', error)
		return c.json({ error: 'Failed to get station details' }, 500)
	}
})

app.get('/universe/systems/:systemId/celestials', async (c) => {
	try {
		const systemId = c.req.param('systemId')
		if (!/^\d+$/.test(systemId)) return c.json({ error: 'Invalid system id' }, 400)
		const universeStub = getStub<Universe>(c.env.UNIVERSE, 'default')
		const [planets, moons] = await Promise.all([
			universeStub.getPlanetsBySystemId(systemId),
			universeStub.getMoonsBySystemId(systemId),
		])
		return c.json({
			planets: planets.map((planet) => ({ id: planet.planetId, name: planet.planetName })),
			moons: moons.map((moon) => ({
				id: moon.moonId,
				name: moon.moonName,
				planetId: moon.planetId,
			})),
		})
	} catch (error) {
		logger.error('Error getting system celestials:', error)
		return c.json({ error: 'Failed to get system celestials' }, 500)
	}
})

export default app
