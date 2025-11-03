/**
 * ESI routes - Proxy for EVE Online ESI API
 *
 * These endpoints provide a backend proxy to ESI for location searches and lookups.
 * Includes caching to reduce load on ESI and improve performance.
 */

import { Hono } from 'hono'

import { logger } from '@repo/hono-helpers'

import { requireAuth } from '../middleware/session'
import { EsiService } from '../services/esi.service'

import type { App } from '../context'

const app = new Hono<App>()

// Require authentication for all ESI routes
app.use('*', requireAuth())

/**
 * GET /esi/search/systems?q={query}
 * Search for solar systems by name
 */
app.get('/search/systems', async (c) => {
	try {
		const query = c.req.query('q')
		logger.info('ESI route /search/systems called', { query, hasUser: !!c.get('user') })

		if (!query || query.length < 2) {
			logger.info('ESI route /search/systems: query too short', { query })
			return c.json({ error: 'Query must be at least 2 characters' }, 400)
		}

		const esiService = new EsiService(c.env)
		logger.info('ESI route /search/systems: calling esiService.searchSystems')
		const results = await esiService.searchSystems(query)
		logger.info('ESI route /search/systems: returning results', { resultCount: results.length })
		return c.json(results)
	} catch (error) {
		logger.error('Error in ESI systems search:', error)
		return c.json({ error: 'Failed to search systems' }, 500)
	}
})

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

/**
 * GET /esi/universe/structures/:structureId
 * Get structure details by ID (requires authentication)
 */
app.get('/universe/structures/:structureId', async (c) => {
	try {
		const structureId = c.req.param('structureId')

		const esiService = new EsiService(c.env)
		const details = await esiService.getStructureDetails(structureId)
		return c.json(details)
	} catch (error) {
		logger.error('Error getting structure details:', error)
		return c.json({ error: 'Failed to get structure details' }, 500)
	}
})

export default app
